import { env } from 'cloudflare:test';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { EntrySourceType } from '../db/schema';
import { post, postingStatements, type Posting } from '../ledger/posting';
import { dueRows } from './deliver';
import { moveQuickbooksStartAt, outboxStatements, previewQuickbooksStartAt } from './outbox';

// the queue row a posting owes QuickBooks, against a real D1.
//
// a workers spec because both claims are the database's: that the queue row lands in the same
// `batch()` as the entry it is about, and that a batch the database refuses leaves none of it
// behind. a stand-in would only prove the stand-in (CONTRIBUTING.md -> Tests).
//
// nothing here reaches a poster. the four that splice this in are covered beside themselves; what
// is under test here is the rule itself — which source types are owed, and what the connection's
// own start date does to a posting dated either side of it, and to the queue when that date moves.

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
 * the postings and whatever they owe, built the way every poster builds its batch — before it
 * runs, so a test can let something land in between.
 */
function settlement(
	postings: readonly (Posting | null)[]
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
	const statements: BatchItem<'sqlite'>[] = [];
	for (const p of postings) {
		if (p !== null) statements.push(...postingStatements(db, p));
	}
	const [first, ...rest] = [...statements, ...outboxStatements(db, postings)];
	if (first === undefined) throw new Error('this fixture was handed nothing to write');
	return [first, ...rest];
}

/** one commit holding the postings and whatever they owe, the shape every poster splices. */
async function commit(postings: readonly (Posting | null)[]): Promise<void> {
	await db.batch(settlement(postings));
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

		// a gift dated before the start date reaches the queue only by the date moving over it.
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

describe('moving the date a connection starts from', () => {
	const NOW = new Date('2026-06-01T00:00:00.000Z');

	it('queues every owed gift from the new date on, those settled before the company was connected included', async () => {
		const beforeConnect = posting({ occurredAt: new Date('2025-11-15T00:00:00.000Z') });
		await commit([beforeConnect]);
		await connect(new Date('2026-04-01T00:00:00.000Z'));
		const beforeStart = posting({ occurredAt: new Date('2026-02-01T00:00:00.000Z') });
		const tooEarly = posting({ occurredAt: new Date('2025-09-30T23:59:59.999Z') });
		await commit([beforeStart, tooEarly]);

		await moveQuickbooksStartAt(db, new Date('2025-10-01T00:00:00.000Z'), NOW);

		expect((await queued()).map((row) => row.entry_group_id).sort()).toEqual(
			[beforeConnect.group.id, beforeStart.group.id].sort()
		);
		expect(await queued()).toMatchObject([
			{ status: 'pending', attempts: 0 },
			{ status: 'pending', attempts: 0 }
		]);
	});

	it('queues nothing new when the same move is made again, and leaves what it queued as it was', async () => {
		await commit([posting({ occurredAt: new Date('2025-12-01T00:00:00.000Z') })]);
		await connect();
		const earlier = new Date('2025-10-01T00:00:00.000Z');
		await moveQuickbooksStartAt(db, earlier, NOW);
		await env.DB.prepare(`update quickbooks_sync set attempts = 2, last_error = 'throttled'`).run();

		await moveQuickbooksStartAt(db, earlier, new Date('2026-06-02T00:00:00.000Z'));

		expect(await queued()).toMatchObject([{ attempts: 2, last_error: 'throttled' }]);
	});

	it('never queues the processor’s cut', async () => {
		const paymentId = uuidv7();
		const occurredAt = new Date('2025-12-01T00:00:00.000Z');
		const charge = posting({ sourceType: 'payment', sourceId: paymentId, occurredAt });
		await commit([charge, posting({ sourceType: 'fee', sourceId: paymentId, occurredAt })]);
		await connect();

		await moveQuickbooksStartAt(db, new Date('2025-10-01T00:00:00.000Z'), NOW);

		expect(await queued()).toMatchObject([{ entry_group_id: charge.group.id }]);
	});

	it('judges a gift settling afterwards by the moved date', async () => {
		await connect(new Date('2026-04-01T00:00:00.000Z'));
		await moveQuickbooksStartAt(db, new Date('2026-02-01T00:00:00.000Z'), NOW);
		const entry = posting({ occurredAt: new Date('2026-03-01T00:00:00.000Z') });

		await commit([entry]);

		expect(await queued()).toMatchObject([{ entry_group_id: entry.group.id }]);
	});

	it('judges a settlement built before the move and committed after it by the moved date', async () => {
		await connect(new Date('2026-04-01T00:00:00.000Z'));
		const entry = posting({ occurredAt: new Date('2026-03-01T00:00:00.000Z') });
		const built = settlement([entry]);

		await moveQuickbooksStartAt(db, new Date('2026-02-01T00:00:00.000Z'), NOW);
		await db.batch(built);

		expect(await queued()).toMatchObject([{ entry_group_id: entry.group.id }]);
	});

	it('queues nothing for a settlement built before a later move and committed after it', async () => {
		await connect(new Date('2026-02-01T00:00:00.000Z'));
		const built = settlement([posting({ occurredAt: new Date('2026-03-01T00:00:00.000Z') })]);

		await moveQuickbooksStartAt(db, new Date('2026-04-01T00:00:00.000Z'), NOW);
		await db.batch(built);

		expect(await queued()).toEqual([]);
	});

	it('sends a gift settling after a move ahead of the history it queued, and the history in date order', async () => {
		await connect(new Date('2026-04-01T00:00:00.000Z'));
		// out of date order on purpose, so an order by id or by commit cannot pass for date order.
		const history = [5, 1, 9, 3, 11, 7, 2, 10, 4, 8, 6].map((day) =>
			posting({ occurredAt: new Date(Date.UTC(2026, 1, day)) })
		);
		for (const entry of history) await commit([entry]);
		await moveQuickbooksStartAt(db, new Date('2025-10-01T00:00:00.000Z'), NOW);
		const settledAfter = posting({ occurredAt: new Date('2026-05-15T00:00:00.000Z') });
		await commit([settledAfter]);

		const run = await dueRows(db, new Date(Date.now() + 60_000));

		const byDate = [...history].sort(
			(a, b) => a.group.occurredAt.getTime() - b.group.occurredAt.getTime()
		);
		expect(run.map((row) => row.entryGroupId)).toEqual([
			settledAfter.group.id,
			...byDate.slice(0, 9).map((entry) => entry.group.id)
		]);
	});

	it('writes nothing where no company is connected', async () => {
		await commit([posting({ occurredAt: new Date('2025-12-01T00:00:00.000Z') })]);

		await moveQuickbooksStartAt(db, new Date('2025-10-01T00:00:00.000Z'), NOW);

		expect(await queued()).toEqual([]);
		const connections = await env.DB.prepare('select id from quickbooks_connection').all();
		expect(connections.results).toEqual([]);
	});

	describe('later', () => {
		const LATER = new Date('2026-04-01T00:00:00.000Z');

		/** one gift queued under the default connection, then its row set to how a run left it. */
		async function queuedAs(occurredAt: Date, row: string | null = null): Promise<string> {
			const entry = posting({ occurredAt });
			await commit([entry]);
			if (row !== null)
				await env.DB.prepare(`update quickbooks_sync set ${row} where entry_group_id = ?`)
					.bind(entry.group.id)
					.run();
			const { id } = entry.group;
			if (id === undefined) throw new Error('post() minted no id');
			return id;
		}

		it('drops the rows before the new date that no run has sent', async () => {
			await connect();
			await queuedAs(new Date('2026-02-01T00:00:00.000Z'));
			await queuedAs(new Date('2026-03-31T23:59:59.999Z'));
			const onTheDay = await queuedAs(LATER);
			const after = await queuedAs(new Date('2026-05-01T00:00:00.000Z'));

			await moveQuickbooksStartAt(db, LATER, NOW);

			expect((await queued()).map((row) => row.entry_group_id).sort()).toEqual(
				[onTheDay, after].sort()
			);
		});

		it('keeps a sent row, a row a run holds, and a row that has been tried', async () => {
			await connect();
			const before = new Date('2026-02-01T00:00:00.000Z');
			const sent = await queuedAs(before, `status = 'sent', remote_id = '42'`);
			const held = await queuedAs(before, `leased_until = ${NOW.getTime() + 60_000}`);
			// a try whose answer never came may have created the record, and only a row with an
			// attempt behind it tells the next send to look for it first (./quickbooks.ts).
			const tried = await queuedAs(before, `attempts = 1, last_error = 'unreachable'`);
			await queuedAs(before, `leased_until = ${NOW.getTime()}`);

			await moveQuickbooksStartAt(db, LATER, NOW);

			expect((await queued()).map((row) => row.entry_group_id).sort()).toEqual(
				[sent, held, tried].sort()
			);
		});

		it('keeps a row whose run died mid-send, and a move back leaves it counted', async () => {
			await connect();
			// how ./deliver.ts's claim leaves a row when its run dies after the post: counted, and
			// the lease run out.
			const died = await queuedAs(
				new Date('2026-02-01T00:00:00.000Z'),
				`attempts = 1, leased_until = ${NOW.getTime() - 1}`
			);

			await moveQuickbooksStartAt(db, LATER, NOW);
			await moveQuickbooksStartAt(db, new Date('2025-10-01T00:00:00.000Z'), NOW);

			expect(await queued()).toMatchObject([{ entry_group_id: died, attempts: 1 }]);
		});
	});
});

describe('what a move would do, asked before it is made', () => {
	const NOW = new Date('2026-06-01T00:00:00.000Z');
	const NONE = { gifts: 0, corrections: 0, earliest: null, latest: null };

	it('answers with what an earlier date then queues, gifts and corrections apart', async () => {
		const first = new Date('2025-10-02T00:00:00.000Z');
		const last = new Date('2026-01-31T00:00:00.000Z');
		await commit([
			posting({ occurredAt: first, sourceType: 'adjustment' }),
			posting({ occurredAt: new Date('2025-11-01T00:00:00.000Z') }),
			posting({ occurredAt: last })
		]);
		await commit([posting({ occurredAt: new Date('2025-09-01T00:00:00.000Z') })]);
		await connect(new Date('2026-02-01T00:00:00.000Z'));
		await commit([posting({ occurredAt: new Date('2026-03-01T00:00:00.000Z') })]);
		const proposed = new Date('2025-10-01T00:00:00.000Z');

		const answer = await previewQuickbooksStartAt(db, proposed, NOW);
		await moveQuickbooksStartAt(db, proposed, NOW);

		expect(answer).toEqual({
			queues: { gifts: 2, corrections: 1, earliest: first, latest: last },
			drops: NONE
		});
		expect(await queued()).toHaveLength(4);
	});

	it('answers with what a later date then drops, gifts and corrections apart, and writes nothing', async () => {
		await connect();
		const first = new Date('2026-01-15T00:00:00.000Z');
		const last = new Date('2026-02-15T00:00:00.000Z');
		await commit([
			posting({ occurredAt: first }),
			posting({ occurredAt: new Date('2026-02-01T00:00:00.000Z'), sourceType: 'adjustment' }),
			posting({ occurredAt: last, sourceType: 'adjustment' }),
			posting({ occurredAt: new Date('2026-05-15T00:00:00.000Z') })
		]);
		const proposed = new Date('2026-04-01T00:00:00.000Z');

		const answer = await previewQuickbooksStartAt(db, proposed, NOW);

		expect(answer).toEqual({
			queues: NONE,
			drops: { gifts: 1, corrections: 2, earliest: first, latest: last }
		});
		expect(await queued()).toHaveLength(4);
		await moveQuickbooksStartAt(db, proposed, NOW);
		expect(await queued()).toHaveLength(1);
	});

	it('answers nothing where no company is connected', async () => {
		await commit([posting({ occurredAt: new Date('2025-12-01T00:00:00.000Z') })]);

		expect(await previewQuickbooksStartAt(db, new Date('2025-10-01T00:00:00.000Z'), NOW)).toEqual({
			queues: NONE,
			drops: NONE
		});
	});
});
