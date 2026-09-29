import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { contact, donation, payment } from '$lib/server/db/schema';
import { ZAPIER_KEY_SHAPE } from '$lib/server/integrations/keys';
import { sendDueZapierEvents } from '$lib/server/zapier/deliver';
import { zapierStatements } from '$lib/server/zapier/events';
import { makeZapierKey } from '$lib/server/zapier/key';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.integrations.zapier';
import * as surface from './zapier';
import * as hooks from './zapier.hooks';

// the Zapier page's server half, against the real D1 the pool binds, through the protected layout
// (../route-request.testing.ts) — who is signed in is what every answer here turns on.
//
// a key made here is carried to the surface it exists for: a Zap subscribes with it at
// `/zapier/hooks`, and a gift settled after that is posted to the Zap's hook by the delivery run.

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/integrations/zapier';
const PASSWORD = 'a-very-long-random-staff-password';

function deployed() {
	return deployedBindings(PASSWORD);
}

let db: Db;
let request: RouteRequester;
let zapierHooks: RouteRequester;
let deployer: string;

/** the Zapier surface's layout charges each address, so each case calls from one of its own. */
let caller = 0;

beforeAll(() => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/integrations/zapier', module: screen }
	]);
	zapierHooks = mountRoutes([
		{ path: 'zapier', module: surface },
		{ path: 'hooks', module: hooks }
	]);
});

beforeEach(async () => {
	for (const table of [
		'zapier_delivery',
		'zapier_subscription',
		'api_key',
		'auth_member_invitation',
		'auth_session',
		'auth_user',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	// the one row the five set-up jobs are read off, so the layout serves its children.
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
	deployer = await signInAsDeployer(db, DEPLOYMENT);
	caller += 1;
});

const DEPLOYMENT = { env: deployed(), password: PASSWORD, origin: ORIGIN };

type Screen = {
	address: string;
	report: {
		key: { id: string; prefix: string; lastFour: string; madeAt: string } | null;
		listening: { newGift: number; newDonor: number; giftRefunded: number };
		deliveries: { waiting: number; failed: number; oldestWaitingAt: string | null };
	};
	late: boolean;
	replacing: boolean;
};

function get(cookie: string, search = ''): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}${search}`, { headers: { cookie } }), {
		env: deployed()
	});
}

async function visit(cookie: string, search = ''): Promise<Screen> {
	const response = await get(cookie, search);
	expect(response.status).toBe(200);
	return (await response.json()) as Screen;
}

describe('GET /admin/integrations/zapier — before a key', () => {
	it('draws this deployment’s own address, no key and nobody listening', async () => {
		const read = await visit(deployer);

		expect(read.address).toBe(ORIGIN);
		expect(read.report.key).toBeNull();
		expect(read.report.listening).toEqual({ newGift: 0, newDonor: 0, giftRefunded: 0 });
		expect(read.report.deliveries).toEqual({ waiting: 0, failed: 0, oldestWaitingAt: null });
		expect(read.late).toBe(false);
	});

	it('hands Zapier an https address when the page is asked over plain http', async () => {
		const plain = ORIGIN.replace('https:', 'http:');
		const response = await request(
			new Request(`${plain}${SCREEN}`, { headers: { cookie: deployer } }),
			{ env: deployed() }
		);

		expect(((await response.json()) as Screen).address).toBe(ORIGIN);
	});
});

function post(cookie: string, body: FormData): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: deployed() }
	);
}

function press(form: 'zapier-key-make' | 'zapier-key-replace'): FormData {
	const body = new FormData();
	body.set('__form_id__', form);
	return body;
}

/** a replace pressed on a page showing the key `keyId`, which the confirm posts. */
function replacing(keyId: string): FormData {
	const body = press('zapier-key-replace');
	body.set('key_id', keyId);
	return body;
}

/** the id of the key the page shows now, which a replace pressed on it names. */
async function shownKeyId(): Promise<string> {
	const { key } = (await visit(deployer)).report;
	if (key === null) throw new Error('the page shows no key to replace');
	return key.id;
}

type Made = {
	made: {
		press: 'make' | 'replace';
		key: string;
		madeAt: string;
		disconnected: number;
		paused: number;
		notPaused: number;
	};
};

async function made(response: Response): Promise<Made['made']> {
	expect(response.status).toBe(200);
	return ((await response.json()) as Made).made;
}

/** the sentence a refused press answers with, which belongs to no box. */
async function refusal(response: Response): Promise<string | undefined> {
	const answer = (await response.json()) as {
		form: { id: string; result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error?.['']?.at(-1);
}

/** a Zap asking for `trigger`'s events at `hookUrl`, as Zapier's servers ask. */
function subscribeWith(key: string, trigger: string, hookUrl: string): Promise<Response> {
	return zapierHooks(
		new Request(`${ORIGIN}/zapier/hooks`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${key}`,
				'content-type': 'application/json',
				'cf-connecting-ip': `203.0.113.${caller}`
			},
			body: JSON.stringify({ trigger, hook_url: hookUrl })
		}),
		{ env: deployed() }
	);
}

/** a gift from a new donor, settled with its fan-out the way the money path commits one. */
async function settleGift(): Promise<void> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date();
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 5_000,
			currency: 'USD',
			receivedAt: at
		}),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		}),
		...zapierStatements(db, { paymentId, contactId })
	]);
}

const HOOK = 'https://hooks.zapier.com/hooks/standard/1/2/3/';

describe('POST /admin/integrations/zapier — making the key', () => {
	it('answers with the key once, a Zap subscribes with it, and a new gift is posted to the Zap', async () => {
		const answer = await made(await post(deployer, press('zapier-key-make')));

		expect(answer.press).toBe('make');
		expect(answer.key).toMatch(ZAPIER_KEY_SHAPE);
		expect(answer.disconnected).toBe(0);

		expect((await subscribeWith(answer.key, 'new_gift', HOOK)).status).toBe(201);
		await settleGift();
		const posted: string[] = [];
		await sendDueZapierEvents(
			{
				db,
				fetch: async (input) => {
					posted.push(String(input instanceof Request ? input.url : input));
					return new Response(null, { status: 200 });
				}
			},
			new Date(Date.now() + 60_000)
		);
		expect(posted).toEqual([HOOK]);
	});

	it('shows only the key’s head and tail on every read after', async () => {
		const answer = await made(await post(deployer, press('zapier-key-make')));

		const response = await get(deployer);
		const served = await response.clone().text();
		const { report } = (await response.json()) as Screen;

		expect(report.key).toMatchObject({
			prefix: answer.key.slice(0, 8),
			lastFour: answer.key.slice(-4)
		});
		expect(served).not.toContain(answer.key.slice(8, -4));
	});

	it('refuses a second make in words and leaves the first key working', async () => {
		const first = await made(await post(deployer, press('zapier-key-make')));

		const second = await post(deployer, press('zapier-key-make'));

		expect(second.status).toBe(409);
		expect(await refusal(second)).toMatch(/already/);
		expect((await subscribeWith(first.key, 'new_gift', HOOK)).status).toBe(201);
	});
});

/** Zapier's hooks answering each pause a replace sends with `status`; the urls paused, in order. */
function hooksAnswer(status: number): string[] {
	const paused: string[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
		if (method === 'DELETE' && url.startsWith('https://hooks.zapier.com/')) paused.push(url);
		return new Response(null, { status });
	});
	return paused;
}

describe('POST /admin/integrations/zapier — replacing the key', () => {
	it('ends every Zap on the old key, turns the old key away and answers with the new one once', async () => {
		const old = await made(await post(deployer, press('zapier-key-make')));
		await subscribeWith(old.key, 'new_gift', `${HOOK}a/`);
		await subscribeWith(old.key, 'new_gift', `${HOOK}b/`);
		await subscribeWith(old.key, 'new_donor', `${HOOK}c/`);
		const paused = hooksAnswer(200);

		const answer = await made(await post(deployer, replacing(await shownKeyId())));

		expect(answer).toMatchObject({ press: 'replace', disconnected: 3, paused: 3, notPaused: 0 });
		expect(answer.key).toMatch(ZAPIER_KEY_SHAPE);
		expect(answer.key).not.toBe(old.key);
		expect(paused.sort()).toEqual([`${HOOK}a/`, `${HOOK}b/`, `${HOOK}c/`]);
		expect((await subscribeWith(old.key, 'new_gift', `${HOOK}d/`)).status).toBe(401);
		expect((await visit(deployer)).report.listening).toEqual({
			newGift: 0,
			newDonor: 0,
			giftRefunded: 0
		});
		expect((await subscribeWith(answer.key, 'new_gift', `${HOOK}e/`)).status).toBe(201);
	});

	it('says how many Zaps Zapier did not pause, which still read as on there', async () => {
		const old = await made(await post(deployer, press('zapier-key-make')));
		await subscribeWith(old.key, 'gift_refunded', `${HOOK}a/`);
		hooksAnswer(500);

		const answer = await made(await post(deployer, replacing(await shownKeyId())));

		expect(answer).toMatchObject({ disconnected: 1, paused: 0, notPaused: 1 });
	});

	it('refuses a replace in words where there is no key, and makes none', async () => {
		const answer = await post(deployer, replacing('0195-no-such-key'));

		expect(answer.status).toBe(409);
		expect(await refusal(answer)).toMatch(/no key/);
		expect((await visit(deployer)).report.key).toBeNull();
	});

	it('refuses a second replace pressed on a page still showing the first key, and changes nothing', async () => {
		await made(await post(deployer, press('zapier-key-make')));
		const shown = await shownKeyId();
		const first = await made(await post(deployer, replacing(shown)));

		const second = await post(deployer, replacing(shown));

		expect(second.status).toBe(409);
		expect(await refusal(second)).toMatch(/already replaced/);
		expect((await subscribeWith(first.key, 'new_gift', HOOK)).status).toBe(201);
	});

	it('refuses a replace that names no key as a bad request, before anything is replaced', async () => {
		await made(await post(deployer, press('zapier-key-make')));
		const shown = await shownKeyId();

		expect((await post(deployer, press('zapier-key-replace'))).status).toBe(400);
		expect(await shownKeyId()).toBe(shown);
	});

	it('asks to replace only where there is a key to replace', async () => {
		expect((await visit(deployer, '?confirm=replace')).replacing).toBe(false);

		await makeZapierKey(db);

		expect((await visit(deployer, '?confirm=replace')).replacing).toBe(true);
		expect((await visit(deployer)).replacing).toBe(false);
	});
});

describe('GET /admin/integrations/zapier — how the feed stands', () => {
	it('counts the Zaps listening on each trigger', async () => {
		const key = await made(await post(deployer, press('zapier-key-make')));
		await subscribeWith(key.key, 'new_gift', `${HOOK}a/`);
		await subscribeWith(key.key, 'new_gift', `${HOOK}b/`);
		await subscribeWith(key.key, 'new_donor', `${HOOK}c/`);

		expect((await visit(deployer)).report.listening).toEqual({
			newGift: 2,
			newDonor: 1,
			giftRefunded: 0
		});
	});

	it('says the Zaps are behind once the oldest event still owed has waited over an hour', async () => {
		const key = await made(await post(deployer, press('zapier-key-make')));
		await subscribeWith(key.key, 'new_gift', `${HOOK}a/`);
		await settleGift();

		expect((await visit(deployer)).late).toBe(false);

		await env.DB.prepare('update zapier_delivery set created_at = ?')
			.bind(Date.now() - 61 * 60_000)
			.run();
		const read = await visit(deployer);

		expect(read.late).toBe(true);
		expect(read.report.deliveries.waiting).toBe(1);
	});

	it('counts the deliveries given up on in the past week, and none older', async () => {
		const key = await made(await post(deployer, press('zapier-key-make')));
		await subscribeWith(key.key, 'new_gift', `${HOOK}a/`);
		await subscribeWith(key.key, 'new_gift', `${HOOK}b/`);
		await settleGift();
		// one delivery per hook: the first given up a minute ago, the second eight days ago.
		const giveUp = (hookUrl: string, at: number) =>
			env.DB.prepare(
				`update zapier_delivery set status = 'failed', updated_at = ?
				 where subscription_id = (select id from zapier_subscription where hook_url = ?)`
			)
				.bind(at, hookUrl)
				.run();
		await giveUp(`${HOOK}a/`, Date.now() - 60_000);
		await giveUp(`${HOOK}b/`, Date.now() - 8 * 24 * 60 * 60_000);

		expect((await visit(deployer)).report.deliveries).toMatchObject({ failed: 1, waiting: 0 });
	});
});

describe('a member’s session', () => {
	it('gets not-found for the page', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for each press, and neither press does anything', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await post(member, press('zapier-key-make'))).status).toBe(404);
		expect((await visit(deployer)).report.key).toBeNull();

		const first = await made(await post(deployer, press('zapier-key-make')));
		expect((await post(member, replacing(await shownKeyId()))).status).toBe(404);
		expect((await subscribeWith(first.key, 'new_gift', HOOK)).status).toBe(201);
	});
});
