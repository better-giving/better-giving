import { FORM_CURRENCY } from '../../forms/amounts';
import { outboxStatements } from '../accounting/outbox';
import type { Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { sqliteResultCode } from '../db/rejection';
import { post, postingStatements } from './posting';

// the one write a human performs against the ledger: a correcting entry, moving one figure out of
// one account and into another.
//
// it is a module and not a route's action for the reason `createContact` and `createForm` are:
// every other caller of `post()` in ./posting.ts is a server module on the settlement path, and a
// second poster — a backfill, a repair run from the console — must not have to copy the sign
// convention, the source type or the currency out of a screen to get an entry into the books. what
// is here is everything a caller would otherwise have had to know; what is left to the route is
// parsing a body and answering with a page.
//
// **the amount is one figure and the entry is balanced by construction.** the same value is written
// as a debit on one side and a credit on the other, so there is no arithmetic at a call site for
// anyone to get wrong and no arm on which `post()`'s sums-to-zero rejection is reachable. a
// correction that needs three lines is a decision to widen this module out loud.
//
// this is not a second writer. ./posting.ts is still the only module that may INSERT into
// `entry_group` or `ledger_entry` — ./sole-writer.spec.ts holds that — and what happens here is a
// caller's own `batch()` over the statements that module hands up, which is the arrangement its
// header argues at length.

/**
 * a correcting entry as a caller states it.
 *
 * the currency is not a field. v0 is USD-only by decision (`FORM_CURRENCY` in
 * `$lib/forms/amounts.ts`), and an entry mixing currencies cannot meaningfully sum to zero, so the
 * one this deployment charges in is the one the books are kept in.
 */
export type Correction = {
	/**
	 * the id this correction is posted under, minted by the caller.
	 *
	 * it is half of `entry_group_source_idx`, and for an `adjustment` its grain is "one per
	 * correction, borrowed from nothing" — see that index's header in ../db/schema.ts. so it is
	 * minted rather than derived from the figures: two identical corrections posted deliberately
	 * must both land, and an id derived from what the entry moves would make the second read as a
	 * redelivery of the first.
	 *
	 * what a caller gets by minting it *early* is idempotency over its own retries. the id is the
	 * only thing that makes two presentations of one correction the same correction, and the
	 * database is the only place that can refuse the second — a read-then-write check cannot be made
	 * atomic inside a `batch()`. a screen that mints it in its `loader` and carries it in a hidden
	 * box makes a double press present the same pair.
	 */
	readonly sourceId: string;
	/** business time: the day the books are being corrected as of. */
	readonly occurredAt: Date;
	/**
	 * what moves, in minor units, and positive.
	 *
	 * the direction is `outOf` and `into` and never this figure's sign. a negative would post a
	 * correction the other way round while still balancing, which is a caller having spelled the
	 * direction twice and disagreed with itself — so the two are not both allowed to say it.
	 */
	readonly amountMinor: number;
	/** the account the money comes out of: the credit side. */
	readonly outOf: PostableAccountId;
	/** the account the money goes into: the debit side. */
	readonly into: PostableAccountId;
	/**
	 * why the correction is being posted.
	 *
	 * required here where the column is nullable, and the difference is the point: every other
	 * posting has a payment or a donation behind it, and a correction is the one entry that answers
	 * to no record at all. blank, it is a movement in the books with nothing anywhere saying what it
	 * was for.
	 */
	readonly note: string;
};

/**
 * what posting a correction answers with.
 *
 * `already_posted` is a legitimate outcome rather than a fault: it is what the second presentation
 * of one correction gets, and the books are in exactly the state the caller wanted. it is named
 * rather than answered as a plain success, because a screen has to tell "posted" from "you have
 * already posted this" — the second is the one that says a press did nothing.
 */
export type CorrectionPosted = { ok: true } | { ok: false; reason: 'already_posted' };

/**
 * post one correcting entry, or report that its id is already in the books.
 *
 * no entry group id is handed back. a caller that needs the row reads it by the pair it already
 * holds — `findEntryGroup(db, 'adjustment', sourceId)` in ./queries.ts — which is also the read
 * that answers on the `already_posted` arm, where there is no write to have returned one.
 *
 * a figure that is not positive, or the same account on both sides, throws before anything is
 * written: `post()` refuses neither a negative, which balances and posts the correction the other
 * way round, nor one account on both lines, which balances and moves nothing.
 *
 * every rejection but a duplicate is rethrown. a `PostingError` means the correction is malformed
 * and is a defect at the call site rather than something to report as a state of the books, and a
 * database rejection that is not a unique-index violation is a fault this module cannot explain —
 * answering either as `already_posted` would tell a caller the entry is in the books when nothing
 * was written at all.
 */
export async function postCorrection(db: Db, correction: Correction): Promise<CorrectionPosted> {
	if (correction.amountMinor <= 0) {
		throw new Error(
			`a correction moves a positive figure, and amountMinor is ${correction.amountMinor}. the direction is outOf and into, never the sign — refuse the figure where it is parsed, before it reaches postCorrection.`
		);
	}
	if (correction.into === correction.outOf) {
		throw new Error(
			`a correction moves money between two accounts, and outOf and into are both the same account, ${correction.into}. refuse the pair where it is parsed, before it reaches postCorrection.`
		);
	}

	// outside the batch's own `try`, so a malformed correction surfaces as the `PostingError` it is
	// rather than as a write that failed.
	const posting = post({
		sourceType: 'adjustment',
		sourceId: correction.sourceId,
		currency: FORM_CURRENCY,
		occurredAt: correction.occurredAt,
		memo: correction.note,
		// `+` is a debit and `−` is a credit, project-wide — ./posting.ts's header settles it. the
		// convention is spelled here and at no call site, which is the whole reason this module
		// exists: a second poster copying it by hand is a second poster who can invert it.
		lines: [
			{ accountId: correction.into, amountMinor: correction.amountMinor },
			{ accountId: correction.outOf, amountMinor: -correction.amountMinor }
		]
	});

	try {
		// one `batch()` and the whole entry in it: the group, its lines and what the books owe
		// QuickBooks land together or not at all. `Db` omits `transaction` (CLAUDE.md), so there is no
		// other shape this could take.
		const statements = postingStatements(db, posting);
		await db.batch([...statements, ...outboxStatements(db, [posting])]);
	} catch (e) {
		// the only unique index any statement in this batch can violate is `entry_group_source_idx`:
		// the group's own id is a fresh uuidv7 minted inside `post()`, each line's id likewise, and
		// `ledger_entry` carries no unique index at all. the queue row is keyed on that same fresh
		// group id, so it adds none. so a `SQLITE_CONSTRAINT_UNIQUE` here is this correction's pair
		// and nothing else.
		//
		// read as the extended result code rather than matched on prose — ../db/rejection.ts argues
		// why, and why the walk has to go through `cause` to find it at all.
		if (sqliteResultCode(e) === 'SQLITE_CONSTRAINT_UNIQUE') {
			return { ok: false, reason: 'already_posted' };
		}
		throw e;
	}

	return { ok: true };
}
