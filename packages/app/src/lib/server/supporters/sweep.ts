import { lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporterLink, supporterSession } from '../db/schema';

/**
 * how long a link is kept past its expiry: a day's trail for whoever looks into a link a supporter
 * says did not open. a swept link reads as an expired one does (`OpenedLink` in ./links.ts).
 */
export const LINK_KEEP_PAST_EXPIRY_MS = 24 * 60 * 60_000;

/**
 * deletes what a supporter's sign-in leaves behind: every link a day past its expiry, used or not —
 * a used link expires within the hour it was made (`LINK_LIFETIME_MS` in ./links.ts) — and every
 * session past its own, which `readSupporterSession` (./session.ts) already admits nothing on. no
 * other row names either. one batch; a throw is the scheduler's to log.
 */
export async function sweepSupporterLeftovers(db: Db, now: Date): Promise<void> {
	await db.batch([
		db
			.delete(supporterLink)
			.where(lt(supporterLink.expiresAt, new Date(now.getTime() - LINK_KEEP_PAST_EXPIRY_MS))),
		db.delete(supporterSession).where(lte(supporterSession.expiresAt, now))
	]);
}
