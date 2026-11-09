import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { donation as donationTable } from '../db/schema';
import { writeOrgRow } from '../org/org-row.testing';
import { ensureDonationPage } from './donation-page';
import {
	parseMessageCursor,
	readModeratedMessages,
	readNoteStandings,
	readShownMessages,
	setNoteHidden
} from './messages';
import { dispute, noteGift, refund } from './settled-gifts.testing';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the donors' messages the donate page shows and /admin/donations/messages moderates, against the
// real database. every gift reaches the books through ./settled-gifts.testing.ts, the writers
// production posts by, so "settled" and "given back" are what those writers make them.

let db: Db;
let formId: string;

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
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'page',
		'form',
		'org_profile'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await writeOrgRow(client, { tax_id: '12-3456789' });
	({ formId } = await ensureDonationPage(db));
});

/** a settled public note signed Ada O., unless a case says otherwise. */
const shownGift = (over: Parameters<typeof noteGift>[2] = {}) =>
	noteGift(db, formId, { note: 'Thank you', noteOnPage: 'named', ...over });

describe('readShownMessages()', () => {
	it('shows a settled gift’s note under the donor’s first name and last initial', async () => {
		await noteGift(db, formId, {
			note: 'Proud to give',
			noteOnPage: 'named',
			firstName: 'Maya',
			lastName: 'Rivera',
			receivedAt: new Date('2026-09-10T11:00:00.000Z')
		});

		expect(await readShownMessages(db, null)).toEqual({
			messages: [
				{ name: 'Maya R.', note: 'Proud to give', receivedAt: '2026-09-10T11:00:00.000Z' }
			],
			total: 1,
			next: null
		});
	});

	const names = async () => (await readShownMessages(db, null)).messages.map((m) => m.note);

	it('shows nothing where the donor did not tick Show my note', async () => {
		await shownGift({ noteOnPage: undefined });

		expect(await readShownMessages(db, null)).toEqual({ messages: [], total: 0, next: null });
	});

	it('shows no note of a gift still pending', async () => {
		await shownGift({ settles: false });

		expect((await readShownMessages(db, null)).total).toBe(0);
	});

	it('shows no blank note, ticked or not', async () => {
		await shownGift({ note: '   ' });

		expect((await readShownMessages(db, null)).total).toBe(0);
	});

	it('takes a gift refunded in full off the page and the admin list', async () => {
		const { txn } = await shownGift({ amountMinor: 5_000 });
		await refund(db, txn, 5_000);

		expect((await readShownMessages(db, null)).total).toBe(0);
		expect((await readModeratedMessages(db)).total).toBe(0);
	});

	it('keeps a gift partly refunded on the page, as the raised total keeps counting it', async () => {
		const { txn } = await shownGift({ amountMinor: 5_000 });
		await refund(db, txn, 1_000);

		expect(await names()).toEqual(['Thank you']);
	});

	it('takes a disputed gift off the page and the admin list', async () => {
		const { txn } = await shownGift();
		await dispute(db, txn);

		expect((await readShownMessages(db, null)).total).toBe(0);
		expect((await readModeratedMessages(db)).total).toBe(0);
	});

	it('takes a gift off while a dispute over part of it is open', async () => {
		const { txn } = await shownGift({ amountMinor: 5_000 });
		await dispute(db, txn, 1_000);

		expect((await readShownMessages(db, null)).total).toBe(0);
		expect((await readModeratedMessages(db)).total).toBe(0);
	});

	it('signs a note the donor asked to keep anonymous as Anonymous', async () => {
		await shownGift({ noteOnPage: 'anonymous', firstName: 'Maya', lastName: 'Rivera' });

		expect((await readShownMessages(db, null)).messages[0]?.name).toBe('Anonymous');
	});

	it('signs a donor who gave one name with that name alone', async () => {
		await shownGift({ firstName: 'Maya', lastName: '' });

		expect((await readShownMessages(db, null)).messages[0]?.name).toBe('Maya');
	});

	it('signs a donor who gave no first name as Anonymous, never their surname', async () => {
		await shownGift({ firstName: '', lastName: 'Rivera' });

		expect((await readShownMessages(db, null)).messages[0]?.name).toBe('Anonymous');
	});

	it('says nothing else about the donor or the gift', async () => {
		await shownGift({ firstName: 'Maya', lastName: 'Rivera', amountMinor: 12_345 });

		const sent = JSON.stringify(await readShownMessages(db, null));
		expect(sent).not.toMatch(/Rivera|@example\.org|12345|123\.45/);
	});

	it('is newest first, a tie on the time broken the same way every load', async () => {
		const at = new Date('2026-09-10T11:00:00.000Z');
		await shownGift({ note: 'older', receivedAt: new Date('2026-09-01T11:00:00.000Z') });
		await shownGift({ note: 'tied a', receivedAt: at });
		await shownGift({ note: 'tied b', receivedAt: at });
		await shownGift({ note: 'newest', receivedAt: new Date('2026-09-20T11:00:00.000Z') });

		const first = await names();
		expect(first[0]).toBe('newest');
		expect(first.slice(1, 3).sort()).toEqual(['tied a', 'tied b']);
		expect(first[3]).toBe('older');
		expect(await names()).toEqual(first);
	});

	it('pages six at a time with the whole count, every message once', async () => {
		for (let day = 1; day <= 14; day += 1) {
			await shownGift({ note: `day ${day}`, receivedAt: new Date(Date.UTC(2026, 8, day)) });
		}

		const one = await readShownMessages(db, null);
		expect(one.total).toBe(14);
		expect(one.messages.map((m) => m.note)).toEqual([
			'day 14',
			'day 13',
			'day 12',
			'day 11',
			'day 10',
			'day 9'
		]);
		const two = await readShownMessages(db, parseMessageCursor(one.next ?? ''));
		expect(two.messages.map((m) => m.note)).toEqual([
			'day 8',
			'day 7',
			'day 6',
			'day 5',
			'day 4',
			'day 3'
		]);
		const three = await readShownMessages(db, parseMessageCursor(two.next ?? ''));
		expect(three.messages.map((m) => m.note)).toEqual(['day 2', 'day 1']);
		expect(three).toMatchObject({ total: 14, next: null });
	});

	it('has no next page where exactly six are shown', async () => {
		for (let day = 1; day <= 6; day += 1) {
			await shownGift({ receivedAt: new Date(Date.UTC(2026, 8, day)) });
		}

		expect(await readShownMessages(db, null)).toMatchObject({ total: 6, next: null });
	});
});

describe('parseMessageCursor()', () => {
	it.each([
		'',
		'not a cursor',
		Buffer.from('abc.').toString('base64url'),
		Buffer.from('.id').toString('base64url')
	])('refuses %j', (text) => {
		expect(parseMessageCursor(text)).toBeNull();
	});
});

describe('hiding a message', () => {
	it('takes it off the page and keeps it in the admin list, marked hidden', async () => {
		const { donationId } = await shownGift({ firstName: 'Maya', lastName: 'Rivera' });

		expect(await setNoteHidden(db, donationId, true, new Date())).toBe(true);

		expect((await readShownMessages(db, null)).total).toBe(0);
		expect(await readModeratedMessages(db)).toEqual({
			messages: [
				{
					id: donationId,
					name: 'Maya R.',
					note: 'Thank you',
					receivedAt: new Date('2026-09-10T11:00:00.000Z'),
					hidden: true
				}
			],
			total: 1
		});
	});

	it('shows it again', async () => {
		const { donationId } = await shownGift();
		await setNoteHidden(db, donationId, true, new Date());

		expect(await setNoteHidden(db, donationId, false, new Date())).toBe(true);

		expect((await readShownMessages(db, null)).total).toBe(1);
		expect((await readModeratedMessages(db)).messages[0]?.hidden).toBe(false);
	});

	it('keeps the first hide’s time on a second press', async () => {
		const { donationId } = await shownGift();
		await setNoteHidden(db, donationId, true, new Date('2026-10-01T00:00:00.000Z'));

		expect(await setNoteHidden(db, donationId, true, new Date('2026-10-02T00:00:00.000Z'))).toBe(
			true
		);

		const [row] = await db
			.select({ at: donationTable.noteHiddenAt })
			.from(donationTable)
			.where(eq(donationTable.id, donationId));
		expect(row?.at).toEqual(new Date('2026-10-01T00:00:00.000Z'));
	});

	it.each([
		['a private note', { noteOnPage: undefined }],
		['a gift still pending', { settles: false }]
	] as const)('refuses %s, writing nothing', async (_label, over) => {
		const { donationId } = await shownGift(over);

		expect(await setNoteHidden(db, donationId, true, new Date())).toBe(false);
		const [row] = await db
			.select({ at: donationTable.noteHiddenAt })
			.from(donationTable)
			.where(eq(donationTable.id, donationId));
		expect(row?.at).toBeNull();
	});

	it('refuses a gift that is not there', async () => {
		expect(await setNoteHidden(db, crypto.randomUUID(), true, new Date())).toBe(false);
	});
});

describe('readNoteStandings()', () => {
	it('says shown, hidden, or private for each gift', async () => {
		const shown = await noteGift(db, formId, { note: 'a', noteOnPage: 'named' });
		const hidden = await noteGift(db, formId, { note: 'b', noteOnPage: 'named' });
		await setNoteHidden(db, hidden.donationId, true, new Date());
		const kept = await noteGift(db, formId, { note: 'c' });
		const pending = await noteGift(db, formId, { note: 'd', noteOnPage: 'named', settles: false });

		const standing = await readNoteStandings(db, [
			shown.donationId,
			hidden.donationId,
			kept.donationId,
			pending.donationId
		]);

		expect([shown, hidden, kept, pending].map(({ donationId }) => standing(donationId))).toEqual([
			'shown',
			'hidden',
			'private',
			'private'
		]);
	});
});
