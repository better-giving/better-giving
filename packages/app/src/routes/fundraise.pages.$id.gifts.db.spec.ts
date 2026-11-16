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
async function giftsOn(formId: string, count: number) {
	for (let i = 0; i < count; i += 1) {
		await noteGift(db, formId, {
			amountMinor: 1_000 + i,
			receivedAt: new Date(Date.UTC(2026, 10, 12) + i * 60_000)
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
});
