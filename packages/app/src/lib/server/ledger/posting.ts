import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import type { PostableAccountId } from '../db/postable';
import type { Db } from '../db/client';
import {
	entryGroup,
	type EntrySourceType,
	ledgerEntry,
	type NewEntryGroup,
	type NewLedgerEntry
} from '../db/schema';

// the only module that may INSERT into `entry_group` or `ledger_entry`.
//
// that is not a convention: `./sole-writer.spec.ts` reads the source tree and fails on an
// insert into either table from anywhere else. the reason is that every guarantee below —
// sums to zero, signed amounts, one currency per entry, append-only — is enforced *here*
// and nowhere in the database. sqlite cannot express "these rows sum to zero" as a
// constraint (it is cross-row, so it would need a trigger), so a second writer is a
// second, unreviewed accounting system.
//
// ---------------------------------------------------------------------------
// why `post()` does not write.
//
// it validates and returns an opaque `Posting`; `postingStatements()` turns that into
// statements a *caller's* `batch()` executes. it never calls `batch()` itself.
//
// the reason is atomicity. `Db` has no `transaction` (D1 has none — see ../db/client.ts),
// so the only way a donation, its line items, its payment and its ledger lines land
// together or not at all is for all of them to be in one `batch()`. if this module
// executed its own batch, the ledger write would be a second, independent commit: a
// donation could exist with no posting, or a posting with no donation, with nothing in
// the schema to detect either. so the ledger hands its statements *up* to the one call
// site that owns the whole write.
//
// two things fall out of that, both good:
//
//   - `post()` is pure. sums-to-zero, the sign convention and every rejection below are
//     testable with no database, no browser and no Stripe. that is this module's
//     acceptance criterion, and it is only reachable because writing is somebody else's
//     job.
//   - an unvalidated posting is unrepresentable. `Posting` carries a brand no other
//     module can construct, so `postingStatements()` cannot be handed rows that skipped
//     validation — the same trick `PostableAccountId` plays on the account id, and the
//     reason there is no `assertBalanced()` for callers to forget to call.
//
// sign convention, settled project-wide: **`+` is a debit, `−` is a credit.** there is no
// `direction` column and no per-account-type sign flipping. a $100 cash gift is
// `+10_000` to 1010 Bank and `−10_000` to 4110 Donations.
//
// what this module deliberately does not check: whether `(sourceType, sourceId)` has
// already been posted. that is `entry_group`'s unique index, on purpose — a read-then-write
// check cannot be made atomic inside a `batch()`, so a duplicate must be rejected by the
// database rather than by a lookup that a concurrent retry can race past. a redelivered
// webhook therefore surfaces as a constraint violation on insert, which is the correct
// and only reliable answer.
//
// ---------------------------------------------------------------------------
// the rules the whole ledger is written to, stated here because this is the module they
// constrain.
//
// no running balance is stored and none is ever gated on. an account's balance, a fund's
// total, what a donor has given — each is a `SUM` over `ledger_entry` at read time. a
// stored total is a second answer to a question the entries already answer, and the first
// write that misses it makes the two disagree with no row looking wrong.
//
// multi-row writes go in one `batch()` and never in an interactive transaction. `Db` omits
// `transaction` (../db/client.ts), so reaching for one is a compile error rather than a
// review note. `batch()` really is atomic, and that is asserted rather than assumed:
// ./posting.workers.spec.ts fails a statement mid-batch against a real D1 and checks that
// the rows the earlier statements wrote are gone.
//
// no invariant in this system is enforced by an atomic read-then-write, and a lost race is
// settled by a correcting entry rather than by a rollback. nothing needs one today by
// design — derived balances remove read-modify-write, and idempotency is `entry_group`'s
// unique index rather than a check-then-insert, per the paragraph above. refunds are what
// will test it: `refund <= received` is cross-row, so no `CHECK` expresses it and two
// concurrent refunds can both post. the answer there is a compensating entry a human posts,
// which is what double-entry books are for. this is the ceiling the design was drawn
// against rather than a platform defect, and working around it would cost every call site.
// an invariant that genuinely cannot tolerate a correcting entry is the trigger to reopen
// the store decision, out loud.
//
// a sqlite-backed durable object is not the escape hatch. durable objects are on-platform
// and do have real transactions, so the next person who wants a read-then-write will find
// them. drizzle's `durable-sqlite` driver is `'sync'` and declares no `batch()`, failing
// both halves of what `Db` requires, and a `'sync'` driver widens every result to
// `T[] | Promise<T[]>`, so adopting it rewrites every call site. it would also serialise
// every write through one object and make the books a single actor's storage. reopen it
// out loud or not at all.
//
// D1 read replication stays `disabled`. it is free and looks like a pure latency win, which
// is why it is written down: every number here is a `SUM` at read time, so a lagging replica
// hands somebody a stale total to reconcile against. sessions API consistency is per-session
// — one staff member sees their own gift while another still sees the pre-gift figure — and
// an authoritative read needs `withSession('first-primary')`, which forfeits the benefit.
// ---------------------------------------------------------------------------

/** one side of a journal entry. `+` debit, `−` credit — see the header. */
export type PostingLine = {
	/**
	 * branded, so a reporting rollup (`ROLLUPS.donations`, `is_postable = 0`) is a compile
	 * error here rather than an entry that makes every report over that subtree
	 * double-count with no error anywhere.
	 */
	accountId: PostableAccountId;
	amountMinor: number;
};

export type PostingInput = {
	sourceType: EntrySourceType;
	sourceId: string;
	/** ISO-4217, uppercase. one per entry — see `entry_group.currency`. */
	currency: string;
	/** business time: when the money moved. system time is the row's own `created_at`. */
	occurredAt: Date;
	memo?: string | null;
	/**
	 * at least two, summing to zero. not a `[PostingLine, PostingLine, ...]` tuple
	 * because real call sites build these conditionally (a quid-pro-quo gift splits
	 * across 4110/4120 only sometimes), so the arity check has to be a runtime one
	 * regardless — and two checks for one rule is how they drift apart.
	 */
	lines: readonly PostingLine[];
};

/**
 * why a code and not just a message: a caller that wants to branch — to tell "this
 * posting is malformed, 500" from "this gift is already posted, 200" — should never have
 * to match on prose. the message is for whoever reads the log; the code is the contract.
 */
export type PostingErrorCode =
	| 'empty_source_id'
	| 'bad_currency'
	| 'bad_occurred_at'
	| 'too_few_lines'
	| 'non_integer_amount'
	| 'zero_amount'
	| 'unbalanced';

export class PostingError extends Error {
	readonly code: PostingErrorCode;
	constructor(code: PostingErrorCode, message: string) {
		super(message);
		this.name = 'PostingError';
		this.code = code;
	}
}

/**
 * a validated, balanced journal entry, ready to be spliced into a caller's `batch()`.
 *
 * the brand is what keeps "every posting was validated" from being a review item: no caller
 * can assemble one by accident, since an object literal of the right shape is not assignable
 * to this type. it is not unforgeable — a single `as Posting` compiles, because a value
 * differing only by the brand stays comparable — but forging it is a line somebody had to
 * write and anybody can grep for, which is the difference between a mistake and a decision.
 */
export type Posting = {
	readonly group: NewEntryGroup;
	readonly lines: readonly NewLedgerEntry[];
} & { readonly __balanced: unique symbol };

/** non-empty by construction: one group insert, then one insert per line. */
export type PostingStatements = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

const CURRENCY = /^[A-Z]{3}$/;

/**
 * validates a journal entry and resolves it into rows. throws `PostingError` on anything
 * that would produce books that do not balance.
 *
 * pure: no database, no clock beyond the ids, no I/O.
 */
export function post(input: PostingInput): Posting {
	if (input.sourceId.length === 0) {
		throw new PostingError(
			'empty_source_id',
			`sourceId is empty for a '${input.sourceType}' posting. it is half of the idempotency key — pass the id this source type is keyed on: a payment id, a donation id, or the uuidv7 minted for a correction. $lib/server/db/schema.ts names which one each type takes.`
		);
	}

	if (!CURRENCY.test(input.currency)) {
		// the lowercase case is not hypothetical: Stripe reports currency as 'usd'. it
		// would satisfy a length-3 check and then split every total in the books in two.
		throw new PostingError(
			'bad_currency',
			`currency ${JSON.stringify(input.currency)} is not a 3-letter uppercase ISO-4217 code. Stripe reports currency lowercase — uppercase it at the boundary rather than storing both forms.`
		);
	}

	if (Number.isNaN(input.occurredAt.getTime())) {
		throw new PostingError(
			'bad_occurred_at',
			'occurredAt is an Invalid Date. it is the accounting date, so it decides which period this entry lands in — it cannot be defaulted here.'
		);
	}

	if (input.lines.length < 2) {
		throw new PostingError(
			'too_few_lines',
			`a journal entry needs at least two lines and got ${input.lines.length}. double entry means every amount is recorded twice, once as a debit (+) and once as a credit (−).`
		);
	}

	let sum = 0;
	for (const [i, line] of input.lines.entries()) {
		if (!Number.isSafeInteger(line.amountMinor)) {
			// STRICT would reject a non-integer at the database too, but by then the message
			// is a datatype mismatch on a column, with no line number in it.
			throw new PostingError(
				'non_integer_amount',
				`lines[${i}].amountMinor is ${line.amountMinor}, which is not a safe integer. amounts are MINOR UNITS — $100.00 is 10_000, not 100.`
			);
		}
		if (line.amountMinor === 0) {
			throw new PostingError(
				'zero_amount',
				`lines[${i}].amountMinor is 0. a zero line records nothing and is the shape a mis-computed split produces, so it is rejected rather than stored.`
			);
		}
		sum += line.amountMinor;
	}

	if (sum !== 0) {
		throw new PostingError(
			'unbalanced',
			`lines sum to ${sum}, not 0 (debits ${input.lines
				.filter((l) => l.amountMinor > 0)
				.reduce((t, l) => t + l.amountMinor, 0)}, credits ${input.lines
				.filter((l) => l.amountMinor < 0)
				.reduce(
					(t, l) => t + l.amountMinor,
					0
				)}). every entry group must sum to exactly zero; + is a debit, − is a credit.`
		);
	}

	const groupId = uuidv7();
	const group: NewEntryGroup = {
		id: groupId,
		sourceType: input.sourceType,
		sourceId: input.sourceId,
		currency: input.currency,
		occurredAt: input.occurredAt,
		memo: input.memo ?? null
		// `createdAt` is left to the column default — system time belongs to the write, not
		// to this function, which is what keeps it pure.
	};
	const lines: NewLedgerEntry[] = input.lines.map((line) => ({
		id: uuidv7(),
		entryGroupId: groupId,
		accountId: line.accountId,
		amountMinor: line.amountMinor
	}));

	// the one place a `Posting` comes into existence, and the reason the double assertion
	// is here rather than smuggled into the type: `{ group, lines }` genuinely is not a
	// `Posting` — it lacks the brand, which is the entire point. making the brand optional
	// so this cast could be a single `as` would let any module build one, which is what the
	// brand exists to prevent. so the unsoundness is spent once, on this line, in the only
	// module that has validated its argument.
	return { group, lines } as unknown as Posting;
}

/**
 * the statements that write `posting`, for splicing into the caller's single `batch()`:
 *
 *   await db.batch([donationStmt, ...postingStatements(db, posting)]);
 *
 * one statement per row, never a multi-row `INSERT` — D1 caps a query at 100 bound
 * parameters, and a multi-row insert is also the shape that makes a partial failure
 * ambiguous. the group comes first so the lines' foreign key resolves in statement order.
 *
 * the other cap is per invocation rather than per query: 50 queries per worker invocation on
 * the free tier. so bulk work — a backfill, an import — chunks across requests and never
 * crams itself into one, each request owning one `batch()` of its own.
 */
export function postingStatements(db: Db, posting: Posting): PostingStatements {
	return [
		db.insert(entryGroup).values(posting.group),
		...posting.lines.map((line) => db.insert(ledgerEntry).values(line))
	];
}
