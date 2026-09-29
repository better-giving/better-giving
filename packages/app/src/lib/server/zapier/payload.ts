import { and, desc, eq, exists, notExists, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { entryGroup, payment, type ZapierTrigger } from '../db/schema';
import { earlierSettledGiftOfDonor, refundStands } from '../donations/queries';
import { type GiftEvent, renderGift, selectGifts } from '../integrations/gift';
import { inPage } from '../db/id-set';
import {
	type RefundRow,
	type RenderedRefund,
	renderRefund,
	selectRefunds
} from '../integrations/refund';

export type { GiftEvent };

// what a Zap is handed about a gift or a refund of one — the public contract every field a user
// maps into a Zap is read from, and the one render both the live send and the sample list go
// through. a gift's own fields are `GiftEvent`'s in ../integrations/gift.ts, which the read API's
// gifts list answers with too.
//
// every key here, on every event, is held to the rule ../integrations/gift.ts's header states for
// a gift's: permanent, and present, null where there is nothing to say — a Zap maps the fields the
// sample showed it, and a key missing from a live event is a blank in whatever it writes.

/**
 * one donor's first settled gift, as a `new_donor` Zap receives it. `id` is the donor's, so a Zap
 * hears of each donor once however many gifts follow.
 */
export type DonorEvent = {
	readonly id: string;
	readonly name: string;
	readonly email: string | null;
	readonly first_gift: GiftEvent;
};

/** the `new_donor` event for the donor whose first gift `gift` is. derived, never read. */
export function donorEventOf(gift: GiftEvent): DonorEvent {
	return { id: gift.donor_id, name: gift.donor_name, email: gift.donor_email, first_gift: gift };
}

/**
 * one refund, or one dispute lost, as a `gift_refunded` Zap receives it: what left
 * (`RenderedRefund` in ../integrations/refund.ts, which a webhook's refund carries too), and the
 * gift it left as a `new_gift` Zap receives it.
 */
export type RefundEvent = RenderedRefund<GiftEvent>;

/**
 * the events for `paymentIds`, keyed by payment id. an id with no payment behind it has no entry,
 * which is the caller's to answer for — the map never holds a half-rendered event.
 */
export async function readGiftEvents(
	db: Db,
	paymentIds: readonly string[]
): Promise<Map<string, GiftEvent>> {
	const rows = await selectGifts(db).where(inPage(payment.id, paymentIds));
	return new Map(rows.map((row) => [row.id, renderGift(row)]));
}

/**
 * the refund events for `refundIds`, refund-direction payment rows, keyed by refund id. like
 * {@link readGiftEvents}, an id with no refund and gift behind it has no entry.
 */
export async function readRefundEvents(
	db: Db,
	refundIds: readonly string[]
): Promise<Map<string, RefundEvent>> {
	const refunds = await selectRefunds(db).where(
		and(eq(payment.direction, 'refund'), inPage(payment.id, refundIds))
	);
	return refundEventsOf(db, refunds);
}

async function refundEventsOf(
	db: Db,
	refunds: readonly RefundRow[]
): Promise<Map<string, RefundEvent>> {
	const gifts = await readGiftEvents(
		db,
		refunds.flatMap((r) => (r.giftId === null ? [] : [r.giftId]))
	);
	const events = new Map<string, RefundEvent>();
	for (const refund of refunds) {
		const gift = refund.giftId === null ? undefined : gifts.get(refund.giftId);
		if (gift === undefined) continue;
		events.set(refund.id, renderRefund(refund, gift));
	}
	return events;
}

/**
 * the gift the Zap editor shows a deployment that has taken none yet, so a Zap can be built before
 * the first gift arrives. every field filled, so each one is there to map.
 */
export const SAMPLE_GIFT: GiftEvent = {
	id: '01920000-0000-7000-8000-000000000003',
	donation_id: '01920000-0000-7000-8000-000000000002',
	occurred_at: '2026-01-15T17:30:00.000Z',
	amount: '51.50',
	amount_minor: 5_150,
	currency: 'USD',
	covered_fee_minor: 150,
	method: 'card',
	recurring: true,
	frequency: 'monthly',
	form_id: '01920000-0000-7000-8000-000000000004',
	form_name: 'General Fund',
	program_name: 'Clean water',
	dedication_kind: 'memory',
	dedication_honoree: 'Margaret Chen',
	note: 'For the new well.',
	donor_id: '01920000-0000-7000-8000-000000000001',
	donor_name: 'Ada Okafor',
	donor_email: 'ada@example.org',
	coin: null,
	coin_amount: null
};

/** the new-donor sample, the donor whose first gift is `SAMPLE_GIFT`. */
export const SAMPLE_DONOR: DonorEvent = donorEventOf(SAMPLE_GIFT);

/** the refund sample: $20 of `SAMPLE_GIFT` given back. */
export const SAMPLE_REFUND: RefundEvent = {
	id: '01920000-0000-7000-8000-000000000005',
	occurred_at: '2026-01-20T09:00:00.000Z',
	amount: '20.00',
	amount_minor: 2_000,
	currency: 'USD',
	source: 'refund',
	gift: SAMPLE_GIFT
};

/** what each trigger's Zap receives. */
export type ZapierEvent = {
	readonly new_gift: GiftEvent;
	readonly new_donor: DonorEvent;
	readonly gift_refunded: RefundEvent;
};

/** how many events the Zap editor is shown to map fields from. */
const SAMPLE_COUNT = 3;

/**
 * what the Zap editor shows for `trigger`: the latest real events, newest first, rendered by the
 * same read a live send makes.
 */
export async function readSamples<T extends ZapierTrigger>(
	db: Db,
	trigger: T
): Promise<ZapierEvent[T][]> {
	if (trigger === 'gift_refunded') return (await refundSamples(db)) as ZapierEvent[T][];
	const settled = and(eq(payment.status, 'succeeded'), eq(payment.direction, 'inbound'));
	const rows = await selectGifts(db)
		.where(
			trigger === 'new_donor' ? and(settled, notExists(earlierSettledGiftOfDonor(db))) : settled
		)
		.orderBy(desc(payment.occurredAt), desc(payment.id))
		.limit(SAMPLE_COUNT);
	const gifts = rows.length === 0 ? [SAMPLE_GIFT] : rows.map(renderGift);
	return (trigger === 'new_donor' ? gifts.map(donorEventOf) : gifts) as ZapierEvent[T][];
}

/**
 * the latest refunds a live `gift_refunded` event would be sent for: standing (`refundStands` in
 * ../donations/queries.ts), of a gift whose settlement posted its `('payment', gift)` group — a refund or
 * dispute of a gift the books never held queues no event (`withdraw` in ../donations/reverse.ts).
 */
async function refundSamples(db: Db): Promise<RefundEvent[]> {
	const giftPosted = db
		.select({ one: sql`1` })
		.from(entryGroup)
		.where(
			and(eq(entryGroup.sourceType, 'payment'), eq(entryGroup.sourceId, payment.parentPaymentId))
		);
	const rows = await selectRefunds(db)
		.where(and(refundStands(db, payment), exists(giftPosted)))
		.orderBy(desc(payment.occurredAt), desc(payment.id))
		.limit(SAMPLE_COUNT);
	const events = await refundEventsOf(db, rows);
	const samples = rows.flatMap((row) => events.get(row.id) ?? []);
	return samples.length === 0 ? [SAMPLE_REFUND] : samples;
}
