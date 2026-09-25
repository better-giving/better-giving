import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { reversalWrites, type Writes } from '../books/writes';
import type { Db } from '../db/client';
import { payment, type Payment } from '../db/schema';
import { findEntryGroup } from '../ledger/queries';
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

// what a refund does to a gift already in the books: a payment row of its own, and an entry group
// taking the money back out, in one `batch()`. the only module that writes a refund-direction row,
// gated by ./sole-refund-writer.spec.ts.
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
// the idempotency key is the refund's id on `payment_provider_txn_idx`, so a redelivery is that
// index refusing the insert and the whole batch rolls back with it (`commit` in ./delivery.ts).
// its group is `('refund', refund row)` on `entry_group_source_idx`, so a second refund on one gift
// is a second row and a second group rather than a collision with the first.
//
// ---------------------------------------------------------------------------
// the group mirrors the gift's own posted lines, scaled to what was refunded (`reversalEntry` in
// ./entries.ts), so the money leaves whichever account the gift went into and every fund it
// credited. each refund is apportioned against what earlier refunds that still stand already took
// (`standingRefunds` below), so refunds adding up to the gift take every fund back exactly, and a
// refund naming no figure is what is left. the processor's fee stays booked: a refund does not
// return it.
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
// a refund owes QuickBooks nothing and no Zap hears of it (`reversalWrites` in ../books/writes.ts
// says why), and a refund of one collection under a repeating gift leaves the commitment
// collecting: stopping it is its own act (../recurring/stop.ts).
//
// ---------------------------------------------------------------------------
// nothing here throws, for the reason ./settle.ts's header gives: a throw is a 500, read by the
// processor as "deliver this again" for three days. what the refund row or the ledger would refuse
// — a blank id, figures `unpostable` in ./entries.ts names, a currency other than the gift's — is
// refused at the door, told to an operator and answered 200, so the one rejection left for `commit`
// is the UNIQUE a redelivery meets. every alert is sent through `tellStaff`, which reports a
// transport fault rather than raising it.

/** one reversal delivery: read it, find its gift, write it. never throws. */
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
			detail: `refund ${read.value.providerReversalId} has moved no money yet; nothing was written.`
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
			detail: `transaction ${reversal.reversedTxnId} names a gift of this deployment’s that has not settled here yet, so refund ${reversal.providerReversalId} (event ${eventId}) was not written and is worth delivering again.`
		};
	}
	return reversal.kind === 'refund'
		? writeRefund(deps, reversal, reversed)
		: reinstateRefund(deps, reversal);
}

type RefundRead = Extract<Reversal, { kind: 'refund' }>;
type FailedRefundRead = Extract<Reversal, { kind: 'refund_failed' }>;

/**
 * the refund row and the group reversing the gift's own lines, in one `batch()`.
 *
 * where the gift was never posted, the row is written alone and an operator is told, once: the row
 * existing is what answers every later delivery of the same refund as `already_posted`. `posting`
 * is the group's statements, or the sentence saying why there are none.
 *
 * a refund naming no figure is whatever of the charge earlier refunds have not already taken.
 */
async function writeRefund(
	deps: SettleDeps,
	reversal: RefundRead,
	reversed: Payment
): Promise<SettleResult> {
	const alreadyRefundedMinor = await standingRefunds(deps.db, reversed.id);
	const amountMinor = reversal.amountMinor ?? reversed.amountMinor - alreadyRefundedMinor;
	const refused =
		unpostable({ ...reversal, amountMinor, feeMinor: null }) ??
		(reversal.currency === reversed.currency
			? null
			: `the refund is in ${reversal.currency} and the gift was paid in ${reversed.currency}, and one entry holds one currency.`);
	if (refused !== null) return refundRefused(deps, reversal, refused);

	const refundId = uuidv7();
	const charge = await findEntryGroup(deps.db, 'payment', reversed.id);
	const posting =
		charge === null
			? `payment ${reversed.id} settled and was never posted, so the books hold none of this gift unless somebody posted it by hand.`
			: reversalWrites(deps.db, {
					kind: 'refund',
					entry: reversalEntry(
						{
							refundPaymentId: refundId,
							donationId: reversed.donationId,
							original: charge.lines,
							alreadyRefundedMinor
						},
						{ amountMinor, currency: reversal.currency, occurredAt: reversal.occurredAt }
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
		...(typeof posting === 'string' ? [] : posting)
	]);
	if (committed === 'already_posted') {
		return {
			ok: true,
			outcome: 'already_posted',
			detail: `refund ${reversal.providerReversalId} is already in the books; this delivery changed nothing.`
		};
	}
	if (committed === 'failed') {
		return { ok: false, reason: 'incomplete', detail: `refund ${refundId} was not written.` };
	}
	if (typeof posting === 'string') {
		return refundNotPosted(deps, reversal, reversed, refundId, amountMinor, posting);
	}
	return { ok: true, outcome: 'posted', detail: `refund ${refundId} posted.` };
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
		headline: `A ${processor} refund could not be read and was not acted on`,
		body:
			'The delivery verified and the refund behind it could not be read. Nothing was written, ' +
			'so a gift may still count money that went back. Repeating the call answers the same way.',
		facts: [
			{ label: 'Event', value: event.id },
			{ label: 'Event type', value: event.type },
			{ label: 'Refund at the processor', value: event.providerNoticeId },
			{ label: 'Reason', value: read.detail }
		],
		action: `Find the refund in the ${processor} dashboard and correct the gift in /admin/books by hand.`
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
		headline: `A ${processor} refund could not be recorded`,
		body:
			`${processor} reported a refund, or a refund failing, with figures that cannot be recorded, ` +
			'so nothing was written: the gift and the donor’s total stand as they were. Sending the ' +
			'delivery again reaches the same figures.',
		facts: [
			{ label: 'Refund at the processor', value: reversal.providerReversalId },
			{ label: 'Transaction refunded', value: reversal.reversedTxnId },
			{ label: 'Problem', value: problem }
		],
		action: `Find this refund in the ${processor} dashboard and correct the gift in /admin/books by hand.`
	});
	return {
		ok: true,
		outcome: 'unactionable',
		detail: `refund ${reversal.providerReversalId} was not recorded: ${problem}`
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
 * a refund that did not stand: its row flips to `cancelled` and its group is mirrored back under
 * `('payment', refund row)`, in one `batch()`.
 *
 * the flip is guarded in the statement (`where status = 'succeeded'`), and this is the one place a
 * `succeeded` payment is ever walked back — a refund-direction row, whose money came back.
 */
async function reinstateRefund(
	deps: SettleDeps,
	reversal: FailedRefundRead
): Promise<SettleResult> {
	const refundRow = await findPayment(
		deps.db,
		deps.provider.processor,
		reversal.providerReversalId
	);
	if (refundRow === null) {
		return {
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
		...(withdrawal === null
			? []
			: reversalWrites(deps.db, {
					kind: 'refund_failed',
					entry: reinstatementEntry(
						{
							refundPaymentId: refundRow.id,
							donationId: refundRow.donationId,
							withdrawn: withdrawal.lines
						},
						{ currency: withdrawal.currency, occurredAt: reversal.occurredAt }
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

	await refundDidNotStand(deps, reversal, refundRow);
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
