import { createHash } from 'node:crypto';
import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment } from '../db/schema';
import { makeZapierKey, readZapierKey, replaceZapierKey, verifyZapierKey } from './key';
import { subscribe, unsubscribe } from './subscriptions';

// the deployment's Zapier key, against a real D1: one live key and the hash lookup are the
// database's, so what is stored is read back from `api_key` rather than from the module.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from zapier_delivery').run();
	await env.DB.prepare('delete from zapier_subscription').run();
	await env.DB.prepare('delete from api_key').run();
});

async function storedKeys() {
	const { results } = await env.DB.prepare(
		`select kind, key_hash, prefix, last_four, revoked_at is not null as revoked
		 from api_key order by revoked_at is null, created_at`
	).all<Record<string, unknown>>();
	return results;
}

/** every value `api_key` holds, as text, so a key in any column is caught. */
async function everyStoredValue(): Promise<string[]> {
	const { results } = await env.DB.prepare('select * from api_key').all();
	return results.flatMap((row) => Object.values(row).map(String));
}

/** the digest worked out apart from ./key.ts, so a hash that drifts from its key is caught. */
const sha256Hex = (key: string) => createHash('sha256').update(key).digest('hex');

describe('making the key', () => {
	it('stores the hash of the key it hands over as a zapier key, and the key nowhere', async () => {
		const made = await makeZapierKey(db);
		if (!made.ok) throw new Error('a first make was refused');
		expect(made.key).toMatch(/^bgz_[A-Za-z0-9_-]{43}$/);

		expect(await storedKeys()).toEqual([
			{
				kind: 'zapier',
				key_hash: sha256Hex(made.key),
				prefix: made.key.slice(0, 8),
				last_four: made.key.slice(-4),
				revoked: 0
			}
		]);
		expect((await everyStoredValue()).filter((v) => v.includes(made.key.slice(4)))).toEqual([]);
	});

	it('refuses a second make and keeps the first key working', async () => {
		const first = await makeZapierKey(db);
		if (!first.ok) throw new Error('a first make was refused');

		expect(await makeZapierKey(db)).toEqual({ ok: false, reason: 'key_exists' });
		expect(await verifyZapierKey(db, bearer(first.key))).not.toBeNull();
	});
});

const bearer = (key: string) => `Bearer ${key}`;

describe('checking a presented key', () => {
	it.each([
		['no header', null],
		['another scheme', 'Basic Ymc6eA=='],
		['an empty bearer', 'Bearer '],
		['a value in no key format', 'Bearer hello'],
		['a well-formed key that was never made', bearer(`bgz_${'A'.repeat(43)}`)]
	])('turns away %s', async (_what, header) => {
		await makeZapierKey(db);
		expect(await verifyZapierKey(db, header)).toBeNull();
	});

	it('turns away every key while none is made', async () => {
		expect(await verifyZapierKey(db, bearer(`bgz_${'A'.repeat(43)}`))).toBeNull();
	});

	it('admits a key made before 0017, by the hash that migration carried into api_key', async () => {
		const madeBefore = `bgz_${'C'.repeat(43)}`;
		await env.DB.prepare(
			`insert into api_key (id, name, kind, key_hash, prefix, last_four, created_at)
			 values ('0192f0c4-7d2a-7000-8000-000000000000', 'Zapier', 'zapier', ?, 'bgz_CCCC', 'CCCC', 0)`
		)
			.bind(sha256Hex(madeBefore))
			.run();

		expect(await verifyZapierKey(db, bearer(madeBefore))).toBe(sha256Hex(madeBefore));
	});

	it('reads the scheme in any case', async () => {
		const made = await makeZapierKey(db);
		if (!made.ok) throw new Error('a first make was refused');
		expect(await verifyZapierKey(db, `bearer ${made.key}`)).not.toBeNull();
	});
});

/** a settled gift, and a delivery of it owed to `subscriptionId`. */
async function owe(subscriptionId: string): Promise<void> {
	const [contactId, donationId, paymentId] = [uuidv7(), uuidv7(), uuidv7()];
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
		})
	]);
	await env.DB.prepare(
		`insert into zapier_delivery
		 (subscription_id, event_id, payment_id, status, attempts, next_attempt_at, created_at, updated_at)
		 values (?, ?, ?, 'pending', 0, 0, 0, 0)`
	)
		.bind(subscriptionId, paymentId, paymentId)
		.run();
}

describe('reading the key', () => {
	it('gives the current key\u2019s head, tail and make date, and nothing before one is', async () => {
		expect(await readZapierKey(db)).toBeNull();
		const made = await makeZapierKey(db);
		if (!made.ok) throw new Error('a first make was refused');

		expect(await readZapierKey(db)).toStrictEqual({
			prefix: made.key.slice(0, 8),
			lastFour: made.key.slice(-4),
			madeAt: made.madeAt
		});
	});
});

describe('replacing the key', () => {
	it('turns the old key away and lets the new one in', async () => {
		const old = await makeZapierKey(db);
		if (!old.ok) throw new Error('a first make was refused');

		const replaced = await replaceZapierKey(db, zapier);
		if (!replaced.ok) throw new Error('the replace was refused');

		expect(replaced.key).not.toBe(old.key);
		expect(await verifyZapierKey(db, bearer(old.key))).toBeNull();
		expect(await verifyZapierKey(db, bearer(replaced.key))).not.toBeNull();
	});

	it('revokes the old key\u2019s row beside the new one\u2019s, and stores neither key', async () => {
		const old = await makeZapierKey(db);
		if (!old.ok) throw new Error('a first make was refused');

		const replaced = await replaceZapierKey(db, zapier);
		if (!replaced.ok) throw new Error('the replace was refused');

		expect(await storedKeys()).toEqual([
			expect.objectContaining({ key_hash: sha256Hex(old.key), revoked: 1 }),
			expect.objectContaining({ key_hash: sha256Hex(replaced.key), revoked: 0 })
		]);
		const secrets = [old.key, replaced.key].map((key) => key.slice(4));
		expect((await everyStoredValue()).filter((v) => secrets.some((k) => v.includes(k)))).toEqual(
			[]
		);
		expect(await readZapierKey(db)).toMatchObject({ lastFour: replaced.key.slice(-4) });
	});

	it('ends every open Zap as key_replaced and drops what they were still owed', async () => {
		const keyHash = await currentKeyHash();
		const gifts = await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}a/` }, keyHash);
		const donors = await subscribe(db, { trigger: 'new_donor', hookUrl: `${HOOK}b/` }, keyHash);
		if (gifts === null || donors === null)
			throw new Error('a subscribe under the current key failed');
		await owe(gifts.id);
		await owe(donors.id);

		const replaced = await replaceZapierKey(db, zapier);

		expect(replaced).toMatchObject({ ok: true, disconnected: 2 });
		const { results: ended } = await env.DB.prepare(
			'select ended_reason from zapier_subscription'
		).all<{ ended_reason: string | null }>();
		expect(ended.map((r) => r.ended_reason)).toEqual(['key_replaced', 'key_replaced']);
		const { results: owed } = await env.DB.prepare('select status from zapier_delivery').all<{
			status: string;
		}>();
		expect(owed.map((r) => r.status)).toEqual(['dropped', 'dropped']);
	});

	it('opens no subscription for a request verified under the key it replaced', async () => {
		const verifiedUnder = await currentKeyHash();

		await replaceZapierKey(db, zapier);

		expect(await subscribe(db, { trigger: 'new_gift', hookUrl: HOOK }, verifiedUnder)).toBeNull();
		const open = await env.DB.prepare(
			'select count(*) as open from zapier_subscription where ended_at is null'
		).first<{ open: number }>();
		expect(open?.open).toBe(0);
	});

	it('reports a conflict to the replace another replace overtook, and ends none of its Zaps', async () => {
		await makeZapierKey(db);
		let overtaken = false;
		let madeOnWinner: string | undefined;
		const racing = createDb(
			new Proxy(env.DB, {
				get: (target, property) =>
					property === 'batch'
						? async (statements: D1PreparedStatement[]) => {
								if (!overtaken) {
									overtaken = true;
									const winner = await replaceZapierKey(db, zapier);
									if (!winner.ok) throw new Error('the overtaking replace was refused');
									const keyHash = await verifyZapierKey(db, bearer(winner.key));
									const zap = await subscribe(
										db,
										{ trigger: 'new_gift', hookUrl: HOOK },
										keyHash ?? ''
									);
									madeOnWinner = zap?.id;
								}
								return target.batch(statements);
							}
						: Reflect.get(target, property)
			})
		);

		expect(await replaceZapierKey(racing, zapier)).toEqual({ ok: false, reason: 'conflict' });
		const open = await env.DB.prepare(
			'select id from zapier_subscription where ended_at is null'
		).all<{ id: string }>();
		expect(open.results.map((r) => r.id)).toEqual([madeOnWinner]);
	});

	it('asks Zapier to pause each Zap it ended, once the end has landed', async () => {
		const keyHash = await currentKeyHash();
		await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}a/` }, keyHash);
		await subscribe(db, { trigger: 'new_donor', hookUrl: `${HOOK}b/` }, keyHash);
		const left = await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}c/` }, keyHash);
		if (left === null) throw new Error('a subscribe under the current key failed');
		await unsubscribe(db, left.id);
		const asked: { url: string; method: string; stillOpen: number }[] = [];

		const replaced = await replaceZapierKey(db, async (input, init) => {
			const open = await env.DB.prepare(
				'select count(*) as open from zapier_subscription where ended_at is null'
			).first<{ open: number }>();
			asked.push({
				url: String(input),
				method: init?.method ?? 'GET',
				stillOpen: open?.open ?? -1
			});
			return new Response(null, { status: 200 });
		});

		expect(replaced).toMatchObject({ ok: true, disconnected: 2, paused: 2, notPaused: 0 });
		expect(asked.sort((a, b) => a.url.localeCompare(b.url))).toEqual([
			{ url: `${HOOK}a/`, method: 'DELETE', stillOpen: 0 },
			{ url: `${HOOK}b/`, method: 'DELETE', stillOpen: 0 }
		]);
	});

	it('lands the replace whatever the hooks answer, and counts a fault, a 5xx or silence as not paused', async () => {
		const keyHash = await currentKeyHash();
		for (const hook of ['refuses', 'faults', 'hangs'])
			await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}${hook}/` }, keyHash);

		const replaced = await replaceZapierKey(db, async (input, init) => {
			const url = String(input);
			if (url.endsWith('refuses/')) return new Response('down', { status: 503 });
			if (url.endsWith('faults/')) throw new TypeError('network connection lost');
			return untilAborted(init?.signal);
		});

		if (!replaced.ok) throw new Error('the replace was refused');
		expect(replaced).toMatchObject({ disconnected: 3, paused: 0, notPaused: 3 });
		expect(await verifyZapierKey(db, bearer(replaced.key))).not.toBeNull();
	});

	it.each([404, 410])(
		'counts a hook answering %i as paused: its Zap is already gone',
		async (status) => {
			const keyHash = await currentKeyHash();
			await subscribe(db, { trigger: 'new_gift', hookUrl: HOOK }, keyHash);

			const replaced = await replaceZapierKey(db, async () => new Response(null, { status }));

			expect(replaced).toMatchObject({ ok: true, disconnected: 1, paused: 1, notPaused: 0 });
		}
	);

	it('holds the pauses to six in flight at once', async () => {
		const keyHash = await currentKeyHash();
		for (let hook = 0; hook < 10; hook += 1)
			await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}${hook}/` }, keyHash);
		let inFlight = 0;
		let most = 0;

		const replaced = await replaceZapierKey(db, async () => {
			inFlight += 1;
			most = Math.max(most, inFlight);
			await new Promise((settle) => setTimeout(settle, 20));
			inFlight -= 1;
			return new Response(null, { status: 200 });
		});

		expect(replaced).toMatchObject({ ok: true, paused: 10 });
		expect(most).toBe(6);
	});

	it('answers a replace press within the pause pass, however many hooks stay silent', async () => {
		const keyHash = await currentKeyHash();
		for (let hook = 0; hook < 40; hook += 1)
			await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}${hook}/` }, keyHash);
		const started = Date.now();

		const replaced = await replaceZapierKey(db, async (_, init) => untilAborted(init?.signal));

		// the pass's four seconds (`PAUSE_PASS_MS` in ./subscriptions.ts), and room for the batch.
		expect(Date.now() - started).toBeLessThan(6_000);
		expect(replaced).toMatchObject({ ok: true, disconnected: 40, paused: 0, notPaused: 40 });
	}, 30_000);

	it('refuses while there is no key to replace', async () => {
		expect(await replaceZapierKey(db, zapier)).toEqual({ ok: false, reason: 'no_key' });
		expect(await storedKeys()).toEqual([]);
	});
});

const HOOK = 'https://hooks.zapier.com/hooks/standard/1/2/3/';

/** a hook that never answers: settles only by rejecting once `signal` aborts, as fetch does. */
function untilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
	return new Promise((_, reject) => {
		signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}

/** Zapier taking every pause it is sent. */
const zapier: typeof fetch = async () => new Response(null, { status: 200 });

/** a key made now, as the hash a request presenting it is verified under. */
async function currentKeyHash(): Promise<string> {
	const made = await makeZapierKey(db);
	if (!made.ok) throw new Error('a first make was refused');
	const keyHash = await verifyZapierKey(db, bearer(made.key));
	if (keyHash === null) throw new Error('the key just made did not verify');
	return keyHash;
}
