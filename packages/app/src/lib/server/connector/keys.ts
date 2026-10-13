import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type ConnectorKey, connectorCode, connectorKey, photoLink } from '../db/schema';

// the connector's key, the code that becomes it, and the end of both. a key is minted only here,
// only by `redeemCode`, and only for a code the Allow screen issued (`issueCode`) within the last
// `CODE_TTL_MS`; the code is single-use, so a code intercepted after the connector redeemed it is
// worth nothing. every value is stored as its SHA-256 and compared by that hash, so nothing read
// out of the database admits a request.

/** how long an Allow's code waits to be redeemed. */
export const CODE_TTL_MS = 10 * 60_000;

/** every connector key: `bgc_` and 43 base64url characters, 256 bits. */
export const CONNECTOR_KEY_SHAPE = /^bgc_[A-Za-z0-9_-]{43}$/;

/** every code the Allow screen issues: 43 base64url characters. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** the lowercase hex SHA-256 of `value`. */
export function hashOf(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 32 random bytes as unpadded base64url. */
export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

/** a code for the connector to redeem, issued by the Allow press of the staff member `allowedBy`. */
export async function issueCode(db: Db, allowedBy: string, now = new Date()): Promise<string> {
	const code = randomToken();
	await db.insert(connectorCode).values({
		codeHash: hashOf(code),
		allowedBy,
		createdAt: now,
		expiresAt: new Date(now.getTime() + CODE_TTL_MS)
	});
	return code;
}

/** a key minted for a redeemed code: the plaintext, which nothing gives again, and its row id. */
export type MintedConnectorKey = { readonly id: string; readonly key: string };

/**
 * `code` redeemed for a new key, or `null` for a code that is not one the Allow screen issued, was
 * redeemed already, or has expired. the take is one guarded UPDATE, so two redemptions racing on one
 * code mint one key between them.
 */
export async function redeemCode(
	db: Db,
	code: string,
	now = new Date()
): Promise<MintedConnectorKey | null> {
	if (!CODE_SHAPE.test(code)) return null;
	const [taken] = await db
		.update(connectorCode)
		.set({ usedAt: now })
		.where(
			and(
				eq(connectorCode.codeHash, hashOf(code)),
				isNull(connectorCode.usedAt),
				gt(connectorCode.expiresAt, now)
			)
		)
		.returning({ allowedBy: connectorCode.allowedBy });
	if (!taken) return null;
	const key = `bgc_${randomToken()}`;
	const [row] = await db
		.insert(connectorKey)
		.values({
			keyHash: hashOf(key),
			prefix: key.slice(0, 8),
			lastFour: key.slice(-4),
			allowedBy: taken.allowedBy,
			createdAt: now
		})
		.returning({ id: connectorKey.id });
	if (!row) throw new Error('inserting the connector key returned no row');
	return { id: row.id, key };
}

/** the live connector key `presented` is, or `null` for any value that is not one. */
export async function findLiveKey(db: Db, presented: string): Promise<ConnectorKey | null> {
	if (!CONNECTOR_KEY_SHAPE.test(presented)) return null;
	const [row] = await db
		.select()
		.from(connectorKey)
		.where(and(eq(connectorKey.keyHash, hashOf(presented)), isNull(connectorKey.revokedAt)));
	return row ?? null;
}

/**
 * revokes the key `id` — Disconnect on the dashboard, or the connector letting its own key go — and
 * ends every photo link it handed out. `false` when there is no such live key.
 */
export async function revokeConnectorKey(
	db: Db,
	id: string,
	by: 'dashboard' | 'connector',
	now = new Date()
): Promise<boolean> {
	const [revoked] = await db.batch([
		db
			.update(connectorKey)
			.set({ revokedAt: now, revokedBy: by })
			.where(and(eq(connectorKey.id, id), isNull(connectorKey.revokedAt)))
			.returning({ id: connectorKey.id }),
		db
			.update(photoLink)
			.set({ usedAt: now })
			.where(and(eq(photoLink.connectorKeyId, id), isNull(photoLink.usedAt)))
	]);
	return revoked.length > 0;
}

/** a connection as Integrations lists it. */
export type ListedConnection = Pick<
	ConnectorKey,
	'id' | 'prefix' | 'lastFour' | 'allowedBy' | 'createdAt' | 'lastUsedAt'
>;

/** every live connection, newest first. */
export async function listConnections(db: Db): Promise<ListedConnection[]> {
	return db
		.select({
			id: connectorKey.id,
			prefix: connectorKey.prefix,
			lastFour: connectorKey.lastFour,
			allowedBy: connectorKey.allowedBy,
			createdAt: connectorKey.createdAt,
			lastUsedAt: connectorKey.lastUsedAt
		})
		.from(connectorKey)
		.where(isNull(connectorKey.revokedAt))
		.orderBy(desc(connectorKey.createdAt), desc(connectorKey.id));
}

const LAST_USED_WINDOW_MS = 60_000;

/** records that `key` was used, at most once a minute, and never rejects. */
export async function touchConnectorKey(db: Db, key: ConnectorKey, now = new Date()) {
	const staleBefore = new Date(now.getTime() - LAST_USED_WINDOW_MS);
	if (key.lastUsedAt !== null && key.lastUsedAt >= staleBefore) return;
	try {
		await db
			.update(connectorKey)
			.set({ lastUsedAt: now })
			.where(
				and(
					eq(connectorKey.id, key.id),
					or(isNull(connectorKey.lastUsedAt), lt(connectorKey.lastUsedAt, staleBefore))
				)
			);
	} catch (e) {
		console.error(`recording when connector key ${key.id} was last used failed:`, e);
	}
}

/** how long a spent or expired code or photo link is kept before the sweep deletes it. */
export const LEFTOVER_KEEP_MS = 24 * 60 * 60_000;

/** how long a revoked key's row is kept, as the trail of who allowed it and when it was cut. */
export const REVOKED_KEY_KEEP_MS = 30 * 24 * 60 * 60_000;

/**
 * deletes codes and photo links that have been spent or expired for `LEFTOVER_KEEP_MS`, and keys
 * revoked for `REVOKED_KEY_KEEP_MS`: none admits anything, and the rows are only a trail. a live key
 * is never swept — a connection lasts until Disconnect, however long the chat goes unused. never
 * rejects.
 */
export async function sweepConnectorLeftovers(db: Db, now = new Date()): Promise<void> {
	const before = new Date(now.getTime() - LEFTOVER_KEEP_MS);
	const revokedBefore = new Date(now.getTime() - REVOKED_KEY_KEEP_MS);
	try {
		await db.batch([
			db
				.delete(connectorCode)
				.where(or(lt(connectorCode.expiresAt, before), lt(connectorCode.usedAt, before))),
			db.delete(photoLink).where(or(lt(photoLink.expiresAt, before), lt(photoLink.usedAt, before))),
			// a swept key's links go before it, whatever their age: their foreign key is `NO ACTION`.
			db
				.delete(photoLink)
				.where(
					inArray(
						photoLink.connectorKeyId,
						db
							.select({ id: connectorKey.id })
							.from(connectorKey)
							.where(lt(connectorKey.revokedAt, revokedBefore))
					)
				),
			db.delete(connectorKey).where(lt(connectorKey.revokedAt, revokedBefore))
		]);
	} catch (e) {
		console.error('sweeping spent connector codes, photo links and revoked keys failed:', e);
	}
}
