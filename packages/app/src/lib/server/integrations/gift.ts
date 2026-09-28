import type { Frequency, TributeKind } from '@better-giving/form/v1';
import { and, asc, desc, eq, inArray, isNull, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { projectTribute } from '../../donations/tributes';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import {
	contact,
	dispute,
	donation,
	ENTRY_SOURCE_TYPES,
	entryGroup,
	form,
	payment,
	program,
	recurringPlan,
	type PaymentMethod
} from '../db/schema';
import { refundStands } from '../donations/queries';
import { inPage, type Keyset, type PageOf, type PageQuery, pageOf, pastKeyset } from './paging';

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
//
// **when a gift last changed is read, never stored.** `updated_at` is the latest of: its payment
// row's writing; each journal entry keyed on that row; and for each refund-direction row reversing
// it, that row's writing, each journal entry keyed on it, and its dispute's `updated_at`. a gift's
// money changes in place — a pending row settles, a refund that did not stand flips to
// `cancelled`, a lost dispute lowers what it took — and `payment` has no `updated_at` to show it.
// every one of those writes lands in the same `batch()` as its journal entry (../books/writes.ts),
// and `entry_group` is append-only, so an entry's `created_at` is when that change was written. no
// money writer stamps anything for this read. what it does not see is a change the books could not
// take — a settlement ../donations/settle.ts corrects with nothing to post — and a change to the
// donor, form or program a gift names: those are read fresh on every page, not announced here.
//
// **two orders.** with no `updated_since`, newest first by when the money moved, then id. with
// `updated_since`, every gift whose `updated_at` is at or after it, oldest change first, then id.
// a system keeping a copy walks the second from any instant before the first gift, stores the last
// `updated_at` it was served, and passes that as `updated_since` next time. `>=` serves that last
// gift again, so it keeps one row per `id`, the later answer winning; and because each time is
// stamped when its write is built, a moment before the write commits, it resumes from a minute
// before the stored time rather than at it, so a write still committing then is not passed over.

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

/** a gift as the read API answers it, with where it stands now and when that last changed. */
export type ApiGift = GiftEvent & GiftStanding;

type GiftStanding = {
	readonly status: GiftStatus;
	/**
	 * what standing refunds and lost disputes have sent back, in minor units of the gift's
	 * currency. a refund that failed, a dispute won and a dispute still open send back nothing.
	 */
	readonly amount_refunded_minor: number;
	/** a dispute on this gift is open, and its money is withdrawn until it closes. */
	readonly dispute_open: boolean;
	/** when this gift last changed, ISO 8601 in UTC: the time `updated_since` is compared with. */
	readonly updated_at: string;
};

/**
 * the two orders gifts are walked in, each named as its cursors carry it (./paging.ts):
 * newest first by when the money moved, or oldest change first from an instant.
 */
export const GIFT_ORDERS = { newest: 'gifts.newest', changed: 'gifts.changed' } as const;

/** one page of settled gifts in the order `query` names. */
export async function readGiftPage(db: Db, query: PageQuery): Promise<PageOf<ApiGift>> {
	const keys =
		query.order === 'newest' ? await newestKeys(db, query) : await changedKeys(db, query);
	const page = pageOf(keys, query.limit, (key) => key);
	const ids = page.rows.map((key) => key.id);
	if (ids.length === 0) return { rows: [], next: null };
	// two reads rather than one `batch()`: drizzle maps a D1 batch's rows by column name, and the
	// gift's joined columns repeat `id` and `name`.
	const [rows, standing] = await Promise.all([
		selectGifts(db).where(inPage(payment.id, ids)),
		selectStanding(db, ids)
	]);
	const gifts = new Map(rows.map((row) => [row.id, renderGift(row)]));
	const standings = new Map(standing.map((row) => [row.id, row]));
	return {
		rows: ids.flatMap((id) => {
			const gift = gifts.get(id);
			const stands = standings.get(id);
			if (gift === undefined || stands === undefined) return [];
			return [
				{
					...gift,
					status: statusOf(gift.amount_minor, stands.refundedMinor),
					amount_refunded_minor: stands.refundedMinor,
					dispute_open: stands.disputeOpen === 1,
					updated_at: new Date(stands.updatedAt).toISOString()
				}
			];
		}),
		next: page.next
	};
}

/**
 * the gift's own payment row under a name of its own, so a subquery reading the refund-direction
 * rows that reverse it can read them as `payment` and hand them to `refundStands`.
 */
const gift = alias(payment, 'gift');

const isGift = (row: typeof payment | typeof gift) =>
	and(eq(row.status, 'succeeded'), eq(row.direction, 'inbound'));

async function newestKeys(db: Db, query: PageQuery): Promise<Keyset[]> {
	const rows = await db
		.select({ id: payment.id, at: payment.occurredAt })
		.from(payment)
		.where(
			and(
				isGift(payment),
				query.after === null
					? undefined
					: pastKeyset('desc', payment.occurredAt, payment.id, query.after)
			)
		)
		.orderBy(desc(payment.occurredAt), desc(payment.id))
		.limit(query.limit + 1);
	return rows.map((row) => ({ id: row.id, at: row.at.getTime() }));
}

async function changedKeys(db: Db, query: PageQuery & { order: 'changed' }): Promise<Keyset[]> {
	const changes = db
		.select({ id: gift.id, at: changedAt(db).as('updated_at') })
		.from(gift)
		.where(isGift(gift))
		.as('changes');
	return db
		.select({ id: changes.id, at: changes.at })
		.from(changes)
		.where(
			and(
				sql`${changes.at} >= ${query.since.getTime()}`,
				query.after === null ? undefined : pastKeyset('asc', changes.at, changes.id, query.after)
			)
		)
		.orderBy(asc(changes.at), asc(changes.id))
		.limit(query.limit + 1);
}

/**
 * where each gift of `ids` stands now: what has been sent back, whether a dispute is open, and when
 * it last changed. an open dispute's withdrawal is not counted as sent back, where `projectStatus`
 * in ../donations/queries.ts reads the gift `disputed`: that money comes back if the dispute is won.
 */
function selectStanding(db: Db, ids: readonly string[]) {
	const refunds = and(eq(payment.parentPaymentId, gift.id), eq(payment.direction, 'refund'));
	const refunded = db
		.select({
			sum: sql`sum(case when ${refundStands(db, payment)} then ${payment.amountMinor} else 0 end)`
		})
		.from(payment)
		.where(refunds);
	const openDispute = db
		.select({ one: sql`1` })
		.from(payment)
		.innerJoin(dispute, eq(dispute.paymentId, payment.id))
		.where(and(refunds, isNull(dispute.outcome)));
	return db
		.select({
			id: gift.id,
			refundedMinor: sql<number>`coalesce(${refunded}, 0)`,
			disputeOpen: sql<number>`exists ${openDispute}`,
			updatedAt: changedAt(db)
		})
		.from(gift)
		.where(inPage(gift.id, ids));
}

/**
 * when the gift on the `gift` row in scope last changed, in epoch milliseconds: the latest of
 * the row's own writing, each posting keyed on it, and for each refund-direction row reversing
 * it, that row's writing, each posting keyed on it and its dispute's last update. the header says
 * why these.
 */
function changedAt(db: Db): SQL<number> {
	const returned = alias(payment, 'changed_returned');
	const disputed = alias(dispute, 'changed_disputed');
	const refundChanged = db
		.select({
			at: sql`max(max(${returned.createdAt}, coalesce(${disputed.updatedAt}, 0), coalesce(${postedAt(db, returned.id, 'refund_posted')}, 0)))`
		})
		.from(returned)
		.leftJoin(disputed, eq(disputed.paymentId, returned.id))
		.where(and(eq(returned.parentPaymentId, gift.id), eq(returned.direction, 'refund')));
	return sql<number>`max(${gift.createdAt}, coalesce(${postedAt(db, gift.id, 'gift_posted')}, 0), coalesce(${refundChanged}, 0))`;
}

/**
 * the latest journal entry keyed on the payment `paymentId` names. every source type but
 * `donation` is keyed on a payment id (`entry_group_source_idx` in ../db/schema.ts), and naming
 * them lets that index's leading column serve the read.
 */
function postedAt(db: Db, paymentId: SQLWrapper, name: string) {
	const posted = alias(entryGroup, name);
	return db
		.select({ at: sql`max(${posted.createdAt})` })
		.from(posted)
		.where(and(inArray(posted.sourceType, PAYMENT_KEYED_SOURCES), eq(posted.sourceId, paymentId)));
}

const PAYMENT_KEYED_SOURCES = ENTRY_SOURCE_TYPES.filter((type) => type !== 'donation');

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
