import type { BatchItem } from 'drizzle-orm/batch';
import { outboxStatements, type ReversalSourceType } from '../accounting/outbox';
import type { Db } from '../db/client';
import type { EntrySourceType } from '../db/schema';
import { type Posting, postingStatements } from '../ledger/posting';
import type { ReversalKind } from '../payments/provider';
import { giftRefundedStatements, zapierStatements } from '../zapier/events';

// the one place a posting becomes everything its batch owes: the entry group and its lines, the
// QuickBooks queue row (../accounting/outbox.ts), and the rows each listening Zap is owed
// (../zapier/events.ts). a writer that puts money into the books takes its statements from here and
// from nowhere else — ./sole-composer.spec.ts fails on an import of those modules' builders
// outside this directory.
//
// what it hides from a writer: the foreign-key order, the null fee, which postings owe QuickBooks
// and under which gate, and which Zap triggers a money event fires.
//
// the contract every function here keeps:
//
//   - **pure and synchronous, and it spends no database turn.** `chargeWrites` and `claimWrites` in
//     ../donations/collect.ts build their batches in synchronous builders that module's `attempt`
//     runs later, so a read here would have nowhere to happen. both gates it splices in are read by
//     the statements themselves, inside the batch.
//   - **appended after the caller's statement that writes the payment row it names**, where there
//     is one: `zapier_delivery.payment_id` points at it.
//   - **in order: the groups and their lines, then the queue rows, then the Zap rows.**
//     `quickbooks_sync.entry_group_id` points at a group, and D1 checks a foreign key per statement.
//   - **it never commits.** each caller keeps its own `batch()` and its own reading of a rejection,
//     because they read `SQLITE_*` codes differently.
//   - **it throws only on a posting in the wrong slot** — a source type the slot does not take, a
//     fee on another payment than its charge, or a reversal on another row than the refund row its
//     Zaps hear of. that is a defect at the call site: the builders in ../donations/entries.ts and
//     ./correct.ts fix the first two, ../donations/reverse.ts keys both on one id, and no caller
//     reaches it.

/** a batch's statements with at least one in it, which is what `db.batch()` accepts. */
export type Writes = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

/** a gift that reached the organisation: its charge, its fee where one was withheld, and the donor it is filed under. */
export type SettledGiftEntry = {
	/** `'payment'`. its `sourceId` is the payment row's id, and the composer reads the id from here rather than taking it twice. */
	readonly charge: Posting;
	/** `'fee'` on the same `sourceId`, or null. */
	readonly fee: Posting | null;
	readonly contactId: string;
};

const GIFT_BUILDERS = '$lib/server/donations/entries.ts';

/** a settled gift's groups, the queue row its charge owes, and its `new_gift` and `new_donor` rows. */
export function settledGiftWrites(db: Db, gift: SettledGiftEntry): Writes {
	const { charge, fee } = gift;
	const paymentId = charge.group.sourceId;
	inSlot(charge, 'charge', 'payment', GIFT_BUILDERS);
	if (fee !== null) inSlot(fee, 'fee', 'fee', GIFT_BUILDERS, paymentId);
	return [
		...postingStatements(db, charge),
		...(fee === null ? [] : postingStatements(db, fee)),
		...outboxStatements(db, [charge, fee]),
		...zapierStatements(db, { paymentId, contactId: gift.contactId })
	];
}

/** a correction a person posts: its group and what it owes QuickBooks. no Zap hears of it. */
export function correctionWrites(db: Db, correction: Posting): Writes {
	inSlot(correction, 'correction', 'adjustment', '$lib/server/books/correct.ts');
	return [...postingStatements(db, correction), ...outboxStatements(db, [correction])];
}

/**
 * money leaving a gift already in the books, or coming back to it, by the port's own kind of
 * reversal (`Reversal` in ../payments/provider.ts), and the settle-up of a dispute's fee at its
 * close, lost or won.
 *
 *   refund, dispute_opened,
 *   dispute_lost             — `('refund', refund row)`: the gift's lines reversed
 *                              (`reversalEntry`). a lost dispute posts only where no opening was
 *                              recorded before it.
 *   refund_failed,
 *   dispute_won              — `('payment', refund row)`: a withdrawal that did not stand, mirrored
 *                              back (`reinstatementEntry`).
 *   settle_up                — `('adjustment', refund row)`: what a close charged or gave back that
 *                              the books do not hold of the dispute (`settleUpEntry`), or null
 *                              where a lost close carried nothing to settle. a win whose opening
 *                              was never recorded is keyed on the disputed payment instead, since
 *                              no refund row holds it.
 *
 * `finalRefundPaymentId` is the refund row whose money is now final — a refund, and a dispute
 * lost, whether it posts its withdrawal or closes one already posted — and a Zap on
 * `gift_refunded` hears of it. a dispute opened or won, its settle-up included, and a refund that
 * did not stand, name none.
 */
export type ReversalEntry =
	| {
			readonly kind: 'refund' | 'dispute_lost';
			readonly entry: Posting;
			readonly finalRefundPaymentId: string;
	  }
	| {
			readonly kind: 'dispute_opened' | 'dispute_won' | 'refund_failed';
			readonly entry: Posting;
			readonly finalRefundPaymentId: null;
	  }
	| {
			readonly kind: 'settle_up';
			readonly entry: Posting;
			readonly finalRefundPaymentId: string | null;
	  }
	| { readonly kind: 'settle_up'; readonly entry: null; readonly finalRefundPaymentId: string };

const REVERSAL_SOURCE_TYPES = {
	refund: 'refund',
	refund_failed: 'payment',
	dispute_opened: 'refund',
	dispute_won: 'payment',
	dispute_lost: 'refund',
	settle_up: 'adjustment'
} as const satisfies Record<ReversalKind | 'settle_up', ReversalSourceType>;

/**
 * a reversal's group, the queue row it owes, and its `gift_refunded` rows. whether QuickBooks is
 * owed it is the group it answers holding a queue row (../accounting/outbox.ts), read off the
 * refund row the caller's batch writes or already holds, so it goes after that row.
 */
export function reversalWrites(db: Db, reversal: ReversalEntry): Writes {
	if (reversal.entry === null) return [giftRefundedStatements(db, reversal.finalRefundPaymentId)];
	const { kind, entry, finalRefundPaymentId } = reversal;
	inSlot(
		entry,
		kind,
		REVERSAL_SOURCE_TYPES[kind],
		'$lib/server/donations/entries.ts',
		finalRefundPaymentId ?? entry.group.sourceId
	);
	return [
		...postingStatements(db, entry),
		...outboxStatements(db, [entry]),
		...(finalRefundPaymentId === null ? [] : [giftRefundedStatements(db, finalRefundPaymentId)])
	];
}

function inSlot(
	posting: Posting,
	slot: string,
	sourceType: EntrySourceType,
	builtIn: string,
	sourceId: string = posting.group.sourceId
): void {
	const { group } = posting;
	if (group.sourceType !== sourceType) {
		throw new Error(
			`the ${slot} slot takes a '${sourceType}' posting and was handed a '${group.sourceType}' one, source id ${group.sourceId}. build it with the ${slot}'s own builder in ${builtIn}.`
		);
	}
	if (group.sourceId !== sourceId) {
		throw new Error(
			`the ${slot} slot takes a posting on source id ${sourceId}, the payment it belongs to, and was handed one on ${group.sourceId}. build both from the one payment in ${builtIn}.`
		);
	}
}
