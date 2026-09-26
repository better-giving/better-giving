import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { donation, payment } from '../db/schema';
import { renderRefundNotice, type RefundNoticeInput } from '../email/refund-notice';
import { readOrgProfile } from '../org/queries';
import { refundStands } from '../zapier/events';
import { alert, type MailDeps } from './delivery';
import { findPaymentDonor } from './queries';

// the donor's notice of a refund, sent once the batch that recorded the refund commits —
// ./crypto-pending.ts's shape, for the same reasons.
//
// ./reverse.ts is the one caller, and it calls this only on the delivery whose batch wrote the
// refund row: a redelivery is answered `already_posted` above it, and a dispute, or a refund that
// did not stand, never reaches it. so "once per refund" is the caller's to keep, and this module
// holds no claim column of its own — the refund row existing is the claim.
//
// every failure here is reported to an operator and none of them is raised. the refund is recorded
// before this runs, and a throw would be a 5xx the processor reads as "deliver this again"
// against a row that answers every redelivery `already_posted` — so the notice would be lost
// anyway, and the delivery log would say something untrue.

/**
 * one refund to tell a donor about, and the figures it is told in. the gift's day and what of it is
 * now deductible are read here from the rows the refund's batch left (`givenAndDeductible`).
 */
export type RefundNoticeTarget = Pick<
	RefundNoticeInput,
	'giftMinor' | 'refundedMinor' | 'currency'
> & {
	/** the gift's own `payment` row, the one refunded. who is written to is read off it. */
	readonly giftPaymentId: string;
	/** the gift refunded, named in anything an operator is told. */
	readonly donationId: string;
	/** the refund's own `payment` row, named in anything an operator is told. */
	readonly refundId: string;
};

/**
 * sends the notice, and never throws.
 *
 * the donor is read here, inside the same guard as the send, so a caller past its commit holds
 * nothing that can throw.
 */
export async function sendRefundNotice(deps: MailDeps, target: RefundNoticeTarget): Promise<void> {
	try {
		const donor = await findPaymentDonor(deps.db, target.giftPaymentId);
		// a donor nobody has an address for is not a fault, and nobody is told of it.
		if (donor === null || donor.email === null) return;

		const rendered = await renderRefundNotice({
			org: await readOrgProfile(deps.db),
			donorName: donor.displayName,
			giftMinor: target.giftMinor,
			refundedMinor: target.refundedMinor,
			currency: target.currency,
			...(await givenAndDeductible(deps.db, target))
		});
		if (!rendered.ok) {
			await alert(deps, {
				headline: 'A donor was not told of a refund',
				body:
					'A refund was recorded and the email telling the donor of it could not be written. ' +
					'The refund stands; the donor has no email of it.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Refund', value: target.refundId },
					{ label: 'Reason', value: rendered.detail }
				],
				action:
					'Open the console (`better-giving start`) and fill in the organisation’s details under Organisation.'
			});
			return;
		}

		const sent = await deps.email.send({ to: donor.email, ...rendered.message });
		if (!sent.ok) {
			await alert(deps, {
				headline: 'A donor’s refund notice did not send',
				body:
					'A refund was recorded and the email telling the donor of it did not send. The ' +
					'refund stands; the donor has no email of it.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Refund', value: target.refundId },
					{ label: 'Reason', value: sent.reason },
					{ label: 'Detail', value: sent.detail },
					{ label: 'May have sent anyway', value: sent.indeterminate ? 'yes' : 'no' }
				],
				action:
					'Check the SMTP settings on the console (`better-giving start`) and send a test message.'
			});
		}
	} catch (error) {
		try {
			await alert(deps, {
				headline: 'A donor’s refund notice could not be attempted',
				body:
					'A refund was recorded and the step that emails the donor of it failed outright. ' +
					'The refund stands; the donor has no email of it.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Refund', value: target.refundId },
					{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
				],
				action:
					'Check the SMTP settings on the console (`better-giving start`) and send a test message. The ' +
					'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
					'checkout).'
			});
		} catch {
			// the alert rides the transport that may be what faulted. nothing on this path may throw.
		}
	}
}

/**
 * the day on the gift's receipt — `donation.received_at`, written at authorization and never moved
 * by a settlement — and what of the gift is now deductible: what it collected, less the refunds of
 * it that stand (`refundStands` in ../zapier/events.ts, so a dispute still open, which may yet be
 * won, takes nothing off), less the part that was never deductible, and never below nothing.
 */
async function givenAndDeductible(
	db: Db,
	target: RefundNoticeTarget
): Promise<Pick<RefundNoticeInput, 'givenAt' | 'deductibleMinor'>> {
	const [gift] = await db
		.select({ givenAt: donation.receivedAt, nonDeductibleMinor: donation.nonDeductibleMinor })
		.from(donation)
		.where(eq(donation.id, target.donationId));
	const [refunded] = await db
		.select({ minor: sql<number>`coalesce(sum(${payment.amountMinor}), 0)` })
		.from(payment)
		.where(and(eq(payment.parentPaymentId, target.giftPaymentId), refundStands(db, payment)));
	if (gift === undefined) throw new Error(`donation ${target.donationId} is not recorded.`);
	return {
		givenAt: gift.givenAt,
		deductibleMinor: Math.max(
			0,
			target.giftMinor - (refunded?.minor ?? 0) - gift.nonDeductibleMinor
		)
	};
}
