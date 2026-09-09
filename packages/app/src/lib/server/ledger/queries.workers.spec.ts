import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { donationRevenueAccount, POSTING_ACCOUNTS, postableId } from '../db/accounts';
import { postableFromAccount } from '../db/postable';
import { createDb, type Db } from '../db/client';
import { post, postingStatements, type PostingInput } from './posting';
import {
	ENTRY_GROUP_LIST_LIMIT,
	findEntryGroup,
	listEntryGroups,
	readRaisedByMonth
} from './queries';

// the read half of the ledger, against a real D1.
//
// it is a `*.workers.spec.ts` and not a pure one because everything worth asserting here is
// D1's: the order rows come back in, that the cap is a `LIMIT` the database applied rather
// than a slice over everything, and that each group's lines arrive under the group they
// belong to. a stand-in would only prove the stand-in.
//
// the rows are seeded through `post()` and `postingStatements` rather than by hand, so what is
// read back is what the writer actually writes — the same shape the next slice's screen will
// list.

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

/** a correction, balanced, at a business time the test chooses. */
const correction = (occurredAt: Date, over: Partial<PostingInput> = {}): PostingInput => ({
	sourceType: 'adjustment',
	sourceId: uuidv7(),
	currency: 'USD',
	occurredAt,
	lines: [
		{ accountId: donationRevenueAccount(true), amountMinor: 2_500 },
		{ accountId: postableId('bankCash'), amountMinor: -2_500 }
	],
	...over
});

/** writes `inputs` one posting per `batch()`, the way a call site does. */
async function postAll(inputs: readonly PostingInput[]): Promise<string[]> {
	const ids: string[] = [];
	for (const input of inputs) {
		const posting = post(input);
		await db.batch(postingStatements(db, posting));
		ids.push(posting.group.id!);
	}
	return ids;
}

describe('listEntryGroups()', () => {
	beforeEach(async () => {
		// storage is isolated per file rather than per test, so rows written by one `it` are
		// visible to the next — and the cap cases below seed a full page of their own.
		await env.DB.prepare('delete from ledger_entry').run();
		await env.DB.prepare('delete from entry_group').run();
	});

	it('reads an empty ledger as an empty page with nothing beyond it', async () => {
		// the state every deployment starts in, and the one where `hasMore` inferred from a
		// count rather than probed would still be right — which is why it is not the case that
		// proves the probe.
		expect(await listEntryGroups(db)).toEqual({ groups: [], hasMore: false });
	});

	it('returns groups newest first in business time', async () => {
		// `occurred_at` and never `created_at`: business time is when the money moved, and a
		// correction posted today against last month's books belongs where the accountant put
		// it rather than where the clock did. the rows are written oldest-first here so an
		// unordered read would come back in exactly the wrong order.
		await postAll([
			correction(new Date('2026-01-31T00:00:00.000Z'), { memo: 'january' }),
			correction(new Date('2026-02-28T00:00:00.000Z'), { memo: 'february' }),
			correction(new Date('2026-03-31T00:00:00.000Z'), { memo: 'march' })
		]);

		const { groups } = await listEntryGroups(db);
		expect(groups.map((g) => g.memo)).toEqual(['march', 'february', 'january']);
	});

	it('breaks a tie on business time by id, so the order does not reshuffle', async () => {
		// `occurred_at` is unix ms and workerd freezes the clock between I/O, so corrections
		// entered in one request routinely share a timestamp. the id is a uuidv7 minted by
		// `post()`, so the greater id is the later posting — without the tiebreak the answer is
		// whatever order the rows came back in, and the list reorders itself between loads.
		const sameMoment = new Date('2026-04-01T00:00:00.000Z');
		const ids = await postAll([
			correction(sameMoment),
			correction(sameMoment),
			correction(sameMoment)
		]);

		const { groups } = await listEntryGroups(db);
		expect(groups.map((g) => g.id)).toEqual([...ids].reverse());
	});

	it('carries each group its own lines, in the order they were posted', async () => {
		// the claim a join per group would make and a second read has to earn: a line arriving
		// under the wrong group is a report that is wrong with every row reading clean.
		const [first] = await postAll([
			correction(new Date('2026-05-01T00:00:00.000Z'), { memo: 'the one under test' }),
			correction(new Date('2026-04-01T00:00:00.000Z'), { memo: 'a neighbour' })
		]);

		const { groups } = await listEntryGroups(db);
		expect(groups).toHaveLength(2);
		const group = groups[0]!;
		expect(group.id).toBe(first);
		expect(group.sourceType).toBe('adjustment');
		// the debit first, as `post()` was handed it. the ids are uuidv7 minted in line order,
		// which is what the read orders by.
		expect(group.lines.map((l) => l.amountMinor)).toEqual([2_500, -2_500]);
		expect(group.lines.map((l) => l.accountId)).toEqual([
			POSTING_ACCOUNTS.donationsDeductible.id,
			POSTING_ACCOUNTS.bankCash.id
		]);
		// derived at read time, the way every figure in this app is.
		expect(group.lines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
		expect(groups[1]!.lines).toHaveLength(2);
	});

	it('reports no more when the ledger holds exactly a full page', async () => {
		// the number `hasMore` is wrong at when it is inferred from the page's own length:
		// a deployment sitting on exactly the cap would be told there are entries it is not
		// being shown.
		await postAll(
			Array.from({ length: ENTRY_GROUP_LIST_LIMIT }, (_, i) =>
				correction(new Date(Date.UTC(2026, 0, 1) + i))
			)
		);

		const { groups, hasMore } = await listEntryGroups(db);
		expect(groups).toHaveLength(ENTRY_GROUP_LIST_LIMIT);
		expect(hasMore).toBe(false);
	});

	it('caps the page and reports more, never handing back the probe row', async () => {
		// the probe is sliced off inside the read rather than handed over with a warning, so
		// there is no shape in which a caller renders one more than the cap by forgetting to.
		const ids = await postAll(
			Array.from({ length: ENTRY_GROUP_LIST_LIMIT + 1 }, (_, i) =>
				correction(new Date(Date.UTC(2026, 0, 1) + i))
			)
		);

		const { groups, hasMore } = await listEntryGroups(db);
		expect(groups).toHaveLength(ENTRY_GROUP_LIST_LIMIT);
		expect(hasMore).toBe(true);
		// newest first, so the row the cap drops is the oldest — the first one written.
		expect(groups.map((g) => g.id)).not.toContain(ids[0]);
		expect(groups[0]!.id).toBe(ids[ids.length - 1]);
		// and the probe brought no lines with it either: the follow-up read is bound to the
		// page's ids, which is what keeps it under D1's 100-parameter cap.
		expect(groups.every((g) => g.lines.length === 2)).toBe(true);
	});
});

describe('findEntryGroup()', () => {
	beforeEach(async () => {
		await env.DB.prepare('delete from ledger_entry').run();
		await env.DB.prepare('delete from entry_group').run();
	});

	it('finds an entry by the pair that identifies it, with its lines', async () => {
		const sourceId = uuidv7();
		const [id] = await postAll([correction(new Date(Date.UTC(2026, 2, 31)), { sourceId })]);

		const found = await findEntryGroup(db, 'adjustment', sourceId);
		expect(found?.id).toBe(id);
		expect(found?.lines).toHaveLength(2);
		expect(found?.occurredAt).toEqual(new Date(Date.UTC(2026, 2, 31)));
	});

	it('finds one dated before everything the list page holds', async () => {
		// the case this read exists for. `listEntryGroups` is capped and ordered by business time,
		// and backdating a correction is the documented use of `occurred_at` — so a correction
		// dated before the page's oldest row is one a search over that page cannot find, which
		// would leave a write that succeeded reporting nothing at all.
		const sourceId = uuidv7();
		await postAll(
			Array.from({ length: ENTRY_GROUP_LIST_LIMIT }, (_, i) =>
				correction(new Date(Date.UTC(2026, 0, 1) + i))
			)
		);
		await postAll([correction(new Date(Date.UTC(2020, 0, 1)), { sourceId })]);

		const { groups } = await listEntryGroups(db);
		expect(groups.map((g) => g.sourceId)).not.toContain(sourceId);
		expect((await findEntryGroup(db, 'adjustment', sourceId))?.sourceId).toBe(sourceId);
	});

	it('is null where the pair names nothing, and reads the whole pair', async () => {
		// both halves, because `source_id` alone is not the key: `entry_group_source_idx` is unique
		// over the pair, so a `payment` and an `adjustment` may legitimately carry one id between
		// them and a read on one half would hand back whichever came first.
		const sourceId = uuidv7();
		await postAll([correction(new Date(Date.UTC(2026, 2, 31)), { sourceId })]);

		expect(await findEntryGroup(db, 'adjustment', uuidv7())).toBeNull();
		expect(await findEntryGroup(db, 'payment', sourceId)).toBeNull();
	});
});

describe('readRaisedByMonth()', () => {
	beforeEach(async () => {
		await env.DB.prepare('delete from ledger_entry').run();
		await env.DB.prepare('delete from entry_group').run();
	});

	/** a gift of `amountMinor`, at the revenue account a deductible gift posts to. */
	const gift = (occurredAt: Date, amountMinor: number): PostingInput => ({
		sourceType: 'donation',
		sourceId: uuidv7(),
		currency: 'USD',
		occurredAt,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor },
			{ accountId: donationRevenueAccount(true), amountMinor: -amountMinor }
		]
	});

	/** what the processor kept out of a settlement, expensed gross. */
	const fee = (occurredAt: Date, amountMinor: number): PostingInput => ({
		sourceType: 'fee',
		sourceId: uuidv7(),
		currency: 'USD',
		occurredAt,
		lines: [
			{ accountId: postableId('processorFees'), amountMinor },
			{ accountId: postableId('undepositedFunds'), amountMinor: -amountMinor }
		]
	});

	it('is what the gift credited revenue, and the fee against it changes nothing', async () => {
		// raised is the face value of the gift and never the net. the fee debits an expense and
		// credits the asset the gift landed in, so a read that summed anything but the revenue
		// subtree would report a smaller month every time a processor took its cut.
		await postAll([
			gift(new Date('2026-09-04T00:00:00.000Z'), 10_000),
			fee(new Date('2026-09-04T00:00:00.000Z'), 320)
		]);

		expect(await readRaisedByMonth(db)).toEqual([{ month: '2026-09', raisedMinor: 10_000 }]);
	});

	it('counts a gift posted to a revenue account this codebase does not name', async () => {
		// the chart gains a child under 4110 per program, and none of them is in
		// ../db/accounts.ts's map. a read that named the two seeded revenue accounts would stop
		// counting the moment the first program's own account was posted to — silently, because
		// every row still reads clean. the walk is what makes this pass.
		const id = uuidv7();
		await env.DB.prepare(
			`insert into account (id, code, name, type, is_deductible, is_tax, is_postable,
			                      parent_id, created_at, updated_at)
			 values (?, '4111', 'Clean water', 'revenue', 1, 0, 1, ?, 0, 0)`
		)
			.bind(id, POSTING_ACCOUNTS.donationsDeductible.id)
			.run();
		const program = postableFromAccount({ id, isPostable: true });
		if (!program) throw new Error('the account seeded above reads as a rollup');

		await postAll([
			{
				sourceType: 'donation',
				sourceId: uuidv7(),
				currency: 'USD',
				occurredAt: new Date('2026-09-04T00:00:00.000Z'),
				lines: [
					{ accountId: postableId('undepositedFunds'), amountMinor: 2_500 },
					{ accountId: program, amountMinor: -2_500 }
				]
			}
		]);

		expect(await readRaisedByMonth(db)).toEqual([{ month: '2026-09', raisedMinor: 2_500 }]);
	});

	it('takes a refund back off the month it was made in', async () => {
		// a refund debits the same revenue account the gift credited, so the sign convention is the
		// whole of it — there is no second read and no special case, and money given back stops
		// being money raised.
		await postAll([
			gift(new Date('2026-09-04T00:00:00.000Z'), 10_000),
			{
				sourceType: 'refund',
				sourceId: uuidv7(),
				currency: 'USD',
				occurredAt: new Date('2026-09-20T00:00:00.000Z'),
				lines: [
					{ accountId: donationRevenueAccount(true), amountMinor: 4_000 },
					{ accountId: postableId('undepositedFunds'), amountMinor: -4_000 }
				]
			}
		]);

		expect(await readRaisedByMonth(db)).toEqual([{ month: '2026-09', raisedMinor: 6_000 }]);
	});

	it('buckets by the month the money moved, to the millisecond, and never by the row’s own', async () => {
		// business time and never system time. both gifts below are written now, and the first one
		// moved at the last instant of August — a read grouping on `created_at` would put it in
		// whichever month the deployment happens to be running in, which is the asynchronous
		// settlement case: a charge that lands in October against a gift made in September belongs
		// to September's figure.
		await postAll([
			gift(new Date(Date.UTC(2026, 8, 1) - 1), 3_000),
			gift(new Date(Date.UTC(2026, 8, 1)), 7_000)
		]);

		expect(await readRaisedByMonth(db)).toEqual([
			{ month: '2026-08', raisedMinor: 3_000 },
			{ month: '2026-09', raisedMinor: 7_000 }
		]);
	});

	it('reads a deployment that has taken nothing as no months at all', async () => {
		// no row rather than a row of noughts, which is what `overMonths` in ../months.ts turns into
		// twelve empty buckets — the zero state is the same screen with nothing in it.
		expect(await readRaisedByMonth(db)).toEqual([]);
	});
});
