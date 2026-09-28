import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type ApiKey, type ApiKeyKind, apiKey, type NewApiKey } from '../db/schema';

// the keys a system outside this deployment presents to it: minted here, and looked up here by
// the hash of what a request presents.
//
// **the plaintext key exists only in `mintApiKey`'s and `newApiKeyRow`'s return values.** no
// column holds it (`api_key`'s header in ../db/schema.ts), nothing here logs it, and a caller that
// shows it does so once. a lost key is revoked and a new one minted, never recovered.
//
// the stored hash is plain SHA-256, unsalted and unstretched: the key is 256 bits from a CSPRNG.

/** what a mint answers with. `key` is the plaintext, and nothing gives it again. */
export type MintedApiKey = {
	readonly id: string;
	readonly key: string;
	readonly prefix: string;
	readonly lastFour: string;
	readonly createdAt: Date;
};

/** a new key of `kind`, in that kind's shape, named `name`, stored as its hash. */
export async function mintApiKey(
	db: Db,
	input: { readonly name: string; readonly kind: ApiKeyKind }
): Promise<MintedApiKey> {
	const { key, row } = newApiKeyRow(input);
	const stored = await db
		.insert(apiKey)
		.values(row)
		.returning({ id: apiKey.id, createdAt: apiKey.createdAt })
		.get();
	return {
		id: stored.id,
		key,
		prefix: row.prefix,
		lastFour: row.lastFour,
		createdAt: stored.createdAt
	};
}

/**
 * a new key of `kind` and the row that stores it, unwritten: `mintApiKey`'s, for a caller whose
 * insert must land in a `batch()` of its own. `key` is the plaintext, the one place it exists.
 */
export function newApiKeyRow(input: { readonly name: string; readonly kind: ApiKeyKind }): {
	readonly key: string;
	readonly row: NewApiKey;
} {
	const key = NEW_KEY[input.kind]();
	return {
		key,
		row: {
			name: input.name,
			kind: input.kind,
			keyHash: hashOf(key),
			prefix: key.slice(0, 8),
			lastFour: key.slice(-4)
		}
	};
}

/**
 * the row `presented` was minted as, or `null` when no key hashes to it. a revoked key is still
 * found, with `revokedAt` set, so the caller can say it was revoked and when; admitting it is the
 * caller's refusal to make.
 *
 * looking up by the hash of the presented value leaks nothing about any stored key.
 */
export async function findKeyByPresented(db: Db, presented: string): Promise<ApiKey | null> {
	const [row] = await db
		.select()
		.from(apiKey)
		.where(eq(apiKey.keyHash, hashOf(presented)));
	return row ?? null;
}

/**
 * stops the `api` key `id` admitting anything, and answers when; `null` when there is no such key
 * or it was already revoked, whose first revocation time stands — it is the one a refusal names.
 *
 * a `zapier` key is `null` here too: it is revoked only by `replaceZapierKey` in ../zapier/key.ts,
 * in the batch that ends every Zap subscribed on it.
 */
export async function revokeApiKey(db: Db, id: string): Promise<Date | null> {
	const [row] = await db
		.update(apiKey)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKey.id, id), eq(apiKey.kind, 'api'), isNull(apiKey.revokedAt)))
		.returning({ revokedAt: apiKey.revokedAt });
	return row?.revokedAt ?? null;
}

/**
 * revokes the `api` key `id` and archives it, in one statement, so a key leaves the list only as
 * a key that admits nothing (`api_key_archived_revoked_check`). an earlier revocation time stands.
 * `false` when no listed `api` key has that id — Zapier's included, which no list shows.
 */
export async function revokeAndArchiveApiKey(db: Db, id: string): Promise<boolean> {
	const now = new Date();
	const rows = await db
		.update(apiKey)
		.set({ revokedAt: sql`coalesce(${apiKey.revokedAt}, ${now.getTime()})`, archivedAt: now })
		.where(and(eq(apiKey.id, id), eq(apiKey.kind, 'api'), isNull(apiKey.archivedAt)))
		.returning({ id: apiKey.id });
	return rows.length > 0;
}

/**
 * the name of the `api` key `id` once `revokeAndArchiveApiKey` has taken it off the list, for the
 * screen that reports the revoke; `null` for a key still listed or none at all.
 */
export async function revokedApiKeyName(db: Db, id: string): Promise<string | null> {
	const [row] = await db
		.select({ name: apiKey.name })
		.from(apiKey)
		.where(and(eq(apiKey.id, id), eq(apiKey.kind, 'api'), isNotNull(apiKey.archivedAt)));
	return row?.name ?? null;
}

/** a key as the dashboard lists it: what it is called and when, and nothing that admits a request. */
export type ListedApiKey = {
	readonly id: string;
	readonly name: string;
	readonly createdAt: Date;
	readonly lastUsedAt: Date | null;
};

/**
 * every `api` key not archived, newest first. Zapier's key is kept off this list, as `api_key`'s
 * header in ../db/schema.ts says; ids break a tie in one millisecond because they are uuidv7.
 */
export async function listApiKeys(db: Db): Promise<ListedApiKey[]> {
	return db
		.select({
			id: apiKey.id,
			name: apiKey.name,
			createdAt: apiKey.createdAt,
			lastUsedAt: apiKey.lastUsedAt
		})
		.from(apiKey)
		.where(and(eq(apiKey.kind, 'api'), isNull(apiKey.archivedAt)))
		.orderBy(desc(apiKey.createdAt), desc(apiKey.id));
}

/** how coarse `last_used_at` is: a use within this long of the recorded one writes nothing. */
const LAST_USED_WINDOW_MS = 60_000;

/**
 * records that `key` was used at `now`, at most once a minute per key, and never rejects.
 *
 * `key` is the row as the request's own lookup read it, so a key used within the minute costs no
 * statement at all — the read already happened, and nothing is read again to decide. a stale read
 * issues one UPDATE guarded on the same condition, so requests racing through one minute on one
 * key land one write between them, whatever their reads said.
 *
 * a failed write is logged by the key's row id and dropped: the column is a hint on a screen, and
 * a request already answered has nobody to refuse.
 */
export async function touchLastUsed(db: Db, key: ApiKey, now = new Date()): Promise<void> {
	const staleBefore = new Date(now.getTime() - LAST_USED_WINDOW_MS);
	if (key.lastUsedAt !== null && key.lastUsedAt >= staleBefore) return;
	try {
		await db
			.update(apiKey)
			.set({ lastUsedAt: now })
			.where(
				and(
					eq(apiKey.id, key.id),
					or(isNull(apiKey.lastUsedAt), lt(apiKey.lastUsedAt, staleBefore))
				)
			);
	} catch (e) {
		console.error(`recording when API key ${key.id} was last used failed:`, e);
	}
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 62^43 exceeds 2^256, so 43 characters hold any 32 bytes. */
const SECRET_LENGTH = 43;

/** every `api` key `mintApiKey` makes, and nothing else: `bgk_` and 43 base62 characters. */
export const API_KEY_SHAPE = /^bgk_[0-9A-Za-z]{43}$/;

/**
 * every `zapier` key, and nothing else: `bgz_` and 43 base64url characters, the value
 * packages/zapier's authentication presents as its bearer.
 */
export const ZAPIER_KEY_SHAPE = /^bgz_[A-Za-z0-9_-]{43}$/;

const NEW_KEY: Record<ApiKeyKind, () => string> = { api: newApiKey, zapier: newZapierKey };

/**
 * `bgk_` and 32 random bytes in base62, left-padded to a fixed 43 characters: 256 bits, a prefix a
 * secret scanner can find, and no `_` or `-` in the secret for a split or a double-click to break
 * on.
 */
function newApiKey(): string {
	let n = BigInt(`0x${randomBytes(32).toString('hex')}`);
	let secret = '';
	for (let i = 0; i < SECRET_LENGTH; i++) {
		secret = BASE62[Number(n % 62n)] + secret;
		n /= 62n;
	}
	return `bgk_${secret}`;
}

/** `bgz_` and 32 random bytes as unpadded base64url: 256 bits in 43 characters. */
function newZapierKey(): string {
	return `bgz_${randomBytes(32).toString('base64url')}`;
}

/** the lowercase hex SHA-256 of the whole key string, as `api_key.key_hash` holds it. */
function hashOf(key: string): string {
	return createHash('sha256').update(key, 'utf8').digest('hex');
}
