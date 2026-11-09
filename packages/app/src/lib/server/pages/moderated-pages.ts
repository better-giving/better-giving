import type { Db } from '../db/client';
import {
	MODERATED_MESSAGE_LIMIT,
	type ModeratedCursor,
	type ModeratedMessage,
	moderatedCursorText,
	moderatedKeyAt,
	readModeratedBetween,
	readModeratedMessages
} from './messages';

const forScreen = (m: ModeratedMessage) => ({ ...m, receivedAt: m.receivedAt.toISOString() });

/** the first page of /admin/donations/messages, as the screen lists it, and how many there are. */
export async function readModeratedFirstPage(db: Db) {
	const read = await readModeratedMessages(db);
	return { messages: read.messages.map(forScreen), total: read.total, next: read.next };
}

/**
 * Show older messages: every listed message past the first page as it stands now, down through the
 * `pages`th page after `after`, the cursor the first page ended on when the screen first asked; and
 * the cursor past them, null on the list's end.
 *
 * the bottom is held by `after`, so a re-read draws the same rows; the top follows the first page,
 * which the screen re-reads beside this. a message arriving pushes the first page's last row off
 * it, and the read takes that row up rather than resuming past it; a message leaving pulls the
 * next row onto the first page, and the read leaves it there. so the two together list every
 * message once.
 */
export async function readOlderModeratedPages(db: Db, after: ModeratedCursor, pages: number) {
	const [firstEnd, bottom] = await Promise.all([
		moderatedKeyAt(db, null, MODERATED_MESSAGE_LIMIT - 1),
		moderatedKeyAt(db, after, pages * MODERATED_MESSAGE_LIMIT - 1)
	]);
	if (firstEnd === null || !firstEnd.more) return { messages: [], next: null };
	const messages = await readModeratedBetween(db, firstEnd.key, bottom?.key ?? null);
	return {
		messages: messages.map(forScreen),
		next: bottom?.more === true ? moderatedCursorText(bottom.key) : null
	};
}
