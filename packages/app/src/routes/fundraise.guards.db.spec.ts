import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { image, supporterPage } from '$lib/server/db/schema';
import { pngHeader } from '$lib/server/images/headers.testing';
import { UPLOAD_MAX } from '$lib/server/images/intake';
import { gift, noteGift } from '$lib/server/pages/settled-gifts.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { hideFundraiser } from '$lib/server/supporters/admin';
import { SUPPORTER_SESSION_COOKIE } from '$lib/server/supporters/session';
import { mountRoutes } from '../route-request.testing';
import {
	call,
	cookieJar,
	form,
	freshSupporterDeployment,
	lastWork,
	liveFundraiser,
	openLink,
	ORIGIN,
	postStart,
	request,
	STARTED,
	supporterEnv,
	tokenIn,
	visitFundraiser
} from '../supporter-routes.testing';
import { formBody, page, signInAsDeployer, signInAsMember } from '../webhook-routes.testing';
import * as admin from './_app.admin.supporter-pages';
import * as fundraiserPage from './f.$slug';
import * as fundraiserMessages from './f.$slug.messages';
import * as preview from './admin.supporter-pages.$id.preview';
import * as start from './fundraise._index';
import * as open from './fundraise.open';
import * as manage from './fundraise.pages.$id._index';
import * as edit from './fundraise.pages.$id.edit';
import * as list from './fundraise.pages._index';
import * as photo from './fundraise.photo';
import * as sent from './fundraise.sent';
import * as signIn from './fundraise.sign-in';
import * as signOut from './fundraise.sign-out';

// who may open what under /fundraise and on Supporter pages, against the real database through the
// route modules: a supporter's session opens no staff screen and a staff session no supporter's, a
// supporter opens only their own pages, a mailed link opens once and for an hour, "Email me a link"
// answers the same for every address, and no supporter screen carries a donor's details. the
// journey these guard is ./fundraise.journey.db.spec.ts.

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
	for (const table of ['auth_session', 'auth_user']) await run(stmt(`delete from ${table}`));
	await freshSupporterDeployment();
});

const adminScreen = page('admin/supporter-pages', admin);
const previewScreen = mountRoutes([{ path: 'admin/supporter-pages/:id/preview', module: preview }]);

/** the supporter's own pages, asked for with `cookie`. */
function ownPages(cookie: string) {
	return call(list.loader, request('/fundraise/pages', { cookie }));
}

describe('a supporter’s session at /admin', () => {
	it('opens neither Supporter pages nor its preview, and a press with it hides nothing', async () => {
		const { browser, pageId, slug } = await liveFundraiser(db, mailed);
		const supporter = browser.header();

		const listed = await adminScreen.get('/admin/supporter-pages', supporter);
		expect(listed.status).toBe(303);
		expect(listed.headers.get('location')).toMatch(/^\/login/);

		const previewed = await previewScreen(
			request(`/admin/supporter-pages/${pageId}/preview`, { cookie: supporter }),
			{ env: supporterEnv() }
		);
		expect(previewed.status).toBe(303);
		expect(previewed.headers.get('location')).toMatch(/^\/login/);

		const pressed = await adminScreen.post(
			'/admin/supporter-pages',
			supporter,
			formBody({ intent: 'hide', page_id: pageId, note: '' })
		);
		expect(pressed.status).toBe(303);
		expect((await visitFundraiser(slug)).status).toBe(200);
	});
});

describe('the staff preview of a fundraiser', () => {
	it('draws a hidden page for a member, with no donation box, and 404s an unknown id', async () => {
		const { pageId } = await liveFundraiser(db, mailed);
		await hideFundraiser(db, pageId, 'spam', new Date());
		const member = await signInAsMember(db);
		const drawn = await previewScreen(
			request(`/admin/supporter-pages/${pageId}/preview`, { cookie: member }),
			{ env: supporterEnv() }
		);
		expect(drawn.status).toBe(200);
		expect(await drawn.json()).toMatchObject({
			fundraiser: { title: 'Run for the shelter', name: 'Maya Rivera' },
			fundraiserEntry: false
		});
		const unknown = await previewScreen(
			request('/admin/supporter-pages/019fb600-0000-7000-8000-00000000dead/preview', {
				cookie: member
			}),
			{ env: supporterEnv() }
		);
		expect(unknown.status).toBe(404);
	});
});

describe('Show more messages on a fundraiser', () => {
	const showMore = mountRoutes([
		{ path: 'f/:slug', module: fundraiserPage },
		{ path: 'messages', module: fundraiserMessages }
	]);
	const read = async (slug: string) =>
		(await (await showMore(request(`/f/${slug}/messages`), { env: supporterEnv() })).json()) as {
			kind: string;
			messages: { note: string }[];
			total: number;
		};

	it('lists the page’s own shown messages, and nothing once the public cannot see it', async () => {
		const { pageId, formId, slug } = await liveFundraiser(db, mailed);
		await noteGift(db, formId, { note: 'Go Maya!', noteOnPage: 'named' });
		expect(await read(slug)).toMatchObject({
			kind: 'messages',
			messages: [{ note: 'Go Maya!' }],
			total: 1
		});
		await hideFundraiser(db, pageId, null, new Date());
		expect(await read(slug)).toEqual({ kind: 'messages', messages: [], total: 0, next: null });
	});
});

describe('a staff session under /fundraise', () => {
	it('is no supporter’s: every guarded screen sends it to the supporter sign-in', async () => {
		const { pageId } = await liveFundraiser(db, mailed);
		const staff = await signInAsDeployer(db);

		for (const answer of [
			await ownPages(staff),
			await call(manage.loader, request(`/fundraise/pages/${pageId}`, { cookie: staff }), {
				id: pageId
			}),
			await call(edit.loader, request(`/fundraise/pages/${pageId}/edit`, { cookie: staff }), {
				id: pageId
			})
		]) {
			expect(answer.status).toBe(303);
			expect(answer.location).toBe('/fundraise/sign-in');
		}
	});
});

describe('another supporter’s page', () => {
	it('is not found to open, to edit or to end, and is left as it was', async () => {
		const maya = await liveFundraiser(db, mailed);
		const ben = await liveFundraiser(db, mailed, {
			...STARTED,
			email: 'ben@example.org',
			title: 'Bake sale for the shelter'
		});
		const asBen = ben.browser.header();
		const at = `/fundraise/pages/${maya.pageId}`;
		const params = { id: maya.pageId };

		expect((await call(manage.loader, request(at, { cookie: asBen }), params)).status).toBe(404);
		expect((await call(edit.loader, request(`${at}/edit`, { cookie: asBen }), params)).status).toBe(
			404
		);
		const edited = await call(
			edit.action,
			request(`${at}/edit`, {
				cookie: asBen,
				body: form({
					intent: 'save',
					name: 'Ben',
					title: 'Taken over',
					goal: '500',
					story: 'Not mine.',
					photo_id: ''
				})
			}),
			params
		);
		expect(edited.status).toBe(404);
		const ended = await call(
			manage.action,
			request(at, { cookie: asBen, body: form({ intent: 'end' }) }),
			params
		);
		expect(ended.status).toBe(404);

		expect((await visitFundraiser(maya.slug)).data).toMatchObject({
			kind: 'live',
			fundraiser: { title: 'Run for the shelter', name: 'Maya Rivera' }
		});
		expect((await ownPages(asBen)).data).toMatchObject({
			pages: [{ id: ben.pageId, title: 'Bake sale for the shelter' }]
		});
	});
});

describe('a mailed link', () => {
	it('opens once: a second opening lands on the sign-in’s expired state', async () => {
		const { token } = await liveFundraiser(db, mailed);
		const again = cookieJar();
		const reopened = await openLink(token);
		again.take(reopened);
		expect(reopened.location).toBe('/fundraise/sign-in');
		expect(again.has(SUPPORTER_SESSION_COOKIE)).toBe(false);
		const landed = await call(
			signIn.loader,
			request('/fundraise/sign-in', { cookie: again.header() })
		);
		expect(landed.data).toMatchObject({ state: { kind: 'expired' } });
	});

	it('opens nothing an hour after it was made', async () => {
		const browser = cookieJar();
		const started = await call(start.action, request('/fundraise', { body: form(STARTED) }));
		browser.take(started);
		await lastWork.settled();
		await run(stmt('update supporter_link set expires_at = 0'));
		const token = /token=([A-Za-z0-9_-]+)/.exec(mailed.at(-1)?.text ?? '')?.[1] ?? '';
		const shown = await call(open.loader, request(`/fundraise/open?token=${token}`));
		expect(shown.location).toBe('/fundraise/sign-in');
		const opened = await openLink(token);
		expect(opened.location).toBe('/fundraise/sign-in');
		expect(opened.headers.getSetCookie().join()).not.toContain(SUPPORTER_SESSION_COOKIE);
		expect((await visitFundraiser('run-for-the-shelter')).status).toBe(404);
	});

	it('answers a link nobody was sent the same way', async () => {
		for (const answer of [
			await call(open.loader, request('/fundraise/open?token=made-up')),
			await openLink('made-up')
		]) {
			expect(answer.status).toBe(303);
			expect(answer.location).toBe('/fundraise/sign-in');
			expect(answer.headers.get('cache-control')).toBe('no-store');
		}
	});

	it('is not spent by a GET, which a mail scanner’s prefetch is: the page stays unpublished', async () => {
		const browser = cookieJar();
		await postStart(browser);
		const token = tokenIn(mailed.at(-1)?.text ?? '');
		for (let fetched = 0; fetched < 2; fetched += 1) {
			const shown = await call(open.loader, request(`/fundraise/open?token=${token}`));
			expect(shown.status).toBe(200);
			expect(shown.data).toMatchObject({ purpose: 'confirm', token });
			expect(shown.headers.get('cache-control')).toBe('no-store');
			expect(shown.headers.getSetCookie()).toEqual([]);
		}
		expect((await visitFundraiser('run-for-the-shelter')).status).toBe(404);
		expect((await openLink(token)).location).toMatch(/^\/fundraise\/pages\//);
	});

	it('names a sign-in link’s press as one, and its post goes on to the supporter’s pages', async () => {
		await liveFundraiser(db, mailed);
		await call(
			signIn.action,
			request('/fundraise/sign-in', {
				body: form({ intent: 'request-link', email: 'maya@example.org' })
			})
		);
		await lastWork.settled();
		const token = tokenIn(mailed.at(-1)?.text ?? '');
		const shown = await call(open.loader, request(`/fundraise/open?token=${token}`));
		expect(shown.data).toMatchObject({ purpose: 'sign_in' });
		const opened = await openLink(token);
		expect(opened.location).toBe('/fundraise/pages');
		expect(opened.headers.get('cache-control')).toBe('no-store');
	});

	it('refuses a post from another site, spending nothing', async () => {
		const browser = cookieJar();
		await postStart(browser);
		const token = tokenIn(mailed.at(-1)?.text ?? '');
		const forged = new Request(`${ORIGIN}/fundraise/open`, {
			method: 'POST',
			headers: {
				[CLIENT_IP_HEADER]: '192.0.2.79',
				origin: 'https://attacker.example',
				'sec-fetch-site': 'cross-site'
			},
			body: form({ token })
		});
		expect((await call(open.action, forged)).status).toBe(403);
		expect((await openLink(token)).location).toMatch(/^\/fundraise\/pages\//);
	});

	it.each([
		['ended', { status: 'ended' as const, endedAt: new Date() }],
		['hidden by staff', { hiddenAt: new Date() }]
	])(
		'says nothing is live where the page was %s before its confirm link was opened',
		async (_, change) => {
			const browser = cookieJar();
			await postStart(browser);
			const token = tokenIn(mailed.at(-1)?.text ?? '');
			await db.update(supporterPage).set(change);
			const opened = await openLink(token);
			browser.take(opened);
			const pageId = opened.location?.split('/').at(-1) ?? '';
			expect(opened.location).toBe(`/fundraise/pages/${pageId}`);
			const drawn = await call(
				manage.loader,
				request(`/fundraise/pages/${pageId}`, { cookie: browser.header() }),
				{ id: pageId }
			);
			expect(drawn.data).toMatchObject({ justPublished: false });
		}
	);
});

describe('Email me a link', () => {
	it('answers an unknown address exactly as a known one, and mails only the known', async () => {
		await liveFundraiser(db, mailed);
		mailed.length = 0;

		const ask = async (email: string) => {
			const jar = cookieJar();
			const answer = await call(
				signIn.action,
				request('/fundraise/sign-in', { body: form({ intent: 'request-link', email }) })
			);
			jar.take(answer);
			await lastWork.settled();
			const checking = await call(
				sent.loader,
				request('/fundraise/sent', { cookie: jar.header() })
			);
			return { answer, checking: checking.data as { kind: string; email: string } };
		};
		const known = await ask('maya@example.org');
		const unknown = await ask('nobody@example.org');

		expect(known.answer.status).toBe(303);
		expect(unknown.answer.status).toBe(known.answer.status);
		expect(unknown.answer.location).toBe(known.answer.location);
		expect(known.checking).toMatchObject({ kind: 'sign-in', email: 'maya@example.org' });
		expect(unknown.checking).toMatchObject({ kind: 'sign-in', email: 'nobody@example.org' });
		expect(mailed.map((message) => message.to)).toEqual(['maya@example.org']);
	});

	/** "Email me a link" for maya, asked at `host` by a caller that sends no browser headers. */
	async function askAtHost(host: string, env = supporterEnv()) {
		await call(
			signIn.action,
			new Request(`https://${host}/fundraise/sign-in`, {
				method: 'POST',
				headers: { [CLIENT_IP_HEADER]: '192.0.2.77' },
				body: form({ intent: 'request-link', email: 'maya@example.org' })
			}),
			{},
			env
		);
		await lastWork.settled();
	}

	it('builds the mailed link on the pinned origin, whatever host the request named', async () => {
		await liveFundraiser(db, mailed);
		mailed.length = 0;
		await askAtHost('attacker.example');
		expect(mailed).toHaveLength(1);
		expect(mailed[0]?.text).toContain(`${ORIGIN}/fundraise/open?token=`);
		expect(mailed[0]?.text).not.toContain('attacker.example');
	});

	it('mails no link where no origin is pinned, and tells the operator why', async () => {
		await liveFundraiser(db, mailed);
		mailed.length = 0;
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { BETTER_AUTH_URL: _pinned, ...unpinned } = supporterEnv();
		await askAtHost('attacker.example', unpinned);
		expect(mailed).toEqual([]);
		expect(logged.mock.calls.flat().join(' ')).toContain('BETTER_AUTH_URL');
		logged.mockRestore();
	});
});

describe('a supporter’s share link', () => {
	it('is on the pinned origin, whatever host the request named', async () => {
		const { browser, pageId, slug } = await liveFundraiser(db, mailed);
		const drawn = await call(
			manage.loader,
			new Request(`https://attacker.example/fundraise/pages/${pageId}`, {
				headers: { cookie: browser.header(), [CLIENT_IP_HEADER]: '192.0.2.78' }
			}),
			{ id: pageId }
		);
		expect(drawn.data).toMatchObject({ page: { url: `${ORIGIN}/f/${slug}` } });
	});
});

describe('signing out', () => {
	it('ends the session, so its cookie opens nothing after', async () => {
		const { browser } = await liveFundraiser(db, mailed);
		const kept = browser.header();
		const out = await call(
			signOut.action,
			request('/fundraise/sign-out', { cookie: kept, body: form({ intent: 'sign-out' }) })
		);
		expect(out.location).toBe('/fundraise/sign-in');
		browser.take(out);
		expect(browser.has(SUPPORTER_SESSION_COOKIE)).toBe(false);
		expect((await ownPages(kept)).location).toBe('/fundraise/sign-in');
	});
});

describe('a supporter’s photo', () => {
	const post = (cookie: string, width: number, height: number) => {
		const body = new FormData();
		body.set('file', new Blob([pngHeader(width, height)], { type: 'image/png' }));
		return call(photo.action, request('/fundraise/photo', { cookie, body }));
	};

	it('is stored for a signed-in supporter, answering its id', async () => {
		const { browser } = await liveFundraiser(db, mailed);
		const stored = await post(browser.header(), 1600, 900);
		expect(stored.status).toBe(200);
		expect(stored.data).toEqual({ id: expect.any(String) });
	});

	it('is refused narrower than a page photo, before anything is stored', async () => {
		const { browser } = await liveFundraiser(db, mailed);
		const before = await db.$count(image);
		const refused = await post(browser.header(), 800, 450);
		expect(refused.status).toBe(400);
		expect(await db.$count(image)).toBe(before);
	});

	it('is refused to a caller with no supporter session, staff included', async () => {
		expect((await post('', 1600, 900)).status).toBe(401);
		expect((await post(await signInAsMember(db), 1600, 900)).status).toBe(401);
	});
});

describe('a photo id posted with an edit', () => {
	const upload = async (cookie: string) => {
		const body = new FormData();
		body.set('file', new Blob([pngHeader(1600, 900)], { type: 'image/png' }));
		const stored = await call(photo.action, request('/fundraise/photo', { cookie, body }));
		return (stored.data as { id: string }).id;
	};
	const saveWith = (who: { browser: ReturnType<typeof cookieJar>; pageId: string }, id: string) =>
		call(
			edit.action,
			request(`/fundraise/pages/${who.pageId}/edit`, {
				cookie: who.browser.header(),
				body: form({
					intent: 'save',
					name: 'Maya Rivera',
					title: 'Run for the shelter',
					goal: '500',
					story: 'I am running 10k for the shelter.',
					photo_id: id
				})
			}),
			{ id: who.pageId }
		);
	const photoOf = async (pageId: string) =>
		(
			await db
				.select({ photoId: supporterPage.photoId })
				.from(supporterPage)
				.where(eq(supporterPage.id, pageId))
		)[0]?.photoId;

	it('cannot be another supporter’s photo, and the page keeps its own', async () => {
		const maya = await liveFundraiser(db, mailed);
		const ben = await liveFundraiser(db, mailed, {
			...STARTED,
			email: 'ben@example.org',
			title: 'Bake sale for the shelter'
		});
		const mayas = await upload(maya.browser.header());
		expect((await saveWith(maya, mayas)).data).toMatchObject({ savedAt: expect.any(Number) });
		const bens = await upload(ben.browser.header());
		expect((await saveWith(ben, bens)).data).toMatchObject({ savedAt: expect.any(Number) });

		const taken = await saveWith(ben, mayas);
		expect(taken.status).toBe(400);
		expect(taken.data).toMatchObject({ photoMissing: true });
		expect(await photoOf(ben.pageId)).toBe(bens);
		expect(await photoOf(maya.pageId)).toBe(mayas);
	});

	it('may be the page’s own photo again, or one the supporter just stored', async () => {
		const maya = await liveFundraiser(db, mailed);
		const first = await upload(maya.browser.header());
		expect((await saveWith(maya, first)).status).toBe(200);
		expect((await saveWith(maya, first)).status).toBe(200);
		const second = await upload(maya.browser.header());
		expect((await saveWith(maya, second)).status).toBe(200);
		expect(await photoOf(maya.pageId)).toBe(second);
	});

	it('cannot be the organisation’s own image', async () => {
		const maya = await liveFundraiser(db, mailed);
		const logo = await upload(maya.browser.header());
		await run(stmt('update org_profile set logo_image_id = ?', logo));
		const taken = await saveWith(maya, logo);
		expect(taken.data).toMatchObject({ photoMissing: true });
		expect(await photoOf(maya.pageId)).toBeNull();
	});
});

describe('a photo posted with a start', () => {
	/** Start a fundraiser posted by a visitor with no session, the photo as its `photo` file. */
	const startWith = (bytes: Uint8Array<ArrayBuffer>, fields: Record<string, string> = {}) => {
		const body = form({ ...STARTED, ...fields });
		body.set('photo', new Blob([bytes], { type: 'image/png' }), 'photo.png');
		return call(start.action, request('/fundraise', { body }));
	};

	it('is stored with the page, for a visitor with no session', async () => {
		const started = await startWith(pngHeader(1600, 900));
		expect(started.location).toBe('/fundraise/sent');
		const [row] = await db.select({ photoId: supporterPage.photoId }).from(supporterPage);
		expect(row?.photoId).toEqual(expect.any(String));
		expect(await db.$count(image, eq(image.id, row?.photoId ?? ''))).toBe(1);
	});

	it('is the only photo a start takes: a posted photo id is dropped', async () => {
		const started = await call(
			start.action,
			request('/fundraise', { body: form({ ...STARTED, photo_id: 'no-such-image' }) })
		);
		expect(started.location).toBe('/fundraise/sent');
		const [row] = await db.select({ photoId: supporterPage.photoId }).from(supporterPage);
		expect(row?.photoId).toBeNull();
	});

	it('is refused narrower than a page photo, storing neither it nor the page', async () => {
		const before = await db.$count(image);
		const refused = await startWith(pngHeader(800, 450));
		expect(refused.status).toBe(400);
		expect(refused.data).toMatchObject({ refused: 'photo_missing' });
		expect(await db.$count(image)).toBe(before);
		expect(await db.$count(supporterPage)).toBe(0);
	});

	it('is refused when it is no image, storing nothing', async () => {
		const before = await db.$count(image);
		const refused = await startWith(new TextEncoder().encode('<svg/>'));
		expect(refused.data).toMatchObject({ refused: 'photo_missing' });
		expect(await db.$count(image)).toBe(before);
	});

	it('is refused past the upload cap, with the page unwritten', async () => {
		const body = form(STARTED);
		body.set('photo', new Blob([new Uint8Array(UPLOAD_MAX + 1)]), 'photo.png');
		// the multipart bytes posted as one buffer, as a browser's upload arrives: a body streamed
		// from a `FormData` throws past the read's cancel inside undici.
		const encoded = new Response(body);
		const caller = request('/fundraise');
		const headers = new Headers(caller.headers);
		headers.set('content-type', encoded.headers.get('content-type') ?? '');
		const posted = new Request(caller.url, {
			method: 'POST',
			headers,
			body: await encoded.arrayBuffer()
		});
		const refused = await call(start.action, posted);
		expect(refused.status).toBe(400);
		expect(refused.data).toMatchObject({ refused: 'photo_missing' });
		expect(await db.$count(supporterPage)).toBe(0);
	});

	it('is not read when the spam check does not clear', async () => {
		const before = await db.$count(image);
		const refused = await startWith(pngHeader(1600, 900), { challenge: 'unsolved' });
		expect(refused.data).toMatchObject({ refused: 'challenge_failed' });
		expect(await db.$count(image)).toBe(before);
	});
});

describe('what a supporter is shown', () => {
	it('carries no donor email, address or payment method, and no secret', async () => {
		const { browser, pageId, formId } = await liveFundraiser(db, mailed);
		await gift(db, formId, 10_000);
		const screens = [
			await ownPages(browser.header()),
			await call(
				manage.loader,
				request(`/fundraise/pages/${pageId}`, { cookie: browser.header() }),
				{
					id: pageId
				}
			)
		];
		for (const screen of screens) {
			const text = JSON.stringify(screen.data);
			expect(text).not.toContain('ada@example.org');
			expect(text).not.toMatch(/sk_test|whsec_|mail-secret|card|payment/i);
		}
		const publicPage = JSON.stringify((await visitFundraiser('run-for-the-shelter')).data);
		expect(publicPage).not.toContain('maya@example.org');
		expect(publicPage).not.toContain('ada@example.org');
		expect(publicPage).not.toMatch(/sk_test|whsec_|mail-secret/);
		expect(publicPage).toContain(ORIGIN);
	});
});
