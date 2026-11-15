import {
	and,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	ne,
	notExists,
	or,
	type SQL,
	sql
} from 'drizzle-orm';
import type { Db } from '../db/client';
import { dispute, donation, type GiftMatch, giftMatch, payment } from '../db/schema';
import { nothingLeftOfGift } from '../donations/queries';
import {
	type MatchFilter,
	type MatchStamps,
	type MatchStatus,
	matchStatus
} from '../../matching/status';
import { type GiftOrigin, giftPageUrl } from './links';

// a gift's employer match: its row, and every write it takes. the only module that writes
// `gift_match` but for the reminder's claim (./reminders.ts) and the pack's (./pack.ts).
//
// each write is one conditional UPDATE that sets its stamp and its `_by` together, and `.returning()`
// says whether it landed. a call the statement refuses — the stamp already set, or a terminal state
// in the way — changes nothing and answers the row as it stands, read after the statement decided,
// so a repeat is a no-op and never an error, and nothing here is a read-then-write.
//
// the rules the statements hold, each a case in ./match.db.spec.ts:
//   - matched is terminal: no void, no filed and no employer after it. a full refund or a lost
//     dispute still voids it (`refundVoidStatement`, `disputeLostVoidStatement`); a partial refund
//     and a dispute opened or won leave every match as it stood.
//   - voided is terminal: no filed, no matched and no employer after it. the one way back is a
//     void the system wrote, cleared when the refund or the loss behind it is put back
//     (`reopenStatement`); matched stays as it stood under the void.
//   - matched may come before filed, and counts as filed without stamping it.
//   - filed needs no employer named.

/** `filed_by` when the donor pressed "I've filed it" on their gift page. */
export const DONOR = 'donor';

/** `voided_by` when a full refund or a lost dispute closed the match. */
export const SYSTEM = 'system';

/** the void reason a full refund writes. */
export const REFUND_REASON = 'Gift refunded';

/** the void reason a lost dispute writes. */
export const DISPUTE_LOST_REASON = 'Dispute lost';

/** how long after the pack is sent (`sendOwedPack` in ./pack.ts) its one reminder falls due. */
export const REMINDER_AFTER_MS = 3 * 24 * 60 * 60_000;

/** the most characters an employer may hold, as `gift_match_employer_length_check` counts them. */
export const MAX_EMPLOYER_CHARS = 200;

/**
 * the gift's row, for the same `batch()` that writes the gift — so a gift recorded from now on has
 * one and a gift recorded before has none. `gift_match_donation_id_idx` refuses a second, and that
 * refusal rolls the batch back with it, which is the gift's own insert colliding first anyway.
 * `token` is one `mintGiftMatchToken` in ../db/schema.ts minted, where the caller answers the
 * page's address before the batch runs; absent, the column mints it.
 */
export function giftMatchInsert(db: Db, donationId: string, token?: string) {
	return db.insert(giftMatch).values({ donationId, ...(token === undefined ? {} : { token }) });
}

/**
 * which gift a write names: by id for staff, by the gift page's token for the donor — and by the
 * token on the form the gift was made on for the donation form, which knows the form it posts to
 * (`POST /api/v1/forms/:id/gifts/:token/employer`). a token on another form's gift names nothing.
 */
export type MatchKey =
	| { readonly donationId: string }
	| { readonly token: string; readonly formId?: string };

function keyed(key: MatchKey): SQL {
	if (!('token' in key)) return eq(giftMatch.donationId, key.donationId);
	const byToken = eq(giftMatch.token, key.token);
	if (key.formId === undefined) return byToken;
	return sql`${byToken} and ${giftMatch.donationId} in (select ${donation.id} from ${donation} where ${donation.formId} = ${key.formId})`;
}

/** the row as a write reports it. */
export type MatchState = MatchStamps & {
	readonly donationId: string;
	readonly token: string;
	readonly status: MatchStatus | null;
	readonly packSentAt: Date | null;
	readonly reminderDueAt: Date | null;
};

export type MatchWrite =
	| { readonly ok: true; readonly changed: boolean; readonly state: MatchState }
	| { readonly ok: false; readonly reason: 'not_found' | 'reason_blank' | 'employer_invalid' };

function stateOf(row: GiftMatch): MatchState {
	return {
		donationId: row.donationId,
		token: row.token,
		employer: row.employer,
		packSentAt: row.packSentAt,
		packFailedAt: row.packFailedAt,
		reminderDueAt: row.reminderDueAt,
		remindedAt: row.remindedAt,
		filedAt: row.filedAt,
		matchedAt: row.matchedAt,
		voidedAt: row.voidedAt,
		status: matchStatus(row)
	};
}

/** the answer to a conditional update: what it wrote, or the row it left alone. */
async function answered(db: Db, key: MatchKey, written: GiftMatch[]): Promise<MatchWrite> {
	const [landed] = written;
	if (landed !== undefined) return { ok: true, changed: true, state: stateOf(landed) };
	const [standing] = await db.select().from(giftMatch).where(keyed(key)).limit(1);
	if (standing === undefined) return { ok: false, reason: 'not_found' };
	return { ok: true, changed: false, state: stateOf(standing) };
}

const open = () => and(isNull(giftMatch.matchedAt), isNull(giftMatch.voidedAt));

/**
 * the row's gift is in the books: an inbound attempt on it succeeded, as `projectStatus` in
 * ../donations/queries.ts reads one. mail about a match waits for it, because a gift recorded at
 * quote time may never be collected.
 */
export function inBooks(db: Db): SQL {
	return exists(
		db
			.select({ id: payment.id })
			.from(payment)
			.where(
				and(
					eq(payment.donationId, giftMatch.donationId),
					eq(payment.direction, 'inbound'),
					eq(payment.status, 'succeeded')
				)
			)
	);
}

/** the donor or staff saying the match was filed with the employer. */
export async function markFiled(db: Db, key: MatchKey, by: string, now: Date): Promise<MatchWrite> {
	const written = await db
		.update(giftMatch)
		.set({ filedAt: now, filedBy: by })
		.where(and(keyed(key), isNull(giftMatch.filedAt), open()))
		.returning();
	return answered(db, key, written);
}

/** staff saying the employer's money arrived. */
export async function markMatched(
	db: Db,
	key: MatchKey,
	by: string,
	now: Date
): Promise<MatchWrite> {
	const written = await db
		.update(giftMatch)
		.set({ matchedAt: now, matchedBy: by })
		.where(and(keyed(key), open()))
		.returning();
	return answered(db, key, written);
}

/** staff closing the match, with a reason only staff see. */
export async function voidMatch(
	db: Db,
	key: MatchKey,
	by: string,
	reason: string,
	now: Date
): Promise<MatchWrite> {
	const trimmed = reason.trim();
	if (trimmed === '') return { ok: false, reason: 'reason_blank' };
	const written = await db
		.update(giftMatch)
		.set({ voidedAt: now, voidedBy: by, voidReason: trimmed })
		.where(and(keyed(key), open()))
		.returning();
	return answered(db, key, written);
}

/**
 * a refund's void, for the refund's own `batch()` in ../donations/reverse.ts, after the refund row's
 * insert or, for a refund that settles an open dispute, after that dispute's close: it lands only
 * where that refund left nothing of the gift (`nothingLeftOfGift` in ../donations/queries.ts), so
 * a partial refund leaves the match as it stood and the one that takes the rest closes it. it voids
 * a matched gift too — staff take no action after matched, and a refund still closes it — leaves an
 * earlier void as it stood, and matches no row on a gift that has none. it sets the three columns the void's checks pair, so it cannot be what refuses the
 * refund's batch.
 */
export function refundVoidStatement(db: Db, donationId: string, now: Date) {
	return db
		.update(giftMatch)
		.set({ voidedAt: now, voidedBy: SYSTEM, voidReason: REFUND_REASON })
		.where(
			and(
				eq(giftMatch.donationId, donationId),
				isNull(giftMatch.voidedAt),
				nothingLeftOfGift(db, giftMatch.donationId)
			)
		);
}

/**
 * a lost dispute's void, for the `batch()` in ../donations/reverse.ts that records the dispute on
 * the withdrawal row `withdrawalId` lost, after the statement that closes it: it lands only where
 * that dispute's row reads lost, so a close another delivery decided the other way voids nothing.
 * a dispute opened or won voids nothing, since a win puts the money back. otherwise as
 * `refundVoidStatement`.
 */
export function disputeLostVoidStatement(
	db: Db,
	donationId: string,
	withdrawalId: string,
	now: Date
) {
	const lost = db
		.select({ one: sql`1` })
		.from(dispute)
		.where(and(eq(dispute.paymentId, withdrawalId), eq(dispute.outcome, 'lost')));
	return db
		.update(giftMatch)
		.set({ voidedAt: now, voidedBy: SYSTEM, voidReason: DISPUTE_LOST_REASON })
		.where(and(eq(giftMatch.donationId, donationId), isNull(giftMatch.voidedAt), exists(lost)));
}

/**
 * the void a refund or a lost dispute wrote, cleared, for the `batch()` in ../donations/reverse.ts
 * that puts back a refund that did not stand or a dispute won after its loss, after the statements
 * that flip the refund row and close the dispute: it lands only where the system wrote the void for
 * one of those two reasons, something of the gift is left again (`nothingLeftOfGift`), and no lost
 * dispute on the gift still stands. a void staff wrote stays. it clears the three columns the void's
 * checks pair and touches no other, so a match that was matched before the void reads matched again.
 */
export function reopenStatement(db: Db, donationId: string) {
	const lostStands = db
		.select({ one: sql`1` })
		.from(dispute)
		.innerJoin(payment, eq(payment.id, dispute.paymentId))
		.where(
			and(
				eq(payment.donationId, donationId),
				eq(payment.status, 'succeeded'),
				eq(dispute.outcome, 'lost')
			)
		);
	return db
		.update(giftMatch)
		.set({ voidedAt: null, voidedBy: null, voidReason: null })
		.where(
			and(
				eq(giftMatch.donationId, donationId),
				eq(giftMatch.voidedBy, SYSTEM),
				inArray(giftMatch.voidReason, [REFUND_REASON, DISPUTE_LOST_REASON]),
				// parenthesised: `not` binds tighter than the `and` inside `nothingLeftOfGift`.
				sql`not (${nothingLeftOfGift(db, giftMatch.donationId)})`,
				notExists(lostStands)
			)
		)
		.returning({ donationId: giftMatch.donationId });
}

/**
 * what the donor typed, as the column takes it, or `null` where it is blank, too long, or holds a
 * control character: SQLite's `length()` in the length check stops counting at a NUL, and the name
 * is printed into mail.
 */
export function employerOf(typed: string): string | null {
	const trimmed = typed.trim();
	const chars = [...trimmed].length;
	if (chars === 0 || chars > MAX_EMPLOYER_CHARS || CONTROL.test(trimmed)) return null;
	return trimmed;
}

const CONTROL = /\p{Cc}/u;

/**
 * the donor naming the employer, or changing it. it arms no reminder: the pack's claim does, and a
 * change leaves the due time and a sent reminder as they stand. whether a pack is owed is the
 * caller's to act on through ./pack.ts, which sends one only where none has gone.
 */
export async function nameEmployer(db: Db, key: MatchKey, typed: string): Promise<MatchWrite> {
	const employer = employerOf(typed);
	if (employer === null) return { ok: false, reason: 'employer_invalid' };
	const written = await db
		.update(giftMatch)
		.set({ employer })
		.where(
			and(keyed(key), open(), or(isNull(giftMatch.employer), ne(giftMatch.employer, employer)))
		)
		.returning();
	return answered(db, key, written);
}

/** the gift page's address for this gift, or `null` where it has no row or no origin names one. */
export async function readGiftPageUrl(
	db: Db,
	donationId: string,
	origin: GiftOrigin | null
): Promise<string | null> {
	if (origin === null) return null;
	const [row] = await db
		.select({ token: giftMatch.token })
		.from(giftMatch)
		.where(eq(giftMatch.donationId, donationId))
		.limit(1);
	return row === undefined ? null : giftPageUrl(origin, row.token);
}

/**
 * the gifts a list filter keeps, over a left join of `gift_match` onto `donation`: each word by the
 * priority `matchStatus` in ../../matching/status.ts reads it, so a row the filter keeps shows that
 * word. `no_employer` keeps every gift naming none, a gift recorded before matching among them.
 */
export function matchFilterWhere(filter: MatchFilter): SQL {
	const g = giftMatch;
	const above: Record<MatchStatus, SQL[]> = {
		voided: [],
		matched: [isNull(g.voidedAt)],
		filed: [isNull(g.voidedAt), isNull(g.matchedAt)],
		send_failed: [isNull(g.voidedAt), isNull(g.matchedAt), isNull(g.filedAt)],
		reminded: [isNull(g.voidedAt), isNull(g.matchedAt), isNull(g.filedAt), isNull(g.packFailedAt)],
		pack_sent: [
			isNull(g.voidedAt),
			isNull(g.matchedAt),
			isNull(g.filedAt),
			isNull(g.packFailedAt),
			isNull(g.remindedAt)
		]
	};
	const own: Record<MatchStatus, SQL> = {
		voided: isNotNull(g.voidedAt),
		matched: isNotNull(g.matchedAt),
		filed: isNotNull(g.filedAt),
		send_failed: isNotNull(g.packFailedAt),
		reminded: isNotNull(g.remindedAt),
		pack_sent: isNotNull(g.packSentAt)
	};
	if (filter === 'no_employer') return isNull(g.employer);
	return and(...above[filter], own[filter]) as SQL;
}
