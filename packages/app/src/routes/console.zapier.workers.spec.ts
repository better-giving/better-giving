import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONSOLE_SESSION_SECONDS,
	CONSOLE_TOKEN_MIN_RANDOM,
	formatConsoleToken
} from '@better-giving/operator/console/token';
import type { ZapierPressReport, ZapierReport } from '@better-giving/operator/console/zapier';
import { createDb, type Db } from '$lib/server/db/client';
import { contact, donation, payment, type ZapierTrigger } from '$lib/server/db/schema';
import { zapierStatements } from '$lib/server/zapier/events';
import { verifyZapierKey } from '$lib/server/zapier/key';
import { subscribe } from '$lib/server/zapier/subscriptions';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as zapier from './console.zapier';
import * as surface from './console';

// the console's Zapier address, against a real D1.
//
// mounted through the surface's own layout rather than handed to a handler, which is what puts
// the credential check in front of it: ../route-request.testing.ts states why.

const OWN = 'https://give.example.workers.dev';

const EXPIRES_AT = new Date(
	Math.floor((Date.now() + CONSOLE_SESSION_SECONDS * 1000) / 1000) * 1000
);
const TOKEN = formatConsoleToken(EXPIRES_AT, 'z'.repeat(CONSOLE_TOKEN_MIN_RANDOM));

const routes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'zapier', module: zapier }
]);

const deployment = new Proxy(env, {
	get: (target, property) => (property === 'CONSOLE_TOKEN' ? TOKEN : Reflect.get(target, property))
}) as Env;

const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

const read = (): Promise<Response> =>
	routes(new Request(`${OWN}/console/zapier`, { headers }), { env: deployment });

const press = (body: unknown): Promise<Response> =>
	routes(
		new Request(`${OWN}/console/zapier`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		}),
		{ env: deployment }
	);

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	// the deliveries before the subscriptions they point at.
	for (const table of ['zapier_delivery', 'zapier_subscription', 'zapier_key']) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

let hooks = 0;

/** an open subscription to `trigger` on a hook of its own, made under `key` as Zapier would. */
async function listen(trigger: ZapierTrigger, key: string): Promise<void> {
	hooks += 1;
	const keyHash = await verifyZapierKey(db, `Bearer ${key}`);
	if (keyHash === null) throw new Error('the key does not verify');
	const hookUrl = `https://hooks.zapier.com/hooks/standard/1/${hooks}/`;
	if ((await subscribe(db, { trigger, hookUrl }, keyHash)) === null)
		throw new Error('the subscribe was refused under the current key');
}

/** a first gift from a new donor, settled with its fan-out the way every caller commits one. */
async function settle(): Promise<void> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
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

async function made(): Promise<string> {
	const report = (await (await press({ press: 'make' })).json()) as ZapierPressReport;
	if (!report.ok) throw new Error(`make refused: ${report.detail}`);
	return report.key;
}

describe('GET /console/zapier', () => {
	it('says no key is made and nothing is listening', async () => {
		const response = await read();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()) as ZapierReport).toEqual({
			key: null,
			listening: { newGift: 0, newDonor: 0 },
			deliveries: { waiting: 0, failed: 0, oldestWaitingAt: null }
		});
	});

	it('counts the Zaps listening to each trigger and the events still owed to them', async () => {
		const key = await made();
		await listen('new_gift', key);
		await listen('new_gift', key);
		await listen('new_donor', key);
		const before = Date.now();
		await settle();

		const report = (await (await read()).json()) as ZapierReport;

		expect(report.listening).toEqual({ newGift: 2, newDonor: 1 });
		expect(report.deliveries).toMatchObject({ waiting: 3, failed: 0 });
		expect(Date.parse(report.deliveries.oldestWaitingAt ?? '')).toBeGreaterThanOrEqual(
			before - 1000
		);
	});
});

describe('the make press', () => {
	it('answers the key, and the reading after it carries the same key', async () => {
		const response = await press({ press: 'make' });

		expect(response.status).toBe(200);
		const made = (await response.json()) as ZapierPressReport;
		if (!made.ok) throw new Error(`make refused: ${made.detail}`);
		expect(made).toMatchObject({ press: 'make', disconnected: 0, paused: 0, notPaused: 0 });
		expect(made.key.length).toBeGreaterThan(0);

		const reading = (await (await read()).json()) as ZapierReport;
		expect(reading.key).toEqual({ madeAt: made.madeAt, key: made.key });
	});

	it('refuses a second make, and names replace as the press that cuts a new key', async () => {
		await press({ press: 'make' });
		const response = await press({ press: 'make' });

		expect(response.status).toBe(200);
		const refused = (await response.json()) as ZapierPressReport;
		expect(refused).toMatchObject({ ok: false, press: 'make' });
		if (refused.ok) throw new Error('second make landed');
		expect(refused.detail).toContain('Replace key');
	});
});

describe('the replace press', () => {
	// ../../vitest.workers.config.ts sets `unstubGlobals`, so this Zapier is taken back after each case.
	let zapierAnswers: () => Response;
	beforeEach(() => {
		zapierAnswers = () => new Response(null, { status: 200 });
		vi.stubGlobal('fetch', async () => zapierAnswers());
	});

	it('refuses where no key is made, and names the create press', async () => {
		const response = await press({ press: 'replace' });

		expect(response.status).toBe(200);
		const refused = (await response.json()) as ZapierPressReport;
		expect(refused).toMatchObject({ ok: false, press: 'replace' });
		if (refused.ok) throw new Error('replace landed with no key');
		expect(refused.detail).toBe(
			'This deployment has no Zapier key to replace. Press Create key to make the first one.'
		);
	});

	it('answers a new key, the old one stops verifying, and every Zap on it is disconnected', async () => {
		const old = await made();
		await listen('new_gift', old);
		await listen('new_donor', old);

		const response = await press({ press: 'replace' });

		expect(response.status).toBe(200);
		const replaced = (await response.json()) as ZapierPressReport;
		if (!replaced.ok) throw new Error(`replace refused: ${replaced.detail}`);
		expect(replaced).toMatchObject({ press: 'replace', disconnected: 2 });
		expect(replaced.key).not.toBe(old);
		expect(await verifyZapierKey(db, `Bearer ${old}`)).toBeNull();
		expect(await verifyZapierKey(db, `Bearer ${replaced.key}`)).not.toBeNull();

		const reading = (await (await read()).json()) as ZapierReport;
		expect(reading).toMatchObject({
			key: { madeAt: replaced.madeAt, key: replaced.key },
			listening: { newGift: 0, newDonor: 0 }
		});
	});

	it('answers how many of the disconnected Zaps Zapier paused, and how many it did not', async () => {
		const old = await made();
		await listen('new_gift', old);
		await listen('new_gift', old);
		await listen('new_donor', old);
		let refused = false;
		zapierAnswers = () => {
			if (refused) return new Response(null, { status: 200 });
			refused = true;
			return new Response('unavailable', { status: 503 });
		};

		const replaced = (await (await press({ press: 'replace' })).json()) as ZapierPressReport;

		expect(replaced).toMatchObject({ ok: true, disconnected: 3, paused: 2, notPaused: 1 });
	});
});

describe('two replaces racing', () => {
	/** a D1 whose next batch runs after another console's replace has already moved the hash. */
	function racedBy(otherHash: string): Env {
		const DB = new Proxy(env.DB, {
			get(target, property) {
				if (property === 'batch')
					return async (statements: D1PreparedStatement[]) => {
						await target.prepare('update zapier_key set key_hash = ?').bind(otherHash).run();
						return target.batch(statements);
					};
				const value = Reflect.get(target, property);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
		return new Proxy(deployment, {
			get: (target, property) => (property === 'DB' ? DB : Reflect.get(target, property))
		}) as Env;
	}

	it('refuses the replace that lost, ends no Zap, and says to read the section again', async () => {
		const key = await made();
		await listen('new_gift', key);

		const response = await routes(
			new Request(`${OWN}/console/zapier`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ press: 'replace' })
			}),
			{ env: racedBy('b'.repeat(64)) }
		);

		expect(response.status).toBe(200);
		const refused = (await response.json()) as ZapierPressReport;
		expect(refused).toMatchObject({ ok: false, press: 'replace' });
		if (refused.ok) throw new Error('the losing replace landed');
		expect(refused.detail).toContain('Another console');
		expect(((await (await read()).json()) as ZapierReport).listening.newGift).toBe(1);
	});
});

describe('a request this address does not take', () => {
	it('refuses a body naming no press this address takes', async () => {
		const response = await press({ press: 'revoke' });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: 'bad_body' });
	});

	it('refuses a caller holding no console credential, and makes no key', async () => {
		const response = await routes(
			new Request(`${OWN}/console/zapier`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ press: 'make' })
			}),
			{ env: deployment }
		);

		expect(response.status).toBe(401);
		expect(((await (await read()).json()) as ZapierReport).key).toBeNull();
	});

	it.each([
		['no credential', {}],
		[
			'a wrong bearer',
			{
				authorization: `Bearer ${formatConsoleToken(EXPIRES_AT, 'y'.repeat(CONSOLE_TOKEN_MIN_RANDOM))}`
			}
		]
	])('refuses a reading under %s, and its body carries no key', async (_, credential) => {
		const key = await made();

		const response = await routes(new Request(`${OWN}/console/zapier`, { headers: credential }), {
			env: deployment
		});

		expect(response.status).toBe(401);
		expect(await response.text()).not.toContain(key);
	});
});
