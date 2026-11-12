import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import {
	call,
	cookieJar,
	form,
	freshSupporterDeployment,
	lastWork,
	ORIGIN,
	STARTED
} from '../supporter-routes.testing';
import * as start from './fundraise._index';
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
