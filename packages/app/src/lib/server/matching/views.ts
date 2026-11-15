import { formatDate, giftAmount } from '@better-giving/emails';
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { authUser } from '../db/auth-schema';
import type { Db } from '../db/client';
import { type GiftMatch, giftMatch } from '../db/schema';
import { type MatchGift, readMatchGift } from '../donations/queries';
import { mailingAddress } from '../email/match';
import { readOrgProfile } from '../org/queries';
import { type MatchStatus, matchStatus } from '../../matching/status';
import { DONOR, SYSTEM } from './match';
import { reminderOwed } from './reminders';

// what the two screens about one gift's match are drawn from: the donor's own gift page, reached by
// its token with no sign-in, and the staff gift detail in /admin. each answers plain values a route
// hands to its component as props.
//
// the donor's view carries the employer they named and never the void reason or any staff id: the
// reason is staff's, and a donor is told only that the claim is closed. neither view is read by a
// public page, a donor message list, the connector or `/integrations/v1`
// (src/routes/gift-match.privacy.db.spec.ts holds that).

/**
 * the paperwork an employer's giving portal asks for, with the nonprofit as the filer. the address
 * is `null` where the profile holds none whole, and the page and the copied text then leave its row
 * out; the legal name and the EIN are `null` only on a profile never saved.
 */
export type FilingDetails = {
	readonly nonprofit: string | null;
	readonly ein: string | null;
	readonly mailingAddress: string | null;
	/** what is left of the gift after its refunds (`MatchGift.remainingMinor`), read at view time. */
	readonly amountMinor: number;
	/**
	 * what was given, the receipt's figure (`MatchGift.totalMinor`): where `amountMinor` is less,
	 * the amount is stated as both (`giftAmount` and `amountAfterRefunds` in @better-giving/emails).
	 */
	readonly givenMinor: number;
	readonly currency: string;
	readonly givenAt: Date;
	/** when the receipt went, or `null` where none has. */
	readonly receiptSentAt: Date | null;
	/** the address it went to, or `null` where the donor has none. */
	readonly receiptEmail: string | null;
};

/** the donor's gift page. */
export type GiftPageView = {
	readonly filing: FilingDetails;
	/** the details as `Copy details` copies them (`filingDetailsText`). */
	readonly copyText: string;
	readonly status: MatchStatus | null;
	readonly employer: string | null;
	readonly packSentAt: Date | null;
	/**
	 * when the one reminder falls due, or `null` where none is armed (`reminderPromised` says
	 * whether one will go).
	 */
	readonly reminderDueAt: Date | null;
	/**
	 * whether the reminder sweep will send the one reminder: it is owed (`reminderOwed` in
	 * ./reminders.ts) and `BETTER_AUTH_URL` pins the address the sweep links the page on. a pack
	 * sent on the request's host armed none.
	 */
	readonly reminderPromised: boolean;
	readonly remindedAt: Date | null;
	readonly filedAt: Date | null;
	readonly matchedAt: Date | null;
	readonly voidedAt: Date | null;
	/**
	 * when the gift was refunded whole (`MatchGift.refundedAt`), or `null` where something of it is
	 * left: a partial refund shows what is left in `filing` and reads as no refund here.
	 */
	readonly refundedAt: Date | null;
};

/**
 * the gift page for `token`, or `null` — an unknown token's answer — where no gift holds it or the
 * gift holding it is not in the books yet: a gift written at quote time may never be collected, and
 * its page shows nothing until it is. `pinned` is whether `BETTER_AUTH_URL` pins an origin, which
 * the reminder sweep needs to send anything (`sendDueReminders` in ./reminders.ts).
 */
export async function readGiftPage(
	db: Db,
	token: string,
	pinned: boolean
): Promise<GiftPageView | null> {
	const [read] = await db
		.select({
			...getTableColumns(giftMatch),
			reminderOwed: sql`${and(...reminderOwed(db))}`.mapWith(Boolean)
		})
		.from(giftMatch)
		.where(eq(giftMatch.token, token))
		.limit(1);
	if (read === undefined) return null;
	const { reminderOwed: owed, ...row } = read;
	const gift = await readMatchGift(db, row.donationId);
	if (gift === null || !gift.inBooks) return null;
	const filing = await filingOf(db, gift);
	return {
		filing,
		copyText: filingDetailsText(filing),
		status: matchStatus(row),
		employer: row.employer,
		packSentAt: row.packSentAt,
		reminderDueAt: row.reminderDueAt,
		reminderPromised: pinned && owed,
		remindedAt: row.remindedAt,
		filedAt: row.filedAt,
		matchedAt: row.matchedAt,
		voidedAt: row.voidedAt,
		refundedAt: gift.refundedAt
	};
}

async function filingOf(db: Db, gift: MatchGift): Promise<FilingDetails> {
	const org = await readOrgProfile(db);
	return {
		nonprofit: org?.legalName ?? null,
		ein: org?.taxId ?? null,
		mailingAddress: mailingAddress(org),
		amountMinor: gift.remainingMinor,
		givenMinor: gift.totalMinor,
		currency: gift.currency,
		givenAt: gift.receivedAt,
		receiptSentAt: gift.receiptSentAt,
		receiptEmail: gift.donorEmail
	};
}

/**
 * the details as plain text, one `Label: value` row each in the page's order, as `Copy details`
 * copies them — the figures spelled as the receipt and the pack spell them
 * (packages/emails/src/format.ts), so what the donor pastes matches what they were mailed. a row
 * with no value is left out, the mailing address the one that ordinarily is.
 */
export function filingDetailsText(filing: FilingDetails): string {
	const receipt =
		filing.receiptSentAt === null
			? null
			: filing.receiptEmail === null
				? `Sent on ${formatDate(filing.receiptSentAt)}`
				: `Emailed to ${filing.receiptEmail} on ${formatDate(filing.receiptSentAt)}`;
	const rows: [string, string | null][] = [
		['Nonprofit', filing.nonprofit],
		['EIN', filing.ein],
		['Mailing address', filing.mailingAddress],
		['Gift amount', giftAmount(filing.amountMinor, filing.givenMinor, filing.currency)],
		['Gift date', formatDate(filing.givenAt)],
		['Receipt', receipt]
	];
	return rows
		.flatMap(([label, value]) => (value === null ? [] : [`${label}: ${value}`]))
		.join('\n');
}

/** who set a stamp: the donor, the app itself, or a staff member as better-auth names them. */
export type MatchActor =
	| { readonly kind: 'donor' }
	| { readonly kind: 'system' }
	| { readonly kind: 'staff'; readonly userId: string };

/** one row of a match's history, oldest first. */
export type MatchEvent = {
	readonly event: 'pack_sent' | 'pack_failed' | 'reminded' | 'filed' | 'matched' | 'voided';
	readonly who: MatchActor;
	readonly at: Date;
	/** the void's reason, on `voided` alone. */
	readonly reason?: string;
};

/** the staff gift detail. */
export type StaffMatchView = {
	readonly gift: Pick<
		MatchGift,
		'donorName' | 'donorEmail' | 'currency' | 'receivedAt' | 'method' | 'status' | 'receiptSentAt'
	> & { readonly amountMinor: number };
	/** `null` on a gift recorded before matching, which has no row and shows no match. */
	readonly match: {
		readonly status: MatchStatus | null;
		readonly employer: string | null;
		readonly history: readonly MatchEvent[];
	} | null;
	/** the profile holds no whole mailing address, so donors' pages and mail leave it out. */
	readonly mailingAddressMissing: boolean;
};

/** the staff detail for the gift `donationId`, or `null` where no gift has the id. */
export async function readStaffMatch(db: Db, donationId: string): Promise<StaffMatchView | null> {
	const [gift, [row], org] = await Promise.all([
		readMatchGift(db, donationId),
		db.select().from(giftMatch).where(eq(giftMatch.donationId, donationId)).limit(1),
		readOrgProfile(db)
	]);
	if (gift === null) return null;
	return {
		gift: {
			donorName: gift.donorName,
			donorEmail: gift.donorEmail,
			amountMinor: gift.totalMinor,
			currency: gift.currency,
			receivedAt: gift.receivedAt,
			method: gift.method,
			status: gift.status,
			receiptSentAt: gift.receiptSentAt
		},
		match:
			row === undefined
				? null
				: { status: matchStatus(row), employer: row.employer, history: historyOf(row) },
		mailingAddressMissing: mailingAddress(org) === null
	};
}

/**
 * the name each staff member in `history` signs in under, by their id. a member removed since has
 * no row, and no entry here.
 */
export async function readStaffNames(
	db: Db,
	history: readonly MatchEvent[]
): Promise<Map<string, string>> {
	const ids = [
		...new Set(history.flatMap(({ who }) => (who.kind === 'staff' ? [who.userId] : [])))
	];
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: authUser.id, name: authUser.name })
		.from(authUser)
		.where(inArray(authUser.id, ids));
	return new Map(rows.map((row) => [row.id, row.name]));
}

function actor(by: string): MatchActor {
	if (by === DONOR) return { kind: 'donor' };
	if (by === SYSTEM) return { kind: 'system' };
	return { kind: 'staff', userId: by };
}

/** the stamps as events, oldest first. the pack and the reminder are the app's own. */
function historyOf(row: GiftMatch): MatchEvent[] {
	const system: MatchActor = { kind: 'system' };
	const events: MatchEvent[] = [];
	if (row.packSentAt) events.push({ event: 'pack_sent', who: system, at: row.packSentAt });
	if (row.packFailedAt) events.push({ event: 'pack_failed', who: system, at: row.packFailedAt });
	if (row.remindedAt) events.push({ event: 'reminded', who: system, at: row.remindedAt });
	if (row.filedAt && row.filedBy) {
		events.push({ event: 'filed', who: actor(row.filedBy), at: row.filedAt });
	}
	if (row.matchedAt && row.matchedBy) {
		events.push({ event: 'matched', who: actor(row.matchedBy), at: row.matchedAt });
	}
	if (row.voidedAt && row.voidedBy && row.voidReason) {
		events.push({
			event: 'voided',
			who: actor(row.voidedBy),
			at: row.voidedAt,
			reason: row.voidReason
		});
	}
	return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}
