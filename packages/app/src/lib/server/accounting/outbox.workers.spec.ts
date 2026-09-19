import { env } from 'cloudflare:test';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { EntrySourceType } from '../db/schema';
import { post, postingStatements, type Posting } from '../ledger/posting';
import { outboxGate, outboxStatements } from './outbox';

// the queue row a posting owes QuickBooks, against a real D1.
//
// a workers spec because both claims are the database's: that the queue row lands in the same
// `batch()` as the entry it is about, and that a batch the database refuses leaves none of it
// behind. a stand-in would only prove the stand-in (CONTRIBUTING.md -> Tests).
//
// nothing here reaches a poster. the four that splice this in are covered beside themselves; what
// is under test here is the rule itself — which source types are owed, and what the connection's
// own start date does to a posting dated either side of it.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	// the queue first: `quickbooks_sync.entry_group_id` is a foreign key, so the other order is a
	// constraint violation rather than an empty table.
	await env.DB.prepare('delete from quickbooks_sync').run();
	await env.DB.prepare('delete from ledger_entry').run();
	await env.DB.prepare('delete from entry_group').run();
	await env.DB.prepare('delete from quickbooks_connection').run();
});

const CONNECTED_FROM = new Date('2026-01-01T00:00:00.000Z');

/** the company connected, sending everything posted on or after `startAt`. */
async function connect(startAt: Date = CONNECTED_FROM): Promise<void> {
	await env.DB.prepare(
		`insert into quickbooks_connection (id, realm_id, access_token, access_token_expires_at,
		                                    refresh_token, start_at, created_at, updated_at)
		 values ('quickbooks', '4620816365', 'access', 0, 'refresh', ?, 0, 0)`
	)
		.bind(startAt.getTime())
		.run();
}

/** one balanced entry, through `post()` rather than around it — `Posting` is branded. */
function posting(
	over: { sourceType?: EntrySourceType; occurredAt?: Date; sourceId?: string } = {}
): Posting {
	return post({
		sourceType: over.sourceType ?? 'payment',
		sourceId: over.sourceId ?? uuidv7(),
		currency: 'USD',
		occurredAt: over.occurredAt ?? new Date('2026-03-01T12:00:00.000Z'),
		memo: null,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor: 10_000 },
			{ accountId: postableId('donationsDeductible'), amountMinor: -10_000 }
		]
	});
}

/** the whole queue, straight out of D1. */
async function queued() {
	const { results } = await env.DB.prepare(
		`select entry_group_id, status, attempts, remote_id, last_error
		 from quickbooks_sync order by entry_group_id`
	).all<{
		entry_group_id: string;
		status: string;
		attempts: number;
		remote_id: string | null;
		last_error: string | null;
	}>();
	return results;
}

/**
 * one commit holding the postings and whatever the gate owes for them, the shape every poster
 * splices.
 */
async function commit(postings: readonly (Posting | null)[]): Promise<void> {
	const gate = await outboxGate(db);
	const statements: BatchItem<'sqlite'>[] = [];
	for (const p of postings) {
		if (p !== null) statements.push(...postingStatements(db, p));
	}
	const [first, ...rest] = [...statements, ...outboxStatements(db, gate, postings)];
	if (first === undefined) throw new Error('this fixture was handed nothing to write');
	await db.batch([first, ...rest]);
}

describe('the gate', () => {
	it('queues nothing where no company is connected', async () => {
		const entry = posting();

		await commit([entry]);

		// the posting still landed: not connected is a state the books do not notice.
		const groups = await env.DB.prepare('select id from entry_group').all();
		expect(groups.results).toHaveLength(1);
		expect(await queued()).toEqual([]);
	});

	it('queues a connected company’s posting as pending, never tried', async () => {
		await connect();
		const entry = posting();

		await commit([entry]);

		expect(await queued()).toEqual([
			{
				entry_group_id: entry.group.id,
				status: 'pending',
				attempts: 0,
				remote_id: null,
				last_error: null
			}
		]);
	});
});

describe('what a posting has to be to be owed', () => {
	it('queues the gift and not the processor’s cut that came with it', async () => {
		await connect();
		const paymentId = uuidv7();
		const charge = posting({ sourceType: 'payment', sourceId: paymentId });
		const fee = posting({ sourceType: 'fee', sourceId: paymentId });

		await commit([charge, fee]);

		// the fee becomes a line on the sales receipt the charge is sent as, so a row for it would
		// send the same money twice.
		expect(await queued()).toMatchObject([{ entry_group_id: charge.group.id }]);
	});

	it('queues a correcting entry', async () => {
		await connect();
		const correction = posting({ sourceType: 'adjustment' });

		await commit([correction]);

		expect(await queued()).toMatchObject([{ entry_group_id: correction.group.id }]);
	});
});

describe('the date a connection starts from', () => {
	it('queues nothing dated before the company was connected', async () => {
		await connect(new Date('2026-04-01T00:00:00.000Z'));

		await commit([posting({ occurredAt: new Date('2026-03-31T23:59:59.999Z') })]);

		// what is already in the books from before a connect is the connect flow's backfill, and
		// queueing it here would send it twice.
		expect(await queued()).toEqual([]);
	});

	it('queues a posting dated at the instant the company was connected', async () => {
		const startAt = new Date('2026-04-01T00:00:00.000Z');
		await connect(startAt);
		const entry = posting({ occurredAt: startAt });

		await commit([entry]);

		// inclusive at the start: an operator naming a date means that day's gifts go over.
		expect(await queued()).toMatchObject([{ entry_group_id: entry.group.id }]);
	});
});

describe('a settlement the database refuses', () => {
	it('leaves no queue row behind, and leaves the first one where it was', async () => {
		await connect();
		const first = posting();
		await commit([first]);
		// the row as a delivery that already ran would have left it.
		await env.DB.prepare(
			`update quickbooks_sync set status = 'sent', attempts = 1, remote_id = '42'`
		).run();

		// a redelivered webhook reaches the same (source_type, source_id), which
		// `entry_group_source_idx` refuses — and the queue insert is in that same commit.
		await expect(commit([posting({ sourceId: first.group.sourceId })])).rejects.toThrowError();

		expect(await queued()).toMatchObject([
			{ entry_group_id: first.group.id, status: 'sent', attempts: 1, remote_id: '42' }
		]);
	});
});
