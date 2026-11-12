import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { stampCookieScheme } from '$lib/server/runtime/cookie-scheme';
import { UNMAILABLE_START } from '$lib/server/supporters/start';
import {
	call,
	cookieJar,
	form,
	freshSupporterDeployment,
	lastWork,
	ORIGIN,
	request,
	STARTED,
	supporterEnv,
	tokenIn
} from '../supporter-routes.testing';
import * as start from './fundraise._index';
import * as open from './fundraise.open';
import * as sent from './fundraise.sent';

// the confirm link a start mails, and the one Send it again mails after it, are built on the origin
// `BETTER_AUTH_URL` pins, whatever host the request named. the sign-in link's case is
// ./fundraise.guards.db.spec.ts's "builds the mailed link on the pinned origin".

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

beforeEach(async () => {
	mailed.length = 0;
	await freshSupporterDeployment();
});

const ATTACKER = 'https://attacker.example';

/** a request to `path` on the attacker's host, from a caller that sends no browser headers. */
function atAttackerHost(path: string, init: { cookie?: string; body?: FormData } = {}): Request {
	const headers = new Headers({ [CLIENT_IP_HEADER]: '192.0.2.79' });
	if (init.cookie) headers.set('cookie', init.cookie);
	return new Request(`${ATTACKER}${path}`, {
		method: init.body ? 'POST' : 'GET',
		headers,
		...(init.body ? { body: init.body } : {})
	});
}

/** a start posted at the attacker's host, its confirm link's mail waited for. */
async function startAtAttackerHost(browser: ReturnType<typeof cookieJar>) {
	browser.take(await call(start.action, atAttackerHost('/fundraise', { body: form(STARTED) })));
	await lastWork.settled();
}

function expectPinned(message: Message | undefined) {
	expect(message?.text).toContain(`${ORIGIN}/fundraise/open?token=`);
	expect(message?.text).not.toContain('attacker.example');
	expect(message?.html).not.toContain('attacker.example');
}

describe('a mailed confirm link', () => {
	it('from a start is on the pinned origin, whatever host the request named', async () => {
		await startAtAttackerHost(cookieJar());
		expect(mailed).toHaveLength(1);
		expectPinned(mailed[0]);
	});

	it('from Send it again is on the pinned origin, whatever host the request named', async () => {
		const browser = cookieJar();
		await startAtAttackerHost(browser);
		browser.take(
			await call(sent.loader, atAttackerHost('/fundraise/sent', { cookie: browser.header() }))
		);
		await call(
			sent.action,
			atAttackerHost('/fundraise/sent', {
				cookie: browser.header(),
				body: form({ intent: 'resend', email: STARTED.email })
			})
		);
		await lastWork.settled();
		expect(mailed).toHaveLength(2);
		expectPinned(mailed[1]);
	});
});

describe('a start where no origin is pinned', () => {
	it('is refused with a sentence the start screen shows, and writes no page', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { BETTER_AUTH_URL: _pinned, ...unpinned } = supporterEnv();
		const answer = await call(
			start.action,
			request('/fundraise', { body: form(STARTED) }),
			{},
			unpinned
		);
		await lastWork.settled();
		logged.mockRestore();

		expect(answer.status).toBe(500);
		expect(answer.data).toMatchObject({
			refused: null,
			form: { result: { error: { '': [UNMAILABLE_START] } } }
		});
		expect(mailed).toEqual([]);
		expect(await createDb(client).select().from(supporterPage)).toEqual([]);
	});
});

/**
 * a request as the server entry hands it on behind a TLS-ending proxy with `TRUSTED_PROXY_HEADER`
 * unset: plain `http:` on the pinned host, stamped with the scheme the pin names.
 */
function behindProxy(path: string, init: { cookie?: string; body?: FormData } = {}): Request {
	const headers = new Headers({
		[CLIENT_IP_HEADER]: '192.0.2.80',
		'sec-fetch-site': 'same-origin'
	});
	if (init.cookie) headers.set('cookie', init.cookie);
	const arrived = new Request(`${ORIGIN.replace(/^https:/, 'http:')}${path}`, {
		method: init.body ? 'POST' : 'GET',
		headers,
		...(init.body ? { body: init.body } : {})
	});
	stampCookieScheme(arrived, ORIGIN);
	return arrived;
}

describe('the cookies a supporter is handed on an https pin, over a connection that reads as http', () => {
	it('are every one Secure: the resend ticket, the session and the flash', async () => {
		const browser = cookieJar();
		const started = await call(start.action, behindProxy('/fundraise', { body: form(STARTED) }));
		browser.take(started);
		await lastWork.settled();
		const ticketed = await call(
			sent.loader,
			behindProxy('/fundraise/sent', { cookie: browser.header() })
		);
		const token = tokenIn(mailed.at(-1)?.text ?? '');
		const opened = await call(
			open.action,
			behindProxy(`/fundraise/open?token=${token}`, { body: form({ token }) })
		);

		const cookies = [started, ticketed, opened].flatMap((answer) => answer.headers.getSetCookie());
		expect(cookies.map((line) => line.split('=', 1)[0])).toEqual(
			expect.arrayContaining(['supporter_sent', 'supporter_resend', 'bg_supporter_session'])
		);
		for (const line of cookies) expect(line).toMatch(/; Secure/);
	});
});
