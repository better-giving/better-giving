import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import { dispute, payment } from '../db/schema';
import { refundStands } from '../donations/queries';
import { inPage } from '../db/id-set';

// one refund-direction row as a system outside this deployment is told of it: the `gift_refunded`
// event a Zap receives (../zapier/payload.ts), and the `data` of a `gift.refunded` or
// `gift.dispute_opened` webhook (../webhooks/payload.ts). one read and one rendering
// (`renderRefund`), so the feeds never disagree about what sent money back: each wraps it around
// the gift in its own shape, and a key added here reaches both.
//
// a refund row with a `dispute` row on it is a dispute's withdrawal; any other is a refund.

/**
 * what sent a gift's money back: `refund`, one the organisation made, or `dispute`, a dispute the
 * organisation lost or a payment the donor's bank returned. **the set may gain values**: a reader
 * branches on the values it knows and lets any other pass, and a value's meaning never narrows, so
 * a value is never split into two later. the `gift_refunded` trigger's own description in
 * packages/zapier says the same to a Zap's author.
 */
export const REFUND_SOURCES = ['refund', 'dispute'] as const;
export type RefundSource = (typeof REFUND_SOURCES)[number];

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

/**
 * of `refundIds`, the refunds that still stand (`refundStands` in ../donations/queries.ts), read as
 * a delivery run renders them: a queued `gift_refunded` Zap row (../zapier/deliver.ts) and a queued
 * `gift.refunded` destination row (../webhooks/payload.ts) are posted only while theirs does.
 */
export async function readStandingRefunds(
	db: Db,
	refundIds: readonly string[]
): Promise<Set<string>> {
	if (refundIds.length === 0) return new Set();
	const rows = await db
		.select({ id: payment.id })
		.from(payment)
		.where(and(inPage(payment.id, refundIds), refundStands(db, payment)));
	return new Set(rows.map((row) => row.id));
}

/** one refund as both feeds render it, around `G`, the gift in the feed's own shape. */
export type RenderedRefund<G> = {
	/** the refund's own payment id, distinct from the gift's: a second refund is a second event. */
	readonly id: string;
	/**
	 * when the money left the organisation, ISO 8601 in UTC: for a refund, when it was made; for a
	 * dispute, when it opened and withdrew the money, or where no opening was recorded, when it
	 * closed.
	 */
	readonly occurred_at: string;
	/**
	 * what left, in `amount`'s notation on the gift: for a refund, what it gave back; for a dispute,
	 * what the processor took as the close left it, which can be less than the opening withdrew.
	 */
	readonly amount: string;
	readonly amount_minor: number;
	readonly currency: string;
	readonly source: RefundSource;
	readonly gift: G;
};

/** `row` rendered around `gift`, the gift it reverses as the calling feed renders one. */
export function renderRefund<G>(row: RefundRow, gift: G): RenderedRefund<G> {
	return {
		id: row.id,
		occurred_at: row.occurredAt.toISOString(),
		amount: majorText(row.amountMinor, row.currency),
		amount_minor: row.amountMinor,
		currency: row.currency,
		source: row.source,
		gift
	};
}

/** the `last_error` of a queued refund row that stopped standing, and was not posted. */
export const REFUND_NO_LONGER_STANDS =
	'The refund this event was queued for no longer stands: it failed, or its dispute no longer reads as lost. It was not sent.';
