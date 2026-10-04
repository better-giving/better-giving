import { and, eq, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { RichTextDocument } from '$lib/rich-text/document';
import type { Db } from '../db/client';
import { image, orgPresentation, orgProfile, type OrgProfile } from '../db/schema';
import { firstMissingImage, illustrationsAmong } from '../images/queries';
import type { ParsedOrgProfile } from './org-input';
import {
	lookFromStored,
	NO_LOOK,
	NO_SHARING,
	NO_STORY,
	type OrgLook,
	type OrgSharing,
	partVersion,
	sharingFromStored,
	type Story,
	storedLook,
	storedSharing,
	storedStory,
	storyFromStored
} from './presentation';

// every read and write of `org_profile` and of `org_presentation`'s story, look, sharing and logo, so
// neither table object leaves this module — the same boundary `contacts/queries.ts` and
// `ledger/posting.ts` draw, and it is what makes "all the writes are here" true rather than
// aspirational.
//
// ---------------------------------------------------------------------------
// execute, or return statements — the rule for every write added below.
//
// a single-row write that must land on its own may execute itself, which is what
// `saveOrgProfile` does. a write that must land atomically with a row in another table may
// not: it would split into a row-building half and a statement-building half and splice the
// statement into the one `batch()` that owns the whole write, as `contacts/queries.ts` does
// with `newContactRow` / `contactInsertStatement`. `Db` has no `transaction` (D1 has none —
// see ../db/client.ts), so a single `batch()` is the only atomic unit there is.
//
// one write has a statement half: the mission an operator answered in a page's chat lands in the
// same `batch()` as the chat turn holding the answer (`missionWhileEmptyStatement`, called from
// ../pages/draft.ts). every other row here is saved on its own from a screen of its own.
//
// ---------------------------------------------------------------------------
// why no seeded row, and why the save is therefore an upsert.
//
// `auth_signing_key` — the singleton this table copies its shape from — is seeded, by
// `migrations/0000_initial_schema.sql`, because auth cannot mint a cookie without a key
// and nothing may fail to boot. this table is the opposite case: it is receipt content, it
// gates nothing, and a seeded row of blanks would be actively worse than no row, because the block
// reporting what a donation form is still missing (../forms/readiness.ts) would read that row as
// filled in. absent means not set.
//
// so the first save has nothing to update and later saves have nothing to insert, and one
// `onConflictDoUpdate` against the fixed id is both — one statement, so it needs no
// `batch()` and no read-then-write, which D1 could not do atomically anyway.
// ---------------------------------------------------------------------------

/**
 * the only id this table will accept, enforced by `org_profile_id_check` in the schema.
 *
 * not exported: a caller that needed it would be a caller reading or writing the table from
 * outside this module, which is the thing the module exists to prevent.
 */
const ORG_PROFILE_ID = 'default';

/**
 * the organization's own details, or `null` when nobody has saved them yet.
 *
 * `null` is a real answer and not an error: a fresh deployment has no profile, the organisation
 * section of the console says so, and a receipt template that finds none must not render a
 * blank one.
 *
 * no ordering and no `limit`, deliberately: `id` is the primary key and the check pins it to
 * one literal, so this is a point lookup on `sqlite_autoindex_org_profile_1` and "which
 * profile is live" is never a question with a sort in it.
 */
export async function readOrgProfile(db: Db): Promise<OrgProfile | null> {
	const [row] = await db.select().from(orgProfile).where(eq(orgProfile.id, ORG_PROFILE_ID));
	return row ?? null;
}

/**
 * writes the organization's details and returns the stored row — insert the first time,
 * update every time after.
 *
 * one statement, not a read-then-write. `Db` has no `transaction`, so a "does it exist yet?"
 * select followed by an insert-or-update would be two commits with a race between them;
 * `on conflict (id) do update` is the database answering that question inside the write it
 * is already doing. it is also why the id is passed explicitly — the column has no
 * `$defaultFn` (the row is a singleton, not a uuidv7), so drizzle has nothing to supply.
 *
 * the UPDATE names every column a screen posts, including the nulls. that is what makes clearing a
 * field work: an operator who empties the tax id gets `null` written back rather than
 * yesterday's value quietly surviving because the key was absent from the set. `ParsedOrgProfile`
 * is total over those columns, so there is no "unspecified" to confuse with "cleared".
 *
 * `deductibility_statement` is deliberately not among them, and that is the one column this
 * function preserves rather than states: nothing posts it (./org-input.ts), a fork writes it on
 * its own deployment and ./deductibility.ts is what reads it — so naming it in the set would clear
 * a fork's own wording on the next identity save. its absence from `set` is what leaves it alone,
 * and an INSERT here leaves it null, which reads as the standard wording.
 *
 * `created_at` is left out of the update on purpose — it is the system time of the first
 * save and an upsert that refreshed it would erase when this deployment was set up.
 * `updated_at` is left out too, but for the opposite reason: it carries `$onUpdateFn`, and
 * drizzle's `buildUpdateSet` — which `onConflictDoUpdate` runs its `set` through — adds
 * every column that has one whether or not the caller named it. `queries.workers.spec.ts`
 * pins both halves against a real D1 rather than trusting that.
 *
 * takes a `ParsedOrgProfile` rather than raw form values so that the "a saved row means at
 * minimum a legal name" promise cannot be bypassed by a caller that skipped
 * `parseOrgProfile`. that is a type-level fact rather than a review item: the type is
 * branded, so a hand-built object literal of the same shape is a compile error here.
 *
 * the mapping stays singular: one field per column, spelled out. a spread of `input` would
 * be shorter and would carry the brand's phantom property into the values object, and it is
 * what makes a later field on `ParsedOrgProfile` reach a column nobody decided to store.
 */
export async function saveOrgProfile(db: Db, input: ParsedOrgProfile): Promise<OrgProfile> {
	const columns = {
		legalName: input.legalName,
		taxId: input.taxId,
		addressLine1: input.addressLine1,
		addressLine2: input.addressLine2,
		city: input.city,
		region: input.region,
		postalCode: input.postalCode,
		country: input.country,
		notificationEmail: input.notificationEmail
	};

	const [row] = await db
		.insert(orgProfile)
		.values({ id: ORG_PROFILE_ID, ...columns })
		.onConflictDoUpdate({ target: orgProfile.id, set: columns })
		.returning();

	if (!row) {
		// unreachable: an upsert that affected no rows would have thrown. it is here because
		// `noUncheckedIndexedAccess` makes the possibility explicit, and a thrown message
		// naming the table beats a `TypeError` on a destructured undefined.
		throw new Error('upserting into `org_profile` returned no row');
	}
	return row;
}

// ---------------------------------------------------------------------------
// the story.
//
// `org_presentation` is seeded by nothing, like `org_profile` and for its reason: absent means
// nothing written. an absent row reads as the column default, `NO_STORY`, so a first save and a
// later one are the same upsert.
//
// every story write is compare-and-set on the story column's own text, which the page was drawn
// from as `partVersion`'s digest (`submittedDigest` in ../conform.ts). the digest is checked
// against a read, and the write then compares the text that read returned in its own `where` — so
// a save landing between the two is refused by the write rather than overwritten.
//
// a save keeps what it replaced in `story_previous`, and Undo swaps the two, so a second Undo puts
// back what the first took away. SQLite evaluates every right-hand side of a `SET` against the row
// as it stood, which is what makes the swap one statement
// (`src/lib/server/db/page-schema.workers.spec.ts` holds it for the look).
// ---------------------------------------------------------------------------

/** the one id `org_presentation_id_check` accepts. */
const ORG_PRESENTATION_ID = 'default';

/** what a story write answers: it landed, or the story moved since the page was drawn. */
export type StoryWrite = 'written' | 'stale';

/** the column's text, or `NO_STORY` where there is no row. */
async function storedStoryText(db: Db): Promise<string> {
	const [row] = await db
		.select({ story: orgPresentation.story })
		.from(orgPresentation)
		.where(eq(orgPresentation.id, ORG_PRESENTATION_ID));
	return row?.story ?? NO_STORY;
}

/** the story, and the version a save of it is written against. */
export async function readOrgStory(db: Db): Promise<{ story: Story; version: string }> {
	const stored = await storedStoryText(db);
	return { story: storyFromStored(stored), version: await partVersion(stored) };
}

/** write the story, keeping the one it replaces for Undo — while the story is still `seen`. */
export async function updateOrgStory(db: Db, seen: string, story: Story): Promise<StoryWrite> {
	const current = await storedStoryText(db);
	if ((await partVersion(current)) !== seen) return 'stale';
	const next = storedStory(story);
	const [row] = await db
		.insert(orgPresentation)
		.values({ id: ORG_PRESENTATION_ID, story: next, storyPrevious: current })
		.onConflictDoUpdate({
			target: orgPresentation.id,
			set: { story: next, storyPrevious: sql`${orgPresentation.story}` },
			setWhere: eq(orgPresentation.story, current)
		})
		.returning({ id: orgPresentation.id });
	return row ? 'written' : 'stale';
}

/**
 * a statement for the caller's `batch()` writing `mission` as the story's mission while none is
 * stored, the vision as it stands, and only where `when` holds as the statement runs. the story it
 * replaces is kept for Undo, as a save keeps it.
 */
export function missionWhileEmptyStatement(db: Db, mission: RichTextDocument, when: SQL) {
	const now = Date.now();
	const first = { mission, vision: null };
	return db
		.insert(orgPresentation)
		.select((qb) =>
			qb
				.select({
					id: sql<string>`${ORG_PRESENTATION_ID}`.as('id'),
					story: sql<string>`${storedStory(first)}`.as('story'),
					look: sql<string>`${NO_LOOK}`.as('look'),
					sharing: sql<string>`${NO_SHARING}`.as('sharing'),
					storyPrevious: sql<string>`${NO_STORY}`.as('story_previous'),
					lookPrevious: sql<null>`null`.as('look_previous'),
					sharingPrevious: sql<null>`null`.as('sharing_previous'),
					createdAt: sql<number>`${now}`.as('created_at'),
					updatedAt: sql<number>`${now}`.as('updated_at'),
					logoImageId: sql<null>`null`.as('logo_image_id'),
					logoImageIdPrevious: sql<null>`null`.as('logo_image_id_previous')
				})
				.from(sql`(select 1)`)
				.where(when)
		)
		.onConflictDoUpdate({
			target: orgPresentation.id,
			set: {
				story: sql`json_set(${orgPresentation.story}, '$.mission', json(${JSON.stringify(mission)}))`,
				storyPrevious: sql`${orgPresentation.story}`
			},
			setWhere: sql`json_extract(${orgPresentation.story}, '$.mission') is null`
		});
}

/**
 * swap the story with the one the last save replaced — while the story is still `seen`.
 *
 * `stale` too where nothing was ever saved: the page offers Undo only after a save has landed, so
 * a story with nothing behind it is one another tab moved.
 */
export async function updateOrgStoryToPrevious(db: Db, seen: string): Promise<StoryWrite> {
	const current = await storedStoryText(db);
	if ((await partVersion(current)) !== seen) return 'stale';
	const [row] = await db
		.update(orgPresentation)
		.set({
			story: sql`${orgPresentation.storyPrevious}`,
			storyPrevious: sql`${orgPresentation.story}`
		})
		.where(
			and(
				eq(orgPresentation.id, ORG_PRESENTATION_ID),
				eq(orgPresentation.story, current),
				isNotNull(orgPresentation.storyPrevious)
			)
		)
		.returning({ id: orgPresentation.id });
	return row ? 'written' : 'stale';
}

// ---------------------------------------------------------------------------
// the look, written as the story is: compare-and-set on the look column's own text, the replaced
// look kept in `look_previous`, and Undo the one-statement swap.
// ---------------------------------------------------------------------------

/** the column's text, or `NO_LOOK` where there is no row. */
async function storedLookText(db: Db): Promise<string> {
	const [row] = await db
		.select({ look: orgPresentation.look })
		.from(orgPresentation)
		.where(eq(orgPresentation.id, ORG_PRESENTATION_ID));
	return row?.look ?? NO_LOOK;
}

/** the look, and the version a save of it is written against. */
export async function readOrgLook(db: Db): Promise<{ look: OrgLook; version: string }> {
	const stored = await storedLookText(db);
	return { look: lookFromStored(stored), version: await partVersion(stored) };
}

/** what a look write answers: the version it left the look at, or `stale`, as a story write's. */
export type LookWrite = { readonly version: string } | 'stale';

/** write the look, keeping the one it replaces for Undo — while the look is still `seen`. */
export async function updateOrgLook(db: Db, seen: string, look: OrgLook): Promise<LookWrite> {
	const current = await storedLookText(db);
	if ((await partVersion(current)) !== seen) return 'stale';
	const next = storedLook(look);
	const [row] = await db
		.insert(orgPresentation)
		.values({ id: ORG_PRESENTATION_ID, look: next, lookPrevious: current })
		.onConflictDoUpdate({
			target: orgPresentation.id,
			set: { look: next, lookPrevious: sql`${orgPresentation.look}` },
			setWhere: eq(orgPresentation.look, current)
		})
		.returning({ look: orgPresentation.look });
	return row ? { version: await partVersion(row.look) } : 'stale';
}

/**
 * swap the look with the one the last save replaced — while the look is still `seen`.
 *
 * `stale` too where no look was ever saved, for `updateOrgStoryToPrevious`'s reason.
 */
export async function updateOrgLookToPrevious(db: Db, seen: string): Promise<LookWrite> {
	const current = await storedLookText(db);
	if ((await partVersion(current)) !== seen) return 'stale';
	const [row] = await db
		.update(orgPresentation)
		.set({
			look: sql`${orgPresentation.lookPrevious}`,
			lookPrevious: sql`${orgPresentation.look}`
		})
		.where(
			and(
				eq(orgPresentation.id, ORG_PRESENTATION_ID),
				eq(orgPresentation.look, current),
				isNotNull(orgPresentation.lookPrevious)
			)
		)
		.returning({ look: orgPresentation.look });
	return row ? { version: await partVersion(row.look) } : 'stale';
}

// ---------------------------------------------------------------------------
// the sharing, written as the story is: compare-and-set on the sharing column's own text, the
// replaced sharing kept in `sharing_previous`, and Undo the one-statement swap.
// ---------------------------------------------------------------------------

/** the column's text, or `NO_SHARING` where there is no row. */
async function storedSharingText(db: Db): Promise<string> {
	const [row] = await db
		.select({ sharing: orgPresentation.sharing })
		.from(orgPresentation)
		.where(eq(orgPresentation.id, ORG_PRESENTATION_ID));
	return row?.sharing ?? NO_SHARING;
}

/**
 * the sharing, each part read through its own rule, and the version a save of it is written
 * against; no row reads as none chosen.
 */
export async function readOrgSharing(db: Db): Promise<{ sharing: OrgSharing; version: string }> {
	const stored = await storedSharingText(db);
	return { sharing: sharingFromStored(stored), version: await partVersion(stored) };
}

/** what a sharing write answers, as a story write's. */
export type SharingWrite = 'written' | 'stale';

/** write the sharing, keeping the one it replaces for Undo — while the sharing is still `seen`. */
export async function updateOrgSharing(
	db: Db,
	seen: string,
	sharing: OrgSharing
): Promise<SharingWrite> {
	const current = await storedSharingText(db);
	if ((await partVersion(current)) !== seen) return 'stale';
	const next = storedSharing(sharing);
	const [row] = await db
		.insert(orgPresentation)
		.values({ id: ORG_PRESENTATION_ID, sharing: next, sharingPrevious: current })
		.onConflictDoUpdate({
			target: orgPresentation.id,
			set: { sharing: next, sharingPrevious: sql`${orgPresentation.sharing}` },
			setWhere: eq(orgPresentation.sharing, current)
		})
		.returning({ id: orgPresentation.id });
	return row ? 'written' : 'stale';
}

/**
 * swap the sharing with the one the last save replaced — while the sharing is still `seen`.
 *
 * `stale` too where no sharing was ever saved, for `updateOrgStoryToPrevious`'s reason.
 */
export async function updateOrgSharingToPrevious(db: Db, seen: string): Promise<SharingWrite> {
	const current = await storedSharingText(db);
	if ((await partVersion(current)) !== seen) return 'stale';
	const [row] = await db
		.update(orgPresentation)
		.set({
			sharing: sql`${orgPresentation.sharingPrevious}`,
			sharingPrevious: sql`${orgPresentation.sharing}`
		})
		.where(
			and(
				eq(orgPresentation.id, ORG_PRESENTATION_ID),
				eq(orgPresentation.sharing, current),
				isNotNull(orgPresentation.sharingPrevious)
			)
		)
		.returning({ id: orgPresentation.id });
	return row ? 'written' : 'stale';
}

// ---------------------------------------------------------------------------
// the logo, written as the look is — compare-and-set on the logo column alone, the replaced logo
// kept in `logo_image_id_previous`, and Undo the one-statement swap — with null a value on both
// sides: no logo is written and undone like any other. so null-safe `IS` compares where the other
// parts use `=`, and there is nothing to undo exactly where the two columns are equal.
// ---------------------------------------------------------------------------

/** the logo as a page lays it out: its image and that image's stored size. */
export type OrgLogo = { readonly imageId: string; readonly width: number; readonly height: number };

/**
 * what a logo write answers: the version it left the logo at, `stale` as a look write's, or the
 * id refused — `unknown` names no stored image, `illustration` an image that is not a photo.
 */
export type LogoWrite = { readonly version: string } | 'stale' | 'unknown' | 'illustration';

/**
 * what a logo Undo answers: as a write, or `nothing` where the logo and the one before it are the
 * same, which includes no row at all.
 */
export type LogoUndo = { readonly version: string } | 'stale' | 'nothing';

/** the version of a logo column's value; no logo is a value too, and digests as empty text. */
const logoVersion = (imageId: string | null) => partVersion(imageId ?? '');

async function storedLogoIds(db: Db) {
	const [row] = await db
		.select({
			current: orgPresentation.logoImageId,
			previous: orgPresentation.logoImageIdPrevious
		})
		.from(orgPresentation)
		.where(eq(orgPresentation.id, ORG_PRESENTATION_ID));
	return { current: row?.current ?? null, previous: row?.previous ?? null };
}

/** the logo with its size, the version a write of it is made against, and whether Undo has one. */
export async function readOrgLogo(
	db: Db
): Promise<{ logo: OrgLogo | null; version: string; undoable: boolean }> {
	const [row] = await db
		.select({
			current: orgPresentation.logoImageId,
			previous: orgPresentation.logoImageIdPrevious,
			width: image.width,
			height: image.height
		})
		.from(orgPresentation)
		.leftJoin(image, eq(image.id, orgPresentation.logoImageId))
		.where(eq(orgPresentation.id, ORG_PRESENTATION_ID));
	const current = row?.current ?? null;
	return {
		// the foreign key holds a stored id to a stored image, so the size is there whenever the id is.
		logo:
			current === null || row?.width == null || row.height == null
				? null
				: { imageId: current, width: row.width, height: row.height },
		version: await logoVersion(current),
		undoable: current !== (row?.previous ?? null)
	};
}

/**
 * set the logo to the photo `imageId`, or to none where it is null, keeping the one it replaces for
 * Undo — while the logo is still `seen`. the photo-only rule is held here, since the kind is on the
 * image's row and no check on this table can read it (../db/schema.ts, `orgPresentation`).
 */
export async function updateOrgLogo(
	db: Db,
	seen: string,
	imageId: string | null
): Promise<LogoWrite> {
	const { current } = await storedLogoIds(db);
	if ((await logoVersion(current)) !== seen) return 'stale';
	if (imageId !== null) {
		if ((await firstMissingImage(db, [imageId])) !== null) return 'unknown';
		if ((await illustrationsAmong(db, [imageId])).has(imageId)) return 'illustration';
	}
	const [row] = await db
		.insert(orgPresentation)
		.values({ id: ORG_PRESENTATION_ID, logoImageId: imageId, logoImageIdPrevious: current })
		.onConflictDoUpdate({
			target: orgPresentation.id,
			set: { logoImageId: imageId, logoImageIdPrevious: sql`${orgPresentation.logoImageId}` },
			setWhere: sql`${orgPresentation.logoImageId} is ${current}`
		})
		.returning({ logo: orgPresentation.logoImageId });
	return row ? { version: await logoVersion(row.logo) } : 'stale';
}

/** swap the logo with the one the last write replaced — while the logo is still `seen`. */
export async function updateOrgLogoToPrevious(db: Db, seen: string): Promise<LogoUndo> {
	const { current, previous } = await storedLogoIds(db);
	if ((await logoVersion(current)) !== seen) return 'stale';
	if (current === previous) return 'nothing';
	const [row] = await db
		.update(orgPresentation)
		.set({
			logoImageId: sql`${orgPresentation.logoImageIdPrevious}`,
			logoImageIdPrevious: sql`${orgPresentation.logoImageId}`
		})
		.where(
			and(
				eq(orgPresentation.id, ORG_PRESENTATION_ID),
				sql`${orgPresentation.logoImageId} is ${current}`,
				sql`${orgPresentation.logoImageIdPrevious} is ${previous}`
			)
		)
		.returning({ logo: orgPresentation.logoImageId });
	return row ? { version: await logoVersion(row.logo) } : 'stale';
}
