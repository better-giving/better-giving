import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { reversalWrites, type Writes } from '../books/writes';
import type { Db } from '../db/client';
import { type DisputeOutcome, dispute, donation, payment, type Payment } from '../db/schema';
import { findEntryGroup } from '../ledger/queries';
import { stopRecurringGift, type StopOutcome } from '../recurring/stop';
import {
	DONATION_METADATA_KEY,
	INTERVAL_METADATA_KEY,
	isRetryable,
	type PaymentFailure,
	type ProcessorName,
	type Reversal,
	type ReversalEvent
} from '../payments/provider';
import { alert, commit, processorLabel, type SettleDeps, type SettleResult } from './delivery';
import { reinstatementEntry, reversalEntry, unpostable } from './entries';

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
// exactly, and one naming no figure is what is left. the processor's fee on the gift stays booked: a
// refund does not return it.
//
// ---------------------------------------------------------------------------
// a refund is found through the gift, and the gift may not be here yet.
//
// deliveries carry no ordering, so a refund can arrive before the settlement that put its gift in
// the books — a collection under a repeating gift has no row at all until ./collect.ts writes it. a
// charge whose metadata names a gift or a commitment of this deployment's (`namesThisDeployment`
// below) is this deployment's, so a refund of it with no settled row behind it is answered
// `incomplete` and the processor delivers it again. a charge naming neither is another
// integration's on the same account, answered 200 and left.
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
// the same group. lost, it closes the row and moves nothing more; lost with no opening recorded,
// it writes the opening's batch with the row already closed. won, it closes the row and puts the
// money back as a refund that did not stand is put back, with the fee where the processor returned
// it. a dispute reported closed one way after it was recorded closed the other changes nothing
// and is told to staff.
//
// after the batch that withdrew the money, and never inside it, the gift's monthly plan is stopped
// (../recurring/stop.ts), because it calls the processor: the card is disputing the charges. then
// staff are told of the dispute once, with how the stop ended. a stop the processor refused for
// now holds the delivery open. each later delivery of the opening, and a loss recorded after it,
// runs the stop again and does not tell of the dispute again; a stop that fails for good is told on
// its own, on each delivery that meets it, because the plan may still be collecting. the donor is
// told nothing.
//
// ---------------------------------------------------------------------------
// a reversal owes QuickBooks nothing and no Zap hears of it (`reversalWrites` in ../books/writes.ts
// says why), and a refund of one collection under a repeating gift leaves the commitment
// collecting: stopping it is its own act.
//
// ---------------------------------------------------------------------------
// nothing here throws, for the reason ./settle.ts's header gives: a throw is a 500, read by the
// processor as "deliver this again" for three days. what the refund row or the ledger would refuse
// — a blank id, figures `unpostable` in ./entries.ts names, a currency other than the gift's — is
// refused at the door, told to an operator and answered 200 — and a dispute's respond-by that is
// no date, or a blank reason, is read as none (`withUsableDetails`) — so the one rejection left for
// `commit` is the UNIQUE a racing delivery meets. every alert is sent through `tellStaff`, which reports a
// transport fault rather than raising it, and a stop that faults is told as a stop that failed.

/** one reversal delivery: read it, find its gift, write it, then tell people. never throws. */
export async function reverseDelivery(
	deps: SettleDeps,
	event: ReversalEvent
): Promise<SettleResult> {
	const read = await deps.provider.readReversal(event);
	if (!read.ok) return unreadableReversal(deps, event, read);
	if (read.value.kind === 'nothing_moved') {
		return {
			ok: true,
			outcome: 'ignored',
			detail: `reversal ${read.value.providerReversalId} has moved no money yet; nothing was written.`
		};
	}
	return recordReversal(deps, read.value, event.id);
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
	if (reversed === null && !namesThisDeployment(reversal.reversedMetadata)) {
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `transaction ${reversal.reversedTxnId} has no payment row here and names no gift of this deployment’s; nothing was written.`
		};
	}
	if (reversed === null || reversed.status !== 'succeeded') {
		return {
			ok: false,
			reason: 'incomplete',
			detail: `transaction ${reversal.reversedTxnId} names a gift of this deployment’s that has not settled here yet, so reversal ${reversal.providerReversalId} (event ${eventId}) was not written and is worth delivering again.`
		};
	}
	switch (reversal.kind) {
		case 'refund':
			return withdraw(deps, reversal, reversed);
		case 'dispute_opened':
		case 'dispute_lost':
			return withdraw(deps, withUsableDetails(reversal), reversed);
		case 'refund_failed':
		case 'dispute_won':
			return reinstate(deps, reversal);
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
 * a refund naming no figure is whatever of the charge earlier refunds have not already taken.
 */
async function withdraw(
	deps: SettleDeps,
	reversal: WithdrawalRead,
	reversed: Payment
): Promise<SettleResult> {
	const recorded = await findPayment(deps.db, deps.provider.processor, reversal.providerReversalId);
	if (recorded !== null) return withdrawnBefore(deps, reversal, recorded);

	const alreadyRefundedMinor = await standingRefunds(deps.db, reversed.id);
	const amountMinor = reversal.amountMinor ?? reversed.amountMinor - alreadyRefundedMinor;
	const feeMinor = reversal.kind === 'refund' ? null : reversal.feeMinor;
	const refused =
		unpostable({ ...reversal, amountMinor, feeMinor }) ??
		(reversal.currency === reversed.currency
			? null
			: `the ${reversal.kind === 'refund' ? 'refund' : 'dispute'} is in ${reversal.currency} and the gift was paid in ${reversed.currency}, and one entry holds one currency.`);
	if (refused !== null) return refundRefused(deps, reversal, refused);

	const refundId = uuidv7();
	const charge = await findEntryGroup(deps.db, 'payment', reversed.id);
	const posting =
		charge === null
			? `payment ${reversed.id} settled and was never posted, so the books hold none of this gift unless somebody posted it by hand.`
			: reversalWrites(deps.db, {
					kind: reversal.kind,
					entry: reversalEntry(
						{
							refundPaymentId: refundId,
							donationId: reversed.donationId,
							original: charge.lines,
							alreadyRefundedMinor
						},
						{
							kind: reversal.kind,
							amountMinor,
							currency: reversal.currency,
							occurredAt: reversal.occurredAt,
							feeMinor
						}
					)
				});

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
			{ refundId, donationId: reversed.donationId, amountMinor },
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
	if (typeof posting === 'string') {
		return refundNotPosted(deps, reversal, reversed, refundId, amountMinor, posting);
	}
	return { ok: true, outcome: 'posted', detail: `refund ${refundId} posted.` };
}

/**
 * a withdrawal whose row is already here: a redelivery, or a dispute lost after it opened, which
 * closes the dispute and moves no money. a dispute's stop is run again, because it is the one step
 * after the batch a delivery may be held open for.
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
			: already)
	);
}

/**
 * an open dispute closed as lost, under `where outcome is null`, so a second report changes nothing.
 * where it was already closed, how.
 */
async function closeLost(
	deps: SettleDeps,
	reversal: Extract<Reversal, { kind: 'dispute_lost' }>,
	recorded: Payment
): Promise<'closed' | 'failed' | DisputeOutcome | null> {
	const committed = await commit(deps.db, [
		deps.db
			.update(dispute)
			.set({ outcome: 'lost', closedAt: reversal.occurredAt })
			.where(and(eq(dispute.paymentId, recorded.id), isNull(dispute.outcome)))
			.returning({ paymentId: dispute.paymentId })
	]);
	if (committed === 'failed' || committed === 'already_posted') return 'failed';
	if (Array.isArray(committed[0]) && committed[0].length > 0) return 'closed';
	const [row] = await deps.db
		.select({ outcome: dispute.outcome })
		.from(dispute)
		.where(eq(dispute.paymentId, recorded.id));
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
	},
	stop: PlanStop,
	problem: string | null
): Promise<void> {
	const processor = processorLabel(deps);
	const lost = reversal.kind === 'dispute_lost';
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
			{ label: 'Amount', value: `${withdrawn.amountMinor} ${reversal.currency} (minor units)` },
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

/** a refund recorded against its gift and absent from the books, told to an operator. */
async function refundNotPosted(
	deps: SettleDeps,
	reversal: RefundRead,
	reversed: Payment,
	refundId: string,
	amountMinor: number,
	problem: string
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
	reversal: FailedRefundRead | WonDisputeRead
): Promise<SettleResult> {
	const refundRow = await findPayment(
		deps.db,
		deps.provider.processor,
		reversal.providerReversalId
	);
	if (refundRow === null) {
		return reversal.kind === 'dispute_won'
			? {
					ok: false,
					reason: 'incomplete',
					detail: `dispute ${reversal.providerReversalId} was won and what it withdrew is not recorded here yet, so it is worth delivering again.`
				}
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
					)
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
 * nothing here writes to them.
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
			{ label: 'Amount', value: `${refundRow.amountMinor} ${refundRow.currency} (minor units)` }
		],
		action: `Check the refund in the ${processor} dashboard, and let the donor know it did not go through.`
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
 * whether a reversed charge's metadata says it is this deployment's: a gift's pointer, which every
 * intent and commitment this app mints carries, or a commitment's cadence, which a collection's
 * charge reads back off the commitment it was collected under (`ReversalFacts.reversedMetadata` in
 * ../payments/provider.ts).
 */
function namesThisDeployment(metadata: Readonly<Record<string, string>>): boolean {
	return [DONATION_METADATA_KEY, INTERVAL_METADATA_KEY].some((key) => metadata[key]?.trim());
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
