import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { readShownMessages } from '$lib/server/pages/messages';
import { noteGift } from '$lib/server/pages/settled-gifts.testing';
import {
	formBody,
	freshDeployment,
	page,
	signInAsDeployer,
	signInAsMember
} from '../webhook-routes.testing';
import * as screen from './_app.admin.donations.messages';
import { client, run, stmt } from '$lib/server/db/database.testing';

// /admin/donations/messages through the protected layout against the real database: what the list
// holds, and the hide and show-again presses, which staff and members may both make. what is
// listed and what a hide writes are `$lib/server/pages/messages.db.spec.ts`.

const SCREEN = '/admin/donations/messages';
const screenAt = page('admin/donations/messages', screen);

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

const shownGift = (over: Parameters<typeof noteGift>[2] = {}) =>
	noteGift(db, formId, {
		note: 'Proud to give',
		noteOnPage: 'named',
		firstName: 'Maya',
		lastName: 'Rivera',
		...over
	});

const press = (cookie: string, form: 'message-hide' | 'message-show', donationId: string) =>
	screenAt.post(SCREEN, cookie, formBody({ __form_id__: form, donation_id: donationId }));

type Listed = {
	messages: { id: string; name: string; note: string; receivedAt: string; hidden: boolean }[];
	total: number;
	limit: number;
};

describe('GET /admin/donations/messages', () => {
	it('lists every message on the page and every hidden one, newest first', async () => {
		const older = await shownGift({ receivedAt: new Date('2026-09-01T10:00:00.000Z') });
		const newer = await shownGift({
			note: 'Keep going',
			noteOnPage: 'anonymous',
			receivedAt: new Date('2026-09-02T10:00:00.000Z')
		});
		await press(staff, 'message-hide', older.donationId);
		await noteGift(db, formId, { note: 'kept private' });

		const response = await screenAt.get(SCREEN, member);

		expect(response.status).toBe(200);
		expect((await response.json()) as Listed).toEqual({
			messages: [
				{
					id: newer.donationId,
					name: 'Anonymous',
					note: 'Keep going',
					receivedAt: '2026-09-02T10:00:00.000Z',
					hidden: false
				},
				{
					id: older.donationId,
					name: 'Maya R.',
					note: 'Proud to give',
					receivedAt: '2026-09-01T10:00:00.000Z',
					hidden: true
				}
			],
			total: 2,
			limit: 50
		});
	});

	it('sends a signed-out caller to sign in', async () => {
		const response = await screenAt.get(SCREEN, '');

		expect(response.status).toBe(303);
	});
});

describe('POST /admin/donations/messages', () => {
	it.each([
		['staff', () => staff],
		['a member', () => member]
	])('lets %s hide a message and show it again', async (_who, cookie) => {
		const { donationId } = await shownGift();

		const hidden = await press(cookie(), 'message-hide', donationId);

		expect(hidden.status).toBe(200);
		expect(await hidden.json()).toEqual({ landed: 'hidden', donationId });
		expect((await readShownMessages(db, null)).total).toBe(0);

		const shown = await press(cookie(), 'message-show', donationId);

		expect(await shown.json()).toEqual({ landed: 'shown', donationId });
		expect((await readShownMessages(db, null)).total).toBe(1);
	});

	it('answers a second hide as the first, changing nothing', async () => {
		const { donationId } = await shownGift();
		await press(staff, 'message-hide', donationId);

		const again = await press(staff, 'message-hide', donationId);

		expect(again.status).toBe(200);
		expect((await readShownMessages(db, null)).total).toBe(0);
	});

	it('refuses to hide a note that is not on the page, at 404', async () => {
		const { donationId } = await noteGift(db, formId, { note: 'kept private' });

		const response = await press(member, 'message-hide', donationId);

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			donationId,
			form: { id: 'message-hide', result: { status: 'error' } }
		});
	});

	it('refuses a body naming no gift', async () => {
		const response = await screenAt.post(SCREEN, staff, formBody({ __form_id__: 'message-hide' }));

		expect(response.status).toBe(400);
	});
});
