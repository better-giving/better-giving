import { and, desc, eq, inArray, isNull, lte, notExists, type SQL, sql } from 'drizzle-orm';
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

/**
 * the most one page of the admin screen lists, as the gifts list caps itself
 * (`DONATION_LIST_LIMIT`).
 */
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

/**
 * where a page of messages resumes, newest first: past `passed` messages listed at `receivedAt`,
 * and on to every older one. it names no gift: the cursor is public on the donate page, and a
 * gift's id is what the crypto status poll answers to
 * (routes/api.v1.forms.$id.donations.$donationId.ts). gifts tied on one instant keep their order,
 * newest id first, so the count resumes them where the last page stopped.
 */
export type MessageCursor = { readonly receivedAt: number; readonly passed: number };

function cursorText({ receivedAt, passed }: MessageCursor): string {
	return Buffer.from(`${receivedAt}.${passed}`).toString('base64url');
}

/** a `next` this module handed out, or null for anything else. */
export function parseMessageCursor(text: string): MessageCursor | null {
	const match = /^(\d+)\.([1-9]\d*)$/.exec(Buffer.from(text, 'base64url').toString());
	if (match === null) return null;
	const receivedAt = Number(match[1]);
	const passed = Number(match[2]);
	if (!Number.isSafeInteger(receivedAt) || !Number.isSafeInteger(passed)) return null;
	return { receivedAt, passed };
}

/** the filter and offset that resume a newest-first list at `after`, or start it. */
function resumeAt(after: MessageCursor | null): { where: SQL | undefined; offset: number } {
	return after === null
		? { where: undefined, offset: 0 }
		: { where: lte(donation.receivedAt, new Date(after.receivedAt)), offset: after.passed };
}

/** the cursor past `page`, the rows a list shows after `after`; null where nothing follows. */
function cursorPast(
	page: readonly { readonly receivedAt: Date }[],
	after: MessageCursor | null,
	more: boolean
): string | null {
	const last = page.at(-1);
	if (!more || last === undefined) return null;
	const receivedAt = last.receivedAt.getTime();
	const tied = page.filter((row) => row.receivedAt.getTime() === receivedAt).length;
	const before = after !== null && after.receivedAt === receivedAt ? after.passed : 0;
	return cursorText({ receivedAt, passed: before + tied });
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
	const resume = resumeAt(after);
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				contactId: donation.contactId,
				note: donation.note,
				anonymous: donation.noteAnonymous,
				receivedAt: donation.receivedAt
			})
			.from(donation)
			.where(and(shown(db), resume.where))
			.orderBy(desc(donation.receivedAt), desc(donation.id))
			.limit(MESSAGES_PER_PAGE + 1)
			.offset(resume.offset),
		db.select({ total: sql<number>`count(*)` }).from(donation).where(shown(db))
	]);
	const page = rows.slice(0, MESSAGES_PER_PAGE);
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
		next: cursorPast(page, after, rows.length > MESSAGES_PER_PAGE)
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
 * the `MODERATED_MESSAGE_LIMIT` listed messages after `after`, or the newest, hidden ones in their
 * place; how many there are; and the cursor to the next page, null on the last.
 */
export async function readModeratedMessages(
	db: Db,
	after: MessageCursor | null = null
): Promise<{ messages: ModeratedMessage[]; total: number; next: string | null }> {
	const resume = resumeAt(after);
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
			.where(and(listed(db), resume.where))
			.orderBy(desc(donation.receivedAt), desc(donation.id))
			.limit(MODERATED_MESSAGE_LIMIT + 1)
			.offset(resume.offset),
		db.select({ total: sql<number>`count(*)` }).from(donation).where(listed(db))
	]);
	const page = rows.slice(0, MODERATED_MESSAGE_LIMIT);
	const name = await namesOf(
		db,
		page.map((row) => row.contactId)
	);
	return {
		messages: page.map((row) => ({
			id: row.id,
			name: name(row.contactId, row.anonymous),
			note: row.note ?? '',
			receivedAt: row.receivedAt,
			hidden: row.hiddenAt !== null
		})),
		total: counted?.total ?? 0,
		next: cursorPast(page, after, rows.length > MODERATED_MESSAGE_LIMIT)
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
