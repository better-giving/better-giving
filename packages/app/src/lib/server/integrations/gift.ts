import type { Frequency, TributeKind } from '@better-giving/form/v1';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { projectTribute } from '../../donations/tributes';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import {
	contact,
	dispute,
	donation,
	form,
	payment,
	program,
	recurringPlan,
	type PaymentMethod
} from '../db/schema';
import { refundStands } from '../donations/queries';

// one gift as a system outside this deployment is told of it: the `new_gift` event a Zap receives
// (../zapier/payload.ts) and each entry the read API's gifts list answers with
// (src/routes/integrations.v1.gifts.ts). one projection, so the two never disagree about a field.
//
// a gift is one settled inbound payment — a `succeeded`, `direction = 'inbound'` row. an
// authorization nothing has settled yet is not one, and neither is a refund row: that is a fact
// about a gift, read here into the gift's own `status`.
//
// **the keys are permanent on both surfaces.** each is a field some Zap has mapped or some
// integrator's code reads, so a rename breaks it silently: add a key, never rename or drop one.
// every key is present on every gift, null where the gift has nothing to say.
//
// the tribute's notify name and address are not here: they name a third person who gave nothing
// and asked for nothing, and the gift leaves the deployment without them.

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
 * what refunds and lost disputes have taken back of a gift: none, some, or all of it. an open
 * dispute shows as `dispute_open` and never as a status. **the set may gain values**: a reader lets
 * one it does not know pass, and a value's meaning never narrows.
 */
export const GIFT_STATUSES = ['settled', 'partially_refunded', 'refunded'] as const;
export type GiftStatus = (typeof GIFT_STATUSES)[number];

/** one gift as the read API answers it: the `new_gift` event and where the gift stands now. */
export type ApiGift = GiftEvent & {
	readonly status: GiftStatus;
	/**
	 * what standing refunds and lost disputes have sent back, in minor units of the gift's
	 * currency. a refund that failed, a dispute won and a dispute still open send back nothing.
	 */
	readonly amount_refunded_minor: number;
	/** a dispute on this gift is open, and its money is withdrawn until it closes. */
	readonly dispute_open: boolean;
};

/** how many gifts the first page holds. */
const FIRST_PAGE_SIZE = 50;

/** the newest settled gifts, newest first by when the money moved, then by id. */
export async function readGiftPage(db: Db): Promise<ApiGift[]> {
	const rows = await selectGifts(db)
		.where(and(eq(payment.status, 'succeeded'), eq(payment.direction, 'inbound')))
		.orderBy(desc(payment.occurredAt), desc(payment.id))
		.limit(FIRST_PAGE_SIZE);
	const standing = await readRefundStanding(
		db,
		rows.map((row) => row.id)
	);
	return rows.map((row) => {
		const gift = renderGift(row);
		const { refundedMinor, disputeOpen } = standing.get(row.id) ?? NOTHING_SENT_BACK;
		return {
			...gift,
			status: statusOf(gift.amount_minor, refundedMinor),
			amount_refunded_minor: refundedMinor,
			dispute_open: disputeOpen
		};
	});
}

type RefundStanding = { readonly refundedMinor: number; readonly disputeOpen: boolean };

const NOTHING_SENT_BACK: RefundStanding = { refundedMinor: 0, disputeOpen: false };

/**
 * what has been sent back from each of `giftIds` and whether a dispute on it is open, keyed by
 * gift id. a gift with no refund row has no entry. an open dispute's withdrawal is not counted,
 * where `projectStatus` in ../donations/queries.ts reads the gift `disputed`: that money comes back
 * if the dispute is won. the ids are one page's, under D1's 100 bound
 * parameters (https://developers.cloudflare.com/d1/platform/limits/).
 */
async function readRefundStanding(
	db: Db,
	giftIds: readonly string[]
): Promise<Map<string, RefundStanding>> {
	if (giftIds.length === 0) return new Map();
	const disputed = alias(dispute, 'disputed');
	const rows = await db
		.select({
			giftId: payment.parentPaymentId,
			refundedMinor: sql<number>`coalesce(sum(case when ${refundStands(db, payment)} then ${payment.amountMinor} else 0 end), 0)`,
			disputeOpen: sql<number>`max(${disputed.paymentId} is not null and ${disputed.outcome} is null)`
		})
		.from(payment)
		.leftJoin(disputed, eq(disputed.paymentId, payment.id))
		.where(and(eq(payment.direction, 'refund'), inArray(payment.parentPaymentId, [...giftIds])))
		.groupBy(payment.parentPaymentId);
	const standing = new Map<string, RefundStanding>();
	for (const row of rows) {
		if (row.giftId === null) continue;
		standing.set(row.giftId, {
			refundedMinor: row.refundedMinor,
			disputeOpen: row.disputeOpen === 1
		});
	}
	return standing;
}

function statusOf(amountMinor: number, refundedMinor: number): GiftStatus {
	if (refundedMinor === 0) return 'settled';
	return refundedMinor >= amountMinor ? 'refunded' : 'partially_refunded';
}

/** every column a `GiftEvent` is rendered from, joined from the payment out. */
export function selectGifts(db: Db) {
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

export function renderGift(row: GiftRow): GiftEvent {
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
