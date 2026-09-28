import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { dispute, payment } from '../db/schema';

// one refund-direction row as a system outside this deployment is told of it: the `gift_refunded`
// event a Zap receives (../zapier/payload.ts), and the `data` of a `gift.refunded` or
// `gift.dispute_opened` webhook (../webhooks/payload.ts). one read, so the feeds never disagree
// about what sent money back.
//
// a refund row with a `dispute` row on it is a dispute's withdrawal; any other is a refund.

/**
 * what sent a gift's money back: `refund`, one the organisation made, or `dispute`, a dispute the
 * organisation lost or a payment the donor's bank returned. **the set may gain values**: a reader
 * branches on the values it knows and lets any other pass, and a value's meaning never narrows, so
 * a value is never split into two later. the `gift_refunded` trigger's own description in
 * packages/zapier says the same to a Zap's author.
 */
export type RefundSource = 'refund' | 'dispute';

/**
 * every column a refund-direction row is rendered from, its dispute's joined where it has one. the
 * caller adds the `where`, and the direction with it: nothing here narrows to refund rows.
 */
export function selectRefunds(db: Db) {
	const disputed = alias(dispute, 'disputed');
	return db
		.select({
			id: payment.id,
			giftId: payment.parentPaymentId,
			occurredAt: payment.occurredAt,
			amountMinor: payment.amountMinor,
			currency: payment.currency,
			source: sql<RefundSource>`case when ${disputed.paymentId} is null then 'refund' else 'dispute' end`,
			respondBy: disputed.respondBy
		})
		.from(payment)
		.leftJoin(disputed, eq(disputed.paymentId, payment.id));
}

export type RefundRow = Awaited<ReturnType<ReturnType<typeof selectRefunds>['all']>>[number];
