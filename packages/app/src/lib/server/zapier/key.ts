import { createHash, randomBytes } from 'node:crypto';
import { and, eq, exists } from 'drizzle-orm';
import type { Db } from '../db/client';
import { zapierKey } from '../db/schema';
import { secretEquals } from '../secret-compare';
import { endSubscriptionStatements } from './subscriptions';

// the one key Zapier presents on every call it makes to this deployment: made and replaced from
// the console, checked on every `/zapier` request.
//
// the row holds the key, so the console can show it on every visit, and its SHA-256, which is
// what a request is admitted by — never the stored key (`zapier_key`'s header in ../db/schema.ts).
// it is the carve-out CLAUDE.md names as a key the app mints for itself.

const KEY_ID = 'zapier';

/** what a made key answers with. `key` is the plaintext, the same one `readZapierKey` gives after. */
export type MadeZapierKey = { readonly ok: true; readonly key: string; readonly madeAt: Date };

/** a make refused because a key already exists: only `replace` cuts one. */
export type ZapierKeyExists = { readonly ok: false; readonly reason: 'key_exists' };

/** what a replace answers with: the new key, and how many Zaps the old one took down with it. */
export type ReplacedZapierKey = MadeZapierKey & { readonly disconnected: number };

/**
 * a replace refused: `no_key` when there is none yet (`make` starts one), `conflict` when another
 * replace landed first — the key this one would have answered with never worked.
 */
export type ZapierKeyNotReplaced = { readonly ok: false; readonly reason: 'no_key' | 'conflict' };

/**
 * the current key and when it was made, or `null` before one is. a row with no stored key reads
 * as none (`zapierKey.key` in ../db/schema.ts).
 */
export async function readZapierKey(
	db: Db
): Promise<{ readonly madeAt: Date; readonly key: string } | null> {
	const [row] = await db
		.select({ madeAt: zapierKey.createdAt, key: zapierKey.key })
		.from(zapierKey)
		.where(eq(zapierKey.id, KEY_ID));
	return row?.key == null ? null : { madeAt: row.madeAt, key: row.key };
}

async function currentKey(db: Db) {
	const [row] = await db
		.select({ keyHash: zapierKey.keyHash })
		.from(zapierKey)
		.where(eq(zapierKey.id, KEY_ID));
	return row;
}

/**
 * a new key, when there is none. a key already made is refused rather than overwritten, so two
 * consoles pressing make at once cannot disconnect each other's Zaps — the insert's conflict on
 * the singleton id is what decides it.
 */
export async function makeZapierKey(db: Db): Promise<MadeZapierKey | ZapierKeyExists> {
	const key = newKey();
	const [row] = await db
		.insert(zapierKey)
		.values({ id: KEY_ID, key, keyHash: hashOf(key) })
		.onConflictDoNothing()
		.returning({ madeAt: zapierKey.createdAt });
	if (row === undefined) return { ok: false, reason: 'key_exists' };
	return { ok: true, key, madeAt: row.madeAt };
}

/**
 * a new key in place of the current one, which stops working in the same batch.
 *
 * **every open subscription ends with it, as `key_replaced`, and what they were owed is dropped.**
 * a REST hook receives events without presenting the key, so a replace that only cut the auth
 * would leave every Zap on the old key still receiving gifts. `disconnected` is how many ended.
 *
 * the write is conditional on the hash read here, and the ends on that write having landed: of
 * two replaces racing, the second changes nothing — it ends no Zap made on the first's key — and
 * answers `conflict`. `created_at` moves with the key, so it stays the current key's make date.
 */
export async function replaceZapierKey(db: Db): Promise<ReplacedZapierKey | ZapierKeyNotReplaced> {
	const current = await currentKey(db);
	if (current === undefined) return { ok: false, reason: 'no_key' };
	const key = newKey();
	const keyHash = hashOf(key);
	const now = new Date();
	const landed = exists(
		db.select({ id: zapierKey.id }).from(zapierKey).where(eq(zapierKey.keyHash, keyHash))
	);
	// `ended` is the subscriptions' update, the second of the pair
	const [written, , ended] = await db.batch([
		db
			.update(zapierKey)
			.set({ key, keyHash, createdAt: now, updatedAt: now })
			.where(and(eq(zapierKey.id, KEY_ID), eq(zapierKey.keyHash, current.keyHash)))
			.returning({ madeAt: zapierKey.createdAt }),
		...endSubscriptionStatements(db, 'every_open', 'key_replaced', now, landed)
	]);
	const [row] = written;
	if (row === undefined) return { ok: false, reason: 'conflict' };
	return { ok: true, key, madeAt: row.madeAt, disconnected: ended.meta.changes };
}

/**
 * the hash of this deployment's key when `authorization` — the request's `Authorization` header,
 * or `null` for none — carries that key as a bearer value, and `null` otherwise. every way of
 * being wrong is the same `null`: the caller is told nothing about which.
 *
 * the hash goes down to a write that must only land while the key is still current
 * (`subscribe` in ./subscriptions.ts). a value in no key format is turned away before the read,
 * which tells a caller only the format the key is published in. the compare is
 * ../secret-compare.ts's, over the two hex digests.
 */
export async function verifyZapierKey(
	db: Db,
	authorization: string | null
): Promise<string | null> {
	const presented = authorization?.trim().match(BEARER_KEY)?.[1];
	if (presented === undefined) return null;
	const current = await currentKey(db);
	return current !== undefined && secretEquals(hashOf(presented), current.keyHash)
		? current.keyHash
		: null;
}

/** `i` for the scheme (case-insensitive, RFC 9110 §11.1); a key in the wrong case fails the hash. */
const BEARER_KEY = /^bearer +(bgz_[\w-]{43})$/i;

/** `bgz_` and 32 random bytes as base64url: 256 bits, and a prefix a secret scanner can find. */
function newKey(): string {
	return `bgz_${randomBytes(32).toString('base64url')}`;
}

/** the lowercase hex SHA-256 of the whole key string, as `zapier_key.key_hash` holds it. */
function hashOf(key: string): string {
	return createHash('sha256').update(key, 'utf8').digest('hex');
}
