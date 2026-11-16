import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { noteGift } from '$lib/server/pages/settled-gifts.testing';
import { OWN_GIFT_LIST_LIMIT } from '$lib/server/supporters/pages';
import {
	call,
	freshSupporterDeployment,
	liveFundraiser,
	request,
	STARTED
} from '../supporter-routes.testing';
import { client } from '$lib/server/db/database.testing';
import * as manage from './fundraise.pages.$id._index';
import * as more from './fundraise.pages.$id.gifts';

// Show more gifts on a supporter's manage screen, through the route modules against the real
// database: the batch after the cursor the screen's last batch ended on, for the supporter's own
// page alone. how a batch resumes is `$lib/server/supporters/pages.db.spec.ts`'s.
//
// the mail transport is stubbed for ./fundraise.journey.db.spec.ts's reason: the confirm link is
// how a page goes live and its supporter signs in.

type Message = { to: string; subject: string; html: string; text: string };

const mailed = vi.hoisted(() => [] as Message[]);

vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: Message) {
			mailed.push(message);
			return { ok: true as const };
		}
	})
}));

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	mailed.length = 0;
	await freshSupporterDeployment();
});

/** `count` gifts on `formId`, a minute apart from the newest down. */
async function giftsOn(formId: string, count: number, minuteOf = (i: number) => i) {
	for (let i = 0; i < count; i += 1) {
		await noteGift(db, formId, {
			amountMinor: 1_000 + i,
			receivedAt: new Date(Date.UTC(2026, 10, 12) + minuteOf(i) * 60_000)
		});
	}
}

type Manage = {
	page: { giftList: { amountMinor: number }[]; giftTotal: number; giftNext: string | null };
};

type Batch = {
	kind: 'gifts';
	gifts: { amountMinor: number; receivedAt: string; shown: unknown }[];
	total: number;
	next: string | null;
};

const morePath = (pageId: string, after: string) =>
	`/fundraise/pages/${pageId}/gifts?${new URLSearchParams({ after })}`;

describe('GET /fundraise/pages/:id/gifts', () => {
	it('answers the batch after the manage screen’s first, the oldest gift last', async () => {
		const { browser, pageId, formId } = await liveFundraiser(db, mailed);
		await giftsOn(formId, OWN_GIFT_LIST_LIMIT + 3);
		const cookie = browser.header();

		const first = await call(manage.loader, request(`/fundraise/pages/${pageId}`, { cookie }), {
			id: pageId
		});
		const shown = (first.data as Manage).page;
		expect(shown.giftList).toHaveLength(OWN_GIFT_LIST_LIMIT);
		expect(shown.giftTotal).toBe(OWN_GIFT_LIST_LIMIT + 3);
		expect(shown.giftNext).toEqual(expect.any(String));

		const answer = await call(
			more.loader,
			request(morePath(pageId, shown.giftNext ?? ''), { cookie }),
			{
				id: pageId
			}
		);
		expect(answer.status).toBe(200);
		expect(answer.headers.get('cache-control')).toBe('no-store');
		const batch = answer.data as Batch;
		expect(batch).toMatchObject({ kind: 'gifts', total: OWN_GIFT_LIST_LIMIT + 3, next: null });
		expect(batch.gifts.map((row) => row.amountMinor)).toEqual([1_002, 1_001, 1_000]);
		expect(batch.gifts[2]).toEqual({
			amountMinor: 1_000,
			receivedAt: '2026-11-12T00:00:00.000Z',
			shown: null
		});
	});

	it('answers the second of two gifts sharing the time the first batch ends on', async () => {
		const { browser, pageId, formId } = await liveFundraiser(db, mailed);
		await giftsOn(formId, OWN_GIFT_LIST_LIMIT + 1, (i) => (i === 1 ? 0 : i));
		const cookie = browser.header();

		const first = await call(manage.loader, request(`/fundraise/pages/${pageId}`, { cookie }), {
			id: pageId
		});
		const answer = await call(
			more.loader,
			request(morePath(pageId, (first.data as Manage).page.giftNext ?? ''), { cookie }),
			{ id: pageId }
		);
		const batch = answer.data as Batch;
		expect(batch.gifts).toHaveLength(1);
		expect(batch.gifts[0]?.receivedAt).toBe('2026-11-12T00:00:00.000Z');
		const listed = [...(first.data as Manage).page.giftList, ...batch.gifts];
		expect(listed.map((row) => row.amountMinor).toSorted((a, b) => a - b)).toEqual(
			Array.from({ length: OWN_GIFT_LIST_LIMIT + 1 }, (_, i) => 1_000 + i)
		);
	});

	it('hands the first batch no cursor where it is every gift', async () => {
		const { browser, pageId, formId } = await liveFundraiser(db, mailed);
		await giftsOn(formId, 2);
		const first = await call(
			manage.loader,
			request(`/fundraise/pages/${pageId}`, { cookie: browser.header() }),
			{ id: pageId }
		);
		expect((first.data as Manage).page).toMatchObject({ giftTotal: 2, giftNext: null });
	});

	it('refuses a cursor it never handed out, or none, with a 400', async () => {
		const { browser, pageId } = await liveFundraiser(db, mailed);
		const cookie = browser.header();
		const forged = await call(more.loader, request(morePath(pageId, 'not-a-cursor'), { cookie }), {
			id: pageId
		});
		expect(forged.status).toBe(400);
		expect(forged.data).toEqual({ kind: 'refused' });
		const none = await call(more.loader, request(`/fundraise/pages/${pageId}/gifts`, { cookie }), {
			id: pageId
		});
		expect(none.status).toBe(400);
	});

	it('answers another supporter’s page as the 404 an unknown one gets', async () => {
		const mine = await liveFundraiser(db, mailed);
		const theirs = await liveFundraiser(db, mailed, {
			...STARTED,
			email: 'ben@example.org',
			title: 'Bake sale'
		});
		await giftsOn(theirs.formId, OWN_GIFT_LIST_LIMIT + 1);
		const after = Buffer.from(`${Date.UTC(2027, 0, 1)}.z`).toString('base64url');
		const answer = await call(
			more.loader,
			request(morePath(theirs.pageId, after), { cookie: mine.browser.header() }),
			{ id: theirs.pageId }
		);
		expect(answer.status).toBe(404);
		expect(answer.data).toEqual({ kind: 'refused' });
	});

	it('sends a caller with no session on to sign in', async () => {
		const { pageId } = await liveFundraiser(db, mailed);
		const after = Buffer.from(`${Date.UTC(2027, 0, 1)}.z`).toString('base64url');
		const answer = await call(more.loader, request(morePath(pageId, after)), { id: pageId });
		expect(answer.status).toBe(303);
		expect(answer.location).toBe('/fundraise/sign-in');
	});

	it('answers a failing read as a 500 refusal, not a thrown load', async () => {
		const { browser, pageId } = await liveFundraiser(db, mailed);
		const after = Buffer.from(`${Date.UTC(2027, 0, 1)}.z`).toString('base64url');
		// the batch orders by received_at, so a column that is not there fails the read in sqlite itself.
		await client.execute('alter table donation rename column received_at to received_at_x');
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const answer = await call(
				more.loader,
				request(morePath(pageId, after), { cookie: browser.header() }),
				{ id: pageId }
			);
			expect(answer.status).toBe(500);
			expect(answer.data).toEqual({ kind: 'refused' });
			expect(answer.headers.get('cache-control')).toBe('no-store');
		} finally {
			quiet.mockRestore();
			await client.execute('alter table donation rename column received_at_x to received_at');
		}
	});
});
