import { and, eq, exists, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { apiKey } from '../db/schema';
import {
	findKeyByPresented,
	mintApiKey,
	newApiKeyRow,
	ZAPIER_KEY_SHAPE
} from '../integrations/keys';
import { endSubscriptionStatements, type PauseOutcome, pauseZaps } from './subscriptions';

// the one key Zapier presents on every call it makes to this deployment: made and replaced from
// the dashboard's Zapier page, under Integrations, and checked on every `/zapier` request.
//
// the key is a `zapier` row of `api_key`, minted and hashed by ../integrations/keys.ts, whose
// header holds for it too: the plaintext exists only in what make and replace answer with, and a
// page shows its head and tail (`readZapierKey`). the read API refuses it (`admitKey` in
// ../integrations/surface.ts) and `verifyZapierKey` refuses every other kind, so a key is good
// only on the surface it was made for. it is the carve-out CLAUDE.md names as a key the app mints
// for itself.

const ZAPIER_KEY = { name: 'Zapier', kind: 'zapier' } as const;

/** what a made key answers with. `key` is the plaintext, and nothing gives it again. */
export type MadeZapierKey = { readonly ok: true; readonly key: string; readonly madeAt: Date };

/** a make refused because a key already exists: only `replace` cuts one. */
export type ZapierKeyExists = { readonly ok: false; readonly reason: 'key_exists' };

/**
 * what a replace answers with: the new key, how many Zaps the old one took down with it, and how
 * many of those Zapier paused and how many it did not ({@link PauseOutcome}).
 */
export type ReplacedZapierKey = MadeZapierKey & { readonly disconnected: number } & PauseOutcome;

/**
 * a replace refused: `no_key` when there is none yet (`make` starts one), `conflict` when another
 * replace landed first — the key this one would have answered with never worked.
 */
export type ZapierKeyNotReplaced = { readonly ok: false; readonly reason: 'no_key' | 'conflict' };

/** what a page may show of a key: its head and tail, never the key. */
export type ZapierKeyShown = {
	readonly prefix: string;
	readonly lastFour: string;
	readonly madeAt: Date;
};

/** the current key as a page may show it, or `null` before one is made. */
export async function readZapierKey(db: Db): Promise<ZapierKeyShown | null> {
	const [row] = await db
		.select({ prefix: apiKey.prefix, lastFour: apiKey.lastFour, madeAt: apiKey.createdAt })
		.from(apiKey)
		.where(CURRENT);
	return row ?? null;
}

/** the one un-revoked `zapier` row, which `api_key_one_zapier_idx` (../db/schema.ts) keeps one. */
const CURRENT = and(eq(apiKey.kind, 'zapier'), isNull(apiKey.revokedAt));

async function currentKey(db: Db) {
	const [row] = await db.select({ id: apiKey.id }).from(apiKey).where(CURRENT);
	return row;
}

/**
 * a new key, when there is none. a key already made is refused rather than revoked, so two
 * presses of make at once cannot disconnect each other's Zaps — `api_key_one_zapier_idx`
 * (../db/schema.ts) refusing the second insert is what decides it.
 */
export async function makeZapierKey(db: Db): Promise<MadeZapierKey | ZapierKeyExists> {
	try {
		const minted = await mintApiKey(db, ZAPIER_KEY);
		return { ok: true, key: minted.key, madeAt: minted.createdAt };
	} catch (error) {
		if (sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
		return { ok: false, reason: 'key_exists' };
	}
}

/**
 * a new key in place of the current one, which stops working in the same batch.
 *
 * **every open subscription ends with it, as `key_replaced`, and what they were owed is dropped.**
 * a REST hook receives events without presenting the key, so a replace that only cut the auth
 * would leave every Zap on the old key still receiving gifts. `disconnected` is how many ended.
 *
 * **once that batch has committed, Zapier is told**: each ended hook is sent a pause
 * (`pauseZaps` in ./subscriptions.ts), since a Zap nothing posts to again otherwise reads as on in
 * Zapier, with no error. the pause cannot fail the replace or undo it, and `fetcher` is how it
 * reaches Zapier.
 *
 * the old row is revoked, not deleted, at the new row's `created_at`. the new row goes in only
 * while no other un-revoked `zapier` row stands (`api_key_one_zapier_idx`), and the ends only once
 * it has: of two replaces racing, the second's insert yields to the first's key, so it ends no Zap
 * made on that key and answers `conflict`.
 */
export async function replaceZapierKey(
	db: Db,
	fetcher: typeof fetch
): Promise<ReplacedZapierKey | ZapierKeyNotReplaced> {
	const current = await currentKey(db);
	if (current === undefined) return { ok: false, reason: 'no_key' };
	const { key, row } = newApiKeyRow(ZAPIER_KEY);
	const now = new Date();
	const landed = exists(
		db.select({ id: apiKey.id }).from(apiKey).where(eq(apiKey.keyHash, row.keyHash))
	);
	// `ended` is the subscriptions' update, the second of the pair
	const [, inserted, , ended] = await db.batch([
		db
			.update(apiKey)
			.set({ revokedAt: now })
			.where(and(eq(apiKey.id, current.id), isNull(apiKey.revokedAt))),
		db
			.insert(apiKey)
			.values({ ...row, createdAt: now })
			.onConflictDoNothing()
			.returning({ madeAt: apiKey.createdAt }),
		...endSubscriptionStatements(db, 'every_open', 'key_replaced', now, { onlyIf: landed })
	]);
	const [made] = inserted;
	if (made === undefined) return { ok: false, reason: 'conflict' };
	const hookUrls = ended.map((e) => e.hookUrl);
	const pause = await pauseZaps(fetcher, hookUrls);
	return { ok: true, key, madeAt: made.madeAt, disconnected: hookUrls.length, ...pause };
}

/**
 * the hash of this deployment's key when `authorization` — the request's `Authorization` header,
 * or `null` for none — carries that key as a bearer value, and `null` otherwise. every way of
 * being wrong is the same `null`: the caller is told nothing about which.
 *
 * the hash goes down to a write that must only land while the key is still current
 * (`subscribe` in ./subscriptions.ts). a value in no Zapier key's shape is turned away before the
 * read, which tells a caller only the format the key is published in; a read API key, a revoked
 * key and one never made are all the same `null`.
 */
export async function verifyZapierKey(
	db: Db,
	authorization: string | null
): Promise<string | null> {
	const presented = authorization?.trim().match(BEARER_VALUE)?.[1];
	if (presented === undefined || !ZAPIER_KEY_SHAPE.test(presented)) return null;
	const key = await findKeyByPresented(db, presented);
	return key !== null && key.kind === 'zapier' && key.revokedAt === null ? key.keyHash : null;
}

/** `i` for the scheme (case-insensitive, RFC 9110 §11.1); a key in the wrong case fails the hash. */
const BEARER_VALUE = /^bearer +(\S+)$/i;
