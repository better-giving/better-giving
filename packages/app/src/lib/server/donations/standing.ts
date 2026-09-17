import type { DonationState } from '@better-giving/form/v1';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { donation, payment } from '../db/schema';

/**
 * where a crypto gift stands, for `GET /api/v1/forms/:id/donations/:donationId`, or `null` where
 * `donationId` names no gift on `formId` with a crypto attempt.
 *
 * read off the gift's inbound `payment` rows alone, never the processor:
 *
 *   received — any attempt `succeeded`. a repeat deposit is a succeeded row of its own, and money
 *              that moved is not taken back by a later attempt.
 *   expired  — none succeeded and one ended `failed` or `cancelled`. `settlementOf` in
 *              ../payments/nowpayments.ts writes those only where nothing arrived; anything that
 *              did arrive settles as `succeeded`.
 *   waiting  — otherwise: the quoted row still `pending`.
 */
export async function readCryptoGiftState(
	db: Db,
	formId: string,
	donationId: string
): Promise<DonationState | null> {
	const attempts = await db
		.select({ status: payment.status })
		.from(payment)
		.innerJoin(donation, eq(donation.id, payment.donationId))
		.where(
			and(
				eq(payment.donationId, donationId),
				eq(donation.formId, formId),
				eq(payment.direction, 'inbound'),
				eq(payment.method, 'crypto')
			)
		);

	if (attempts.length === 0) return null;
	if (attempts.some((a) => a.status === 'succeeded')) return 'received';
	if (attempts.some((a) => a.status === 'failed' || a.status === 'cancelled')) return 'expired';
	return 'waiting';
}
