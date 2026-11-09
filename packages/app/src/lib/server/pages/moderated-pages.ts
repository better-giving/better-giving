import type { Db } from '../db/client';
import { type MessageCursor, parseMessageCursor, readModeratedMessages } from './messages';

/**
 * up to `pages` pages of /admin/donations/messages from `after`, or from the newest, as the screen
 * lists them; how many there are; and the cursor past the last page read, null on the list's end.
 * the read stops at the end of the list, however many pages were asked for.
 */
export async function readModeratedPages(db: Db, after: MessageCursor | null, pages: number) {
	const messages: {
		id: string;
		name: string;
		note: string;
		receivedAt: string;
		hidden: boolean;
	}[] = [];
	let cursor = after;
	let read: Awaited<ReturnType<typeof readModeratedMessages>>;
	let left = pages;
	do {
		read = await readModeratedMessages(db, cursor);
		for (const m of read.messages) {
			messages.push({ ...m, receivedAt: m.receivedAt.toISOString() });
		}
		cursor = read.next === null ? null : parseMessageCursor(read.next);
		left -= 1;
	} while (left > 0 && cursor !== null);
	return { messages, total: read.total, next: read.next };
}
