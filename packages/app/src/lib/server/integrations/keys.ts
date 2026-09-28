import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type ApiKey, type ApiKeyKind, apiKey } from '../db/schema';
import { secretEquals } from '../secret-compare';

// the keys a system outside this deployment presents to it: minted here, and looked up here by
// the hash of what a request presents.
//
// **the plaintext key exists only in `mintApiKey`'s return value.** no column holds it
// (`api_key`'s header in ../db/schema.ts), nothing here logs it, and a caller that shows it does so
// once. a lost key is revoked and a new one minted, never recovered.
//
// the stored hash is plain SHA-256, unsalted and unstretched, because the key is 256 random bits:
// a salt defends a guessable secret against a precomputed table and a stretch against a search of
// a small space, and a key drawn from 2^256 is neither. a slow hash here would only turn a burst
// of requests into CPU spent on every one.

/** what a mint answers with. `key` is the plaintext, and nothing gives it again. */
export type MintedApiKey = {
	readonly id: string;
	readonly key: string;
	readonly prefix: string;
	readonly lastFour: string;
	readonly createdAt: Date;
};

/** a new key of `kind`, named `name`, stored as its hash. */
export async function mintApiKey(
	db: Db,
	input: { readonly name: string; readonly kind: ApiKeyKind }
): Promise<MintedApiKey> {
	const key = newKey();
	const prefix = key.slice(0, 8);
	const lastFour = key.slice(-4);
	const row = await db
		.insert(apiKey)
		.values({ name: input.name, kind: input.kind, keyHash: hashOf(key), prefix, lastFour })
		.returning({ id: apiKey.id, createdAt: apiKey.createdAt })
		.get();
	return { id: row.id, key, prefix, lastFour, createdAt: row.createdAt };
}

/**
 * the row `presented` was minted as, or `null` when no key hashes to it. a revoked key is still
 * found, with `revokedAt` set, so the caller can say it was revoked and when; admitting it is the
 * caller's refusal to make.
 *
 * the read is by the hash's unique index, and the hash it finds is compared again through
 * ../secret-compare.ts, the repository's one constant-time compare.
 */
export async function findKeyByPresented(db: Db, presented: string): Promise<ApiKey | null> {
	const presentedHash = hashOf(presented);
	const [row] = await db.select().from(apiKey).where(eq(apiKey.keyHash, presentedHash));
	return row !== undefined && secretEquals(presentedHash, row.keyHash) ? row : null;
}

/**
 * stops the key `id` admitting anything, and answers when; `null` when there is no such key or it
 * was already revoked, whose first revocation time stands — it is the one a refusal names.
 */
export async function revokeApiKey(db: Db, id: string): Promise<Date | null> {
	const [row] = await db
		.update(apiKey)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKey.id, id), isNull(apiKey.revokedAt)))
		.returning({ revokedAt: apiKey.revokedAt });
	return row?.revokedAt ?? null;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 62^43 exceeds 2^256, so 43 characters hold any 32 bytes. */
const SECRET_LENGTH = 43;

/**
 * `bgk_` and 32 random bytes in base62, left-padded to a fixed 43 characters: 256 bits, a prefix a
 * secret scanner can find, and no `_` or `-` in the secret for a split or a double-click to break
 * on.
 */
function newKey(): string {
	let n = BigInt(`0x${randomBytes(32).toString('hex')}`);
	let secret = '';
	for (let i = 0; i < SECRET_LENGTH; i++) {
		secret = BASE62[Number(n % 62n)] + secret;
		n /= 62n;
	}
	return `bgk_${secret}`;
}

/** the lowercase hex SHA-256 of the whole key string, as `api_key.key_hash` holds it. */
function hashOf(key: string): string {
	return createHash('sha256').update(key, 'utf8').digest('hex');
}
