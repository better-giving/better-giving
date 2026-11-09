import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { setNoteHidden } from '$lib/server/pages/messages';
import { noteGift } from '$lib/server/pages/settled-gifts.testing';
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
