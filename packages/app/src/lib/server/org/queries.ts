import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { image, orgProfile, type OrgProfile } from '../db/schema';
import { freeImageStatements } from '../images/free';
import { firstMissingImage, illustrationsAmong, type NewImageStatements } from '../images/queries';
import type { ParsedOrgProfile } from './org-input';

// every read and write of `org_profile`, so the table object never leaves this module — the same
// boundary `contacts/queries.ts` and `ledger/posting.ts` draw, and it is what makes "all the writes
// are here" true rather than aspirational.
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
 * `deductibility_statement` is deliberately not among them, and it is one of two columns this
 * function preserves rather than states: nothing posts it (./org-input.ts), a fork writes it on
 * its own deployment and ./deductibility.ts is what reads it — so naming it in the set would clear
 * a fork's own wording on the next identity save. its absence from `set` is what leaves it alone,
 * and an INSERT here leaves it null, which reads as the standard wording. the other is
 * `logo_image_id`, which has writes of its own (the logo writes below) because a logo it
 * replaces is freed with it.
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
		notificationEmail: input.notificationEmail,
		mission: input.mission,
		vision: input.vision,
		brandColour: input.brandColour,
		socialLinks: input.socialLinks
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
// the profile's logo, `org_profile.logo_image_id`: set to a stored photo or taken off, and the logo
// it replaces freed in the same `batch()` where nothing else names it (../images/free.ts). no undo:
// a freed image is gone.
//
// the write is compare-and-set on the logo it read, so the logo it frees is the one it replaced; a
// write landing between the two answers `stale`.
// ---------------------------------------------------------------------------

/**
 * what a profile logo write answers: it landed, the logo moved since it was read, or the id refused
 * — `no-profile` where no profile is saved for it to sit on, `unknown` where no image has the id,
 * `illustration` where the image is not a photo.
 */
export type ProfileLogoWrite = 'written' | 'stale' | 'no-profile' | 'unknown' | 'illustration';

/** the logo as a page lays it out: its image and that image's stored size. */
export type OrgLogo = { readonly imageId: string; readonly width: number; readonly height: number };

/** the profile's logo as a page lays it out, its photo and that photo's stored size; null for none. */
export async function readOrgProfileLogo(db: Db): Promise<OrgLogo | null> {
	const [row] = await db
		.select({ imageId: image.id, width: image.width, height: image.height })
		.from(orgProfile)
		.innerJoin(image, eq(image.id, orgProfile.logoImageId))
		.where(eq(orgProfile.id, ORG_PROFILE_ID));
	return row ?? null;
}

/** set the profile's logo to the stored photo `imageId`, freeing the one it replaces. */
export async function setOrgProfileLogo(db: Db, imageId: string): Promise<ProfileLogoWrite> {
	if ((await firstMissingImage(db, [imageId])) !== null) return 'unknown';
	if ((await illustrationsAmong(db, [imageId])).has(imageId)) return 'illustration';
	return writeProfileLogo(db, imageId);
}

/**
 * store a new photo and put it on as the profile's logo, in one `batch()` with the guarded write
 * and the frees: the logo it replaces, and the new photo itself, which nothing names unless the
 * write landed. so a stale write or a failed batch leaves no photo behind, and `no-profile` is
 * answered before anything is written.
 */
export async function putNewOrgProfileLogo(
	db: Db,
	photo: { readonly id: string; readonly statements: NewImageStatements }
): Promise<'written' | 'stale' | 'no-profile'> {
	const read = await readLogo(db);
	if (!read) return 'no-profile';
	const [, , written] = await db.batch([
		...photo.statements,
		logoWrite(db, read.logo, photo.id),
		...freeImageStatements(db, photo.id),
		...(read.logo === null ? [] : freeImageStatements(db, read.logo))
	]);
	return written.length > 0 ? 'written' : 'stale';
}

/** take the profile's logo off, freeing it. no profile has no logo, so that is `written` too. */
export async function removeOrgProfileLogo(db: Db): Promise<'written' | 'stale'> {
	const written = await writeProfileLogo(db, null);
	return written === 'no-profile' ? 'written' : written;
}

async function writeProfileLogo(
	db: Db,
	next: string | null
): Promise<'written' | 'stale' | 'no-profile'> {
	const read = await readLogo(db);
	if (!read) return 'no-profile';
	const write = logoWrite(db, read.logo, next);
	if (read.logo === null || read.logo === next) {
		return (await write).length > 0 ? 'written' : 'stale';
	}
	const [written] = await db.batch([write, ...freeImageStatements(db, read.logo)]);
	return written.length > 0 ? 'written' : 'stale';
}

/** the logo a write compares against; undefined where no profile is saved. */
async function readLogo(db: Db): Promise<{ readonly logo: string | null } | undefined> {
	const [row] = await db
		.select({ logo: orgProfile.logoImageId })
		.from(orgProfile)
		.where(eq(orgProfile.id, ORG_PROFILE_ID));
	return row;
}

/** the logo set to `next` where it is still `read`, returning a row only where it landed. */
function logoWrite(db: Db, read: string | null, next: string | null) {
	return db
		.update(orgProfile)
		.set({ logoImageId: next })
		.where(and(eq(orgProfile.id, ORG_PROFILE_ID), sql`${orgProfile.logoImageId} is ${read}`))
		.returning({ id: orgProfile.id });
}
