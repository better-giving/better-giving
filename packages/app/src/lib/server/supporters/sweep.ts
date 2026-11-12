import { and, eq, inArray, isNull, lt, lte, notExists, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
	donation,
	form,
	supporter,
	supporterLink,
	supporterPage,
	supporterSession
} from '../db/schema';
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
 * how long a fundraiser may wait for its confirm link to be opened, from its start: past this a
 * pending page is deleted, so an address nobody confirms stops holding its slug (`heldAddresses`
 * in ../pages/queries.ts). a link resent late in it (`resendConfirmLink` in ./links.ts) goes with
 * the page.
 */
export const PENDING_PAGE_KEEP_MS = 7 * 24 * 60 * 60_000;

/**
 * deletes what a supporter's sign-in leaves behind: every link a day past its expiry, used or not —
 * a used link expires within the hour it was made (`LINK_LIFETIME_MS` in ./links.ts) — and every
 * session past its own, which `readSupporterSession` (./session.ts) already admits nothing on. no
 * other row names either. and every image `UNHELD_PHOTO_KEEP_MS` old that nothing names: a crop no
 * edit saved. the image table does not say which upload made an image, so a dashboard upload
 * (src/routes/_app.admin.images.ts) a day old and never saved goes too; every write naming an image
 * refuses one no longer stored. and every fundraiser still pending `PENDING_PAGE_KEEP_MS` after
 * its start, with its links, its settings row and its photo (`unconfirmedPageStatements`). last,
 * every supporter none of that leaves anything of (`abandonedSupporter`). one batch; a throw is the
 * scheduler's to log.
 */
export async function sweepSupporterLeftovers(db: Db, now: Date): Promise<void> {
	const unheld = await unheldImagesMadeBefore(db, new Date(now.getTime() - UNHELD_PHOTO_KEEP_MS));
	const unconfirmed = await unconfirmedPageStatements(db, now);
	await db.batch([
		db
			.delete(supporterLink)
			.where(lt(supporterLink.expiresAt, new Date(now.getTime() - LINK_KEEP_PAST_EXPIRY_MS))),
		db.delete(supporterSession).where(lte(supporterSession.expiresAt, now)),
		...unconfirmed,
		...unheld.flatMap((id) => freeImageStatements(db, id)),
		deleteAbandonedSupporters(db)
	]);
}

/**
 * deletes every supporter who never signed in and has no page, no link and no session left: an
 * address a start named whose confirm link nobody opened, once the statements before it in the
 * sweep's batch took the rest.
 */
export function deleteAbandonedSupporters(db: Db) {
	return db.delete(supporter).where(abandonedSupporter(db));
}

function abandonedSupporter(db: Db) {
	const naming = (table: typeof supporterPage | typeof supporterLink | typeof supporterSession) =>
		notExists(
			db.select({ id: table.supporterId }).from(table).where(eq(table.supporterId, supporter.id))
		);
	return and(
		isNull(supporter.lastSignInAt),
		naming(supporterPage),
		naming(supporterLink),
		naming(supporterSession)
	);
}

/**
 * a page still pending `PENDING_PAGE_KEEP_MS` after its start that no gift names, by itself or
 * through its settings row: never one published, ended or given to.
 */
function unconfirmedPage(db: Db, now: Date) {
	return and(
		eq(supporterPage.status, 'pending'),
		lt(supporterPage.createdAt, new Date(now.getTime() - PENDING_PAGE_KEEP_MS)),
		notExists(
			db
				.select({ id: donation.id })
				.from(donation)
				.where(
					or(
						eq(donation.supporterPageId, supporterPage.id),
						eq(donation.formId, supporterPage.formId)
					)
				)
		)
	);
}

/**
 * the statements deleting every `unconfirmedPage`: its links first, since their foreign key is
 * `NO ACTION`, then the page, then the settings row it owned once no page names it, then its photo
 * where nothing else holds it (../images/free.ts). each carries its own guard, so a page confirmed
 * between this read and the batch keeps all four.
 */
async function unconfirmedPageStatements(db: Db, now: Date) {
	const pages = await db
		.select({ formId: supporterPage.formId, photoId: supporterPage.photoId })
		.from(supporterPage)
		.where(unconfirmedPage(db, now));
	if (pages.length === 0) return [];
	const unconfirmedIds = db
		.select({ id: supporterPage.id })
		.from(supporterPage)
		.where(unconfirmedPage(db, now));
	const formIds = pages.map((row) => row.formId);
	return [
		db.delete(supporterLink).where(inArray(supporterLink.supporterPageId, unconfirmedIds)),
		db.delete(supporterPage).where(unconfirmedPage(db, now)),
		db
			.delete(form)
			.where(
				and(
					inArray(form.id, formIds),
					notExists(
						db
							.select({ id: supporterPage.id })
							.from(supporterPage)
							.where(eq(supporterPage.formId, form.id))
					)
				)
			),
		...pages.flatMap((row) => (row.photoId === null ? [] : freeImageStatements(db, row.photoId)))
	];
}
