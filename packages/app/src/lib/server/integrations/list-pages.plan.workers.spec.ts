import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment } from '../db/schema';
import { readDonorPage } from './donor';
import { readGiftPage } from './gift';
import type { Keyset, PageQuery } from './paging';
import { readRecurringGiftPage } from './recurring-gift';
import { type Prepared, statementsOf } from './statements.testing';

// every list the read API answers is walked a page at a time over a table that only grows, and a
// sync walks it on every run, so what a page must not do is scan its table or sort it. the plan is
// read for each statement the walk itself prepares — the first a read prepares, and for the gifts'
// walk of changes the first two — with the values it binds: a partial index is only chosen when
// sqlite can see the bound values match the index's own `where`.

/** sqlite's plan for `statement`, with what it bound. */
async function planOf(statement: Prepared): Promise<string[]> {
	const { results } = await env.DB.prepare(`explain query plan ${statement.sql}`)
		.bind(...statement.params)
		.all<{ detail: string }>();
	return results.map((step) => step.detail);
}

/** the statement `read` prepares first, and sqlite's plan for it with what it bound. */
async function walkOf(
	read: (db: Db) => Promise<unknown>
): Promise<{ sql: string; plan: string[] }> {
	const [walk] = await statementsOf(read);
	if (walk === undefined) throw new Error('the read prepared no statement');
	return { sql: walk.sql, plan: await planOf(walk) };
}

const past: Keyset = {
	at: Date.parse('2026-09-10T12:00:00.000Z'),
	id: '019fb300-0000-7000-8000-000000000004'
};
const since = new Date('2026-09-01T00:00:00.000Z');
const pages = [
	['the first page', null],
	['a page past a cursor', past]
] as const;

describe('the gifts', () => {
	it.each(pages)(
		'are walked newest first through their partial index for %s, never a scan or a sort of payment',
		async (_, after) => {
			const { sql, plan } = await walkOf((db) =>
				readGiftPage(db, { order: 'newest', limit: 50, after })
			);

			expect(sql).toMatch(/from "payment"/);
			expect(sql).toMatch(/order by "payment"."occurred_at" desc, "payment"."id" desc/);
			expect(plan).toContainEqual(
				expect.stringMatching(
					/^(?:SCAN|SEARCH) payment USING (?:COVERING )?INDEX payment_settled_gift_occurred_at_idx\b/
				)
			);
			expect(plan).not.toContainEqual(expect.stringMatching(/TEMP B-TREE FOR ORDER BY/));
		}
	);

	// `updated_at` is the latest of several writes (`changedAt` in ./gift.ts), so no one index holds
	// it in order. the walk merges one stream per kind of write, each read in order off its own
	// index, inside a window closed at the time of a counted write, which is read first off the same
	// indexes. two streams order by a time whose tie-break id is on another row, and sort only the
	// rows sharing one millisecond. the window is closed only where there are writes enough to count
	// to, so each page's gifts are written past the cursor: four writes, and a page of one counts to
	// its fourth.
	describe('oldest change first', () => {
		beforeAll(async () => {
			const db = createDb(env.DB);
			await db
				.insert(contact)
				.values({ id: 'contact-plan', kind: 'individual', displayName: 'Ada' });
			for (const n of [1, 2, 3, 4]) {
				const at = new Date(Date.UTC(2026, 8, 20, n));
				await db.insert(donation).values({
					id: `donation-plan-${n}`,
					contactId: 'contact-plan',
					totalMinor: 5_000,
					currency: 'USD',
					receivedAt: at
				});
				await db.insert(payment).values({
					id: `019fb300-0000-7000-8000-00000000010${n}`,
					donationId: `donation-plan-${n}`,
					amountMinor: 5_000,
					currency: 'USD',
					direction: 'inbound',
					method: 'check',
					status: 'succeeded',
					provider: 'manual',
					occurredAt: at,
					createdAt: at
				});
			}
		});

		const changedWalk = (after: Keyset | null) =>
			statementsOf((db) => readGiftPage(db, { order: 'changed', limit: 1, after, since }));

		it.each(pages)(
			'close the window for %s off the four indexes alone, never a scan or a sort',
			async (_, after) => {
				const [window] = await changedWalk(after);
				if (window === undefined) throw new Error('the walk prepared no statement');
				const plan = await planOf(window);

				expect(window.sql).toMatch(/ union all /);
				expect(window.sql).toMatch(/ offset \?$/);
				for (const index of [
					/^SEARCH \w+ USING COVERING INDEX payment_settled_gift_created_at_idx \(created_at>\?\)/,
					/^SEARCH \w+ USING COVERING INDEX payment_refund_created_at_idx \(created_at>\?\)/,
					/^SEARCH \w+ USING COVERING INDEX entry_group_created_at_idx \(created_at>\?\)/,
					/^SEARCH \w+ USING COVERING INDEX dispute_updated_at_idx \(updated_at>\?\)/
				])
					expect(plan).toContainEqual(expect.stringMatching(index));
				expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN |TEMP B-TREE/));
			}
		);

		it.each(pages)(
			'are merged for %s from each kind of change off its own index inside the window, never a scan or a sort of payment',
			async (_, after) => {
				const [, walk] = await changedWalk(after);
				if (walk === undefined) throw new Error('the walk prepared no second statement');
				const plan = await planOf(walk);

				expect(walk.sql).toMatch(/ union /);
				for (const index of [
					/^SEARCH gift USING (?:COVERING )?INDEX payment_settled_gift_created_at_idx \(created_at>\? AND created_at<\?\)/,
					/^SEARCH \w+ USING (?:COVERING )?INDEX payment_refund_created_at_idx \(created_at>\? AND created_at<\?\)/,
					/^SEARCH \w+ USING (?:COVERING )?INDEX entry_group_created_at_idx \(created_at>\? AND created_at<\?\)/,
					/^SEARCH \w+ USING (?:COVERING )?INDEX dispute_updated_at_idx \(updated_at>\? AND updated_at<\?\)/
				])
					expect(plan).toContainEqual(expect.stringMatching(index));
				expect(plan).toContainEqual(expect.stringMatching(/^MERGE \(UNION\)/));
				expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN /));
				const sorts = plan.filter((step) => step.includes('TEMP B-TREE'));
				expect(
					sorts.filter((step) => !/FOR (?:LAST TERM|RIGHT PART) OF ORDER BY$/.test(step))
				).toEqual([]);
			}
		);

		// D1 refuses a statement binding more than 100 parameters, and every `updated_since` page
		// prepares these two: half of that leaves a stream or a source type room to arrive.
		it.each(pages)('bind at most 50 parameters a statement for %s', async (_, after) => {
			const [window, walk] = await changedWalk(after);

			expect(window?.params.length).toBeLessThanOrEqual(50);
			expect(walk?.params.length).toBeLessThanOrEqual(50);
		});
	});
});

const storedTimesOrders = (after: Keyset | null): readonly [string, PageQuery][] => [
	['newest first', { order: 'newest', limit: 50, after }],
	['oldest change first', { order: 'changed', limit: 50, after, since }]
];

describe.each(pages)('on %s', (_, after) => {
	it.each(storedTimesOrders(after))(
		'the donors are walked %s through an index of the listed contacts, never a sort of contact',
		async (order, query) => {
			const { plan } = await walkOf((db) => readDonorPage(db, query));

			const index =
				order === 'newest first'
					? 'contact_unarchived_created_at_idx'
					: 'contact_unarchived_updated_at_idx';
			expect(plan).toContainEqual(
				expect.stringMatching(new RegExp(`^(?:SCAN|SEARCH) contact USING INDEX ${index}\\b`))
			);
			expect(plan).not.toContainEqual(expect.stringMatching(/TEMP B-TREE/));
		}
	);

	it.each(storedTimesOrders(after))(
		'the recurring gifts are walked %s through an index of their own, never a sort of recurring_plan',
		async (order, query) => {
			const { plan } = await walkOf((db) => readRecurringGiftPage(db, query));

			const index =
				order === 'newest first'
					? 'recurring_plan_created_at_idx'
					: 'recurring_plan_updated_at_idx';
			expect(plan).toContainEqual(
				expect.stringMatching(new RegExp(`^(?:SCAN|SEARCH) recurring_plan USING INDEX ${index}\\b`))
			);
			expect(plan).not.toContainEqual(expect.stringMatching(/TEMP B-TREE/));
		}
	);
});
