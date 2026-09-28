import { and, eq, notExists } from 'drizzle-orm';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import { donation, payment } from '../db/schema';
import { earlierSettledGiftOfDonor } from '../donations/queries';
import { type ApiDonor, readDonors } from '../integrations/donor';
import { type ApiGift, readGifts } from '../integrations/gift';
import { inPage } from '../integrations/paging';
import { readRecurringGifts } from '../integrations/recurring-gift';
import {
	REFUND_NO_LONGER_STANDS,
	type RefundRow,
	type RefundSource,
	readStandingRefunds,
	selectRefunds
} from '../integrations/refund';
import type { WebhookEvent } from '../../webhooks/catalog';
import { changedRecordOf } from './events';

// the `data` a destination is posted for each event, rendered at send from the row's subject
// (./deliver.ts). every gift in it is the read API's (`readGifts` in ../integrations/gift.ts),
// every donor the read API's (`readDonors` in ../integrations/donor.ts) and every recurring gift
// the read API's (`readRecurringGifts` in ../integrations/recurring-gift.ts), each as it stands at
// that moment, and every key is held to those modules' rule: permanent, and present, null where
// there is nothing to say.
//
// **a change event says which record, not what changed.** `donor.updated`, `recurring_gift.updated`
// and `recurring_gift.ended` carry the record as it stands at send, not the change their row was
// queued for, so of two changes queued close together both posts may read alike — an ending
// followed at once by a revival posts an `ended` whose `status` is `active`; a receiver keeps the
// latest by `updated_at`. `donor.added`'s `first_gift` is the
// donor's earliest settled gift by date (`earlierSettledGiftOfDonor` in ../donations/queries.ts) —
// the gift whose settlement queued the row, unless one dated earlier was entered by hand since.
//
// **a `gift.refunded` row is sent only while its refund still stands**, read at send
// (`readStandingRefunds` in ../integrations/refund.ts, the read a Zap's is) as it was in the
// statement that queued it (`giftRefundedWebhookStatements` in ./events.ts). a refund that
// failed after it was queued, or a dispute whose loss no longer holds, is not sent: no event
// follows it, so posting it would leave a receiver acting on money that came back. what already
// went out stays out. `gift.made` and `gift.dispute_opened` are sent whatever befell the gift
// since: each is still true of the moment it names.

/**
 * one refund, or one dispute lost, as a `gift.refunded` destination receives it: what left, and
 * the gift it left — the keys a `gift_refunded` Zap receives (../zapier/payload.ts), with `gift`
 * as the read API answers it. `id` is the refund's own payment id, distinct from the gift's, so a
 * second refund of one gift is a second event.
 */
export type RefundedGift = {
	readonly id: string;
	/**
	 * when the money left the organisation, ISO 8601 in UTC: for a refund, when it was made; for a
	 * dispute, when it opened and withdrew the money, or where no opening was recorded, when it
	 * closed.
	 */
	readonly occurred_at: string;
	/**
	 * what left, in `amount`'s notation on the gift: for a refund, what it gave back; for a dispute,
	 * what the processor took as the close left it.
	 */
	readonly amount: string;
	readonly amount_minor: number;
	readonly currency: string;
	readonly source: RefundSource;
	readonly gift: ApiGift;
};

/**
 * one dispute, as a `gift.dispute_opened` destination receives it: the money its opening withdrew
 * from the gift. `id` is that withdrawal's payment id — the `id` a `gift.refunded` about the same
 * dispute carries, should it be lost.
 */
export type OpenedDispute = {
	readonly id: string;
	/** when the dispute opened and withdrew the money, ISO 8601 in UTC. */
	readonly opened_at: string;
	/**
	 * what the dispute holds, in `amount`'s notation on the gift: what the opening withdrew, or
	 * where it has since been lost for less, what the processor took.
	 */
	readonly amount: string;
	readonly amount_minor: number;
	readonly currency: string;
	/** the processor's deadline for the organisation's answer, ISO 8601 in UTC; null where it named none. */
	readonly respond_by: string | null;
	readonly gift: ApiGift;
};

/**
 * a donor's first settled gift, as a `donor.added` destination receives it: the donor as the read
 * API answers them, and `first_gift` as it answers that gift — the event a `new_donor` Zap
 * receives (../zapier/payload.ts), with the donor's keys where the Zap has `name` and `email`. `id`
 * is the donor's, so a destination hears of each donor once however many gifts follow.
 */
export type AddedDonor = ApiDonor & { readonly first_gift: ApiGift };

/** the subject a delivery row names, as ./deliver.ts claims it. */
type Subject = { readonly event: WebhookEvent; readonly subjectId: string };

/** a row's `data`, or the words `last_error` keeps for why it is not sent. */
type Rendered = { readonly data: unknown } | { readonly unsent: string };

/** each of `subjects` rendered, read in one pass over the lot. */
export async function renderSubjects(
	db: Db,
	subjects: readonly Subject[]
): Promise<(subject: Subject) => Rendered> {
	const ofEvent = (event: WebhookEvent) =>
		subjects.filter((s) => s.event === event).map((s) => s.subjectId);
	const refundedIds = ofEvent('gift.refunded');
	const withdrawalIds = [...refundedIds, ...ofEvent('gift.dispute_opened')];
	const addedIds = ofEvent('donor.added');
	const updatedIds = ofEvent('donor.updated').flatMap((subject) => changedRecordOf(subject) ?? []);
	const planIds = [
		...ofEvent('recurring_gift.started'),
		...[...ofEvent('recurring_gift.updated'), ...ofEvent('recurring_gift.ended')].flatMap(
			(subject) => changedRecordOf(subject) ?? []
		)
	];
	const [withdrawals, standing, donors, firstGiftIds, plans] = await Promise.all([
		withdrawalIds.length === 0
			? []
			: selectRefunds(db).where(
					and(eq(payment.direction, 'refund'), inPage(payment.id, withdrawalIds))
				),
		readStandingRefunds(db, refundedIds),
		readDonors(db, [...addedIds, ...updatedIds]),
		readFirstGifts(db, addedIds),
		readRecurringGifts(db, planIds)
	]);
	const byId = new Map(withdrawals.map((row) => [row.id, row]));
	const gifts = await readGifts(db, [
		...ofEvent('gift.made'),
		...withdrawals.flatMap((row) => (row.giftId === null ? [] : [row.giftId])),
		...firstGiftIds.values()
	]);
	const withdrawalOf = (id: string) => {
		const row = byId.get(id);
		const gift = row?.giftId ? gifts.get(row.giftId) : undefined;
		return row === undefined || gift === undefined ? undefined : { row, gift };
	};

	return ({ event, subjectId }) => {
		switch (event) {
			case 'gift.made': {
				const gift = gifts.get(subjectId);
				return gift === undefined ? unreadable('settled gift', subjectId) : { data: gift };
			}
			case 'gift.refunded': {
				const found = withdrawalOf(subjectId);
				if (found === undefined) return unreadable('refund', subjectId);
				if (!standing.has(subjectId)) return { unsent: REFUND_NO_LONGER_STANDS };
				return { data: refundedGift(found.row, found.gift) };
			}
			case 'gift.dispute_opened': {
				const found = withdrawalOf(subjectId);
				if (found === undefined) return unreadable('dispute withdrawal', subjectId);
				return { data: openedDispute(found.row, found.gift) };
			}
			case 'donor.added': {
				const donor = donors.get(subjectId);
				if (donor === undefined) return unreadable('donor', subjectId);
				const giftId = firstGiftIds.get(subjectId);
				const gift = giftId === undefined ? undefined : gifts.get(giftId);
				if (gift === undefined) return unreadable('first settled gift of the donor', subjectId);
				return { data: { ...donor, first_gift: gift } satisfies AddedDonor };
			}
			case 'donor.updated': {
				const contactId = changedRecordOf(subjectId);
				const donor = contactId === null ? undefined : donors.get(contactId);
				return donor === undefined ? unreadable('donor', contactId ?? subjectId) : { data: donor };
			}
			case 'recurring_gift.started': {
				const plan = plans.get(subjectId);
				return plan === undefined ? unreadable('recurring gift', subjectId) : { data: plan };
			}
			case 'recurring_gift.updated':
			case 'recurring_gift.ended': {
				const planId = changedRecordOf(subjectId);
				const plan = planId === null ? undefined : plans.get(planId);
				return plan === undefined
					? unreadable('recurring gift', planId ?? subjectId)
					: { data: plan };
			}
			default:
				return { unsent: `A ${event} event is not one this deployment sends.` };
		}
	};
}

function unreadable(what: string, id: string): Rendered {
	return { unsent: `The ${what} ${id} this event was queued for could not be read.` };
}

/** each of `contactIds`' first settled gift, by the donor's id: the one with no earlier one. */
async function readFirstGifts(db: Db, contactIds: readonly string[]): Promise<Map<string, string>> {
	if (contactIds.length === 0) return new Map();
	const rows = await db
		.select({ contactId: donation.contactId, paymentId: payment.id })
		.from(payment)
		.innerJoin(donation, eq(donation.id, payment.donationId))
		.where(
			and(
				inPage(donation.contactId, contactIds),
				eq(payment.status, 'succeeded'),
				eq(payment.direction, 'inbound'),
				notExists(earlierSettledGiftOfDonor(db))
			)
		);
	return new Map(rows.map((row) => [row.contactId, row.paymentId]));
}

function refundedGift(row: RefundRow, gift: ApiGift): RefundedGift {
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

function openedDispute(row: RefundRow, gift: ApiGift): OpenedDispute {
	return {
		id: row.id,
		opened_at: row.occurredAt.toISOString(),
		amount: majorText(row.amountMinor, row.currency),
		amount_minor: row.amountMinor,
		currency: row.currency,
		respond_by: row.respondBy?.toISOString() ?? null,
		gift
	};
}
