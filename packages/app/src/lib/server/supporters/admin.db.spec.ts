import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { gift } from '$lib/server/pages/settled-gifts.testing';
import { parseKeysetCursor } from '$lib/server/db/keyset-cursor';
import {
	hideFundraiser,
	listAllFundraisers,
	SUPPORTER_PAGE_LIST_LIMIT,
	showFundraiser
} from './admin';
import {
	emptySupporterTables,
	pendingPage,
	STARTED_AT,
	startDeps,
	startInput
} from './fundraiser.testing';
import { startFundraiser } from './start';
import { signInWithLink } from './links';
import { readPublicFundraiser } from './view';

// staff's supporter fundraisers: every page, and hiding one or showing it again.

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

async function livePage(email = 'maya@example.org', title = 'Run for the shelter') {
	const started = await pendingPage(db, { email, title });
	await signInWithLink(db, new Request('https://give.example/f/link'), started.token, LIVE_AT);
	const [row] = await db
		.select({ formId: supporterPage.formId })
		.from(supporterPage)
		.where(eq(supporterPage.id, started.pageId));
	return { ...started, formId: row?.formId ?? '' };
}

describe('every fundraiser, for staff', () => {
	it('lists each with its supporter, address, goal, total and standing, newest first', async () => {
		const first = await livePage();
		const second = await pendingPage(db, {
			email: 'ben@example.org',
			name: 'Ben Ito',
			title: 'Bake sale'
		});
		await gift(db, first.formId, 10_000);
		await hideFundraiser(db, first.pageId, 'spam', LATER);

		expect(await listAllFundraisers(db, null)).toEqual({
			pages: [
				{
					id: second.pageId,
					supporterName: 'Ben Ito',
					supporterEmail: 'ben@example.org',
					title: 'Bake sale',
					slug: 'bake-sale',
					goalMinor: 50_000,
					currency: 'USD',
					raisedMinor: 0,
					gifts: 0,
					status: 'pending',
					hidden: false,
					hiddenNote: null,
					published: false,
					createdAt: STARTED_AT
				},
				{
					id: first.pageId,
					supporterName: 'Maya Rivera',
					supporterEmail: 'maya@example.org',
					title: 'Run for the shelter',
					slug: 'run-for-the-shelter',
					goalMinor: 50_000,
					currency: 'USD',
					raisedMinor: 10_000,
					gifts: 1,
					status: 'live',
					hidden: true,
					hiddenNote: 'spam',
					published: true,
					createdAt: STARTED_AT
				}
			],
			total: 2,
			next: null
		});
	});
});

describe('every fundraiser, a batch at a time', () => {
	/**
	 * `count` pages started a minute apart, every third at its neighbour's minute, oldest first, each
	 * with the confirm token mailed for it.
	 */
	async function pagesStarted(count: number): Promise<{ pageId: string; token: string }[]> {
		const made: { pageId: string; token: string }[] = [];
		for (let i = 0; i < count; i += 1) {
			const minute = i % 3 === 2 ? i - 1 : i;
			const { deps, mailed, settled } = startDeps(db, {
				now: new Date(STARTED_AT.getTime() + minute * 60_000)
			});
			const started = await startFundraiser(
				deps,
				startInput({ email: `runner${i}@example.org`, title: `Run number ${i}` })
			);
			if (!started.ok) throw new Error(`start ${i} was refused: ${started.reason}`);
			await settled();
			made.push({ pageId: started.pageId, token: mailed.at(-1)?.token ?? '' });
		}
		return made;
	}

	/** the started page `made`, taken live by opening its confirm link; its settings row. */
	async function takenLive(made: { pageId: string; token: string } | undefined) {
		if (made === undefined) throw new Error('no page was started');
		await signInWithLink(db, new Request('https://give.example/f/link'), made.token, LATER);
		const [row] = await db
			.select({ formId: supporterPage.formId })
			.from(supporterPage)
			.where(eq(supporterPage.id, made.pageId));
		return { pageId: made.pageId, formId: row?.formId ?? '' };
	}

	/** every batch from the first to the last, as the screen's presses ask for them. */
	async function everyBatch() {
		const batches = [await listAllFundraisers(db, null)];
		let next = batches[0]?.next ?? null;
		while (next !== null) {
			const after = parseKeysetCursor(next);
			if (after === null) throw new Error(`a cursor handed out did not parse: ${next}`);
			const batch = await listAllFundraisers(db, after);
			batches.push(batch);
			next = batch.next;
		}
		return batches;
	}

	it('reaches every page down to the oldest, newest first, with its total', async () => {
		const ids = (await pagesStarted(SUPPORTER_PAGE_LIST_LIMIT * 2 + 5)).map((made) => made.pageId);
		const oldest = ids[0];

		const batches = await everyBatch();
		expect(batches.map((batch) => batch.pages.length)).toEqual([
			SUPPORTER_PAGE_LIST_LIMIT,
			SUPPORTER_PAGE_LIST_LIMIT,
			5
		]);
		expect(batches.map((batch) => batch.total)).toEqual([105, 105, 105]);
		const listed = batches.flatMap((batch) => batch.pages.map((page) => page.id));
		expect(listed.toSorted()).toEqual(ids.toSorted());
		expect(listed.at(-1)).toBe(oldest);
		const times = batches.flatMap((batch) => batch.pages.map((page) => page.createdAt.getTime()));
		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	it('hands out no cursor where the first batch is every page, a full one included', async () => {
		await pagesStarted(SUPPORTER_PAGE_LIST_LIMIT);
		const first = await listAllFundraisers(db, null);
		expect(first.pages).toHaveLength(SUPPORTER_PAGE_LIST_LIMIT);
		expect(first).toMatchObject({ total: SUPPORTER_PAGE_LIST_LIMIT, next: null });
	});

	it('neither repeats nor skips a page when a new one starts between batches', async () => {
		const ids = (await pagesStarted(SUPPORTER_PAGE_LIST_LIMIT + 10)).map((made) => made.pageId);
		const first = await listAllFundraisers(db, null);
		const after = parseKeysetCursor(first.next ?? '');
		if (after === null) throw new Error('the first batch handed out no cursor');

		const late = startDeps(db, { now: LATER });
		await startFundraiser(
			late.deps,
			startInput({ email: 'late@example.org', title: 'A late start' })
		);
		await late.settled();
		const second = await listAllFundraisers(db, after);

		expect(second.next).toBeNull();
		expect(second.total).toBe(SUPPORTER_PAGE_LIST_LIMIT + 11);
		const seen = [...first.pages, ...second.pages].map((page) => page.id);
		expect(seen.toSorted()).toEqual(ids.toSorted());
	});

	it('reads what each page in a later batch has raised', async () => {
		const [oldest] = await pagesStarted(SUPPORTER_PAGE_LIST_LIMIT + 1);
		const live = await takenLive(oldest);
		await gift(db, live.formId, 7_000);

		const first = await listAllFundraisers(db, null);
		const second = await listAllFundraisers(db, parseKeysetCursor(first.next ?? ''));
		expect(second.pages).toMatchObject([{ id: live.pageId, raisedMinor: 7_000, gifts: 1 }]);
	});
});

describe('hiding a fundraiser', () => {
	it('takes it off its address, and showing it again puts it back', async () => {
		const page = await livePage();
		expect(await hideFundraiser(db, page.pageId, null, LATER)).toBe('hidden');
		expect(await readPublicFundraiser(db, page.slug)).toEqual({ kind: 'not_found' });
		expect(await showFundraiser(db, page.pageId)).toBe('shown');
		expect(await readPublicFundraiser(db, page.slug)).toMatchObject({ kind: 'live' });
	});

	it('keeps the first hide’s time on a second, and takes the newer note', async () => {
		const page = await livePage();
		await hideFundraiser(db, page.pageId, 'first look', LATER);
		await hideFundraiser(db, page.pageId, 'spam', new Date(LATER.getTime() + 1));
		const [row] = await db
			.select({ at: supporterPage.hiddenAt, note: supporterPage.hiddenNote })
			.from(supporterPage)
			.where(eq(supporterPage.id, page.pageId));
		expect(row).toEqual({ at: LATER, note: 'spam' });
	});

	it('clears the note when shown again', async () => {
		const page = await livePage();
		await hideFundraiser(db, page.pageId, 'spam', LATER);
		await showFundraiser(db, page.pageId);
		const [row] = await db
			.select({ at: supporterPage.hiddenAt, note: supporterPage.hiddenNote })
			.from(supporterPage)
			.where(eq(supporterPage.id, page.pageId));
		expect(row).toEqual({ at: null, note: null });
	});

	it('answers not found for a page that is not there', async () => {
		expect(await hideFundraiser(db, 'no-such-page', null, LATER)).toBe('not_found');
		expect(await showFundraiser(db, 'no-such-page')).toBe('not_found');
	});
});
