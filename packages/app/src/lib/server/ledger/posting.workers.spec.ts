import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS, ROLLUPS, donationRevenueAccount, postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { rejectionCode } from '../db/rejection.testing';
import { entryGroup, type EntrySourceType, ledgerEntry } from '../db/schema';
import { PostingError, post, postingStatements, type PostingInput } from './posting';

// the ledger's acceptance criterion.
//
// the first half of this file touches no database at all, which is the point of `post()`
// being pure: "an entry group sums to exactly zero" is the one invariant the whole design
// rests on, and it is provable here with no D1, no browser, no Stripe and no fixture.
// the second half proves the statements it produces actually apply.
//
// the canonical fixture is the cash gift: $100 in hand, `+10_000` to 1010 Bank (debit
// asset), `−10_000` to 4110 Tax-Deductible Donations (credit revenue). deliberately not
// the card gift — a card charge is not cash and must debit 1020 Undeposited Funds, which
// is two groups (recognition and fee) and is covered against a real D1 in
// ../donations/settle.workers.spec.ts, not in the fixture that proves sums-to-zero.

const CASH_GIFT: PostingInput = {
	sourceType: 'donation',
	sourceId: 'don_canonical',
	currency: 'USD',
	occurredAt: new Date('2026-03-31T12:00:00.000Z'),
	lines: [
		{ accountId: postableId('bankCash'), amountMinor: 10_000 },
		{ accountId: donationRevenueAccount(true), amountMinor: -10_000 }
	]
};

/** `post` with one field of the canonical gift replaced. */
const gift = (over: Partial<PostingInput>): PostingInput => ({ ...CASH_GIFT, ...over });

/** runs `fn`, requires a `PostingError`, and hands back its code and message. */
function rejection(fn: () => unknown): PostingError {
	try {
		fn();
	} catch (e) {
		if (e instanceof PostingError) return e;
		throw e;
	}
	throw new Error('expected post() to reject this input, but it returned a Posting');
}

/**
 * the same helper for a statement D1 must refuse: runs `fn`, requires a rejection, hands
 * back the message. throws rather than returning a sentinel when the statement succeeds,
 * so a probe that stops being rejected fails loudly instead of passing quietly. (the twin
 * of `rejection` in ../db/donation-schema.workers.spec.ts, duplicated for the same reason
 * that one gives.)
 */
async function d1Rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

/**
 * the one row `rows` must contain.
 *
 * `noUncheckedIndexedAccess` types `rows[0]` as possibly undefined, which is correct — a
 * query's length is a runtime fact. asserting the count first and confining the `!` here
 * keeps every call site free of one, and makes a query that returned the wrong number of
 * rows fail on the count rather than on a property read of undefined.
 */
function one<T>(rows: readonly T[], what: string): T {
	expect(rows, `expected exactly one ${what}, got ${rows.length}`).toHaveLength(1);
	return rows[0]!;
}

describe('post() — the balanced entry', () => {
	it('accepts the canonical cash gift and resolves it into a group plus two lines', () => {
		const posting = post(CASH_GIFT);
		expect(posting.group.sourceType).toBe('donation');
		expect(posting.group.sourceId).toBe('don_canonical');
		expect(posting.group.currency).toBe('USD');
		expect(posting.group.occurredAt).toEqual(new Date('2026-03-31T12:00:00.000Z'));
		expect(posting.lines).toHaveLength(2);
	});

	it('holds the sign convention: + is a debit, − is a credit', () => {
		// the assertion the entire ledger reads through. a flip here inverts every balance
		// in the app and every number on a receipt.
		const posting = post(CASH_GIFT);
		const bank = posting.lines.find((l) => l.accountId === POSTING_ACCOUNTS.bankCash.id);
		const revenue = posting.lines.find(
			(l) => l.accountId === POSTING_ACCOUNTS.donationsDeductible.id
		);
		expect(bank?.amountMinor).toBe(10_000);
		expect(revenue?.amountMinor).toBe(-10_000);
	});

	it('links every line to its group and gives each row its own uuidv7', () => {
		const posting = post(CASH_GIFT);
		const groupId = posting.group.id;
		expect(groupId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		for (const line of posting.lines) {
			expect(line.entryGroupId).toBe(groupId);
			expect(line.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
			expect(line.id).not.toBe(groupId);
		}
		expect(new Set(posting.lines.map((l) => l.id)).size).toBe(posting.lines.length);
	});

	it('leaves created_at to the column default', () => {
		// system time belongs to the write, not to this function — it is what keeps `post()`
		// pure and what stops two rows of one entry disagreeing about when they were written.
		expect(post(CASH_GIFT).group.createdAt).toBeUndefined();
	});

	it('defaults memo to null and passes one through when given', () => {
		expect(post(CASH_GIFT).group.memo).toBeNull();
		expect(post(gift({ memo: 'gala table 4' })).group.memo).toBe('gala table 4');
	});

	it('accepts a three-line quid-pro-quo split', () => {
		// the shape that made two revenue accounts necessary rather than a flag on the gift:
		// one $100 gift where $25 of fair-market value came back to the donor.
		const posting = post(
			gift({
				lines: [
					{ accountId: postableId('bankCash'), amountMinor: 10_000 },
					{ accountId: donationRevenueAccount(true), amountMinor: -7_500 },
					{ accountId: donationRevenueAccount(false), amountMinor: -2_500 }
				]
			})
		);
		expect(posting.lines).toHaveLength(3);
		expect(posting.lines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
	});

	it('preserves line order', () => {
		// statement order follows this, and the group-then-lines ordering in
		// `postingStatements` is what makes the foreign key resolve.
		const posting = post(CASH_GIFT);
		expect(posting.lines.map((l) => l.amountMinor)).toEqual([10_000, -10_000]);
	});
});

describe('post() — what it refuses to build', () => {
	it('rejects an unbalanced entry', () => {
		// the invariant. off by one cent is the realistic version of this, so that is the
		// case: a fee netted out of the credit but not the debit.
		const err = rejection(() =>
			post(
				gift({
					lines: [
						{ accountId: postableId('bankCash'), amountMinor: 10_000 },
						{ accountId: donationRevenueAccount(true), amountMinor: -9_999 }
					]
				})
			)
		);
		expect(err.code).toBe('unbalanced');
		// the message carries the arithmetic because whoever reads it is looking for which
		// side is short.
		expect(err.message).toContain('sum to 1');
	});

	it('rejects a single-line entry even when its amount is zero', () => {
		// a one-line group technically "sums to zero" if the amount is 0, which is why the
		// arity check exists separately and runs first.
		expect(
			rejection(() =>
				post(gift({ lines: [{ accountId: postableId('bankCash'), amountMinor: 0 }] }))
			).code
		).toBe('too_few_lines');
	});

	it('rejects a zero line', () => {
		expect(
			rejection(() =>
				post(
					gift({
						lines: [
							{ accountId: postableId('bankCash'), amountMinor: 0 },
							{ accountId: donationRevenueAccount(true), amountMinor: 0 }
						]
					})
				)
			).code
		).toBe('zero_amount');
	});

	it('rejects a non-integer amount, naming the minor-units encoding', () => {
		// the mistake this catches is passing dollars: 100.5 instead of 10_050. `STRICT`
		// would also reject it at the database, but as a datatype mismatch on a column with
		// no line number in it.
		const err = rejection(() =>
			post(
				gift({
					lines: [
						{ accountId: postableId('bankCash'), amountMinor: 100.5 },
						{ accountId: donationRevenueAccount(true), amountMinor: -100.5 }
					]
				})
			)
		);
		expect(err.code).toBe('non_integer_amount');
		expect(err.message).toContain('MINOR UNITS');
	});

	it("rejects Stripe's lowercase currency", () => {
		// not hypothetical: Stripe reports `currency: 'usd'`. it would pass a length-3 check
		// and then split every total in the books into 'usd' and 'usd'.
		const err = rejection(() => post(gift({ currency: 'usd' })));
		expect(err.code).toBe('bad_currency');
		expect(err.message).toContain('Stripe');
	});

	it('rejects a currency that is not three letters', () => {
		expect(rejection(() => post(gift({ currency: 'US' }))).code).toBe('bad_currency');
		expect(rejection(() => post(gift({ currency: 'USDD' }))).code).toBe('bad_currency');
		expect(rejection(() => post(gift({ currency: '' }))).code).toBe('bad_currency');
	});

	it('rejects an empty sourceId, because it is half the idempotency key', () => {
		expect(rejection(() => post(gift({ sourceId: '' }))).code).toBe('empty_source_id');
	});

	it('rejects an Invalid Date for occurredAt', () => {
		// it decides which accounting period the entry lands in, so there is no safe default.
		expect(rejection(() => post(gift({ occurredAt: new Date('nonsense') }))).code).toBe(
			'bad_occurred_at'
		);
	});
});

describe('postingStatements() — applied to a real D1', () => {
	// this suite proves the statements are real SQL that lands, that the account ids in
	// accounts.ts resolve against the seeded chart, and — because the database here is
	// D1 inside workerd rather than a stand-in — that a failing `batch()` leaves nothing
	// behind. that last claim is the reason the whole write path is shaped around
	// `batch()`, and it is only assertable against the real thing.
	//
	// same `createDb` the request path uses. the binding differs, nothing else does.
	let db: Db;
	beforeAll(() => {
		db = createDb(env.DB);
	});

	it('emits one statement per row, group first', () => {
		const posting = post(CASH_GIFT);
		expect(postingStatements(db, posting)).toHaveLength(1 + posting.lines.length);
	});

	it('writes the group and its lines, and they sum to zero out of the database', async () => {
		const posting = post(gift({ sourceId: 'don_applies' }));
		await db.batch(postingStatements(db, posting));

		const group = one(
			await db.select().from(entryGroup).where(eq(entryGroup.sourceId, 'don_applies')),
			'entry_group for don_applies'
		);
		expect(group.currency).toBe('USD');
		// the bitemporal pair: business time is what we passed, system time was filled by
		// the column default rather than by `post()`.
		expect(group.occurredAt).toEqual(new Date('2026-03-31T12:00:00.000Z'));
		expect(group.createdAt).toBeInstanceOf(Date);

		const lines = await db.select().from(ledgerEntry).where(eq(ledgerEntry.entryGroupId, group.id));
		expect(lines).toHaveLength(2);
		// derived at read time, never stored — the assertion the whole design exists for.
		expect(lines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
		expect(lines.map((l) => l.accountId).sort()).toEqual(
			[POSTING_ACCOUNTS.bankCash.id, POSTING_ACCOUNTS.donationsDeductible.id].sort()
		);
	});

	it('resolves account_id against the seeded chart of accounts', async () => {
		// the foreign key is the reason `accounts.workers.spec.ts` exists; this is the same claim
		// from the other side. an id present in accounts.ts and absent from the migration
		// fails right here instead of on a donor's gift.
		const posting = post(gift({ sourceId: 'don_fk', sourceType: 'payment' }));
		// the group and both of its lines, because `account_id` is on the lines: a statement list
		// that stopped emitting them would leave the foreign key with nothing to resolve.
		await expect(db.batch(postingStatements(db, posting))).resolves.toHaveLength(3);
	});

	it('fills account_is_postable from its default, without this module naming it', async () => {
		// `account_id` is half of a composite foreign key against
		// `account(id, is_postable)`, and this is the column that is its other half — a
		// constant 1, never a fact about a line. `post()` does not set it and must not: it is
		// carried by the schema's `.default(1)`, which drizzle substitutes for the absent key
		// and which mirrors the `DEFAULT 1` in 0000_initial_schema.sql.
		//
		// the probe exists because those two defaults are a pair. a SQL default with no
		// drizzle default binds `null` and trips NOT NULL on every posting in the app, and
		// nothing else in this suite would notice: every other assertion here would go red
		// with a message about a column, not about the FK it belongs to.
		const posting = post(gift({ sourceId: 'don_pin_default', sourceType: 'payment' }));
		await db.batch(postingStatements(db, posting));

		const lines = await db
			.select()
			.from(ledgerEntry)
			.where(eq(ledgerEntry.entryGroupId, posting.group.id!));
		expect(lines).toHaveLength(2);
		expect(lines.map((l) => l.accountIsPostable)).toEqual([1, 1]);
	});

	it('refuses a ledger entry against the 4100 rollup, at the database', async () => {
		// the guard `PostableAccountId` could not provide. the brand makes a rollup a compile
		// error in `post()`'s argument and nothing more — a hand-run `wrangler d1 execute`, a
		// CSV import or any future writer that never sees the brand reaches this table
		// directly, and one entry naming a rollup makes every report over that subtree
		// double-count, silently and permanently: the ledger is append-only and the rollup
		// already sums its children.
		//
		// raw SQL on purpose. going through `post()` would need a cast to defeat the brand and
		// would then be testing the cast; this is the shape the constraint actually exists to
		// stop. (this file is inside `src/lib/server/ledger/`, which ./sole-writer.spec.ts
		// exempts — the same probe in ../db/ would trip that scan.)
		const posting = post(gift({ sourceId: 'don_rollup_probe', sourceType: 'payment' }));
		await db.batch(postingStatements(db, posting));

		const message = await d1Rejection(() =>
			env.DB.prepare(
				`insert into ledger_entry (id, entry_group_id, account_id, amount_minor)
				 values ('le-rollup', ?, ?, 1)`
			)
				.bind(posting.group.id!, ROLLUPS.donations.id)
				.run()
		);
		// the extended result code's name, never the prose in front of it.
		expect(message).toContain('SQLITE_CONSTRAINT_FOREIGNKEY');
	});

	it('refuses to let the pin be lowered to 0 to reach a rollup anyway', async () => {
		// the loophole the check closes: `(4100, 0)` matches the parent unique index
		// perfectly, so the composite FK alone is not the constraint — the check holding this
		// side at 1 is the other half of it.
		const posting = post(gift({ sourceId: 'don_pin_probe', sourceType: 'payment' }));
		await db.batch(postingStatements(db, posting));

		const message = await d1Rejection(() =>
			env.DB.prepare(
				`insert into ledger_entry
				   (id, entry_group_id, account_id, account_is_postable, amount_minor)
				 values ('le-pin', ?, ?, 0, 1)`
			)
				.bind(posting.group.id!, ROLLUPS.donations.id)
				.run()
		);
		expect(message).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(message).toContain('ledger_entry_account_postable_check');
	});

	it('rejects a redelivered source event — where idempotency actually lives', async () => {
		// the guarantee `UNIQUE (source_type, source_id)` was moved onto the header table to
		// make possible. a retried Stripe webhook posts the same pair and the database
		// refuses it; nothing here reads first and then decides, because a `batch()` cannot
		// do that atomically and a concurrent retry would race past it.
		const first = post(gift({ sourceId: 'evt_redelivered', sourceType: 'payment' }));
		await db.batch(postingStatements(db, first));

		const redelivery = post(gift({ sourceId: 'evt_redelivered', sourceType: 'payment' }));
		// the extended result code's name, not the prose around it — same reasoning as
		// ../db/strict.workers.spec.ts.
		await expect(db.batch(postingStatements(db, redelivery))).rejects.toThrow(
			/SQLITE_CONSTRAINT_UNIQUE/
		);
	});

	it('allows the same source_id under a different source_type', async () => {
		// the constraint is the pair, not the id: a payment and the refund that reverses it
		// can legitimately share an id from whichever system minted it.
		await db.batch(
			postingStatements(db, post(gift({ sourceId: 'shared', sourceType: 'payment' })))
		);
		await expect(
			db.batch(postingStatements(db, post(gift({ sourceId: 'shared', sourceType: 'refund' }))))
		).resolves.toHaveLength(3);
	});

	it('refuses a source type outside the vocabulary', async () => {
		// `entry_group_source_type_check` is a constraint and not a comment. the writer that
		// meets it is a redelivered webhook or a hand-run `wrangler d1 execute`, neither of which
		// ever sees the TypeScript union, so the cast is what stands in for that writer.
		//
		// through `rejectionCode` rather than `toThrow`, because drizzle is in the path: it
		// catches D1's error and rethrows `Failed query: …` with the code demoted to `cause`, so
		// a plain `rejects.toThrow(/SQLITE_CONSTRAINT/)` here would pass whether the constraint
		// fired or not.
		const chain = await rejectionCode(() =>
			db.batch(
				postingStatements(
					db,
					post(gift({ sourceType: 'settlement' as EntrySourceType, sourceId: 'evt_not_a_type' }))
				)
			)
		);
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('entry_group_source_type_check');
	});

	it('refuses a lowercase currency and a blank source id, which no posting can produce', async () => {
		// `entry_group`'s other two checks, probed straight at D1 because `post()` refuses both
		// long before the database sees them. what they are there for is the writer that never
		// meets `post()`: a hand-run `wrangler d1 execute`, a CSV import, a backfill.
		const currency = await rejectionCode(() =>
			db.run(
				sql`insert into entry_group (id, source_type, source_id, currency, occurred_at, created_at)
				    values ('lowercase', 'donation', 'don-lower', 'usd', 0, 0)`
			)
		);
		expect(currency).toContain('entry_group_currency_check');

		const blank = await rejectionCode(() =>
			db.run(
				sql`insert into entry_group (id, source_type, source_id, currency, occurred_at, created_at)
				    values ('blank', 'donation', '', 'USD', 0, 0)`
			)
		);
		expect(blank).toContain('entry_group_source_id_not_empty_check');
	});

	it('writes a hand-posted correction under the adjustment source type', async () => {
		// a correction is a posting like any other — lines that net to zero — and the source
		// type is what says a human posted it rather than an event. that the database takes it
		// is the whole of the claim: `entry_group_source_type_check` is a closed list, so
		// nothing about this lands until the migration that widened it has run.
		const correction = post(
			gift({
				sourceType: 'adjustment',
				sourceId: uuidv7(),
				memo: 'reverses the duplicate refund posted on 2026-04-02',
				lines: [
					{ accountId: donationRevenueAccount(true), amountMinor: 2_500 },
					{ accountId: postableId('bankCash'), amountMinor: -2_500 }
				]
			})
		);
		await db.batch(postingStatements(db, correction));

		const group = one(
			await db.select().from(entryGroup).where(eq(entryGroup.id, correction.group.id!)),
			'entry_group for the correction'
		);
		expect(group.sourceType).toBe('adjustment');
		expect(group.memo).toBe('reverses the duplicate refund posted on 2026-04-02');

		const lines = await db.select().from(ledgerEntry).where(eq(ledgerEntry.entryGroupId, group.id));
		expect(lines).toHaveLength(2);
		expect(lines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
	});

	it('lets two identical corrections both land, each on a source_id of its own', async () => {
		// the grain that separates an adjustment from the other four source types. for those the
		// pair is an event's idempotency key and a repeat is a redelivery to refuse; a correction
		// answers to no external event, so two posted deliberately — same amount, same accounts,
		// same day — are two corrections and both have to land. a borrowed key (the payment being
		// corrected, say) is what would make `entry_group_source_idx` refuse the second.
		const lines = [
			{ accountId: donationRevenueAccount(true), amountMinor: 1_000 },
			{ accountId: postableId('bankCash'), amountMinor: -1_000 }
		];
		const first = post(gift({ sourceType: 'adjustment', sourceId: uuidv7(), lines }));
		const second = post(gift({ sourceType: 'adjustment', sourceId: uuidv7(), lines }));
		expect(first.group.sourceId).not.toBe(second.group.sourceId);

		await db.batch(postingStatements(db, first));
		await expect(db.batch(postingStatements(db, second))).resolves.toHaveLength(3);
	});

	it('appends a compensating entry rather than touching the original', async () => {
		// the refund story, and the reason nothing needs an interactive transaction: the
		// original group is never read, never updated and never deleted. the account balance
		// nets to zero because both groups are in the sum, not because one was removed.
		const original = post(gift({ sourceId: 'don_refunded', sourceType: 'donation' }));
		await db.batch(postingStatements(db, original));
		const reversal = post(
			gift({
				sourceId: 'ref_refunded',
				sourceType: 'refund',
				lines: [
					{ accountId: postableId('bankCash'), amountMinor: -10_000 },
					{ accountId: donationRevenueAccount(true), amountMinor: 10_000 }
				]
			})
		);
		await db.batch(postingStatements(db, reversal));

		const originalLines = await db
			.select()
			.from(ledgerEntry)
			.where(eq(ledgerEntry.entryGroupId, original.group.id!));
		expect(originalLines).toHaveLength(2);
		expect(originalLines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);

		const bank = await db
			.select()
			.from(ledgerEntry)
			// `postableId('bankCash')` rather than `POSTING_ACCOUNTS.bankCash.id`: the column
			// carries `$type<PostableAccountId>()`, so even a read predicate has to arrive
			// through one of the brand's two constructors. that is the constraint working —
			// the seeded-key constructor is right here and costs nothing.
			.where(eq(ledgerEntry.accountId, postableId('bankCash')));
		const forThisPair = bank.filter(
			(l) => l.entryGroupId === original.group.id || l.entryGroupId === reversal.group.id
		);
		expect(forThisPair.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
	});

	it('leaves nothing behind when one statement in the batch fails', async () => {
		// the claim the whole write path is shaped around, and the reason `post()` hands its
		// statements up instead of executing them: a posting spliced into the caller's
		// `batch()` lands completely or not at all. here the group inserts fine and a line
		// then violates the FK on `account_id`, so if `batch()` were not atomic the header
		// would survive with no lines — an entry group summing to zero only because it is
		// empty, which is the one corruption no check can catch.
		//
		// this is asserted against D1 in workerd. it is not assertable against a stand-in,
		// because a stand-in's rollback is whatever the stand-in implements.
		const posting = post(gift({ sourceId: 'don_atomic', sourceType: 'donation' }));
		const orphanLine = db.insert(ledgerEntry).values({
			id: crypto.randomUUID(),
			entryGroupId: posting.group.id!,
			// the one place this file reaches past `PostableAccountId`, and the cast is the
			// test: an id no `account` row carries is unreachable through either of the brand's
			// constructors, which is the guarantee — and this probe needs exactly that, because
			// what it asserts is the FK failing mid-batch and taking the earlier rows with it.
			accountId: 'no-such-account' as PostableAccountId,
			amountMinor: 1
		});

		await expect(db.batch([...postingStatements(db, posting), orphanLine])).rejects.toThrow(
			/FOREIGN KEY|SQLITE_CONSTRAINT/
		);

		const groups = await db.select().from(entryGroup).where(eq(entryGroup.sourceId, 'don_atomic'));
		expect(groups, 'the group survived a failed batch — batch() is not atomic').toEqual([]);
		const lines = await db
			.select()
			.from(ledgerEntry)
			.where(eq(ledgerEntry.entryGroupId, posting.group.id!));
		expect(lines).toEqual([]);
	});
});
