import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { createRateLimiter } from '$lib/server/runtime/rate-limiter';
import { type LinkMail, requestSignInLink, signInWithLink } from './links';
import { readSupporterSession } from './session';

// the emailed one-time link: who is mailed one, and what opening it does, against the real tables.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	for (const table of ['supporter_session', 'supporter_link', 'supporter']) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(
			`insert into supporter (id, email, name, created_at)
			 values ('019fb600-0000-7000-8000-000000000001', 'maya@example.org', 'Maya Rivera', 0)`
		)
	);
});

const NOW = new Date('2026-11-11T12:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

let address = 0;
/** a request from an address of its own, so no case spends another's bucket. */
function from(ip = `203.0.113.${++address}`): Request {
	return new Request('https://give.example/f/sign-in', {
		method: 'POST',
		headers: { [CLIENT_IP_HEADER]: ip }
	});
}

/** a sign-in request for `email`, and the mail it sent once the deferred work ran. */
async function ask(email: string, options: { request?: Request; limit?: number } = {}) {
	const mailed: LinkMail[] = [];
	const deferred = createDeferredWork();
	const answer = await requestSignInLink(
		{
			db,
			limiter: createRateLimiter({ limit: options.limit ?? 10, period: 60 }),
			defer: (work) => deferred.waitUntil(work),
			sendLink: async (mail) => {
				mailed.push(mail);
			},
			now: NOW
		},
		options.request ?? from(),
		email
	);
	await deferred.settled();
	return { answer, mailed };
}

describe('asking for a sign-in link', () => {
	it('mails a link to an address that has started a fundraiser', async () => {
		const { answer, mailed } = await ask('maya@example.org');
		expect(answer).toBe('sent');
		expect(mailed).toEqual([
			{ to: 'maya@example.org', token: expect.any(String), arm: { kind: 'returning' } }
		]);
	});

	it('answers an unknown address the same way and mails nobody', async () => {
		const { answer, mailed } = await ask('nobody@example.org');
		expect(answer).toBe('sent');
		expect(mailed).toEqual([]);
	});

	it('mails nothing before the answer is returned', async () => {
		const mailed: LinkMail[] = [];
		const held: Promise<unknown>[] = [];
		await requestSignInLink(
			{
				db,
				limiter: createRateLimiter({ limit: 10, period: 60 }),
				defer: (work) => held.push(work),
				sendLink: async (mail) => {
					mailed.push(mail);
				},
				now: NOW
			},
			from(),
			'maya@example.org'
		);
		expect(mailed).toEqual([]);
		await Promise.all(held);
		expect(mailed).toHaveLength(1);
	});

	it('answers too many tries past the bucket for one client address', async () => {
		const request = () => from('198.51.100.7');
		const limiter = createRateLimiter({ limit: 2, period: 60 });
		const answers: string[] = [];
		for (const email of ['a@example.org', 'b@example.org', 'c@example.org']) {
			answers.push(
				await requestSignInLink(
					{ db, limiter, defer: () => {}, sendLink: async () => {}, now: NOW },
					request(),
					email
				)
			);
		}
		expect(answers).toEqual(['sent', 'sent', 'too_many']);
	});

	it('answers too many tries past the bucket for one email, from any address', async () => {
		const limiter = createRateLimiter({ limit: 2, period: 60 });
		const answers: string[] = [];
		for (let n = 0; n < 3; n += 1) {
			answers.push(
				await requestSignInLink(
					{ db, limiter, defer: () => {}, sendLink: async () => {}, now: NOW },
					from(),
					'maya@example.org'
				)
			);
		}
		expect(answers).toEqual(['sent', 'sent', 'too_many']);
	});
});

describe('opening a link', () => {
	async function mailedToken(): Promise<string> {
		const { mailed } = await ask('maya@example.org');
		const [mail] = mailed;
		if (!mail) throw new Error('no link was mailed');
		return mail.token;
	}

	const open = (token: string, at = minutes(1)) =>
		signInWithLink(db, new Request('https://give.example/f/link'), token, at);

	it('signs the supporter in with a session cookie of their own', async () => {
		const opened = await open(await mailedToken());
		if (!opened.ok) throw new Error('the link was refused');
		const cookie = opened.setCookie.split(';', 1)[0] ?? '';
		const session = await readSupporterSession(
			db,
			new Request('https://give.example/f/mine', { headers: { cookie } }),
			minutes(2)
		);
		expect(session).toEqual({
			supporterId: '019fb600-0000-7000-8000-000000000001',
			email: 'maya@example.org',
			name: 'Maya Rivera'
		});
	});

	it('sets the cookie HttpOnly, Secure and SameSite=Lax', async () => {
		const opened = await open(await mailedToken());
		if (!opened.ok) throw new Error('the link was refused');
		expect(opened.setCookie).toMatch(/; HttpOnly/);
		expect(opened.setCookie).toMatch(/; Secure/);
		expect(opened.setCookie).toMatch(/; SameSite=Lax/);
	});

	it('works once', async () => {
		const token = await mailedToken();
		expect((await open(token)).ok).toBe(true);
		expect(await open(token)).toEqual({ ok: false });
	});

	it('works until sixty minutes after it was made, and not after', async () => {
		const early = await mailedToken();
		expect((await open(early, minutes(59))).ok).toBe(true);
		const late = await mailedToken();
		expect(await open(late, minutes(60))).toEqual({ ok: false });
	});

	it('stops working once a newer sign-in link is mailed', async () => {
		const older = await mailedToken();
		const newer = await mailedToken();
		expect(await open(older)).toEqual({ ok: false });
		expect((await open(newer)).ok).toBe(true);
	});

	it('refuses a token it never minted the same way', async () => {
		expect(await open('not-a-token-anyone-was-sent')).toEqual({ ok: false });
	});
});
