import type { Frequency, TributeKind } from '@better-giving/form/v1';
import { and, desc, eq, inArray, lt, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { projectTribute } from '../../donations/tributes';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import { refundStands } from './events';
import {
	contact,
	dispute,
	donation,
	form,
	payment,
	program,
	recurringPlan,
	type PaymentMethod,
	type ZapierTrigger
} from '../db/schema';

// what a Zap is handed about a gift or a refund of one — the public contract every field a user
// maps into a Zap is read from, and the one render both the live send and the sample list go
// through.
//
// **the keys are permanent.** each is a field some organisation's Zap has mapped, so a rename
// breaks that Zap silently on its next run: add a key, never rename or drop one. every key is
// present on every event, null where the gift or refund has nothing to say, because a Zap maps the
// fields the sample showed it and a key missing from a live event is a blank in whatever it writes.
//
// the tribute's notify name and address are not here: they name a third person who gave nothing
// and asked for nothing, and the gift reaches a Zap without them.

/** one settled gift, as a `new_gift` Zap receives it. `id` is the payment's, stable across retries. */
export type GiftEvent = {
	readonly id: string;
	readonly donation_id: string;
	/** when the money moved, ISO 8601 in UTC. */
	readonly occurred_at: string;
	/** major units as a decimal string in the currency's own digits: `51.50`, `2500` for JPY. */
	readonly amount: string;
	readonly amount_minor: number;
	readonly currency: string;
	/** the processor fee the donor chose to add on top, included in `amount`. */
	readonly covered_fee_minor: number;
	readonly method: PaymentMethod;
	readonly recurring: boolean;
	readonly frequency: Frequency;
	readonly form_id: string | null;
	readonly form_name: string | null;
	readonly program_name: string | null;
	readonly dedication_kind: TributeKind | null;
	readonly dedication_honoree: string | null;
	readonly note: string | null;
	readonly donor_id: string;
	readonly donor_name: string;
	readonly donor_email: string | null;
	/** a crypto gift's coin and how much of it arrived; null on every other rail. */
	readonly coin: string | null;
	readonly coin_amount: string | null;
};

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
 * what sent a gift's money back: `refund`, one the organisation made, or `dispute`, one the donor's
 * bank decided against the organisation. **the set may gain values**: a Zap branches on the values
 * it knows and lets any other pass, and a value's meaning never narrows, so a value is never split
 * into two later. the trigger's own description in packages/zapier says the same to a Zap's author.
 */
export type RefundSource = 'refund' | 'dispute';

/**
 * one refund, or one dispute lost, as a `gift_refunded` Zap receives it: what left, and the gift it
 * left. `id` is the refund's own payment id, stable across retries and distinct from the gift's, so
 * a second refund of one gift is a second event.
 */
export type RefundEvent = {
	readonly id: string;
	/**
	 * when the money left the organisation, ISO 8601 in UTC. for a refund, when it was made. for a
	 * dispute, when it opened and withdrew the money, which may be weeks before it was lost and this
	 * event sent; where no opening was recorded, when it closed.
	 */
	readonly occurred_at: string;
	/**
	 * what left, in `amount`'s notation on `GiftEvent`. for a refund, what it gave back. for a
	 * dispute, what the processor took as the close left it, which is less than the opening withdrew
	 * where the close took less.
	 */
	readonly amount: string;
	readonly amount_minor: number;
	readonly currency: string;
	readonly source: RefundSource;
	/** the gift the money came out of, as a `new_gift` Zap receives it. */
	readonly gift: GiftEvent;
};

/**
 * payment ids per query. D1 caps a query at 100 bound parameters
 * (https://developers.cloudflare.com/d1/platform/limits/), and each id is one.
 */
const IDS_PER_READ = 90;

/**
 * the events for `paymentIds`, keyed by payment id. an id with no payment behind it has no entry,
 * which is the caller's to answer for — the map never holds a half-rendered event.
 */
export async function readGiftEvents(
	db: Db,
	paymentIds: readonly string[]
): Promise<Map<string, GiftEvent>> {
	const ids = [...new Set(paymentIds)];
	const events = new Map<string, GiftEvent>();
	for (let start = 0; start < ids.length; start += IDS_PER_READ) {
		const rows = await selectGifts(db).where(
			inArray(payment.id, ids.slice(start, start + IDS_PER_READ))
		);
		for (const row of rows) events.set(row.id, render(row));
	}
	return events;
}

/**
 * the refund events for `refundIds`, refund-direction payment rows, keyed by refund id. like
 * {@link readGiftEvents}, an id with no refund and gift behind it has no entry.
 */
export async function readRefundEvents(
	db: Db,
	refundIds: readonly string[]
): Promise<Map<string, RefundEvent>> {
	const ids = [...new Set(refundIds)];
	const refunds: RefundRow[] = [];
	for (let start = 0; start < ids.length; start += IDS_PER_READ) {
		refunds.push(
			...(await selectRefunds(db).where(
				and(
					eq(payment.direction, 'refund'),
					inArray(payment.id, ids.slice(start, start + IDS_PER_READ))
				)
			))
		);
	}
	return refundEventsOf(db, refunds);
}

/** a refund row with a `dispute` row on it is a dispute's withdrawal; any other is a refund. */
function selectRefunds(db: Db) {
	const disputed = alias(dispute, 'disputed');
	return db
		.select({
			id: payment.id,
			giftId: payment.parentPaymentId,
			occurredAt: payment.occurredAt,
			amountMinor: payment.amountMinor,
			currency: payment.currency,
			source: sql<RefundSource>`case when ${disputed.paymentId} is null then 'refund' else 'dispute' end`
		})
		.from(payment)
		.leftJoin(disputed, eq(disputed.paymentId, payment.id));
}

type RefundRow = Awaited<ReturnType<ReturnType<typeof selectRefunds>['all']>>[number];

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
		events.set(refund.id, {
			id: refund.id,
			occurred_at: refund.occurredAt.toISOString(),
			amount: majorText(refund.amountMinor, refund.currency),
			amount_minor: refund.amountMinor,
			currency: refund.currency,
			source: refund.source,
			gift
		});
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
		.where(trigger === 'new_donor' ? and(settled, notExists(earlierGiftOfDonor(db))) : settled)
		.orderBy(desc(payment.occurredAt), desc(payment.id))
		.limit(SAMPLE_COUNT);
	const gifts = rows.length === 0 ? [SAMPLE_GIFT] : rows.map(render);
	return (trigger === 'new_donor' ? gifts.map(donorEventOf) : gifts) as ZapierEvent[T][];
}

/** the latest refunds that stand, as `gift_refunded` hears of them (`refundStands` in ./events.ts). */
async function refundSamples(db: Db): Promise<RefundEvent[]> {
	const rows = await selectRefunds(db)
		.where(refundStands(db, payment))
		.orderBy(desc(payment.occurredAt), desc(payment.id))
		.limit(SAMPLE_COUNT);
	const events = await refundEventsOf(db, rows);
	const samples = rows.flatMap((row) => events.get(row.id) ?? []);
	return samples.length === 0 ? [SAMPLE_REFUND] : samples;
}

/**
 * a settled gift from the same donor as the outer row's, dated before it — so the outer row with
 * none is that donor's first. a tie on the date falls to the lower id, so exactly one row per
 * donor is first.
 */
function earlierGiftOfDonor(db: Db) {
	const earlier = alias(payment, 'earlier');
	const earlierDonation = alias(donation, 'earlier_donation');
	return db
		.select({ one: sql`1` })
		.from(earlier)
		.innerJoin(earlierDonation, eq(earlierDonation.id, earlier.donationId))
		.where(
			and(
				eq(earlierDonation.contactId, donation.contactId),
				eq(earlier.status, 'succeeded'),
				eq(earlier.direction, 'inbound'),
				or(
					lt(earlier.occurredAt, payment.occurredAt),
					and(eq(earlier.occurredAt, payment.occurredAt), lt(earlier.id, payment.id))
				)
			)
		);
}

/** every column a `GiftEvent` is rendered from, joined from the payment out. */
function selectGifts(db: Db) {
	return db
		.select({
			id: payment.id,
			donationId: payment.donationId,
			occurredAt: payment.occurredAt,
			amountMinor: payment.amountMinor,
			currency: payment.currency,
			method: payment.method,
			coin: payment.coin,
			coinAmount: payment.coinAmount,
			coveredFeeMinor: donation.feeMinor,
			note: donation.note,
			tributeKind: donation.tributeKind,
			tributeHonoree: donation.tributeHonoree,
			formId: donation.formId,
			formName: form.name,
			programName: program.name,
			interval: recurringPlan.interval,
			donorId: contact.id,
			donorName: contact.displayName,
			donorEmail: contact.primaryEmail
		})
		.from(payment)
		.innerJoin(donation, eq(donation.id, payment.donationId))
		.innerJoin(contact, eq(contact.id, donation.contactId))
		.leftJoin(form, eq(form.id, donation.formId))
		.leftJoin(program, eq(program.id, donation.programId))
		.leftJoin(recurringPlan, eq(recurringPlan.id, donation.recurringId));
}

type GiftRow = Awaited<ReturnType<ReturnType<typeof selectGifts>['all']>>[number];

function render(row: GiftRow): GiftEvent {
	const dedication = projectTribute(row.tributeKind, row.tributeHonoree);
	return {
		id: row.id,
		donation_id: row.donationId,
		occurred_at: row.occurredAt.toISOString(),
		amount: majorText(row.amountMinor, row.currency),
		amount_minor: row.amountMinor,
		currency: row.currency,
		covered_fee_minor: row.coveredFeeMinor,
		method: row.method,
		recurring: row.interval !== null,
		frequency: row.interval ?? 'one_time',
		form_id: row.formId,
		form_name: row.formName,
		program_name: row.programName,
		dedication_kind: dedication?.kind ?? null,
		dedication_honoree: dedication?.honoree ?? null,
		note: row.note,
		donor_id: row.donorId,
		donor_name: row.donorName,
		donor_email: row.donorEmail,
		coin: row.coin,
		coin_amount: row.coinAmount
	};
}
