import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { readDonorPage } from './donor';
import { readGiftPage } from './gift';
import type { Keyset, PageQuery } from './paging';
import { readRecurringGiftPage } from './recurring-gift';

// every list the read API answers is walked a page at a time over a table that only grows, and a
// sync walks it on every run, so what a page must not do is scan its table or sort it. the plan is
// read for the walk's own statement — the first each read prepares — with the values it binds: a
// partial index is only chosen when sqlite can see the bound values match the index's own `where`.

type Prepared = { readonly sql: string; readonly params: unknown[] };

/** a D1 handle that records each statement prepared on it, and what was bound to it. */
function recording(db: D1Database): { readonly handle: D1Database; readonly prepared: Prepared[] } {
	const prepared: Prepared[] = [];
	const handle = new Proxy(db, {
		get(target, key) {
			if (key !== 'prepare') return Reflect.get(target, key, target);
			return (sql: string) => {
				const entry: Prepared = { sql, params: [] };
				prepared.push(entry);
				const statement = target.prepare(sql);
				return new Proxy(statement, {
					get(stmt, method) {
						if (method !== 'bind') return Reflect.get(stmt, method, stmt);
						return (...params: unknown[]) => {
							entry.params.push(...params);
							return stmt.bind(...params);
						};
					}
				});
			};
		}
	});
	return { handle, prepared };
}

/** the statement `read` prepares first, and sqlite's plan for it with what it bound. */
async function walkOf(
	read: (db: Db) => Promise<unknown>
): Promise<{ sql: string; plan: string[] }> {
	const { handle, prepared } = recording(env.DB);
	await read(createDb(handle));
	const [walk] = prepared;
	if (walk === undefined) throw new Error('the read prepared no statement');
	const { results } = await env.DB.prepare(`explain query plan ${walk.sql}`)
		.bind(...walk.params)
		.all<{ detail: string }>();
	return { sql: walk.sql, plan: results.map((step) => step.detail) };
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
	// index, so a page reads as far as its last gift and no further. two streams order by a time
	// whose tie-break id is on another row, and sort only the rows sharing one millisecond.
	it.each(pages)(
		'are walked oldest change first by merging each kind of change off its own index for %s, never a scan or a sort of payment',
		async (_, after) => {
			const { sql, plan } = await walkOf((db) =>
				readGiftPage(db, { order: 'changed', limit: 50, after, since })
			);

			expect(sql).toMatch(/ union /);
			for (const index of [
				/^SEARCH gift USING (?:COVERING )?INDEX payment_settled_gift_created_at_idx \(created_at>\?\)/,
				/^SEARCH \w+ USING (?:COVERING )?INDEX payment_refund_created_at_idx \(created_at>\?\)/,
				/^SEARCH \w+ USING (?:COVERING )?INDEX entry_group_created_at_idx \(created_at>\?\)/,
				/^SEARCH \w+ USING (?:COVERING )?INDEX dispute_updated_at_idx \(updated_at>\?\)/
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
