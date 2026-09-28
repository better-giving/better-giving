import { createHash } from 'node:crypto';
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { API_KEY_SHAPE, findKeyByPresented, mintApiKey, revokeApiKey } from './keys';

// the integration keys against a real D1: what is stored is read back from the table rather than
// from the module, so a key that reached a column is caught however it got there.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from api_key').run();
});

/** the digest worked out apart from ./keys.ts, so a hash that drifts from its key is caught. */
const sha256Hex = (key: string) => createHash('sha256').update(key).digest('hex');

async function storedRows() {
	const { results } = await env.DB.prepare('select * from api_key').all<Record<string, unknown>>();
	return results;
}

describe('minting a key', () => {
	it('stores the hash of the key it hands over, and the key nowhere', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		expect(minted.key).toMatch(/^bgk_[0-9A-Za-z]{43}$/);

		const rows = await storedRows();
		expect(rows).toHaveLength(1);
		const [row] = rows;
		if (row === undefined) throw new Error('the mint stored no row');
		expect(row).toMatchObject({
			id: minted.id,
			name: 'CRM sync',
			kind: 'api',
			key_hash: sha256Hex(minted.key),
			prefix: minted.key.slice(0, 8),
			last_four: minted.key.slice(-4),
			created_at: minted.createdAt.getTime(),
			last_used_at: null,
			revoked_at: null
		});
		// the whole key, or its secret half, in any column is the leak this test exists for
		const secret = minted.key.slice(4);
		for (const value of Object.values(row)) {
			expect(String(value)).not.toContain(secret);
		}
	});
});

describe('finding the key a request presents', () => {
	it('finds the row a minted key was stored as', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		await mintApiKey(db, { name: 'warehouse', kind: 'api' });

		const found = await findKeyByPresented(db, minted.key);
		expect(found).toMatchObject({ id: minted.id, name: 'CRM sync', kind: 'api', revokedAt: null });
	});

	it('finds nothing for a key that was never minted', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const lastSwapped = `${minted.key.slice(0, -1)}${minted.key.endsWith('A') ? 'B' : 'A'}`;

		expect(await findKeyByPresented(db, lastSwapped)).toBeNull();
		expect(await findKeyByPresented(db, `bgk_${'A'.repeat(43)}`)).toBeNull();
		expect(await findKeyByPresented(db, '')).toBeNull();
	});
});

describe('revoking a key', () => {
	it('still finds a revoked key, with when it was revoked', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });

		const revokedAt = await revokeApiKey(db, minted.id);
		expect(revokedAt).toBeInstanceOf(Date);

		expect(await findKeyByPresented(db, minted.key)).toMatchObject({ id: minted.id, revokedAt });
	});

	it('keeps the first revocation time when revoked again', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const first = await revokeApiKey(db, minted.id);

		expect(await revokeApiKey(db, minted.id)).toBeNull();
		expect((await findKeyByPresented(db, minted.key))?.revokedAt).toEqual(first);
	});

	it('revokes no other key', async () => {
		const revoked = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const kept = await mintApiKey(db, { name: 'warehouse', kind: 'api' });
		await revokeApiKey(db, revoked.id);

		expect((await findKeyByPresented(db, kept.key))?.revokedAt).toBeNull();
	});
});

describe("the key's shape", () => {
	it('matches a minted key', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		expect(minted.key).toMatch(API_KEY_SHAPE);
	});

	it.each([
		['one character short', `bgk_${'A'.repeat(42)}`],
		['one character long', `bgk_${'A'.repeat(44)}`],
		['a base64url character in the secret', `bgk_${'A'.repeat(42)}-`],
		['the prefix in capitals', `BGK_${'A'.repeat(43)}`],
		['a key inside a longer value', ` bgk_${'A'.repeat(43)}`]
	])('refuses %s', (_what, value) => {
		expect(value).not.toMatch(API_KEY_SHAPE);
	});
});
