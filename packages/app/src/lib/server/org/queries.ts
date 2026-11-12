import { and, eq, notExists, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { image, orgProfile, type OrgProfile } from '../db/schema';
import { freeImageStatements } from '../images/free';
import type { NewImageStatements } from '../images/queries';
import type { ParsedOrgProfile } from './org-input';

// every read and write of `org_profile`, so the table object never leaves this module — the same
// boundary `contacts/queries.ts` and `ledger/posting.ts` draw, and it is what makes "all the writes
// are here" true rather than aspirational. the one read elsewhere is ./directory-identity.ts, raw
// SQL for a script that cannot load the table object.
//
// ---------------------------------------------------------------------------
// execute, or return statements — the rule for every write added below.
//
// a single-row write that must land on its own may execute itself, which is what
// `saveOrgProfile` does. a write that must land atomically with a row in another table may
// not: it would split into a row-building half and a statement-building half and splice the
// statement into the one `batch()` that owns the whole write, as `contacts/queries.ts` does
// with `newContactRow` / `contactInsertStatement`. `Db` has no `transaction`
// (../db/client.ts), so a single `batch()` is the only atomic unit there is.
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
// `batch()` and no read-then-write, which `Db` could not do atomically anyway.
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
 * `null` is a real answer and not an error: a fresh deployment has no profile, and a receipt
 * template that finds none must not render a blank one.
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
 * `deductibility_statement` is deliberately not among them, and it is one of three columns this
 * function preserves rather than states: nothing posts it (./org-input.ts), a fork writes it on
 * its own deployment and ./deductibility.ts is what reads it — so naming it in the set would clear
 * a fork's own wording on the next identity save. its absence from `set` is what leaves it alone,
 * and an INSERT here leaves it null, which reads as the standard wording. the others are
 * `logo_image_id` and `banner_image_id`, which have writes of their own (the logo and banner
 * writes below) because a photo they replace is freed with it.
 *
 * `created_at` is left out of the update on purpose — it is the system time of the first
 * save and an upsert that refreshed it would erase when this deployment was set up.
 * `updated_at` is left out too, but for the opposite reason: it carries `$onUpdateFn`, and
 * drizzle's `buildUpdateSet` — which `onConflictDoUpdate` runs its `set` through — adds
 * every column that has one whether or not the caller named it. `queries.db.spec.ts`
 * pins both halves against a real database rather than trusting that.
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

/**
 * a save that `updateOrgDetails` or `updateOrgNotificationEmail` made: `saved`, `stale` where the
 * row moved since the page was drawn, and `no-profile` where there is no row for a column of its
 * own to land on.
 */
export type OrgSave = 'saved' | 'stale' | 'no-profile';

/**
 * the version a page is drawn with: the row's `updated_at` in unix ms, and 0 where no profile is
 * saved — a row is never written at 0, so a page drawn over no profile is stale once one exists.
 */
export function orgProfileVersion(row: OrgProfile | null): number {
	return row?.updatedAt.getTime() ?? 0;
}

/**
 * writes the organisation's details from the dashboard: every column `saveOrgProfile` names but the
 * notification address, which has a save of its own (`updateOrgNotificationEmail` below), and only
 * where the row still carries `version`.
 *
 * one statement, as `saveOrgProfile` is: the insert the first time, and the guarded update after
 * it. the guard is the conflict arm's own `where`, so a tab drawn before another save is answered
 * `stale` with no read in front of the write for a race to fall between. an insert leaves the
 * notification address null, which is what a deployment with no profile holds.
 */
export async function updateOrgDetails(
	db: Db,
	version: Date,
	input: ParsedOrgProfile
): Promise<Exclude<OrgSave, 'no-profile'>> {
	const columns = {
		legalName: input.legalName,
		taxId: input.taxId,
		addressLine1: input.addressLine1,
		addressLine2: input.addressLine2,
		city: input.city,
		region: input.region,
		postalCode: input.postalCode,
		country: input.country,
		mission: input.mission,
		vision: input.vision,
		brandColour: input.brandColour,
		socialLinks: input.socialLinks
	};

	const written = await db
		.insert(orgProfile)
		.values({ id: ORG_PROFILE_ID, ...columns })
		.onConflictDoUpdate({
			target: orgProfile.id,
			set: columns,
			setWhere: eq(orgProfile.updatedAt, version)
		})
		.returning({ id: orgProfile.id });

	return written.length > 0 ? 'saved' : 'stale';
}

/**
 * writes the address this deployment reaches the organisation at, and nothing beside it, where the
 * row still carries `version`. `null` clears it.
 *
 * an update and never an insert: a row cannot exist without a legal name
 * (`org_profile_legal_name_not_blank_check`), so an address saved ahead of the details has no row
 * to land on and is answered `no-profile`. which of the two a write that matched nothing met is
 * read after it, and picks the answer rather than guarding anything.
 */
export async function updateOrgNotificationEmail(
	db: Db,
	version: Date,
	email: string | null
): Promise<OrgSave> {
	const written = await db
		.update(orgProfile)
		.set({ notificationEmail: email })
		.where(and(eq(orgProfile.id, ORG_PROFILE_ID), eq(orgProfile.updatedAt, version)))
		.returning({ id: orgProfile.id });
	if (written.length > 0) return 'saved';
	return (await readOrgProfile(db)) === null ? 'no-profile' : 'stale';
}

/**
 * whether supporters may start a fundraiser here: the stored setting, and on where no profile is
 * saved yet, the column's own default.
 */
export async function supporterFundraisersEnabled(db: Db): Promise<boolean> {
	const [row] = await db
		.select({ enabled: orgProfile.supporterFundraisersEnabled })
		.from(orgProfile)
		.where(eq(orgProfile.id, ORG_PROFILE_ID));
	return row?.enabled ?? true;
}

/**
 * `supporterFundraisersEnabled` as a condition, for a write that must land only while the setting
 * is on and so reads it in its own statement: true where no profile row says off.
 */
export function supporterFundraisersEnabledSql(db: Db): SQL {
	return notExists(
		db
			.select({ id: orgProfile.id })
			.from(orgProfile)
			.where(
				and(eq(orgProfile.id, ORG_PROFILE_ID), eq(orgProfile.supporterFundraisersEnabled, false))
			)
	);
}

/**
 * sets the supporter fundraisers setting, and nothing beside it. an update and never an insert,
 * for `updateOrgNotificationEmail`'s reason: with no profile there is no row to hold it, so turning
 * it off is `no-profile` and turning it on is already what no profile reads as. no version: the
 * setting is one switch, and the press is the whole of what it says.
 */
export async function setSupporterFundraisersEnabled(
	db: Db,
	enabled: boolean
): Promise<Exclude<OrgSave, 'stale'>> {
	const written = await db
		.update(orgProfile)
		.set({ supporterFundraisersEnabled: enabled })
		.where(eq(orgProfile.id, ORG_PROFILE_ID))
		.returning({ id: orgProfile.id });
	return written.length > 0 || enabled ? 'saved' : 'no-profile';
}

// ---------------------------------------------------------------------------
// the profile's logo, `org_profile.logo_image_id`, and its banner, `org_profile.banner_image_id`:
// a new photo put on or taken off, and the photo it replaces freed in the same `batch()` where
// nothing else names it (../images/free.ts). no undo: a freed image is gone.
//
// the write is compare-and-set on the photo it read, so the photo it frees is the one it replaced; a
// write landing between the two answers `stale`.
// ---------------------------------------------------------------------------

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

/**
 * store a new photo and put it on as the profile's logo, in one `batch()` with the guarded write
 * and the frees: the logo it replaces, and the new photo itself, which nothing names unless the
 * write landed. so a stale write or a failed batch leaves no photo behind, and `no-profile` is
 * answered before anything is written.
 */
export function putNewOrgProfileLogo(
	db: Db,
	photo: NewPhoto
): Promise<'written' | 'stale' | 'no-profile'> {
	return putNewProfileImage(db, 'logoImageId', photo);
}

/** take the profile's logo off, freeing it. no profile has no logo, so that is `written` too. */
export function removeOrgProfileLogo(db: Db): Promise<'written' | 'stale'> {
	return removeProfileImage(db, 'logoImageId');
}

/** `putNewOrgProfileLogo`, for the donate page's banner. */
export function putNewOrgProfileBanner(
	db: Db,
	photo: NewPhoto
): Promise<'written' | 'stale' | 'no-profile'> {
	return putNewProfileImage(db, 'bannerImageId', photo);
}

/** `removeOrgProfileLogo`, for the donate page's banner. */
export function removeOrgProfileBanner(db: Db): Promise<'written' | 'stale'> {
	return removeProfileImage(db, 'bannerImageId');
}

type NewPhoto = { readonly id: string; readonly statements: NewImageStatements };

/** a column of the profile that names one image. */
type ProfileImage = 'logoImageId' | 'bannerImageId';

async function putNewProfileImage(
	db: Db,
	slot: ProfileImage,
	photo: NewPhoto
): Promise<'written' | 'stale' | 'no-profile'> {
	const read = await readProfileImage(db, slot);
	if (!read) return 'no-profile';
	const [, , written] = await db.batch([
		...photo.statements,
		profileImageWrite(db, slot, read.id, photo.id),
		...freeImageStatements(db, photo.id),
		...(read.id === null ? [] : freeImageStatements(db, read.id))
	]);
	return written.length > 0 ? 'written' : 'stale';
}

async function removeProfileImage(db: Db, slot: ProfileImage): Promise<'written' | 'stale'> {
	const read = await readProfileImage(db, slot);
	if (!read) return 'written';
	const write = profileImageWrite(db, slot, read.id, null);
	if (read.id === null) return (await write).length > 0 ? 'written' : 'stale';
	const [written] = await db.batch([write, ...freeImageStatements(db, read.id)]);
	return written.length > 0 ? 'written' : 'stale';
}

/** the image a write compares against; undefined where no profile is saved. */
async function readProfileImage(
	db: Db,
	slot: ProfileImage
): Promise<{ readonly id: string | null } | undefined> {
	const [row] = await db
		.select({ id: orgProfile[slot] })
		.from(orgProfile)
		.where(eq(orgProfile.id, ORG_PROFILE_ID));
	return row;
}

/** the image set to `next` where it is still `read`, returning a row only where it landed. */
function profileImageWrite(db: Db, slot: ProfileImage, read: string | null, next: string | null) {
	return db
		.update(orgProfile)
		.set({ [slot]: next })
		.where(and(eq(orgProfile.id, ORG_PROFILE_ID), sql`${orgProfile[slot]} is ${read}`))
		.returning({ id: orgProfile.id });
}
