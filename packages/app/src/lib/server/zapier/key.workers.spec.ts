import { createHash } from 'node:crypto';
import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment } from '../db/schema';
import { makeZapierKey, readZapierKey, replaceZapierKey, verifyZapierKey } from './key';
import { subscribe } from './subscriptions';

// the deployment's Zapier key, against a real D1: the singleton and hash checks are the
// database's, so what is stored is read back from the table rather than from the module.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from zapier_delivery').run();
	await env.DB.prepare('delete from zapier_subscription').run();
	await env.DB.prepare('delete from zapier_key').run();
});

async function storedKeys() {
	const { results } = await env.DB.prepare('select key, key_hash from zapier_key').all<{
		key: string | null;
		key_hash: string;
	}>();
	return results;
}

/** the digest worked out apart from ./key.ts, so a hash that drifts from its key is caught. */
const sha256Hex = (key: string) => createHash('sha256').update(key).digest('hex');

async function storedRows() {
	const { results } = await env.DB.prepare('select * from zapier_key').all<
		Record<string, unknown>
	>();
	return results;
}

describe('making the key', () => {
	it('stores the key it hands over beside the hash a request is checked against', async () => {
		const made = await makeZapierKey(db);
		if (!made.ok) throw new Error('a first make was refused');
		expect(made.key).toMatch(/^bgz_[A-Za-z0-9_-]{43}$/);

		expect(await storedKeys()).toEqual([{ key: made.key, key_hash: sha256Hex(made.key) }]);
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
	it('gives the current key and when it was made, and nothing before one is', async () => {
		expect(await readZapierKey(db)).toBeNull();
		const made = await makeZapierKey(db);
		if (!made.ok) throw new Error('a first make was refused');
		expect(await readZapierKey(db)).toEqual({ madeAt: made.madeAt, key: made.key });
	});

	it('gives no key for a row made before the key was stored, which still admits its key', async () => {
		const unstored = `bgz_${'B'.repeat(43)}`;
		await env.DB.prepare(
			`insert into zapier_key (id, key_hash, created_at, updated_at) values ('zapier', ?, 0, 0)`
		)
			.bind(sha256Hex(unstored))
			.run();

		expect(await readZapierKey(db)).toEqual({ madeAt: new Date(0), key: null });
		expect(await verifyZapierKey(db, bearer(unstored))).toBe(sha256Hex(unstored));
	});
});

describe('replacing the key', () => {
	it('turns the old key away and lets the new one in', async () => {
		const old = await makeZapierKey(db);
		if (!old.ok) throw new Error('a first make was refused');

		const replaced = await replaceZapierKey(db);
		if (!replaced.ok) throw new Error('the replace was refused');

		expect(replaced.key).not.toBe(old.key);
		expect(await verifyZapierKey(db, bearer(old.key))).toBeNull();
		expect(await verifyZapierKey(db, bearer(replaced.key))).not.toBeNull();
		expect(await storedRows()).toHaveLength(1);
	});

	it('stores the new key and its hash in place of the old pair', async () => {
		await makeZapierKey(db);

		const replaced = await replaceZapierKey(db);
		if (!replaced.ok) throw new Error('the replace was refused');

		expect(await storedKeys()).toEqual([{ key: replaced.key, key_hash: sha256Hex(replaced.key) }]);
	});

	it('ends every open Zap as key_replaced and drops what they were still owed', async () => {
		const keyHash = await currentKeyHash();
		const gifts = await subscribe(db, { trigger: 'new_gift', hookUrl: `${HOOK}a/` }, keyHash);
		const donors = await subscribe(db, { trigger: 'new_donor', hookUrl: `${HOOK}b/` }, keyHash);
		if (gifts === null || donors === null)
			throw new Error('a subscribe under the current key failed');
		await owe(gifts.id);
		await owe(donors.id);

		const replaced = await replaceZapierKey(db);

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

		await replaceZapierKey(db);

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
									const winner = await replaceZapierKey(db);
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

		expect(await replaceZapierKey(racing)).toEqual({ ok: false, reason: 'conflict' });
		const open = await env.DB.prepare(
			'select id from zapier_subscription where ended_at is null'
		).all<{ id: string }>();
		expect(open.results.map((r) => r.id)).toEqual([madeOnWinner]);
	});

	it('refuses while there is no key to replace', async () => {
		expect(await replaceZapierKey(db)).toEqual({ ok: false, reason: 'no_key' });
		expect(await storedRows()).toHaveLength(0);
	});
});

const HOOK = 'https://hooks.zapier.com/hooks/standard/1/2/3/';

/** a key made now, as the hash a request presenting it is verified under. */
async function currentKeyHash(): Promise<string> {
	const made = await makeZapierKey(db);
	if (!made.ok) throw new Error('a first make was refused');
	const keyHash = await verifyZapierKey(db, bearer(made.key));
	if (keyHash === null) throw new Error('the key just made did not verify');
	return keyHash;
}
