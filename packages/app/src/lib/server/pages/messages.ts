import { and, desc, eq, inArray, isNull, notExists, type SQL, sql } from 'drizzle-orm';
import { type DonorMessages, MESSAGES_PER_PAGE, type NoteStanding } from '../../donate/messages';
import { readContactNameParts } from '../contacts/queries';
import type { Db } from '../db/client';
import { dispute, donation, payment } from '../db/schema';
import { giftNetRaised } from '../ledger/queries';
import { type NameParts, shownName } from './shown-name';

// the donors' messages: a gift's note shown on the donate page, read for that page and for
// /admin/donations/messages, and the one write, hiding or showing one again.
//
// a gift's note is listed while all of these hold, and only then:
//   - the donor ticked Show my note (`note_public`),
//   - the note is not blank,
//   - the gift is settled and not reversed: it still stands above nothing in the books, on the
//     figure the raised total counts gifts by (`giftNetRaised` in ../ledger/queries.ts), so a gift
//     refunded in full or withdrawn by a dispute leaves on its own and a partly refunded one stays,
//   - and no dispute on it is open, which a dispute withdrawing only part of the gift would leave
//     standing above nothing.
// the page shows a listed note unless staff hid it (`note_hidden_at`); the admin screen lists both.
//
// every read here runs on its request and nothing is cached: a list a hide or a refund changes is
// neither a capability nor immutable bytes (AGENTS.md → Storage), so each reaches the next load.

/** the most the admin screen lists, as the gifts list caps itself (`DONATION_LIST_LIMIT`). */
export const MODERATED_MESSAGE_LIMIT = 50;

const openDispute = (db: Db) =>
	db
		.select({ one: sql`1` })
		.from(dispute)
		.innerJoin(payment, eq(payment.id, dispute.paymentId))
		.where(and(eq(payment.donationId, donation.id), isNull(dispute.outcome)));

function listed(db: Db): SQL {
	return sql`${donation.notePublic} = 1
		and trim(${donation.note}) <> ''
		and ${giftNetRaised()} > 0
		and ${notExists(openDispute(db))}`;
}

/**
 * listed and not hidden, spelled as literals so the planner can take
 * `donation_note_shown_received_at_idx`: a bound `?` proves nothing about a partial index's `WHERE`.
 */
function shown(db: Db): SQL {
	return sql`${donation.noteHiddenAt} is null and ${listed(db)}`;
}

/** where a page of messages resumes: past the gift last shown, newest first. */
export type MessageCursor = { readonly receivedAt: number; readonly id: string };

function cursorText({ receivedAt, id }: MessageCursor): string {
	return Buffer.from(`${receivedAt}.${id}`).toString('base64url');
}

/** a `next` this module handed out, or null for anything else. */
export function parseMessageCursor(text: string): MessageCursor | null {
	const decoded = Buffer.from(text, 'base64url').toString();
	const dot = decoded.indexOf('.');
	const receivedAt = Number(decoded.slice(0, dot));
	const id = decoded.slice(dot + 1);
	if (dot < 1 || !Number.isSafeInteger(receivedAt) || id === '') return null;
	return { receivedAt, id };
}

async function namesOf(db: Db, contactIds: readonly string[]) {
	const parts = await readContactNameParts(db, contactIds);
	const none: NameParts = { firstName: null, lastName: null };
	return (contactId: string, anonymous: boolean) =>
		shownName(parts.get(contactId) ?? none, anonymous);
}

/** the six messages after `after`, or the newest six, as the donate page shows them. */
export async function readShownMessages(
	db: Db,
	after: MessageCursor | null
): Promise<DonorMessages> {
	const resume =
		after === null
			? undefined
			: sql`(${donation.receivedAt} < ${after.receivedAt}
				or (${donation.receivedAt} = ${after.receivedAt} and ${donation.id} < ${after.id}))`;
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				id: donation.id,
				contactId: donation.contactId,
				note: donation.note,
				anonymous: donation.noteAnonymous,
				receivedAt: donation.receivedAt
			})
			.from(donation)
			.where(and(shown(db), resume))
			.orderBy(desc(donation.receivedAt), desc(donation.id))
			.limit(MESSAGES_PER_PAGE + 1),
		db.select({ total: sql<number>`count(*)` }).from(donation).where(shown(db))
	]);
	const page = rows.slice(0, MESSAGES_PER_PAGE);
	const last = page.at(-1);
	const name = await namesOf(
		db,
		page.map((row) => row.contactId)
	);
	return {
		messages: page.map((row) => ({
			name: name(row.contactId, row.anonymous),
			note: row.note ?? '',
			receivedAt: row.receivedAt.toISOString()
		})),
		total: counted?.total ?? 0,
		next:
			rows.length > MESSAGES_PER_PAGE && last
				? cursorText({ receivedAt: last.receivedAt.getTime(), id: last.id })
				: null
	};
}

/** a listed message as /admin/donations/messages shows it, hidden or not. */
export type ModeratedMessage = {
	/** the gift's id, which a hide or show names. */
	readonly id: string;
	readonly name: string;
	readonly note: string;
	readonly receivedAt: Date;
	readonly hidden: boolean;
};

/**
 * the newest `MODERATED_MESSAGE_LIMIT` listed messages, hidden ones in their place, and how many
 * there are.
 */
export async function readModeratedMessages(
	db: Db
): Promise<{ messages: ModeratedMessage[]; total: number }> {
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				id: donation.id,
				contactId: donation.contactId,
				note: donation.note,
				anonymous: donation.noteAnonymous,
				receivedAt: donation.receivedAt,
				hiddenAt: donation.noteHiddenAt
			})
			.from(donation)
			.where(listed(db))
			.orderBy(desc(donation.receivedAt), desc(donation.id))
			.limit(MODERATED_MESSAGE_LIMIT),
		db.select({ total: sql<number>`count(*)` }).from(donation).where(listed(db))
	]);
	const name = await namesOf(
		db,
		rows.map((row) => row.contactId)
	);
	return {
		messages: rows.map((row) => ({
			id: row.id,
			name: name(row.contactId, row.anonymous),
			note: row.note ?? '',
			receivedAt: row.receivedAt,
			hidden: row.hiddenAt !== null
		})),
		total: counted?.total ?? 0
	};
}

/** where each of these gifts' notes stands on the page; a gift with no listed note is `private`. */
export async function readNoteStandings(
	db: Db,
	ids: readonly string[]
): Promise<(id: string) => NoteStanding> {
	const rows =
		ids.length === 0
			? []
			: await db
					.select({ id: donation.id, hiddenAt: donation.noteHiddenAt })
					.from(donation)
					.where(and(inArray(donation.id, [...ids]), listed(db)));
	const standing = new Map(
		rows.map((row): [string, NoteStanding] => [row.id, row.hiddenAt === null ? 'shown' : 'hidden'])
	);
	return (id) => standing.get(id) ?? 'private';
}

/**
 * hide the listed message on gift `id` from the page, or show it again; `false` where `id` names
 * no listed message. a second hide keeps the first one's time, so a double press changes nothing.
 * the note, the gift and the books are untouched.
 */
export async function setNoteHidden(
	db: Db,
	id: string,
	hidden: boolean,
	now: Date
): Promise<boolean> {
	const written = await db
		.update(donation)
		.set({
			noteHiddenAt: hidden ? sql`coalesce(${donation.noteHiddenAt}, ${now.getTime()})` : null
		})
		.where(and(eq(donation.id, id), listed(db)))
		.returning({ id: donation.id });
	return written.length > 0;
}
