import { and, eq, exists, isNull, lt, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { type ReversalEntry, reversalWrites, type Writes } from '../books/writes';
import type { Db } from '../db/client';
import { postableId } from '../db/accounts';
import {
	type DisputeOutcome,
	dispute,
	donation,
	entryGroup,
	ledgerEntry,
	payment,
	type Payment
} from '../db/schema';
import type { Posting, PostingLine } from '../ledger/posting';
import { findEntryGroup } from '../ledger/queries';
import { stopRecurringGift, type StopOutcome } from '../recurring/stop';
import {
	DONATION_METADATA_KEY,
	isRetryable,
	type PaymentFailure,
	type ProcessorName,
	type Reversal,
	type ReversalEvent,
	type ReversalRead
} from '../payments/provider';
import { alert, commit, processorLabel, type SettleDeps, type SettleResult } from './delivery';
import { reinstatementEntry, reversalEntry, settleUpEntry, unpostable } from './entries';
import { sendRefundNotice } from './refund-notice';

// what a refund or a dispute does to a gift already in the books: a payment row of its own, and an
// entry group taking the money back out, in one `batch()`. the only module that writes a
// refund-direction row or a `dispute` row, gated by ./sole-refund-writer.spec.ts.
//
// ---------------------------------------------------------------------------
// the refund is a row of its own and never a status on the gift's.
//
// `direction = 'refund'`, `status = 'succeeded'`, `provider_txn_id` the refund's own id and
// `parent_payment_id` the inbound payment it reverses (../db/schema.ts). the reads that already
// subtract refunds — `projectStatus` in ./queries.ts, `listContacts` in ../contacts/queries.ts —
// then read the gift as refunded or partly refunded and take the money off the donor's given,
// with no edit of their own.
//
// the idempotency key is the refund's id on `payment_provider_txn_idx`: a redelivery finds its row
// and changes nothing, and one racing the first is that index refusing the insert, the whole batch
// rolling back with it (`commit` in ./delivery.ts). its group is `('refund', refund row)` on
// `entry_group_source_idx`, so a second refund on one gift is a second row and a second group rather
// than a collision with the first.
//
// ---------------------------------------------------------------------------
// the group mirrors the gift's own posted lines, scaled to what was refunded (`reversalEntry` in
// ./entries.ts), so the money leaves whichever account the gift went into and every fund it
// credited. each refund is apportioned against what earlier refunds and disputes that still stand
// already took (`standingRefunds` below), so withdrawals adding up to the gift take every fund back
// exactly, and one naming no figure is what is left. a refund or a dispute naming more than is left
// takes what is left, and the books never take a gift below nothing: a refund capped is told to
// staff once, on the delivery that wrote it, and one finding nothing left writes nothing and is told
// on each delivery that meets it. the processor's fee on the gift stays booked,
// but for the part a processor gives back with a refund: that is the gift's own `'fee'` lines
// reversed, in the refund's group, and no more of the fee than the gift still holds after what
// earlier refunds that still stand gave back (`feeGivenBack` below). a figure over that is capped,
// and the cap is logged rather than told to staff.
//
// ---------------------------------------------------------------------------
// a refund is found through the gift, and the gift may not be here yet.
//
// deliveries carry no ordering, so a refund can arrive before the settlement that put its gift in
// the books — a collection under a repeating gift has no row at all until ./collect.ts writes it.
// a refund of a charge whose row is `pending`, or with no row whose metadata names a gift recorded
// here (`chargeNotHere` below), is answered `incomplete` and the processor delivers it again. a
// charge whose row ended `failed` or `cancelled`, or whose metadata names a gift that is not here,
// never becomes one: it is answered 200 and told to staff. a charge naming no gift is another
// integration's on the same account, answered 200 and left.
//
// a reversal read as having moved no money is answered 200 and nothing is written. where the read
// names a charge that settled here, the processor sends nothing more about it, and staff are told.
//
// ---------------------------------------------------------------------------
// a refund that did not stand flips its row to `cancelled` and mirrors its group back under
// `('payment', refund row)`. the flip is guarded in the statement, and the mirror's own index makes
// a redelivery collide, so it happens once. staff are told and nobody else is: the donor may hold
// word that the refund went out, and what to tell them is a person's call.
//
// ---------------------------------------------------------------------------
// a dispute is a refund the donor's bank made, with a `dispute` row keyed on its refund row.
//
// opened, it withdraws the money as a refund does, and the processor's dispute fee is expensed in
// the same group. what it withdraws is capped at what earlier refunds left of the gift: a processor
// may report the whole charge disputed after part of it was refunded, and the books never take a
// gift below nothing. the fee is booked in full, and the alert names the figure reported. lost, it
// closes the row and settles up in the same batch: a fee charged at the
// close that the opening did not book, and what the processor took less than the opening withdrew,
// post as one `('adjustment', refund row)` group (`settleUpEntry` in ./entries.ts), and none where
// the close carries neither. where the processor took less, the refund row's amount is lowered to
// what it took in the same batch, guarded on the dispute still being open, so the gift and the
// donor's given follow the close; a close naming more never raises it. the row's group stays as the
// opening wrote it, and the settle-up is its correction. nothing else changes a refund row's
// amount (./sole-refund-writer.spec.ts). lost with no opening recorded, it
// writes the opening's batch with the row already closed. won, it closes the row and puts back
// exactly what the opening took, as a refund that did not stand is put back, with the fee where the
// processor returned it; won with no opening recorded, it writes nothing, because every later
// delivery reads won too, and staff are told. a dispute reported closed one way after it was
// recorded closed the other changes nothing and is told to staff.
//
// a refund of a gift whose open dispute holds the money is that dispute lost at the refund's figure,
// through the same close and settle-up, and never a second withdrawal (`disputeHolding` below): the
// donor has the money back once, and is sent no notice, as for any dispute. the close is dated by
// the refund, which is how a redelivery of it is found, since no row holds the refund's own id.
//
// a dispute the books cannot take — nothing of the gift left, figures `unpostable` names, another
// currency than the gift's — writes nothing, and still stops the plan below; staff are told on each
// delivery that meets it what needs booking by hand and how the stop ended (`disputeRefused`).
//
// after the batch that withdrew the money, and never inside it, the gift's monthly plan is stopped
// (../recurring/stop.ts), because it calls the processor: the card is disputing the charges. then
// staff are told of the dispute once, with how the stop ended. a stop the processor refused for
// now holds the delivery open. each later delivery of the opening, and a loss recorded after it,
// runs the stop again and does not tell of the dispute again; a stop that fails for good is told on
// its own, on each delivery that meets it, because the plan may still be collecting. the donor is
// told nothing.
//
// after the batch that wrote a refund, and only on the delivery that wrote it, the donor is sent one
// short notice (./refund-notice.ts): what this refund took, and what of the gift is now deductible,
// which that module reads off the rows this batch left. it goes whether or not the gift was ever posted, because the money went back either way. a
// redelivery is answered `already_posted` before it, and a dispute or a refund that did not stand
// never reaches it. a notice that fails is told to staff and never changes the answer.
//
// ---------------------------------------------------------------------------
// a reversal, its settle-up included, owes QuickBooks a row only where the group it answers holds
// one (../accounting/outbox.ts). a Zap on `gift_refunded` hears of a refund and of a dispute lost,
// keyed on the refund row, in the batch that makes its money final (`ReversalEntry` in
// ../books/writes.ts); never of a dispute opened or won, a refund that did not stand, or a gift the
// books never held. a refund of one collection under a repeating gift leaves the commitment
// collecting: stopping it is its own act.
//
// ---------------------------------------------------------------------------
// nothing here throws, for the reason ./settle.ts's header gives: a throw is a 500, read by the
// processor as "deliver this again" for three days. what the refund row or the ledger would refuse
// — a blank id, figures `unpostable` in ./entries.ts names, a fee given back that is not whole, a
// currency other than the gift's — is refused at the door, told to an operator and answered 200 —
// and a dispute's respond-by that is no date, or a blank reason, is read as none
// (`withUsableDetails`) — so the one rejection left for `commit` is the UNIQUE a racing delivery
// meets. every alert is sent through `tellStaff`, which reports a transport fault rather than
// raising it, and a stop that faults is told as a stop that failed.

/** one reversal delivery: read it, find its gift, write it, then tell people. never throws. */
export async function reverseDelivery(
	deps: SettleDeps,
	event: ReversalEvent
): Promise<SettleResult> {
	const read = await deps.provider.readReversal(event);
	if (!read.ok) return unreadableReversal(deps, event, read);
	if (read.value.kind === 'nothing_moved') return nothingMoved(deps, read.value);
	return recordReversal(deps, read.value, event.id);
}

/**
 * a reversal read as having moved no money. where the read names a transaction that settled here,
 * no later event reports the money (`ReversalRead` in ../payments/provider.ts), so staff are told.
 */
async function nothingMoved(
	deps: SettleDeps,
	read: Extract<ReversalRead, { kind: 'nothing_moved' }>
): Promise<SettleResult> {
	const ignored: SettleResult = {
		ok: true,
		outcome: 'ignored',
		detail: `reversal ${read.providerReversalId} has moved no money yet; nothing was written.`
	};
	if (!read.reversedTxnId?.trim()) return ignored;
	const reversed = await findPayment(deps.db, deps.provider.processor, read.reversedTxnId);
	if (reversed?.status !== 'succeeded') return ignored;
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund of a settled gift was reported as moving no money`,
		body:
			`${processor} reported a refund of a gift that settled here, and read it as having sent ` +
			'nothing back, so nothing was written: the gift and the donor’s total stand as they were. ' +
			`${processor} sends nothing further about it.`,
		facts: [
			{ label: 'At the processor', value: read.providerReversalId },
			{ label: 'Transaction refunded', value: read.reversedTxnId },
			{ label: 'Donation', value: reversed.donationId }
		],
		action:
			`Check the refund in the ${processor} dashboard. Where money did go back to the donor, ` +
			'post a correction in /admin/books for it, out of the account the gift went into and the fund it was given to.'
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `reversal ${read.providerReversalId} of settled transaction ${read.reversedTxnId} moved no money by the processor’s read; nothing was written.`
	};
}

/** one reversal the processor has already read back, written against the gift it names. */
export async function recordReversal(
	deps: SettleDeps,
	reversal: Reversal,
	eventId: string
): Promise<SettleResult> {
	if (!reversal.providerReversalId.trim() || !reversal.reversedTxnId.trim()) {
		return refundRefused(
			deps,
			reversal,
			'the processor named no id for the refund or for the charge it reverses, and a refund is recorded and found by both.'
		);
	}
	const processor = deps.provider.processor;
	const reversed = await findPayment(deps.db, processor, reversal.reversedTxnId);
	if (reversed === null) return chargeNotHere(deps, reversal, eventId);
	if (reversed.status === 'pending') {
		return {
			ok: false,
			reason: 'incomplete',
			detail: `transaction ${reversal.reversedTxnId} names a gift of this deployment’s that has not settled here yet, so reversal ${reversal.providerReversalId} (event ${eventId}) was not written and is worth delivering again.`
		};
	}
	if (reversed.status !== 'succeeded') return chargeNeverSettled(deps, reversal, reversed);
	switch (reversal.kind) {
		case 'refund':
			return withdraw(deps, reversal, reversed);
		case 'dispute_opened':
		case 'dispute_lost':
			return withdraw(deps, withUsableDetails(reversal), reversed);
		case 'refund_failed':
		case 'dispute_won':
			return reinstate(deps, reversal, reversed);
	}
}

type RefundRead = Extract<Reversal, { kind: 'refund' }>;
type FailedRefundRead = Extract<Reversal, { kind: 'refund_failed' }>;
type WonDisputeRead = Extract<Reversal, { kind: 'dispute_won' }>;
/** a reversal that takes money out of the gift. */
type WithdrawalRead = Extract<Reversal, { kind: 'refund' | 'dispute_opened' | 'dispute_lost' }>;
type DisputeWithdrawalRead = Extract<Reversal, { kind: 'dispute_opened' | 'dispute_lost' }>;

/**
 * a dispute's details as its row and its alert can hold them: a respond-by that is no date, and a
 * blank reason, read as none. neither is money, so neither refuses the delivery — and a respond-by
 * that is no date would throw in the alert after the batch has committed.
 */
function withUsableDetails(reversal: DisputeWithdrawalRead): DisputeWithdrawalRead {
	const reason = reversal.reason?.trim() ? reversal.reason : null;
	if (reversal.kind === 'dispute_lost') return { ...reversal, reason };
	const respondBy =
		reversal.respondBy === null || Number.isNaN(reversal.respondBy.getTime())
			? null
			: reversal.respondBy;
	return { ...reversal, reason, respondBy };
}

/**
 * the refund row and the group reversing the gift's own lines, in one `batch()` — and for a
 * dispute, its `dispute` row between the two.
 *
 * where the gift was never posted, the row is written alone and an operator is told, once: the row
 * existing is what answers every later delivery of the same refund as `already_posted`. `posting`
 * is the group's statements, or the sentence saying why there are none.
 *
 * a refund naming no figure is whatever of the charge earlier refunds and disputes have not already
 * taken, and no withdrawal takes more than that, whatever figure it names.
 */
async function withdraw(
	deps: SettleDeps,
	reversal: WithdrawalRead,
	reversed: Payment
): Promise<SettleResult> {
	const recorded = await findPayment(deps.db, deps.provider.processor, reversal.providerReversalId);
	if (recorded !== null) return withdrawnBefore(deps, reversal, recorded);
	if (reversal.kind === 'refund') {
		const held = await disputeHolding(deps.db, reversed.id, reversal.occurredAt);
		if (held !== null) return withdrawnBefore(deps, closedByRefund(reversal, held), held);
	}

	const alreadyRefundedMinor = await standingRefunds(deps.db, reversed.id);
	const leftMinor = reversed.amountMinor - alreadyRefundedMinor;
	const reportedMinor = reversal.amountMinor ?? leftMinor;
	const amountMinor = Math.min(reportedMinor, leftMinor);
	const feeMinor = reversal.kind === 'refund' ? null : reversal.feeMinor;
	if (leftMinor <= 0 && reversal.kind === 'refund') {
		return nothingLeftToRefund(deps, reversal, reversed, reportedMinor);
	}
	const refused =
		(leftMinor <= 0
			? 'earlier refunds and disputes already took the whole gift, so the dispute has nothing of it left to withdraw, and the books already hold none of it.'
			: null) ??
		unpostable({ ...reversal, amountMinor, feeMinor }) ??
		(reversal.kind === 'refund' &&
		reversal.feeReturnedMinor !== null &&
		!Number.isSafeInteger(reversal.feeReturnedMinor)
			? `the fee given back with the refund is ${reversal.feeReturnedMinor}, which is not a whole number of minor units.`
			: null) ??
		(reversal.currency === reversed.currency
			? null
			: `the ${reversal.kind === 'refund' ? 'refund' : 'dispute'} is in ${reversal.currency} and the gift was paid in ${reversed.currency}, and one entry holds one currency.`);
	if (refused !== null) {
		return reversal.kind === 'refund'
			? refundRefused(deps, reversal, refused)
			: disputeRefused(deps, reversal, reversed, refused, leftMinor <= 0);
	}

	const refundId = uuidv7();
	const charge = await findEntryGroup(deps.db, 'payment', reversed.id);
	const giftFee = charge === null ? null : await findEntryGroup(deps.db, 'fee', reversed.id);
	const feeBack =
		reversal.kind === 'refund' && charge !== null
			? await feeGivenBack(deps.db, reversal, reversed.id, giftFee?.lines ?? [])
			: null;
	const posting =
		charge === null
			? `payment ${reversed.id} settled and was never posted, so the books hold none of this gift unless somebody posted it by hand.`
			: reversalWrites(
					deps.db,
					withdrawalEntry(
						reversal.kind,
						refundId,
						reversalEntry(
							{
								refundPaymentId: refundId,
								donationId: reversed.donationId,
								original: charge.lines,
								alreadyRefundedMinor,
								fee: giftFee?.lines ?? []
							},
							{
								kind: reversal.kind,
								amountMinor,
								currency: reversal.currency,
								occurredAt: reversal.occurredAt,
								feeMinor,
								feeReturnedMinor: feeBack?.bookedMinor ?? null
							}
						)
					)
				);

	const committed = await commit(deps.db, [
		deps.db.insert(payment).values({
			id: refundId,
			donationId: reversed.donationId,
			amountMinor,
			currency: reversal.currency,
			direction: 'refund',
			method: reversed.method,
			status: 'succeeded',
			provider: deps.provider.processor,
			providerTxnId: reversal.providerReversalId,
			occurredAt: reversal.occurredAt,
			parentPaymentId: reversed.id
		}),
		...(reversal.kind === 'refund'
			? []
			: [
					deps.db.insert(dispute).values({
						paymentId: refundId,
						respondBy: reversal.kind === 'dispute_opened' ? reversal.respondBy : null,
						reason: reversal.reason,
						...(reversal.kind === 'dispute_lost'
							? { outcome: 'lost', closedAt: reversal.occurredAt }
							: {})
					})
				]),
		...(typeof posting === 'string' ? [] : posting)
	]);
	// the row appeared between the read above and this batch: another delivery of the same reversal.
	// a loss answers it `incomplete`, so its next delivery closes the dispute that delivery opened.
	if (committed === 'already_posted' && reversal.kind === 'dispute_lost') {
		return {
			ok: false,
			reason: 'incomplete',
			detail: `dispute ${reversal.providerReversalId} was opened by another delivery while this one was written; delivering it again records the loss.`
		};
	}
	if (committed === 'already_posted') {
		return {
			ok: true,
			outcome: 'already_posted',
			detail: `${reversal.kind === 'refund' ? 'refund' : 'dispute'} ${reversal.providerReversalId} is already in the books; this delivery changed nothing.`
		};
	}
	if (committed === 'failed') {
		return { ok: false, reason: 'incomplete', detail: `refund ${refundId} was not written.` };
	}
	if (reversal.kind !== 'refund') {
		const stop = await stopPlanOf(deps, reversed.donationId);
		const problem = typeof posting === 'string' ? posting : null;
		await disputeWithdrew(
			deps,
			reversal,
			{ refundId, donationId: reversed.donationId, amountMinor, reportedMinor },
			stop,
			problem
		);
		return (
			stopHeldOpen(stop, reversal) ??
			(problem === null
				? {
						ok: true,
						outcome: 'posted',
						detail: `dispute ${reversal.providerReversalId} withdrew ${amountMinor} ${reversal.currency} as refund ${refundId}.`
					}
				: {
						ok: true,
						outcome: 'unactionable',
						detail: `dispute ${reversal.providerReversalId} was recorded as refund ${refundId} and not posted: ${problem}`
					})
		);
	}
	await sendRefundNotice(deps, {
		giftPaymentId: reversed.id,
		donationId: reversed.donationId,
		refundId,
		giftMinor: reversed.amountMinor,
		refundedMinor: amountMinor,
		currency: reversal.currency
	});
	const capped =
		reportedMinor > amountMinor ? cappedFact(deps, reportedMinor, reversal.currency) : null;
	if (typeof posting === 'string') {
		return refundNotPosted(deps, reversal, reversed, refundId, amountMinor, posting, capped);
	}
	if (capped !== null) await refundCapped(deps, reversal, reversed, refundId, amountMinor, capped);
	if (feeBack !== null && feeBack.bookedMinor < feeBack.reportedMinor) {
		console.warn(
			'a refund gave back more of its gift’s fee than the books still held, and only what they held was booked:',
			JSON.stringify({ refund: refundId, ...feeBack, currency: reversal.currency })
		);
	}
	return { ok: true, outcome: 'posted', detail: `refund ${refundId} posted.` };
}

/**
 * a dispute the books cannot take: nothing of the gift left, figures `unpostable` names, or another
 * currency than the gift's. nothing is written, and the gift's monthly plan is stopped all the same
 * — the card is disputing the charge whatever the books could hold of it. staff are told on each
 * delivery that meets it, because no row is left to say one already did: what of it needs booking
 * by hand, and how the stop ended.
 */
async function disputeRefused(
	deps: SettleDeps,
	reversal: DisputeWithdrawalRead,
	reversed: Payment,
	problem: string,
	nothingLeft: boolean
): Promise<SettleResult> {
	const stop = await stopPlanOf(deps, reversed.donationId);
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} dispute could not be recorded against its gift`,
		body: nothingLeft
			? `A donor’s bank disputed a charge whose gift earlier refunds and disputes already took ` +
				'whole, so nothing was written: the books already hold none of this gift.'
			: `${processor} reported a dispute the books cannot hold, so nothing was written: the gift ` +
				'and the donor’s total stand as they were.',
		facts: [
			{ label: 'Dispute at the processor', value: reversal.providerReversalId },
			{ label: 'Transaction disputed', value: reversal.reversedTxnId },
			{ label: 'Donation', value: reversed.donationId },
			{ label: 'Problem', value: problem },
			{
				label: 'Dispute fee',
				value:
					reversal.feeMinor === null
						? 'None reported.'
						: `${reversal.feeMinor} ${reversal.currency} (minor units), not booked.`
			},
			{
				label: 'Monthly gift',
				value:
					stop === null ? 'None: this was a one-time gift.' : stopSentence(stop.outcome, processor)
			},
			...(reversal.dashboardUrl === null
				? []
				: [{ label: 'The dispute', value: reversal.dashboardUrl }])
		],
		action: nothingLeft
			? `Where ${processor} charged a fee for the dispute, post a correction in /admin/books for it: ` +
				'into processor fees, out of the account the gift went into. Nothing else needs booking.'
			: `Check the dispute in the ${processor} dashboard and correct the gift in /admin/books by ` +
				'hand for what it took, with its fee where one was charged.'
	});
	return (
		stopHeldOpen(stop, reversal) ?? {
			ok: true,
			outcome: 'unactionable',
			detail: `dispute ${reversal.providerReversalId} was not recorded: ${problem}`
		}
	);
}

/**
 * the withdrawal of a dispute on `paymentId` that a refund dated `refundedAt` settles: one still
 * open, or one that refund already closed. a close made by a refund is dated by it (`closedByRefund`),
 * and no row holds the refund's own id, so that date is what a redelivery of the refund is found
 * by. null where no dispute holds the gift's money.
 */
async function disputeHolding(
	db: Db,
	paymentId: string,
	refundedAt: Date
): Promise<Payment | null> {
	const closedByThis = and(eq(dispute.outcome, 'lost'), eq(dispute.closedAt, refundedAt));
	const [row] = await db
		.select({ payment })
		.from(payment)
		.innerJoin(dispute, eq(dispute.paymentId, payment.id))
		.where(
			and(
				eq(payment.parentPaymentId, paymentId),
				eq(payment.direction, 'refund'),
				eq(payment.status, 'succeeded'),
				or(isNull(dispute.outcome), closedByThis)
			)
		)
		.orderBy(sql`${dispute.outcome} is null`, payment.occurredAt)
		.limit(1);
	return row?.payment ?? null;
}

/**
 * a refund of money a dispute holds, read as that dispute's loss: the donor has the money back, and
 * what the dispute withdrew is lowered to what the refund sent, as a close naming less is.
 */
function closedByRefund(refund: RefundRead, held: Payment): DisputeWithdrawalRead {
	return {
		kind: 'dispute_lost',
		reversedTxnId: refund.reversedTxnId,
		providerReversalId: held.providerTxnId ?? refund.providerReversalId,
		amountMinor: refund.amountMinor,
		currency: refund.currency,
		occurredAt: refund.occurredAt,
		reversedMetadata: refund.reversedMetadata,
		feeMinor: null,
		reason: null,
		dashboardUrl: null
	};
}

/** a withdrawal as the composer takes it: a refund and a dispute lost are final, a dispute opened is not. */
function withdrawalEntry(
	kind: WithdrawalRead['kind'],
	refundId: string,
	entry: Posting
): ReversalEntry {
	return kind === 'dispute_opened'
		? { kind, entry, finalRefundPaymentId: null }
		: { kind, entry, finalRefundPaymentId: refundId };
}

/**
 * a withdrawal whose row is already here: a redelivery, or a dispute lost after it opened, which
 * closes the dispute and moves no money but its settle-up. a dispute's stop is run again, because it
 * is the one step after the batch a delivery may be held open for.
 */
async function withdrawnBefore(
	deps: SettleDeps,
	reversal: WithdrawalRead,
	recorded: Payment
): Promise<SettleResult> {
	const already: SettleResult = {
		ok: true,
		outcome: 'already_posted',
		detail: `${reversal.kind === 'refund' ? 'refund' : 'dispute'} ${reversal.providerReversalId} is already in the books; this delivery changed nothing.`
	};
	if (reversal.kind === 'refund') return already;
	const closed =
		reversal.kind === 'dispute_lost' ? await closeLost(deps, reversal, recorded) : null;
	if (typeof closed === 'object' && closed !== null) {
		return refundRefused(deps, reversal, closed.refused);
	}
	if (closed === 'failed') {
		return {
			ok: false,
			reason: 'incomplete',
			detail: `dispute ${reversal.providerReversalId} could not be closed as lost.`
		};
	}
	if (reversal.kind === 'dispute_lost' && closed === 'won') {
		return closedTheOtherWay(deps, reversal, recorded);
	}
	const stop = await stopPlanOf(deps, recorded.donationId);
	return (
		stopHeldOpen(stop, reversal) ??
		(closed === 'closed'
			? {
					ok: true,
					outcome: 'updated',
					detail: `dispute ${reversal.providerReversalId} was lost; what it withdrew stays withdrawn.`
				}
			: closed === 'settled'
				? {
						ok: true,
						outcome: 'posted',
						detail: `dispute ${reversal.providerReversalId} was lost, and what its close charged or gave back beyond the opening is settled up.`
					}
				: already)
	);
}

/**
 * an open dispute closed as lost, under `where outcome is null`, with its settle-up
 * (`settleUpEntry` in ./entries.ts) and, where the processor took less than the opening withdrew,
 * the withdrawal row's amount lowered to what it took, in the same batch: `'settled'` where a
 * settle-up posted, `'closed'` where the close carried nothing to settle. where it was already
 * closed, how. a close whose figures the books cannot take is refused before anything is written,
 * with why.
 *
 * a redelivery reads the dispute closed and writes nothing; one racing the first is refused whole by
 * the settle-up's `('adjustment', withdrawal row)` on `entry_group_source_idx`, or matches no open
 * row where there is nothing to settle.
 */
async function closeLost(
	deps: SettleDeps,
	reversal: Extract<Reversal, { kind: 'dispute_lost' }>,
	recorded: Payment
): Promise<'closed' | 'settled' | 'failed' | DisputeOutcome | null | { readonly refused: string }> {
	const before = await outcomeOf(deps.db, recorded.id);
	if (before !== null) return before;
	const refused =
		unpostable({ ...reversal, amountMinor: reversal.amountMinor ?? recorded.amountMinor }) ??
		(reversal.currency === recorded.currency
			? null
			: `the dispute closed in ${reversal.currency} and opened in ${recorded.currency}, and one entry holds one currency.`);
	if (refused !== null) return { refused };
	const withdrawal = await findEntryGroup(deps.db, 'refund', recorded.id);
	const settleUp =
		withdrawal === null
			? null
			: settleUpEntry(
					{
						refundPaymentId: recorded.id,
						donationId: recorded.donationId,
						amountMinor: recorded.amountMinor,
						withdrawn: withdrawal.lines
					},
					{
						amountMinor: reversal.amountMinor,
						currency: reversal.currency,
						occurredAt: reversal.occurredAt,
						feeMinor: reversal.feeMinor
					}
				);
	const stillOpen = and(eq(dispute.paymentId, recorded.id), isNull(dispute.outcome));
	const took = reversal.amountMinor;
	const close = deps.db
		.update(dispute)
		.set({ outcome: 'lost', closedAt: reversal.occurredAt })
		.where(stillOpen)
		.returning({ paymentId: dispute.paymentId });
	const lowered =
		took !== null && took < recorded.amountMinor
			? deps.db
					.update(payment)
					.set({ amountMinor: took })
					.where(
						and(
							eq(payment.id, recorded.id),
							eq(payment.direction, 'refund'),
							exists(deps.db.select({ open: sql`1` }).from(dispute).where(stillOpen))
						)
					)
			: null;
	// an opening the books never held is a gift no Zap heard of, and its close is heard of by none.
	const settled =
		withdrawal === null
			? []
			: reversalWrites(deps.db, {
					kind: 'settle_up',
					entry: settleUp,
					finalRefundPaymentId: recorded.id
				});
	// the lowering goes ahead of the close, whose update is what makes `stillOpen` false.
	const batch: Writes = lowered === null ? [close, ...settled] : [lowered, close, ...settled];
	const closeAt = batch.indexOf(close);
	const committed = await commit(deps.db, batch);
	if (committed === 'failed') return 'failed';
	const closed = committed === 'already_posted' ? undefined : committed[closeAt];
	if (Array.isArray(closed) && closed.length > 0) return settleUp === null ? 'closed' : 'settled';
	return outcomeOf(deps.db, recorded.id);
}

/** how a withdrawal's dispute was closed, or null where it is open or there is none. */
async function outcomeOf(db: Db, refundId: string): Promise<DisputeOutcome | null> {
	const [row] = await db
		.select({ outcome: dispute.outcome })
		.from(dispute)
		.where(eq(dispute.paymentId, refundId));
	return row?.outcome ?? null;
}

/**
 * staff told, once, that a dispute took a gift's money: on the delivery whose batch wrote it, and
 * never on a redelivery. the donor is told nothing — they are the one disputing.
 */
async function disputeWithdrew(
	deps: SettleDeps,
	reversal: DisputeWithdrawalRead,
	withdrawn: {
		readonly refundId: string;
		readonly donationId: string;
		readonly amountMinor: number;
		/** what the processor reported the dispute took: more than `amountMinor` where it was capped. */
		readonly reportedMinor: number;
	},
	stop: PlanStop,
	problem: string | null
): Promise<void> {
	const processor = processorLabel(deps);
	const lost = reversal.kind === 'dispute_lost';
	const inMinor = (figure: number) => `${figure} ${reversal.currency} (minor units)`;
	await tellStaff(deps, {
		headline: lost
			? `A ${processor} dispute was lost and took back a gift`
			: `A ${processor} dispute took back a gift`,
		body: lost
			? `A donor’s bank disputed a charge and ${processor} decided it for the donor. The money is ` +
				'taken off the gift and the donor’s total, and it does not come back.'
			: `A donor’s bank disputed a charge and ${processor} took the money back while it is ` +
				'decided. It is taken off the gift and the donor’s total, and it is put back if the ' +
				'dispute is won.',
		facts: [
			{ label: 'Amount', value: inMinor(withdrawn.amountMinor) },
			...(withdrawn.reportedMinor > withdrawn.amountMinor
				? [cappedFact(deps, withdrawn.reportedMinor, reversal.currency)]
				: []),
			...(reversal.kind === 'dispute_opened' && reversal.respondBy !== null
				? [{ label: 'Respond by', value: reversal.respondBy.toISOString() }]
				: []),
			...(reversal.dashboardUrl === null
				? []
				: [{ label: 'The dispute', value: reversal.dashboardUrl }]),
			{ label: 'Dispute at the processor', value: reversal.providerReversalId },
			...(reversal.reason === null ? [] : [{ label: 'Reason', value: reversal.reason }]),
			{ label: 'Donation', value: withdrawn.donationId },
			{
				label: 'Monthly gift',
				value:
					stop === null ? 'None: this was a one-time gift.' : stopSentence(stop.outcome, processor)
			},
			...(problem === null ? [] : [{ label: 'Books', value: problem }])
		],
		action:
			reversal.kind === 'dispute_lost'
				? null
				: `Answer the dispute in the ${processor} dashboard${reversal.respondBy === null ? '' : ' by the date above'}, with the gift’s receipt and anything showing the donor gave.`
	});
}

/** how stopping a disputed gift's monthly plan ended, or null where the gift has none. */
type PlanStop = { readonly planId: string; readonly outcome: StopOutcome } | null;

/**
 * stops the monthly plan a disputed gift was collected under, and tells staff on its own where it
 * could not be stopped for good. a processor call that throws is told as a stop that did not
 * happen.
 */
async function stopPlanOf(deps: SettleDeps, donationId: string): Promise<PlanStop> {
	const [gift] = await deps.db
		.select({ planId: donation.recurringId })
		.from(donation)
		.where(eq(donation.id, donationId));
	const planId = gift?.planId ?? null;
	if (planId === null) return null;
	let outcome: StopOutcome;
	try {
		outcome = await stopRecurringGift(deps.db, deps.processors, planId);
	} catch (error) {
		outcome = {
			outcome: 'refused',
			retryable: false,
			detail: `stopping it faulted: ${error instanceof Error ? error.message : String(error)}`,
			processor: null
		};
	}
	const stop = { planId, outcome };
	if (stoppedForGood(outcome) === false) await planNotStopped(deps, stop);
	return stop;
}

/**
 * whether a stop ended with nothing collecting: true, false where it did not and will not by being
 * asked again, and null where the processor may yet stop it on a redelivery.
 */
function stoppedForGood(outcome: StopOutcome): boolean | null {
	switch (outcome.outcome) {
		case 'gone':
		case 'already-stopped':
		case 'nothing-to-stop':
		case 'stopped':
			return true;
		case 'unrecorded':
			return false;
		case 'refused':
			return outcome.retryable ? null : false;
	}
}

/** a dispute delivery held open because its plan's stop may yet go through. */
function stopHeldOpen(stop: PlanStop, reversal: WithdrawalRead): SettleResult | null {
	if (stop === null || stoppedForGood(stop.outcome) !== null) return null;
	return {
		ok: false,
		reason: 'incomplete',
		detail: `dispute ${reversal.providerReversalId} is recorded, and the processor refused to stop monthly gift ${stop.planId} for now; delivering it again stops it.`
	};
}

/** staff told a disputed gift's monthly plan is still collecting, or may be. */
async function planNotStopped(deps: SettleDeps, stop: NonNullable<PlanStop>): Promise<void> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: 'A disputed monthly gift could not be stopped',
		body:
			'A donor disputed a charge of their monthly gift, and the gift could not be stopped here, ' +
			'so the processor may go on charging the card that is disputing it.',
		facts: [
			{ label: 'Monthly gift', value: stop.planId },
			{ label: 'What happened', value: stopSentence(stop.outcome, processor) }
		],
		action: `Cancel the subscription in the ${processor} dashboard, then stop the gift at /admin/recurring/${stop.planId}.`
	});
}

/** how a stop ended, as a sentence staff read. */
function stopSentence(outcome: StopOutcome, processor: string): string {
	switch (outcome.outcome) {
		case 'gone':
			return 'No monthly gift is recorded here under that id, so there was nothing to stop.';
		case 'already-stopped':
			return 'It was already stopped.';
		case 'nothing-to-stop':
			return `Stopped. ${processor} held no subscription for it, so nothing was collecting.`;
		case 'stopped':
			return 'Stopped: no further charges will be made.';
		case 'unrecorded':
			return `${processor} stopped it, and recording that here failed, so it may still read as collecting.`;
		case 'refused':
			return outcome.retryable
				? `${processor} refused to stop it for now: ${outcome.detail} It is tried again when the dispute is delivered again.`
				: `Not stopped: ${outcome.detail}`;
	}
}

/** a reversal that could not be read, held open where the read is worth making again. */
async function unreadableReversal(
	deps: SettleDeps,
	event: ReversalEvent,
	read: PaymentFailure
): Promise<SettleResult> {
	if (isRetryable(read.reason)) return { ok: false, reason: 'incomplete', detail: read.detail };
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund or dispute could not be read and was not acted on`,
		body:
			'The delivery verified and the refund or dispute behind it could not be read. Nothing was written, ' +
			'so a gift may still count money that went back. Repeating the call answers the same way.',
		facts: [
			{ label: 'Event', value: event.id },
			{ label: 'Event type', value: event.type },
			{ label: 'At the processor', value: event.providerNoticeId },
			{ label: 'Reason', value: read.detail }
		],
		action: `Find it in the ${processor} dashboard and correct the gift in /admin/books by hand.`
	});
	return { ok: true, outcome: 'unactionable', detail: read.detail };
}

/**
 * a reversal carrying figures neither the refund row nor the ledger will hold, told to an operator.
 * nothing is written, and the answer is a 200: the same figures arrive on every redelivery.
 */
async function refundRefused(
	deps: SettleDeps,
	reversal: Reversal,
	problem: string
): Promise<SettleResult> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund or dispute could not be recorded`,
		body:
			`${processor} reported a refund or a dispute, or its outcome, with figures that cannot be recorded, ` +
			'so nothing was written: the gift and the donor’s total stand as they were. Sending the ' +
			'delivery again reaches the same figures.',
		facts: [
			{ label: 'At the processor', value: reversal.providerReversalId },
			{ label: 'Transaction reversed', value: reversal.reversedTxnId },
			{ label: 'Problem', value: problem }
		],
		action: `Find it in the ${processor} dashboard and correct the gift in /admin/books by hand.`
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `reversal ${reversal.providerReversalId} was not recorded: ${problem}`
	};
}

type Fact = Parameters<typeof alert>[1]['facts'][number];

/** an alert's fact that a withdrawal took less than the processor reported, because less was left. */
function cappedFact(deps: SettleDeps, reportedMinor: number, currency: string): Fact {
	return {
		label: 'Capped',
		value:
			`${processorLabel(deps)} reported ${reportedMinor} ${currency} (minor units), and earlier refunds and ` +
			'disputes had already taken the rest of the gift, so what this took off the gift is capped at what was left.'
	};
}

/** staff told, on the delivery that wrote it, that a refund took less than the processor reported. */
async function refundCapped(
	deps: SettleDeps,
	reversal: RefundRead,
	reversed: Payment,
	refundId: string,
	amountMinor: number,
	capped: Fact
): Promise<void> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund was more than was left of its gift`,
		body:
			`${processor} reported a refund of more than the gift’s earlier refunds and disputes had left ` +
			'of it here, so it is recorded at what was left and the gift reads refunded in full.',
		facts: [
			{ label: 'Refund', value: refundId },
			{ label: 'Donation', value: reversed.donationId },
			{ label: 'Refund at the processor', value: reversal.providerReversalId },
			{ label: 'Amount', value: `${amountMinor} ${reversal.currency} (minor units)` },
			capped
		],
		action:
			`Compare the gift’s refunds and disputes in the ${processor} dashboard with the ones recorded ` +
			'here. Where more went back to the donor than the gift took in, post a correction in /admin/books for the difference.'
	});
}

/**
 * a refund of a gift its earlier refunds and disputes already took whole: nothing is written, and
 * staff are told on each delivery that meets it, because no row is left to say one already did.
 */
async function nothingLeftToRefund(
	deps: SettleDeps,
	reversal: RefundRead,
	reversed: Payment,
	reportedMinor: number
): Promise<SettleResult> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund found nothing of its gift left to take`,
		body:
			`${processor} reported a refund of a gift whose earlier refunds and disputes already take the ` +
			'whole of it here, so nothing was written: the books already hold none of this gift.',
		facts: [
			{ label: 'Refund at the processor', value: reversal.providerReversalId },
			{ label: 'Transaction refunded', value: reversal.reversedTxnId },
			{ label: 'Donation', value: reversed.donationId },
			{ label: 'Amount reported', value: `${reportedMinor} ${reversal.currency} (minor units)` }
		],
		action:
			`Compare the gift’s refunds and disputes in the ${processor} dashboard with the ones recorded ` +
			'here. Where more went back to the donor than the gift took in, post a correction in /admin/books for the difference.'
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `refund ${reversal.providerReversalId} found nothing of payment ${reversed.id} left to take; nothing was written.`
	};
}

/** a refund recorded against its gift and absent from the books, told to an operator. */
async function refundNotPosted(
	deps: SettleDeps,
	reversal: RefundRead,
	reversed: Payment,
	refundId: string,
	amountMinor: number,
	problem: string,
	capped: Fact | null
): Promise<SettleResult> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: 'A gift was refunded and the books could not take the refund',
		body:
			'The refund is recorded against the gift, so the gift and the donor’s total show it. ' +
			'Nothing was posted for it, and the problem below says what the books hold of the gift.',
		facts: [
			{ label: 'Refund', value: refundId },
			{ label: 'Payment refunded', value: reversed.id },
			{ label: 'Donation', value: reversed.donationId },
			{ label: 'Refund at the processor', value: reversal.providerReversalId },
			{ label: 'Amount', value: `${amountMinor} ${reversal.currency} (minor units)` },
			...(capped === null ? [] : [capped]),
			{ label: 'Problem', value: problem }
		],
		action:
			`Check the refund in the ${processor} dashboard. Where the books hold this gift, post a ` +
			'correction in /admin/books for the refunded amount, out of the account the gift went into ' +
			'and into the fund it was given to.'
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `refund ${refundId} was recorded and not posted: ${problem}`
	};
}

/**
 * a withdrawal that did not stand — a refund that failed, or a dispute won: its row flips to
 * `cancelled` and its group is mirrored back under `('payment', refund row)`, in one `batch()`, with
 * a won dispute's row closed in the same batch.
 *
 * the flip is guarded in the statement (`where status = 'succeeded'`), and this is the one place a
 * `succeeded` payment is ever walked back — a refund-direction row, whose money came back.
 */
async function reinstate(
	deps: SettleDeps,
	reversal: FailedRefundRead | WonDisputeRead,
	reversed: Payment
): Promise<SettleResult> {
	const refundRow = await findPayment(
		deps.db,
		deps.provider.processor,
		reversal.providerReversalId
	);
	if (refundRow === null) {
		return reversal.kind === 'dispute_won'
			? wonUnheard(deps, reversal, reversed)
			: {
					ok: true,
					outcome: 'ignored',
					detail: `refund ${reversal.providerReversalId} is not recorded here, so there is nothing to put back.`
				};
	}
	if (Number.isNaN(reversal.occurredAt.getTime())) {
		return refundRefused(
			deps,
			reversal,
			'the processor reported no usable time for it, and that time is the date the money is put back under.'
		);
	}
	const feeReturnedMinor = reversal.kind === 'dispute_won' ? reversal.feeReturnedMinor : null;
	if (feeReturnedMinor !== null && !Number.isSafeInteger(feeReturnedMinor)) {
		return refundRefused(
			deps,
			reversal,
			`the dispute fee given back is ${feeReturnedMinor}, which is not a whole number of minor units.`
		);
	}
	if (reversal.kind === 'dispute_won') {
		const [closed] = await deps.db
			.select({ outcome: dispute.outcome })
			.from(dispute)
			.where(eq(dispute.paymentId, refundRow.id));
		if (closed?.outcome === 'won') {
			return {
				ok: true,
				outcome: 'already_posted',
				detail: `dispute ${reversal.providerReversalId} is already recorded as won; this delivery changed nothing.`
			};
		}
		if (closed?.outcome === 'lost') return closedTheOtherWay(deps, reversal, refundRow);
	}

	const withdrawal = await findEntryGroup(deps.db, 'refund', refundRow.id);
	const flip = deps.db
		.update(payment)
		.set({ status: 'cancelled' })
		.where(
			and(
				eq(payment.id, refundRow.id),
				eq(payment.direction, 'refund'),
				eq(payment.status, 'succeeded')
			)
		)
		.returning({ id: payment.id });
	const batch: Writes = [
		flip,
		...(reversal.kind === 'dispute_won'
			? [
					deps.db
						.update(dispute)
						.set({ outcome: 'won', closedAt: reversal.occurredAt })
						.where(and(eq(dispute.paymentId, refundRow.id), isNull(dispute.outcome)))
				]
			: []),
		...(withdrawal === null
			? []
			: reversalWrites(deps.db, {
					kind: reversal.kind,
					entry: reinstatementEntry(
						{
							refundPaymentId: refundRow.id,
							donationId: refundRow.donationId,
							withdrawn: withdrawal.lines
						},
						{
							kind: reversal.kind,
							currency: withdrawal.currency,
							occurredAt: reversal.occurredAt,
							feeReturnedMinor
						}
					),
					finalRefundPaymentId: null
				}))
	];
	const flipAt = batch.indexOf(flip);
	const committed = await commit(deps.db, batch);
	if (committed === 'failed') {
		return {
			ok: false,
			reason: 'incomplete',
			detail: `refund ${refundRow.id} could not be put back.`
		};
	}
	// a redelivery: the mirror refused by its index or, where the books never held the refund, a
	// flip that matched no row.
	if (
		committed === 'already_posted' ||
		(Array.isArray(committed[flipAt]) && committed[flipAt].length === 0)
	) {
		return {
			ok: true,
			outcome: 'already_posted',
			detail: `refund ${reversal.providerReversalId} was already put back; this delivery changed nothing.`
		};
	}

	if (reversal.kind === 'refund_failed') await refundDidNotStand(deps, reversal, refundRow);
	return withdrawal === null
		? {
				ok: true,
				outcome: 'updated',
				detail: `refund ${refundRow.id} did not stand; the books never held it, so nothing was posted.`
			}
		: {
				ok: true,
				outcome: 'posted',
				detail: `refund ${refundRow.id} did not stand and was put back.`
			};
}

/**
 * a dispute won that this deployment never heard open: every later delivery of it reads won too, so
 * none can ever record the opening. the money went and came back, and only the fee may have stayed
 * with the processor, so nothing is written and staff are told on every delivery that meets it —
 * no row is left behind to tell a later one it was already told.
 */
async function wonUnheard(
	deps: SettleDeps,
	reversal: WonDisputeRead,
	reversed: Payment
): Promise<SettleResult> {
	const processor = processorLabel(deps);
	const returned = reversal.feeReturnedMinor;
	await tellStaff(deps, {
		headline: `A ${processor} dispute was opened and won before this deployment heard of it`,
		body:
			`${processor} reported a dispute won whose opening never reached this deployment, so the ` +
			'books hold neither the money it took nor the money it gave back, and nothing was written. ' +
			'The gift and the donor’s total stand as they were, which is where a win leaves them.',
		facts: [
			{ label: 'Dispute at the processor', value: reversal.providerReversalId },
			{ label: 'Transaction disputed', value: reversal.reversedTxnId },
			{ label: 'Donation', value: reversed.donationId },
			{
				label: 'Dispute fee given back',
				value:
					returned === null ? 'None given back.' : `${returned} ${reversed.currency} (minor units)`
			}
		],
		action:
			`Check the dispute’s fee in the ${processor} dashboard. Where a fee was charged and not given ` +
			'back, post a correction in /admin/books for it: into processor fees, out of the account the gift went into.'
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `dispute ${reversal.providerReversalId} was won with no opening recorded here; nothing was written.`
	};
}

/**
 * a dispute reported closed one way after this deployment recorded it closed the other. which
 * report stands is the processor's to say and a person's to read, so nothing is written and staff
 * are told.
 */
async function closedTheOtherWay(
	deps: SettleDeps,
	reversal: Extract<Reversal, { kind: 'dispute_won' | 'dispute_lost' }>,
	refundRow: Payment
): Promise<SettleResult> {
	const processor = processorLabel(deps);
	const [reported, recorded] = reversal.kind === 'dispute_won' ? ['won', 'lost'] : ['lost', 'won'];
	await tellStaff(deps, {
		headline: `A ${processor} dispute recorded as ${recorded} was reported ${reported}`,
		body:
			`${processor} reported a dispute ${reported} that this deployment had already recorded as ${recorded}. ` +
			(recorded === 'lost'
				? 'Nothing was changed: the money stays taken off the gift and the donor’s total.'
				: 'Nothing was changed: the money stays counted on the gift and the donor’s total.'),
		facts: [
			{ label: 'Dispute at the processor', value: reversal.providerReversalId },
			{ label: 'Refund', value: refundRow.id },
			{ label: 'Donation', value: refundRow.donationId },
			{ label: 'Amount', value: `${refundRow.amountMinor} ${refundRow.currency} (minor units)` }
		],
		action:
			recorded === 'lost'
				? `Check the dispute in the ${processor} dashboard. Where the money did come back, post a ` +
					'correction in /admin/books for it, into the account the gift went into and the fund it was given to.'
				: `Check the dispute in the ${processor} dashboard. Where the money did go, post a ` +
					'correction in /admin/books for it, out of the account the gift went into and the fund it was given to.'
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `dispute ${reversal.providerReversalId} was reported ${reported} and is recorded as ${recorded}; nothing was changed.`
	};
}

/**
 * staff told a refund did not stand, because the donor may already hold word that it went out and
 * nothing here writes to them — and a Zap may already have heard of it, keyed on its row, with
 * nothing to follow.
 */
async function refundDidNotStand(
	deps: SettleDeps,
	reversal: FailedRefundRead,
	refundRow: Payment
): Promise<void> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund did not go through`,
		body:
			'A refund recorded against a gift failed, so the money is the organisation’s again. The gift ' +
			'and the donor’s total count it again. The donor may already have been told the refund was ' +
			'on its way, and nothing here tells them otherwise.',
		facts: [
			{ label: 'Refund', value: refundRow.id },
			{ label: 'Donation', value: refundRow.donationId },
			{ label: 'Refund at the processor', value: reversal.providerReversalId },
			{ label: 'Amount', value: `${refundRow.amountMinor} ${refundRow.currency} (minor units)` },
			{
				label: 'Zaps',
				value:
					`Zaps on Gift refunded may already have been told of this refund, as id ${refundRow.id}, ` +
					'and nothing tells them it did not go through.'
			}
		],
		action:
			`Check the refund in the ${processor} dashboard, and let the donor know it did not go through. ` +
			'Where a Zap on Gift refunded acted on it, undo what it did.'
	});
}

/**
 * `alert`, reporting a transport that faults rather than raising it — the same guard `tellingFault`
 * in ./settle.ts puts around what that module sends after its batch. the headline and facts reach
 * the logs before the transport is tried (./delivery.ts), so a fault loses the mail and nothing else.
 */
async function tellStaff(deps: SettleDeps, input: Parameters<typeof alert>[1]): Promise<void> {
	try {
		await alert(deps, input);
	} catch (error) {
		try {
			console.error('an alert about a refund could not be sent:', error);
		} catch {
			// nothing to report it to, and nothing on this path may throw.
		}
	}
}

/**
 * a reversal of a charge recorded here as `failed` or `cancelled`, which no redelivery settles:
 * nothing is written, and staff are told, because the processor reports money moving on a charge
 * this deployment reads as having taken none.
 */
async function chargeNeverSettled(
	deps: SettleDeps,
	reversal: Reversal,
	reversed: Payment
): Promise<SettleResult> {
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund or dispute names a charge that never settled here`,
		body:
			`${processor} reported a refund or a dispute of a charge this deployment recorded as ` +
			`${reversed.status}, so the books hold no money of it to take back and nothing was written.`,
		facts: [
			{ label: 'At the processor', value: reversal.providerReversalId },
			{ label: 'Transaction reversed', value: reversal.reversedTxnId },
			{ label: 'Donation', value: reversed.donationId },
			{ label: 'Recorded here as', value: reversed.status }
		],
		action:
			`Check the charge in the ${processor} dashboard. Where it did take the donor’s money, ` +
			'correct the gift in /admin/books by hand.'
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `transaction ${reversal.reversedTxnId} is recorded as ${reversed.status}, so reversal ${reversal.providerReversalId} was not written.`
	};
}

/**
 * a reversal of a charge with no payment row here. held open only where the charge's metadata names
 * a gift this deployment recorded: every gift is recorded at authorization, and a collection under a
 * commitment reads back the commitment's pointer to its first gift (`ReversalFacts.reversedMetadata`
 * in ../payments/provider.ts), so the row the charge settles into is the one still to come. a
 * pointer to no gift here never becomes one — another deployment on the same account, most often —
 * and is told to an operator once per delivery; a charge naming no gift is another integration's,
 * answered quietly.
 */
async function chargeNotHere(
	deps: SettleDeps,
	reversal: Reversal,
	eventId: string
): Promise<SettleResult> {
	const named = reversal.reversedMetadata[DONATION_METADATA_KEY];
	if (!named?.trim()) {
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `transaction ${reversal.reversedTxnId} has no payment row here and names no gift of this deployment’s; nothing was written.`
		};
	}
	const [gift] = await deps.db
		.select({ id: donation.id })
		.from(donation)
		.where(eq(donation.id, named));
	if (gift !== undefined) {
		return {
			ok: false,
			reason: 'incomplete',
			detail: `transaction ${reversal.reversedTxnId} names gift ${named}, which has not settled here yet, so reversal ${reversal.providerReversalId} (event ${eventId}) was not written and is worth delivering again.`
		};
	}
	const processor = processorLabel(deps);
	await tellStaff(deps, {
		headline: `A ${processor} refund or dispute names a gift this deployment has no record of`,
		body:
			`${processor} reported a refund or a dispute of a charge whose details name a gift, and no ` +
			'gift here has that id, so nothing was written. It is most often a charge another ' +
			`deployment took on the same ${processor} account.`,
		facts: [
			{ label: 'At the processor', value: reversal.providerReversalId },
			{ label: 'Transaction reversed', value: reversal.reversedTxnId },
			{ label: 'Gift named', value: named }
		],
		action:
			`Find the charge in the ${processor} dashboard to see what took it. The books hold no gift ` +
			'under that id, so nothing here needs correcting.'
	});
	return {
		ok: true,
		outcome: 'unmatched',
		detail: `transaction ${reversal.reversedTxnId} has no payment row here and names gift ${named}, which this deployment has no record of; nothing was written.`
	};
}

/**
 * minor units: what the refunds of a payment that still stand add up to. a read the refund's own
 * figures are worked out from rather than a gate: two refunds of one gift racing each other both
 * post, and a cent they place differently is a correction in /admin/books.
 */
async function standingRefunds(db: Db, paymentId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${payment.amountMinor}), 0)` })
		.from(payment)
		.where(
			and(
				eq(payment.parentPaymentId, paymentId),
				eq(payment.direction, 'refund'),
				eq(payment.status, 'succeeded')
			)
		);
	return row?.total ?? 0;
}

/** minor units: the part of a gift's fee a refund gave back, and what of it the books take. */
type FeeBack = { readonly reportedMinor: number; readonly bookedMinor: number };

/**
 * what a refund gave back of its gift's fee, taken no further than the fee the gift's own `'fee'`
 * group booked less what earlier refunds that still stand gave back of it. null where it gave none
 * back. like `standingRefunds`, a read rather than a gate: two refunds racing may both give back
 * the same part, and the figure over is a correction in /admin/books.
 */
async function feeGivenBack(
	db: Db,
	reversal: RefundRead,
	paymentId: string,
	giftFee: readonly PostingLine[]
): Promise<FeeBack | null> {
	const reportedMinor = reversal.feeReturnedMinor;
	if (reportedMinor === null || reportedMinor <= 0) return null;
	const processorFees = postableId('processorFees');
	const bookedMinor = giftFee
		.filter((line) => line.accountId === processorFees)
		.reduce((sum, line) => sum + line.amountMinor, 0);
	const [back] = await db
		.select({ minor: sql<number>`coalesce(-sum(${ledgerEntry.amountMinor}), 0)` })
		.from(ledgerEntry)
		.innerJoin(entryGroup, eq(entryGroup.id, ledgerEntry.entryGroupId))
		.innerJoin(payment, eq(payment.id, entryGroup.sourceId))
		.where(
			and(
				eq(entryGroup.sourceType, 'refund'),
				eq(payment.parentPaymentId, paymentId),
				eq(payment.direction, 'refund'),
				eq(payment.status, 'succeeded'),
				eq(ledgerEntry.accountId, processorFees),
				lt(ledgerEntry.amountMinor, 0)
			)
		);
	const stillBookedMinor = Math.max(0, bookedMinor - (back?.minor ?? 0));
	return { reportedMinor, bookedMinor: Math.min(reportedMinor, stillBookedMinor) };
}

/** the payment row a transaction id names on this processor, through `payment_provider_txn_idx`. */
async function findPayment(
	db: Db,
	processor: ProcessorName,
	providerTxnId: string
): Promise<Payment | null> {
	const [row] = await db
		.select()
		.from(payment)
		.where(and(eq(payment.provider, processor), eq(payment.providerTxnId, providerTxnId)))
		.limit(1);
	return row ?? null;
}
