import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUPPORTER_EDIT_INPUT } from '../../supporters/input';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { supporter, supporterPage } from '$lib/server/db/schema';
import { createImage, stored } from '$lib/server/images/image.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { setNoteHidden } from '$lib/server/pages/messages';
import { gift, noteGift, refund } from '$lib/server/pages/settled-gifts.testing';
import { hideFundraiser } from './admin';
import { emptySupporterTables, pendingPage, STARTED_AT } from './fundraiser.testing';
import { signInWithLink } from './links';
import { parseKeysetCursor } from '$lib/server/db/keyset-cursor';
import {
	editOwnFundraiser,
	endOwnFundraiser,
	listOwnFundraisers,
	OWN_GIFT_LIST_LIMIT,
	readMoreOwnGifts,
	readOwnFundraiser
} from './pages';

// a signed-in supporter's own fundraisers: the list, one page's manage view, the edit and the end,
// each answering for the supporter's own pages and not-found for anybody else's.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, { tax_id: '12-3456789' });
});

const LIVE_AT = new Date(STARTED_AT.getTime() + 60_000);
const LATER = new Date(STARTED_AT.getTime() + 3_600_000);

/** a live page started by `email`, its owner's id, and its settings row. */
async function livePage(email = 'maya@example.org', title = 'Run for the shelter') {
	const { pageId, token } = await pendingPage(db, { email, title });
	await signInWithLink(db, new Request('https://give.example/f/link'), token, LIVE_AT);
	const [row] = await db
		.select({ supporterId: supporterPage.supporterId, formId: supporterPage.formId })
		.from(supporterPage)
		.where(eq(supporterPage.id, pageId));
	if (!row) throw new Error(`page ${pageId} was not written`);
	return { pageId, ...row };
}

const edit = (over: Record<string, string> = {}) =>
	SUPPORTER_EDIT_INPUT.parse({
		name: 'Maya R.',
		title: 'Run for the new shelter',
		goal: '750',
		story: 'Now running 21k.',
		...over
	});

describe('the list of a supporter’s own pages', () => {
	it('is theirs alone, newest first, with what each has raised against its goal', async () => {
		const first = await livePage();
		const second = await pendingPage(db, { title: 'A second run' });
		await livePage('someone@example.org', 'Somebody else’s run');
		await gift(db, first.formId, 10_000);

		expect(await listOwnFundraisers(db, first.supporterId)).toEqual([
			{
				id: second.pageId,
				slug: second.slug,
				title: 'A second run',
				status: 'pending',
				hidden: false,
				goalMinor: 50_000,
				currency: 'USD',
				endedAt: null,
				raisedMinor: 0,
				gifts: 0
			},
			{
				id: first.pageId,
				slug: 'run-for-the-shelter',
				title: 'Run for the shelter',
				status: 'live',
				hidden: false,
				goalMinor: 50_000,
				currency: 'USD',
				endedAt: null,
				raisedMinor: 10_000,
				gifts: 1
			}
		]);
	});

	it('says when an ended page ended', async () => {
		const page = await livePage();
		await endOwnFundraiser(db, page.supporterId, page.pageId, LATER);
		expect(await listOwnFundraisers(db, page.supporterId)).toMatchObject([
			{ id: page.pageId, status: 'ended', endedAt: LATER }
		]);
	});
});

describe('one page, as its supporter manages it', () => {
	it('names a gift’s donor and note only where the donor chose to show them', async () => {
		const page = await livePage();
		await noteGift(db, page.formId, {
			amountMinor: 5_000,
			note: 'Go Maya!',
			noteOnPage: 'named',
			firstName: 'Ada',
			lastName: 'Okafor',
			receivedAt: new Date('2026-11-11T13:00:00.000Z')
		});
		await noteGift(db, page.formId, {
			amountMinor: 2_500,
			note: 'Kept between us',
			firstName: 'Ben',
			lastName: 'Ito',
			receivedAt: new Date('2026-11-11T14:00:00.000Z')
		});

		const read = await readOwnFundraiser(db, page.supporterId, page.pageId);
		expect(read).toMatchObject({
			id: page.pageId,
			title: 'Run for the shelter',
			name: 'Maya Rivera',
			status: 'live',
			hidden: false,
			publishedAt: LIVE_AT,
			raisedMinor: 7_500,
			goalMinor: 50_000,
			gifts: 2
		});
		expect(read?.giftList).toEqual([
			{ amountMinor: 2_500, receivedAt: new Date('2026-11-11T14:00:00.000Z'), shown: null },
			{
				amountMinor: 5_000,
				receivedAt: new Date('2026-11-11T13:00:00.000Z'),
				shown: { name: 'Ada O.', note: 'Go Maya!' }
			}
		]);
	});

	it('carries the note staff left when they hid it, word for word', async () => {
		const page = await livePage();
		expect(await readOwnFundraiser(db, page.supporterId, page.pageId)).toMatchObject({
			hidden: false,
			hiddenNote: null
		});
		await hideFundraiser(db, page.pageId, 'Please take the phone number out of the story.', LATER);
		expect(await readOwnFundraiser(db, page.supporterId, page.pageId)).toMatchObject({
			hidden: true,
			hiddenNote: 'Please take the phone number out of the story.'
		});
	});

	it('stops naming a donor whose note staff hid', async () => {
		const page = await livePage();
		const { donationId } = await noteGift(db, page.formId, {
			note: 'Go Maya!',
			noteOnPage: 'named'
		});
		await setNoteHidden(db, donationId, true, LATER);
		const read = await readOwnFundraiser(db, page.supporterId, page.pageId);
		expect(read?.giftList.map((row) => row.shown)).toEqual([null]);
	});

	it('leaves a gift given back in full off the list', async () => {
		const page = await livePage();
		const txn = await gift(db, page.formId, 4_000);
		await refund(db, txn, 4_000);
		expect((await readOwnFundraiser(db, page.supporterId, page.pageId))?.giftList).toEqual([]);
	});

	it('carries no donor email, address or payment method anywhere', async () => {
		const page = await livePage();
		await noteGift(db, page.formId, { note: 'Go!', noteOnPage: 'named', email: 'ada@example.org' });
		const read = await readOwnFundraiser(db, page.supporterId, page.pageId);
		const text = JSON.stringify(read);
		expect(text).not.toContain('ada@example.org');
		expect(text).not.toMatch(/card|address|method|email|contact/i);
	});
});

describe('another supporter’s page', () => {
	it('is not found to read, to edit or to end', async () => {
		const mine = await livePage();
		const theirs = await livePage('someone@example.org', 'Somebody else’s run');

		expect(await readOwnFundraiser(db, mine.supporterId, theirs.pageId)).toBeNull();
		expect(await editOwnFundraiser(db, mine.supporterId, theirs.pageId, edit(), LATER)).toBe(
			'not_found'
		);
		expect(await endOwnFundraiser(db, mine.supporterId, theirs.pageId, LATER)).toBe('not_found');

		const [untouched] = await db
			.select({ title: supporterPage.title, status: supporterPage.status })
			.from(supporterPage)
			.where(eq(supporterPage.id, theirs.pageId));
		expect(untouched).toEqual({ title: 'Somebody else’s run', status: 'live' });
		expect(await db.select({ name: supporter.name }).from(supporter)).toEqual([
			{ name: 'Maya Rivera' },
			{ name: 'Maya Rivera' }
		]);
	});
});

describe('editing one’s own page', () => {
	it('writes the name, title, goal and story, and keeps the address', async () => {
		const page = await livePage();
		expect(await editOwnFundraiser(db, page.supporterId, page.pageId, edit(), LATER)).toBe('saved');
		const read = await readOwnFundraiser(db, page.supporterId, page.pageId);
		expect(read).toMatchObject({
			name: 'Maya R.',
			title: 'Run for the new shelter',
			goalMinor: 75_000,
			story: 'Now running 21k.',
			slug: 'run-for-the-shelter'
		});
	});

	it('refuses a photo that was never stored', async () => {
		const page = await livePage();
		expect(
			await editOwnFundraiser(
				db,
				page.supporterId,
				page.pageId,
				edit({ photo_id: 'no-such-image' }),
				LATER
			)
		).toBe('photo_missing');
	});

	it('changes nothing on a page that has ended', async () => {
		const page = await livePage();
		await endOwnFundraiser(db, page.supporterId, page.pageId, LATER);

		expect(await editOwnFundraiser(db, page.supporterId, page.pageId, edit(), LATER)).toBe(
			'not_found'
		);
		expect(await readOwnFundraiser(db, page.supporterId, page.pageId)).toMatchObject({
			name: 'Maya Rivera',
			title: 'Run for the shelter',
			goalMinor: 50_000,
			story: 'I am running 10k.'
		});
	});

	it('frees the photo a racing edit set, once the other edit replaces it', async () => {
		const page = await livePage();
		const first = await photo();
		const second = await photo();

		await Promise.all([
			editOwnFundraiser(db, page.supporterId, page.pageId, edit({ photo_id: first }), LATER),
			editOwnFundraiser(db, page.supporterId, page.pageId, edit({ photo_id: second }), LATER)
		]);

		const held = (await readOwnFundraiser(db, page.supporterId, page.pageId))?.photoId;
		const letGo = held === first ? second : first;
		expect([first, second]).toContain(held);
		expect(await stored(db, letGo)).toEqual({ row: false, bytes: false });
	});
});

const photo = () =>
	createImage(
		db,
		{ kind: 'photo', contentType: 'image/webp', width: 1200, height: 800, alt: null },
		new Uint8Array([0x52, 0x49, 0x46, 0x46])
	);

describe('ending one’s own page', () => {
	it('ends it for good, and a second end changes nothing', async () => {
		const page = await livePage();
		expect(await endOwnFundraiser(db, page.supporterId, page.pageId, LATER)).toBe('ended');
		expect(
			await endOwnFundraiser(db, page.supporterId, page.pageId, new Date(LATER.getTime() + 1))
		).toBe('ended');
		const read = await readOwnFundraiser(db, page.supporterId, page.pageId);
		expect(read).toMatchObject({ status: 'ended', endedAt: LATER });
	});

	it('ends a page that never went live', async () => {
		const { pageId } = await pendingPage(db, { email: 'quiet@example.org' });
		const [row] = await db
			.select({ supporterId: supporterPage.supporterId })
			.from(supporterPage)
			.where(eq(supporterPage.id, pageId));
		expect(await endOwnFundraiser(db, row?.supporterId ?? '', pageId, LATER)).toBe('ended');
	});
});

describe('a supporter’s gifts, a batch at a time', () => {
	/** `count` settled gifts on `formId`, a minute apart, every third sharing its neighbour's time. */
	async function giftsOn(
		formId: string,
		count: number,
		minuteOf = (i: number) => (i % 3 === 2 ? i - 1 : i),
		from = LIVE_AT
	) {
		for (let i = 0; i < count; i += 1) {
			const minute = minuteOf(i);
			await noteGift(db, formId, {
				amountMinor: 1_000 + i,
				receivedAt: new Date(from.getTime() + minute * 60_000)
			});
		}
	}

	/** every batch from the manage view's first to the last, as the screen's presses ask for them. */
	async function everyBatch(page: { supporterId: string; pageId: string }) {
		const first = await readOwnFundraiser(db, page.supporterId, page.pageId);
		if (first === null) throw new Error('the page did not read');
		const batches = [{ gifts: first.giftList, total: first.giftTotal, next: first.giftNext }];
		let next = first.giftNext;
		while (next !== null) {
			const after = parseKeysetCursor(next);
			if (after === null) throw new Error(`a cursor handed out did not parse: ${next}`);
			const batch = await readMoreOwnGifts(db, page.supporterId, page.pageId, after);
			if (batch === null) throw new Error('the page stopped reading as the supporter’s');
			batches.push(batch);
			next = batch.next;
		}
		return batches;
	}

	it('reaches every gift down to the oldest, newest first, counting all of them', async () => {
		const page = await livePage();
		await giftsOn(page.formId, OWN_GIFT_LIST_LIMIT * 2 + 5);

		const batches = await everyBatch(page);
		expect(batches.map((batch) => batch.gifts.length)).toEqual([
			OWN_GIFT_LIST_LIMIT,
			OWN_GIFT_LIST_LIMIT,
			5
		]);
		expect(batches.map((batch) => batch.total)).toEqual([105, 105, 105]);
		const amounts = batches.flatMap((batch) => batch.gifts.map((row) => row.amountMinor));
		expect(new Set(amounts).size).toBe(105);
		expect(amounts.at(-1)).toBe(1_000);
		const times = batches.flatMap((batch) => batch.gifts.map((row) => row.receivedAt.getTime()));
		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	it('keeps both gifts of a time the batch edge falls between', async () => {
		// the two oldest share a minute, so the first batch ends on one and the second opens on the other.
		const page = await livePage();
		await giftsOn(page.formId, OWN_GIFT_LIST_LIMIT + 1, (i) => (i === 1 ? 0 : i));

		const batches = await everyBatch(page);
		expect(batches.map((batch) => batch.gifts.length)).toEqual([OWN_GIFT_LIST_LIMIT, 1]);
		expect(batches[0]?.gifts.at(-1)?.receivedAt).toEqual(batches[1]?.gifts[0]?.receivedAt);
		const amounts = batches.flatMap((batch) => batch.gifts.map((row) => row.amountMinor));
		expect(amounts.toSorted((a, b) => a - b)).toEqual(
			Array.from({ length: OWN_GIFT_LIST_LIMIT + 1 }, (_, i) => 1_000 + i)
		);
	});

	it('hands out no cursor where the first batch is every gift, a full one included', async () => {
		const page = await livePage();
		await giftsOn(page.formId, OWN_GIFT_LIST_LIMIT);
		const read = await readOwnFundraiser(db, page.supporterId, page.pageId);
		expect(read?.giftList).toHaveLength(OWN_GIFT_LIST_LIMIT);
		expect(read).toMatchObject({ giftTotal: OWN_GIFT_LIST_LIMIT, giftNext: null });
	});

	it('neither repeats nor skips a gift when a new one arrives between batches', async () => {
		const page = await livePage();
		await giftsOn(page.formId, OWN_GIFT_LIST_LIMIT + 10);
		const first = await readOwnFundraiser(db, page.supporterId, page.pageId);
		const after = parseKeysetCursor(first?.giftNext ?? '');
		if (first === null || after === null) throw new Error('the first batch handed out no cursor');

		await noteGift(db, page.formId, { amountMinor: 99_999, receivedAt: LATER });
		const second = await readMoreOwnGifts(db, page.supporterId, page.pageId, after);

		expect(second?.next).toBeNull();
		expect(second?.total).toBe(OWN_GIFT_LIST_LIMIT + 11);
		const seen = [...first.giftList, ...(second?.gifts ?? [])].map((row) => row.amountMinor);
		expect(seen.toSorted((a, b) => a - b)).toEqual(
			Array.from({ length: OWN_GIFT_LIST_LIMIT + 10 }, (_, i) => 1_000 + i)
		);
	});

	it('counts what it lists: a gift given back in full is in neither', async () => {
		const page = await livePage();
		const txn = await gift(db, page.formId, 4_000);
		await gift(db, page.formId, 2_000);
		await refund(db, txn, 4_000);
		expect(await readOwnFundraiser(db, page.supporterId, page.pageId)).toMatchObject({
			giftList: [{ amountMinor: 2_000 }],
			giftTotal: 1,
			giftNext: null
		});
	});

	it('reads no batch of another supporter’s page', async () => {
		const page = await livePage();
		const other = await livePage('someone@example.org', 'Somebody else’s run');
		await giftsOn(page.formId, 3);
		expect(
			await readMoreOwnGifts(db, other.supporterId, page.pageId, { at: LATER.getTime(), id: 'z' })
		).toBeNull();
	});
});
