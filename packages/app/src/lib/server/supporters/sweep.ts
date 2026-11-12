import { lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporterLink, supporterSession } from '../db/schema';
import { freeImageStatements, unheldImagesMadeBefore } from '../images/free';

/**
 * how long a link is kept past its expiry: a day's trail for whoever looks into a link a supporter
 * says did not open. a swept link reads as an expired one does (`OpenedLink` in ./links.ts).
 */
export const LINK_KEEP_PAST_EXPIRY_MS = 24 * 60 * 60_000;

/**
 * how old a photo nothing holds must be before it is freed: a photo box stores each crop when it is
 * made (src/routes/fundraise.photo.ts) and a page names it only once saved, so an edit left open
 * this long and saved after loses its photo to `photo_missing` (./pages.ts).
 */
export const UNHELD_PHOTO_KEEP_MS = 24 * 60 * 60_000;

/**
 * deletes what a supporter's sign-in leaves behind: every link a day past its expiry, used or not —
 * a used link expires within the hour it was made (`LINK_LIFETIME_MS` in ./links.ts) — and every
 * session past its own, which `readSupporterSession` (./session.ts) already admits nothing on. no
 * other row names either. and every image `UNHELD_PHOTO_KEEP_MS` old that nothing names: a crop no
 * edit saved. the image table does not say which upload made an image, so a dashboard upload
 * (src/routes/_app.admin.images.ts) a day old and never saved goes too; every write naming an image
 * refuses one no longer stored. one batch; a throw is the scheduler's to log.
 */
export async function sweepSupporterLeftovers(db: Db, now: Date): Promise<void> {
	const unheld = await unheldImagesMadeBefore(db, new Date(now.getTime() - UNHELD_PHOTO_KEEP_MS));
	await db.batch([
		db
			.delete(supporterLink)
			.where(lt(supporterLink.expiresAt, new Date(now.getTime() - LINK_KEEP_PAST_EXPIRY_MS))),
		db.delete(supporterSession).where(lte(supporterSession.expiresAt, now)),
		...unheld.flatMap((id) => freeImageStatements(db, id))
	]);
}
