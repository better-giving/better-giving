import { and, eq } from 'drizzle-orm';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import { payment } from '../db/schema';
import { refundStands } from '../donations/queries';
import { type ApiGift, readGifts } from '../integrations/gift';
import { inPage } from '../integrations/paging';
import { type RefundRow, type RefundSource, selectRefunds } from '../integrations/refund';
import type { WebhookEvent } from '../../webhooks/catalog';

// the `data` a destination is posted for each event, rendered at send from the row's subject
// (./deliver.ts). every gift in it is the read API's (`readGifts` in ../integrations/gift.ts) as it
// stands at that moment, and every key is held to that module's rule: permanent, and present, null
// where there is nothing to say.
//
// **a `gift.refunded` row is sent only while its refund still stands**, read here at send as it was
// in the statement that queued it (`giftRefundedWebhookStatements` in ./events.ts). a refund that
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
	const [withdrawals, standing] = await Promise.all([
		withdrawalIds.length === 0
			? []
			: selectRefunds(db).where(
					and(eq(payment.direction, 'refund'), inPage(payment.id, withdrawalIds))
				),
		readStandingRefunds(db, refundedIds)
	]);
	const byId = new Map(withdrawals.map((row) => [row.id, row]));
	const gifts = await readGifts(db, [
		...ofEvent('gift.made'),
		...withdrawals.flatMap((row) => (row.giftId === null ? [] : [row.giftId]))
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
			default:
				return { unsent: `A ${event} event is not one this deployment sends.` };
		}
	};
}

function unreadable(what: string, id: string): Rendered {
	return { unsent: `The ${what} ${id} this event was queued for could not be read.` };
}

const REFUND_NO_LONGER_STANDS =
	'The refund this event was queued for no longer stands: it failed, or its dispute no longer reads as lost. It was not sent.';

/** of `refundIds`, the refunds that still stand, read as this run renders them. */
async function readStandingRefunds(db: Db, refundIds: readonly string[]): Promise<Set<string>> {
	if (refundIds.length === 0) return new Set();
	const rows = await db
		.select({ id: payment.id })
		.from(payment)
		.where(and(inPage(payment.id, refundIds), refundStands(db, payment)));
	return new Set(rows.map((row) => row.id));
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
