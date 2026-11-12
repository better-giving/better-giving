import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { gift } from '$lib/server/pages/settled-gifts.testing';
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
	postStart,
	request,
	STARTED,
	supporterEnv,
	tokenIn,
	visitDonorPage,
	visitFundraiser
} from '../supporter-routes.testing';
import { formBody, page, signInAsDeployer, signInAsMember } from '../webhook-routes.testing';
import * as admin from './_app.admin.supporter-pages';
import * as surface from './api.v1';
import * as servedConfig from './api.v1.forms.$id.config';
import * as donate from './donate';
import * as start from './fundraise._index';
import * as edit from './fundraise.pages.$id.edit';
import * as open from './fundraise.open';
import * as manage from './fundraise.pages.$id._index';
import * as sent from './fundraise.sent';
import * as signIn from './fundraise.sign-in';

// a supporter's fundraiser from start to end, driven through the route modules in-process against
// the real database: the start, the mailed confirm link, the manage screen, the edit, a gift on the
// public page, staff hiding and showing it again, the organisation switching fundraisers off, and
// the end. no /admin browser spec exists (AGENTS.md → Never), and packages/form is the one browser
// package, so this is the end-to-end evidence for the slice.
//
// the mail transport is the one thing stubbed, for ./forgot.db.spec.ts's reason: the link is
// composed by the routes, and the address in the message is the assertion worth having.

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

describe('starting a fundraiser and opening its confirm link', () => {
	it('goes on to Check your email with the address, and mails a link that publishes the page once', async () => {
		const browser = cookieJar();
		const started = await postStart(browser);
		expect(started.status).toBe(303);
		expect(started.location).toBe('/fundraise/sent');

		const checking = await call(
			sent.loader,
			request('/fundraise/sent', { cookie: browser.header() })
		);
		browser.take(checking);
		expect(checking.data).toMatchObject({ kind: 'start', email: 'maya@example.org' });
		// the address rides in the flash and never in the address bar, and is spent by the screen.
		expect(started.location).not.toContain('maya');
		const reloaded = await call(
			sent.loader,
			request('/fundraise/sent', { cookie: browser.header() })
		);
		expect(reloaded.location).toBe('/fundraise');

		expect(mailed).toHaveLength(1);
		expect(mailed[0]?.to).toBe('maya@example.org');
		const token = tokenIn(mailed[0]?.text ?? '');

		const shown = await call(open.loader, request(`/fundraise/open?token=${token}`));
		expect(shown.status).toBe(200);
		expect(shown.data).toMatchObject({ purpose: 'confirm' });
		expect((await visitFundraiser('run-for-the-shelter')).status).toBe(404);

		const opened = await openLink(token);
		browser.take(opened);
		expect(opened.status).toBe(303);
		expect(opened.headers.get('cache-control')).toBe('no-store');
		expect(browser.has(SUPPORTER_SESSION_COOKIE)).toBe(true);
		const managePath = opened.location ?? '';
		const pageId = managePath.split('/').at(-1) ?? '';
		expect(managePath).toBe(`/fundraise/pages/${pageId}`);

		const first = await call(manage.loader, request(managePath, { cookie: browser.header() }), {
			id: pageId
		});
		browser.take(first);
		expect(first.data).toMatchObject({
			justPublished: true,
			page: { title: 'Run for the shelter', status: 'live', address: '/f/run-for-the-shelter' }
		});
		const second = await call(manage.loader, request(managePath, { cookie: browser.header() }), {
			id: pageId
		});
		expect(second.data).toMatchObject({ justPublished: false });

		const visited = await visitFundraiser('run-for-the-shelter');
		expect(visited.status).toBe(200);
		expect(visited.data).toMatchObject({
			kind: 'live',
			fundraiser: { title: 'Run for the shelter', name: 'Maya Rivera', raisedMinor: 0 }
		});
	});
});

describe('Send it again on Check your email', () => {
	/** the start's Check your email drawn in `browser`, then Send it again pressed there. */
	async function resendAfterStart(browser: ReturnType<typeof cookieJar>, email = STARTED.email) {
		browser.take(await call(sent.loader, request('/fundraise/sent', { cookie: browser.header() })));
		const pressed = await call(
			sent.action,
			request('/fundraise/sent', {
				cookie: browser.header(),
				body: form({ intent: 'resend', email })
			})
		);
		await lastWork.settled();
		return pressed;
	}

	it('after a start, mails a fresh confirm link that publishes the page, and the first still opens once', async () => {
		const browser = cookieJar();
		await postStart(browser);
		const first = tokenIn(mailed[0]?.text ?? '');
		const pressed = await resendAfterStart(browser);
		expect(pressed.status).toBe(200);
		expect(mailed).toHaveLength(2);
		expect(mailed[1]?.to).toBe('maya@example.org');
		const fresh = tokenIn(mailed[1]?.text ?? '');

		const opened = await openLink(fresh);
		expect(opened.location).toMatch(/^\/fundraise\/pages\//);
		const visited = await visitFundraiser('run-for-the-shelter');
		expect(visited.data).toMatchObject({ kind: 'live' });
		expect((await openLink(first)).location).toMatch(/^\/fundraise\/pages\//);
		expect((await openLink(first)).location).toBe('/fundraise/sign-in');
	});

	it('after a sign-in request that follows a start, mails a sign-in link and publishes nothing', async () => {
		const browser = cookieJar();
		await postStart(browser);
		browser.take(await call(sent.loader, request('/fundraise/sent', { cookie: browser.header() })));
		browser.take(
			await call(
				signIn.action,
				request('/fundraise/sign-in', {
					cookie: browser.header(),
					body: form({ intent: 'request-link', email: STARTED.email })
				})
			)
		);
		await lastWork.settled();
		await resendAfterStart(browser);
		expect(mailed).toHaveLength(3);
		const opened = await openLink(tokenIn(mailed[2]?.text ?? ''));
		expect(opened.location).toBe('/fundraise/pages');
		expect((await visitFundraiser('run-for-the-shelter')).data).not.toMatchObject({ kind: 'live' });
	});

	it('after a start, answers another address as it answers the started one, and mails nobody', async () => {
		const browser = cookieJar();
		await postStart(browser);
		const pressed = await resendAfterStart(browser, 'nobody@example.org');
		expect(pressed.status).toBe(200);
		expect(mailed).toHaveLength(1);
	});
});

const adminScreen = page('admin/supporter-pages', admin);

/** a press on Supporter pages, by `staff`'s session. */
function press(staff: string, fields: Record<string, string>) {
	return adminScreen.post('/admin/supporter-pages', staff, formBody(fields));
}

const configEndpoint = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/config', module: servedConfig }
]);

/** whether the donation form on the page could take a gift: the config it boots on, served. */
async function takesGifts(formId: string): Promise<boolean> {
	const answer = await configEndpoint(request(`/api/v1/forms/${formId}/config`), {
		env: supporterEnv()
	});
	return answer.ok;
}

/** the manage screen's figures for the supporter's browser. */
async function managed(browser: ReturnType<typeof cookieJar>, pageId: string) {
	const answer = await call(
		manage.loader,
		request(`/fundraise/pages/${pageId}`, { cookie: browser.header() }),
		{ id: pageId }
	);
	return (answer.data as { page: Record<string, unknown> }).page;
}

describe('a fundraiser’s life, from its first edit to its end', () => {
	it('edits, raises, is hidden and shown, outlives the setting, and ends', async () => {
		const { browser, pageId, formId, slug } = await liveFundraiser(db, mailed);

		// the edit, and the screen staying with Saved.
		const saved = await call(
			edit.action,
			request(`/fundraise/pages/${pageId}/edit`, {
				cookie: browser.header(),
				body: form({
					intent: 'save',
					name: 'Maya R.',
					title: 'Run for the new shelter',
					goal: '750',
					story: 'Now running 21k.',
					photo_id: ''
				})
			}),
			{ id: pageId }
		);
		expect(saved.status).toBe(200);
		expect(saved.data).toMatchObject({ savedAt: expect.any(Number) });
		expect(await managed(browser, pageId)).toMatchObject({
			title: 'Run for the new shelter',
			goalMinor: 75_000
		});

		// a gift through the page's own form moves both totals.
		expect(await takesGifts(formId)).toBe(true);
		await gift(db, formId, 10_000);
		expect(await managed(browser, pageId)).toMatchObject({ raisedMinor: 10_000, gifts: 1 });
		expect((await visitFundraiser(slug)).data).toMatchObject({
			kind: 'live',
			fundraiser: { title: 'Run for the new shelter', name: 'Maya R.', raisedMinor: 10_000 }
		});

		// staff hide it: not found to the public, no gift taken, and the supporter told why.
		const staff = await signInAsDeployer(db);
		const hidden = await press(staff, {
			intent: 'hide',
			page_id: pageId,
			note: 'Please take the phone number out of the story.'
		});
		expect(await hidden.json()).toMatchObject({ landed: 'hidden', pageId });
		const notFound = await visitFundraiser(slug);
		expect(notFound.status).toBe(404);
		expect(notFound.data).toEqual({ kind: 'refused' });
		expect((await visitFundraiser('nobody-holds-this')).data).toEqual(notFound.data);
		expect(await takesGifts(formId)).toBe(false);
		expect(await managed(browser, pageId)).toMatchObject({
			hidden: true,
			hiddenNote: 'Please take the phone number out of the story.'
		});

		// and show it again: back as it stood.
		const shown = await press(staff, { intent: 'show', page_id: pageId });
		expect(await shown.json()).toMatchObject({ landed: 'shown', pageId });
		expect((await visitFundraiser(slug)).status).toBe(200);
		expect(await takesGifts(formId)).toBe(true);

		// the organisation switches fundraisers off: no new start, no entry card, the live page live.
		const off = await press(staff, { intent: 'save-setting' });
		expect(await off.json()).toMatchObject({ saved: 'setting' });
		expect((await call(start.loader, request('/fundraise'))).data).toMatchObject({ open: false });
		const refused = await call(
			start.action,
			request('/fundraise', { body: form({ ...STARTED, email: 'ben@example.org' }) })
		);
		expect(refused.status).toBe(303);
		expect(refused.location).toBe('/fundraise');
		expect(await entryCardOnDonate()).toBe(false);
		expect((await visitFundraiser(slug)).data).toMatchObject({
			kind: 'live',
			fundraiserEntry: false
		});
		await press(staff, { intent: 'save-setting', enabled: 'on' });
		expect(await entryCardOnDonate()).toBe(true);

		// the supporter ends it: the address answers 200 with the final total, and takes no gift.
		const ended = await call(
			manage.action,
			request(`/fundraise/pages/${pageId}`, {
				cookie: browser.header(),
				body: form({ intent: 'end' })
			}),
			{ id: pageId }
		);
		expect(ended.status).toBe(200);
		const after = await visitFundraiser(slug);
		expect(after.status).toBe(200);
		expect(after.data).toMatchObject({
			kind: 'ended',
			fundraiser: { title: 'Run for the new shelter', raisedMinor: 10_000, goalMinor: 75_000 }
		});
		expect(await takesGifts(formId)).toBe(false);
		expect(await managed(browser, pageId)).toMatchObject({ status: 'ended' });
	});

	it('lets a member hide and show, and not change the setting', async () => {
		const { pageId } = await liveFundraiser(db, mailed);
		const member = await signInAsMember(db);
		const listed = await adminScreen.get('/admin/supporter-pages', member);
		expect(await listed.json()).toMatchObject({
			setting: { enabled: true, mayChange: false },
			pages: [{ id: pageId, openHref: '/f/run-for-the-shelter' }]
		});
		expect(
			await (await press(member, { intent: 'hide', page_id: pageId, note: '' })).json()
		).toMatchObject({ landed: 'hidden' });
		const relisted = await adminScreen.get('/admin/supporter-pages', member);
		expect(await relisted.json()).toMatchObject({
			pages: [{ id: pageId, openHref: `/admin/supporter-pages/${pageId}/preview` }]
		});
		await press(member, { intent: 'save-setting' });
		expect((await call(start.loader, request('/fundraise'))).data).toMatchObject({ open: true });
	});
});

/** whether /donate draws the card that starts a fundraiser. */
async function entryCardOnDonate(): Promise<boolean> {
	const drawn = await visitDonorPage(donate, 'donate', '/donate');
	return (drawn.data as { view?: { fundraiserEntry?: boolean } }).view?.fundraiserEntry === true;
}
