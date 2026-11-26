import { postableId } from '../db/accounts';
import { post, PostingError, type Posting } from './posting';

// the entry groups a fiscal sponsor's payout events make. a settled payout debits 1010 bank cash
// and credits 4130 grant income for the payout's `amount`; each return against it reverses that
// for the returned amount alone, never compared with the payout's. both are `payout` entries keyed
// `settled:<payout_id>` and `returned:<return_id>`, the grain the `payout` bullet on
// `entry_group_source_idx` in ../db/schema.ts states.
//
// nothing here reads the ledger first: a repeated payout or return id is refused by that unique
// index when its statements are batched, as ./posting.ts's header says. nothing here writes either
// — `post()` returns a `Posting` the caller splices into its own `batch()`.

/** the sponsor's `payout.settled` body. money is integer minor units, times ISO 8601 UTC. */
export type PayoutSettled = {
	payout_id: string;
	amount: number;
	currency: string;
	settled_at: string;
	/** the gifts the sponsor paid out. informational: never read for the posting. */
	payment_ids: readonly string[];
};

/** the sponsor's `payout.returned` body, one per part of a payout returned. */
export type PayoutReturned = {
	return_id: string;
	payout_id: string;
	amount: number;
	currency: string;
	returned_at: string;
};

/** bank cash against grant income for the payout's `amount`. a negative amount is a `PostingError`. */
export function payoutSettledPosting(body: PayoutSettled): Posting {
	const amount = positive(body.amount);
	return post({
		sourceType: 'payout',
		sourceId: keyed('settled', body.payout_id),
		// the sponsor's casing is not the ledger's; ./posting.ts's `bad_currency` says why.
		currency: body.currency.toUpperCase(),
		occurredAt: new Date(body.settled_at),
		memo: `payout ${body.payout_id}`,
		lines: [
			{ accountId: postableId('bankCash'), amountMinor: amount },
			{ accountId: postableId('grantIncome'), amountMinor: -amount }
		]
	});
}

/** grant income back out of bank cash for the returned `amount`. a negative amount is a `PostingError`. */
export function payoutReturnedPosting(body: PayoutReturned): Posting {
	const amount = positive(body.amount);
	return post({
		sourceType: 'payout',
		sourceId: keyed('returned', body.return_id),
		currency: body.currency.toUpperCase(),
		occurredAt: new Date(body.returned_at),
		// the payout a return takes back is named here, not looked up: the books refuse a
		// read-then-write check (AGENTS.md -> Ledger, gifts, and schema).
		memo: `return of payout ${body.payout_id}`,
		lines: [
			{ accountId: postableId('grantIncome'), amountMinor: amount },
			{ accountId: postableId('bankCash'), amountMinor: -amount }
		]
	});
}

/**
 * the key a payout event posts under. `post()` refuses an empty `sourceId`, but the prefix makes
 * this one non-empty whatever the sponsor's id is, so the empty id is refused here instead.
 */
function keyed(prefix: 'settled' | 'returned', id: string): string {
	if (id.length === 0) {
		throw new PostingError(
			'empty_source_id',
			`a '${prefix}' payout event carries an empty id. it is the other half of the idempotency key, so a blank one would collide with every other blank one.`
		);
	}
	return `${prefix}:${id}`;
}

/** refuses a negative amount, which `post()` would book as the opposite entry and still balance. */
function positive(amount: number): number {
	if (amount < 0) {
		throw new PostingError(
			'negative_amount',
			`a payout event's amount is ${amount}. a negative amount would post the opposite entry — a settled payout as a return, or a return as income — so it is refused rather than booked.`
		);
	}
	return amount;
}
