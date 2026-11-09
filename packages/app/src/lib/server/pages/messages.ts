import { and, desc, eq, inArray, isNull, lte, notExists, type SQL, sql } from 'drizzle-orm';
import { type DonorMessages, MESSAGES_PER_PAGE, type NoteStanding } from '../../donate/messages';
import type { Db } from '../db/client';
import { dispute, donation, payment } from '../db/schema';
import { giftNetRaised } from '../ledger/queries';

// the donors' messages: a gift's note shown on the donate page, read for that page and for
// /admin/donations/messages, and the one write, hiding or showing one again.
//
// a gift's note is listed while all of these hold, and only then:
//   - the donor ticked Show my note (`note_public`),
//   - the note is not blank, by the whitespace `note_shown_name`'s check trims
//     (migrations/0035_donation_note_shown_name.sql),
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
		and trim(${donation.note}, char(32, 9, 10, 11, 12, 13, 160)) <> ''
		and ${giftNetRaised()} > 0
		and ${notExists(openDispute(db))}`;
}

/**
 * listed and not hidden. `listed`'s `note_public = 1` is what lets the planner take
 * `donation_note_public_received_at_idx` (../db/schema.ts), so every read here keeps it in its
 * `where`; `note_hidden_at is null` filters the rows that index yields.
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
	if (!Number.isSafeInteger(passed)) return null;
	// a safe integer can still lie past the last instant a `Date` holds, which then binds as NaN.
	if (Number.isNaN(new Date(receivedAt).getTime())) return null;
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

/**
 * the name a listed note is signed with, as the gift stored it when the donor opted in
 * (`noteOnPageColumns` in ../donations/record.ts), and never read from the contact, which may be
 * another donor's who shares the address. the checks on `note_shown_name` (../db/schema.ts) give
 * every public note one, so the null is the column's type and no gift's.
 */
const signature = (stored: string | null) => stored ?? 'Anonymous';

/** the six messages after `after`, or the newest six, as the donate page shows them. */
export async function readShownMessages(
	db: Db,
	after: MessageCursor | null
): Promise<DonorMessages> {
	const resume = resumeAt(after);
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				name: donation.noteShownName,
				note: donation.note,
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
	return {
		messages: page.map((row) => ({
			name: signature(row.name),
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
 * a row of /admin/donations/messages, by the key the list is ordered on, newest first: the time it
 * was received and the gift's id. a page resumes strictly past the row it ended on, so a message
 * that joins or leaves the list between loads moves no other row across a page's edge. it names a
 * gift, which the donor cursor above may not: this one reaches only a signed-in screen, which
 * lists the same ids.
 */
export type ModeratedCursor = { readonly receivedAt: number; readonly id: string };

/** the text a `ModeratedCursor` travels as, which `parseModeratedCursor` reads back. */
export function moderatedCursorText({ receivedAt, id }: ModeratedCursor): string {
	return Buffer.from(`${receivedAt}.${id}`).toString('base64url');
}

/** a `next` the admin reads handed out, or null for anything else. */
export function parseModeratedCursor(text: string): ModeratedCursor | null {
	const match = /^(\d+)\.(\S+)$/.exec(Buffer.from(text, 'base64url').toString());
	if (match === null) return null;
	const receivedAt = Number(match[1]);
	if (!Number.isSafeInteger(receivedAt)) return null;
	return { receivedAt, id: match[2] ?? '' };
}

const keyOf = (row: { readonly receivedAt: Date; readonly id: string }): ModeratedCursor => ({
	receivedAt: row.receivedAt.getTime(),
	id: row.id
});

/**
 * the rows listed after `key`, newest first. a row value rather than an `or` of its two halves, so
 * the planner seeks `donation_note_public_received_at_idx` from the cursor rather than scanning it
 * from the top (`messages.plan.db.spec.ts`).
 */
function olderThan(key: ModeratedCursor): SQL {
	return sql`(${donation.receivedAt}, ${donation.id}) < (${key.receivedAt}, ${key.id})`;
}

/** `key`'s own row and the rows listed before it, newest first. */
function atOrNewerThan(key: ModeratedCursor): SQL {
	return sql`(${donation.receivedAt}, ${donation.id}) >= (${key.receivedAt}, ${key.id})`;
}

const newestFirst = [desc(donation.receivedAt), desc(donation.id)] as const;

/**
 * the `MODERATED_MESSAGE_LIMIT` listed messages after `after`, or the newest, hidden ones in their
 * place; how many there are; and the cursor to the next page, null on the last.
 */
export async function readModeratedMessages(
	db: Db,
	after: ModeratedCursor | null = null
): Promise<{ messages: ModeratedMessage[]; total: number; next: string | null }> {
	const [rows, [counted]] = await Promise.all([
		moderatedRows(db, after === null ? undefined : olderThan(after)).limit(
			MODERATED_MESSAGE_LIMIT + 1
		),
		db.select({ total: sql<number>`count(*)` }).from(donation).where(listed(db))
	]);
	const page = rows.slice(0, MODERATED_MESSAGE_LIMIT);
	const last = page.at(-1);
	return {
		messages: page.map(moderated),
		total: counted?.total ?? 0,
		next:
			rows.length > MODERATED_MESSAGE_LIMIT && last !== undefined
				? moderatedCursorText(keyOf(last))
				: null
	};
}

/**
 * the key of the listed row `index` places past `after`, or past none from the newest, and whether
 * any row follows it; null where the list ends first.
 */
export async function moderatedKeyAt(
	db: Db,
	after: ModeratedCursor | null,
	index: number
): Promise<{ key: ModeratedCursor; more: boolean } | null> {
	const rows = await db
		.select({ receivedAt: donation.receivedAt, id: donation.id })
		.from(donation)
		.where(and(listed(db), after === null ? undefined : olderThan(after)))
		.orderBy(...newestFirst)
		.limit(2)
		.offset(index);
	const [row] = rows;
	return row === undefined ? null : { key: keyOf(row), more: rows.length > 1 };
}

/**
 * every listed message after `below`, down to and including `through`'s row, or to the end of the
 * list where `through` is null, newest first.
 */
export async function readModeratedBetween(
	db: Db,
	below: ModeratedCursor,
	through: ModeratedCursor | null
): Promise<ModeratedMessage[]> {
	const rows = await moderatedRows(
		db,
		and(olderThan(below), through === null ? undefined : atOrNewerThan(through))
	);
	return rows.map(moderated);
}

function moderatedRows(db: Db, where: SQL | undefined) {
	return db
		.select({
			id: donation.id,
			name: donation.noteShownName,
			note: donation.note,
			receivedAt: donation.receivedAt,
			hiddenAt: donation.noteHiddenAt
		})
		.from(donation)
		.where(and(listed(db), where))
		.orderBy(...newestFirst);
}

function moderated(row: Awaited<ReturnType<typeof moderatedRows>>[number]): ModeratedMessage {
	return {
		id: row.id,
		name: signature(row.name),
		note: row.note ?? '',
		receivedAt: row.receivedAt,
		hidden: row.hiddenAt !== null
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
