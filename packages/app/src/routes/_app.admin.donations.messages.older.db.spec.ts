import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { setNoteHidden } from '$lib/server/pages/messages';
import * as moderatedPages from '$lib/server/pages/moderated-pages';
import { noteGift, refund } from '$lib/server/pages/settled-gifts.testing';
import { freshDeployment, page, signInAsDeployer, signInAsMember } from '../webhook-routes.testing';
import * as screen from './_app.admin.donations.messages';
import * as older from './_app.admin.donations.messages.older';

// Show older messages on /admin/donations/messages, through the protected layout against the real
// database: the pages after the cursor the screen's first page ends on, read again whole on every
// re-read so an older row a press changed is drawn as it now stands. how many a page holds and
// how the cursor resumes are `$lib/server/pages/messages.db.spec.ts`'s.

const SCREEN = '/admin/donations/messages';
const OLDER = '/admin/donations/messages/older';
const screenAt = page('admin/donations/messages', screen);
const olderAt = page('admin/donations/messages/older', older);

let db: Db;
let formId: string;
let staff: string;
let member: string;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	for (const table of [
		'dispute',
		'zapier_delivery',
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'line_item',
		'recurring_plan',
		'page'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await freshDeployment();
	await run(stmt('delete from form'));
	({ formId } = await ensureDonationPage(db));
	staff = await signInAsDeployer(db);
	member = await signInAsMember(db);
});

/** `count` shown messages a day apart, the newest first in the order they were made. */
async function shownGifts(count: number) {
	const made: string[] = [];
	for (let i = 0; i < count; i += 1) {
		const { donationId } = await noteGift(db, formId, {
			note: `message ${i}`,
			noteOnPage: 'named',
			receivedAt: new Date(Date.UTC(2026, 8, 30) - i * 86_400_000)
		});
		made.push(donationId);
	}
	return made;
}

type Older = {
	kind: 'messages';
	messages: { id: string; name: string; note: string; receivedAt: string; hidden: boolean }[];
	next: string | null;
};

async function firstNext(cookie: string): Promise<string> {
	const first = (await (await screenAt.get(SCREEN, cookie)).json()) as { next: string | null };
	if (first.next === null) throw new Error('the first page ends on no cursor');
	return first.next;
}

const olderPages = (cookie: string, after: string, pages: string) =>
	olderAt.get(`${OLDER}?${new URLSearchParams({ after, pages })}`, cookie);

describe('GET /admin/donations/messages/older', () => {
	it('lets a member read the messages past the first page', async () => {
		const made = await shownGifts(51);

		const response = await olderPages(member, await firstNext(member), '1');

		expect(response.status).toBe(200);
		expect((await response.json()) as Older).toEqual({
			kind: 'messages',
			messages: [
				{
					id: made[50],
					name: 'Ada O.',
					note: 'message 50',
					receivedAt: '2026-08-11T00:00:00.000Z',
					hidden: false
				}
			],
			next: null
		});
	});

	it('reads every page it is asked for again, an older row as a press left it', async () => {
		const made = await shownGifts(102);
		const after = await firstNext(staff);
		await setNoteHidden(db, made[101] ?? '', true, new Date());

		const read = (await (await olderPages(staff, after, '2')).json()) as Older;

		expect(read.messages.map((m) => m.note)).toEqual(
			Array.from({ length: 52 }, (_, i) => `message ${i + 50}`)
		);
		expect(read.messages.at(-1)).toMatchObject({ id: made[101], hidden: true });
		expect(read.next).toBeNull();
	});

	it('keeps the list whole and every row once when a message arrives between loads', async () => {
		const made = await shownGifts(103);
		const after = await firstNext(staff);
		const before = (await (await olderPages(staff, after, '1')).json()) as Older;
		expect(before.messages.map((m) => m.id)).toEqual(made.slice(50, 100));

		const { donationId: arrived } = await noteGift(db, formId, {
			note: 'just in',
			noteOnPage: 'named',
			receivedAt: new Date(Date.UTC(2026, 9, 1))
		});
		// the re-read after a press: the first page again, and the older pages from the same cursor.
		const first = (await (await screenAt.get(SCREEN, staff)).json()) as Older;
		const again = (await (await olderPages(staff, after, '1')).json()) as Older;
		const twice = (await (await olderPages(staff, after, '2')).json()) as Older;

		expect(first.messages.map((m) => m.id)).toEqual([arrived, ...made.slice(0, 49)]);
		expect(again.messages.map((m) => m.id)).toEqual(made.slice(49, 100));
		expect(twice.messages.map((m) => m.id)).toEqual(made.slice(49));
		expect(twice.next).toBeNull();
	});

	it('keeps the list whole and every row once when a message leaves between loads', async () => {
		const made: { txn: string; donationId: string }[] = [];
		for (let i = 0; i < 103; i += 1) {
			made.push(
				await noteGift(db, formId, {
					note: `message ${i}`,
					noteOnPage: 'named',
					receivedAt: new Date(Date.UTC(2026, 8, 30) - i * 86_400_000)
				})
			);
		}
		const after = await firstNext(staff);
		const leaving = made[0];
		if (leaving === undefined) throw new Error('no gift was made');
		await refund(db, leaving.txn, 10_000);

		const first = (await (await screenAt.get(SCREEN, staff)).json()) as Older;
		const older = (await (await olderPages(staff, after, '2')).json()) as Older;

		// the next row is pulled onto the first page, and the read leaves it there.
		const ids = [...first.messages, ...older.messages].map((m) => m.id);
		expect(ids).toEqual(made.slice(1).map((gift) => gift.donationId));
		expect(older.next).toBeNull();
	});

	it('answers a failed read at 500 as a refusal, and logs it', async () => {
		await shownGifts(51);
		const after = await firstNext(staff);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('the read failed');
		vi.spyOn(moderatedPages, 'readOlderModeratedPages').mockRejectedValueOnce(failure);

		const response = await olderPages(staff, after, '1');

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ kind: 'refused' });
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('older'), failure);
	});

	it.each([
		['a cursor nobody handed out', 'bm90IGEgY3Vyc29y', '1'],
		['no cursor', '', '1'],
		['no page count', null, ''],
		['a page count of none', null, '0'],
		['a page count that is not a number', null, 'all']
	])('refuses %s at 400', async (_case, after, pages) => {
		await shownGifts(51);

		const response = await olderPages(member, after ?? (await firstNext(member)), pages);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ kind: 'refused' });
	});

	it('sends a signed-out caller to sign in', async () => {
		await shownGifts(51);
		const after = await firstNext(member);

		expect((await olderPages('', after, '1')).status).toBe(303);
	});
});
