import { editPageDraft } from './draft-writer';
import {
	and,
	eq,
	exists,
	gt,
	inArray,
	isNotNull,
	isNull,
	ne,
	notExists,
	or,
	type SQL,
	sql
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Page as PageDocument } from '../../page/catalog';
import { stateAt } from '../../page/ended';
import { PAGE_KEYS } from '../../page/keys';
import { freeSlug, slugFromTitle } from '../../page/slug';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { form, type Page, page, photoLink } from '../db/schema';
import { freeLetGoStatements } from '../images/free';
import { MAX_FORM_NAME } from '../../forms/input-schema';
import type { ParsedFormGiving, ParsedFormProgram } from '../forms/form-input';
import { readForm, type StoredForm } from '../forms/queries';
import { readActivePrograms } from '../programs/queries';
import { documentsOf, placedPhotos, readableDraft } from './document';

// one page read by its id, the one module that deletes a `page`, gated by ./sole-deleter.spec.ts,
// where a campaign ends and where a live one is unpublished, the editor's two writes that are not page content — a campaign's
// name and its address — and its donation settings and the Settings sheet's keys, which are, each
// against the version the editor was drawn at; and the address a campaign's name asked for and did
// not get.
//
// a page is deleted only while it is a campaign nobody has ever been shown. once a page has been
// live a gift may point at its owned settings row, and ending it is the campaign's own state rather
// than a delete; the donation page is always live (`page_donation_page_live_check`), so it never
// qualifies for either. `page` in ../db/schema.ts argues the rest from the table's side.

/** the page with this id, of either type; null where there is none. */
export async function readPage(db: Db, pageId: string): Promise<Page | null> {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	return row ?? null;
}

/**
 * deletes a never-published campaign and the donation-settings row it owns, in one
 * `batch()`, while the page is still the version it was drawn at. false when the page is missing,
 * is the donation page, has ever been live, or has been written since `version`.
 *
 * the read only finds which settings row the page owns and which photos it places; every statement
 * carries its own guard, so a campaign published between the read and the batch loses nothing. the
 * settings row goes only once no page owns it, and a gift already naming it fails the batch whole on
 * its foreign key. a photo goes only once nothing places it (../images/free.ts).
 */
export async function deleteNeverPublishedCampaign(
	db: Db,
	pageId: string,
	version: Date
): Promise<boolean> {
	const [found] = await db.select().from(page).where(eq(page.id, pageId));
	if (!found) return false;

	const deletable = and(
		eq(page.id, pageId),
		eq(page.type, 'campaign'),
		eq(page.state, 'never_published'),
		eq(page.updatedAt, version)
	);
	// the page's photo links first, under the page's own guard: their foreign key is `NO ACTION`.
	const [, deleted] = await db.batch([
		db
			.delete(photoLink)
			.where(
				and(
					eq(photoLink.pageId, pageId),
					exists(db.select({ id: page.id }).from(page).where(deletable))
				)
			),
		db.delete(page).where(deletable).returning({ id: page.id }),
		db
			.delete(form)
			.where(
				and(
					eq(form.id, found.formId),
					notExists(db.select({ id: page.id }).from(page).where(eq(page.formId, found.formId)))
				)
			),
		...freeLetGoStatements(db, placedPhotos(found, documentsOf(found)), [])
	]);
	return deleted.length === 1;
}

/**
 * ends a live or unpublished campaign: the page to `ended` and the settings row it owns out of
 * service, in one `batch()`, and an unpublished one's address given up, while the page is still the version it was drawn at. false when the
 * page is missing, is the donation page, is neither live nor unpublished, or has been written since
 * `version`.
 *
 * the owned row goes to `draft`, which the served config and the gift endpoint refuse as they refuse
 * any unpublished form, so the address takes no new gift while a commitment already made on the row
 * keeps collecting (`readForm` in ../donations/collect.ts reads no status). the row's update runs
 * first and names the page by the same guard, so a campaign not live at that version leaves its row
 * alone.
 */
export async function endCampaign(db: Db, pageId: string, version: Date): Promise<boolean> {
	const [, ended] = await db.batch(ending(db, pageId, version));
	return ended.length === 1;
}

/**
 * `endCampaign`'s two statements, in its order, for a batch that ends a campaign among others, each
 * under `also` besides its own guard.
 */
function ending(db: Db, pageId: string, version: Date, also?: SQL) {
	const endable = and(
		eq(page.id, pageId),
		eq(page.type, 'campaign'),
		inArray(page.state, ['live', 'unpublished']),
		eq(page.updatedAt, version),
		also
	);
	return [
		db
			.update(form)
			.set({ status: 'draft' })
			.where(
				and(
					eq(form.status, 'live'),
					inArray(form.id, db.select({ id: page.formId }).from(page).where(endable))
				)
			),
		// an unpublished campaign answered nothing at its address, and ended it would answer with the
		// ended screen: it gives the address up instead.
		db
			.update(page)
			.set({
				state: 'ended',
				slug: sql`case when ${page.state} = 'unpublished' then null else ${page.slug} end`
			})
			.where(endable)
			.returning({ id: page.id })
	] as const;
}

/** what an Unpublish did; `not_live` is a campaign not public at `now`, ended by its date included. */
export type UnpublishWrite = 'unpublished' | 'not_live' | 'stale' | 'gone';

/**
 * takes a public campaign down without ending it: the page to `unpublished` and the settings row it
 * owns to `draft`, as `ending` does, in one `batch()`, while the page is still the version it was
 * drawn at and still short of its published end as of `now`. the published page and the address
 * stay, nothing answers there (`readServedCampaign` in ./campaign.ts), and Publish makes it live
 * again. the read only picks the answer; every statement carries the guard.
 */
export async function unpublishCampaign(
	db: Db,
	pageId: string,
	version: Date,
	now: number
): Promise<UnpublishWrite> {
	const [row] = await db
		.select()
		.from(page)
		.where(and(eq(page.id, pageId), eq(page.type, 'campaign')));
	if (!row) return 'gone';
	if (row.updatedAt.getTime() !== version.getTime()) return 'stale';
	if (stateAt(row, now) !== 'live') return 'not_live';
	const endsAt = sql`json_extract(${page.published}, ${`$.${PAGE_KEYS.endsAt}`})`;
	const unpublishable = and(
		eq(page.id, pageId),
		eq(page.type, 'campaign'),
		eq(page.state, 'live'),
		eq(page.updatedAt, version),
		or(isNull(endsAt), gt(endsAt, now))
	);
	const [, unpublished] = await db.batch([
		db
			.update(form)
			.set({ status: 'draft' })
			.where(
				and(
					eq(form.status, 'live'),
					inArray(form.id, db.select({ id: page.formId }).from(page).where(unpublishable))
				)
			),
		db.update(page).set({ state: 'unpublished' }).where(unpublishable).returning({ id: page.id })
	]);
	return unpublished.length === 1 ? 'unpublished' : 'stale';
}

/** what a move of a campaign's address did, or the question it waits on. */
export type SlugWrite =
	| { readonly kind: 'written' }
	| { readonly kind: 'gone' }
	| { readonly kind: 'stale' }
	/** another campaign holds the address and keeps it. */
	| { readonly kind: 'taken'; readonly by: string }
	/** the campaign has been published, and its address, which donors may hold, would stop working. */
	| { readonly kind: 'ask'; readonly ask: 'move'; readonly from: string }
	/** an ended campaign holds the address, and would be left with none. */
	| { readonly kind: 'ask'; readonly ask: 'takeover'; readonly holder: string };

/** the questions a move has been answered yes to. */
export type SlugConfirmed = { readonly move: boolean; readonly takeover: boolean };

/**
 * what moving the campaign `row` to `slug` takes: nothing, where it holds it already; a refusal or a
 * question, where `updateCampaignSlug` names one; or the statements that release the address from
 * an ended holder — ending it first where it is live past its published end — each to run ahead of
 * the write that sets the slug, in its `batch()`, under `drawn`, the guard over the moving page.
 * the release runs before the move, for `page_slug_idx`.
 */
export async function planSlugMove(
	db: Db,
	row: Pick<Page, 'id' | 'slug' | 'state'>,
	slug: string,
	confirmed: SlugConfirmed,
	now: number
): Promise<
	| { readonly kind: 'unchanged' }
	| Extract<SlugWrite, { kind: 'taken' | 'ask' }>
	| { readonly kind: 'move'; readonly before: (drawn: SQL) => BatchItem<'sqlite'>[] }
> {
	if (row.slug === slug) return { kind: 'unchanged' };

	const holder = await slugHolder(db, slug, now);
	if (holder !== null && holder.state !== 'ended') return { kind: 'taken', by: holder.name };
	if (row.state !== 'never_published' && row.slug !== null && !confirmed.move) {
		return { kind: 'ask', ask: 'move', from: row.slug };
	}
	if (holder !== null && !confirmed.takeover) {
		return { kind: 'ask', ask: 'takeover', holder: holder.name };
	}
	return {
		kind: 'move',
		before: (drawn) => {
			if (holder === null) return [];
			// guarded on the moving page still being the version it was drawn at, so a stale save
			// leaves the ended campaign its address, and one past its end date its state.
			const stillDrawn = exists(db.select({ id: page.id }).from(page).where(drawn));
			const release = db
				.update(page)
				.set({ slug: null })
				.where(
					and(eq(page.id, holder.id), eq(page.state, 'ended'), eq(page.slug, slug), stillDrawn)
				);
			if (holder.stored === 'ended') return [release];
			const [endRow, endPage] = ending(db, holder.id, holder.version, stillDrawn);
			return [endRow, endPage, release];
		}
	};
}

/**
 * who took `slug` while a batch moving a campaign to it ran: a campaign took the address, or an
 * ended holder was published again, between the read and the write, and `page_slug_idx` refused the
 * batch whole. any other failure is thrown on.
 */
export async function slugRace(db: Db, slug: string, now: number, error: unknown): Promise<string> {
	if (sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
	const taker = await slugHolder(db, slug, now);
	if (taker === null) throw error;
	return taker.name;
}

/**
 * the campaign holding `slug`, or null where none does: its `state` as of `now` (`isEnded`), and
 * the state and version stored.
 */
async function slugHolder(
	db: Db,
	slug: string,
	now: number
): Promise<{
	id: string;
	name: string;
	state: Page['state'];
	stored: Page['state'];
	version: Date;
} | null> {
	const [held] = await db
		.select({
			id: page.id,
			name: page.name,
			state: page.state,
			published: page.published,
			updatedAt: page.updatedAt
		})
		.from(page)
		.where(eq(page.slug, slug));
	if (!held) return null;
	// unreachable: `page_slug_check` gives no donation page a slug and `page_name_check` no
	// campaign a null name.
	if (held.name === null) throw new Error(`page ${held.id} holds "${slug}" and has no name`);
	return {
		id: held.id,
		name: held.name,
		state: stateAt(held, now),
		stored: held.state,
		version: held.updatedAt
	};
}

/** a free address is found this many times before a write taking one gives up on the race. */
export const SLUG_ATTEMPTS = 5;

/**
 * what makes `name` a campaign's name everywhere but its draft, in the batch that writes the
 * draft, each under `when` over the page row:
 * - the row's `name`, which the dashboard shows — the Campaigns list and the editor's bar;
 * - the owned settings row's `name`, which a gift's staff notice and Zapier's `form_name` carry
 *   (`ownedName`). it runs first, since the page's update moves what `when` reads;
 * - until the first publish, the address, where it still follows the name: the first `-2`, `-3`
 *   free (`freeSlug` in ../../page/slug.ts), as a new campaign's is. one set by hand stays, and so
 *   does a published campaign's, which donors may hold.
 *
 * a free address is read here, and `page_slug_idx` settles a race for it: the caller's batch fails
 * whole on `SQLITE_CONSTRAINT_UNIQUE`, and it tries again.
 */
export async function renaming(
	db: Db,
	row: Pick<Page, 'id' | 'formId' | 'state' | 'slug' | 'name'>,
	name: string,
	when: SQL | undefined
) {
	return {
		columns: await renamedColumns(db, row, name),
		owned: renamingOwned(db, row.formId, name, when)
	};
}

/** the page row's columns `renaming` sets: the name, and the address where it still follows it. */
export async function renamedColumns(
	db: Db,
	row: Pick<Page, 'id' | 'state' | 'slug' | 'name'>,
	name: string
): Promise<{ name: string; slug: string | null }> {
	if (row.state !== 'never_published' || !followsName(row.slug, row.name)) {
		return { name, slug: row.slug };
	}
	const held = await db
		.select({ slug: page.slug })
		.from(page)
		.where(and(isNotNull(page.slug), ne(page.id, row.id)));
	return { name, slug: freeSlug(name, new Set(held.map((each) => each.slug))) };
}

/** the name `document` holds where `row` is a campaign named otherwise; null where there is none. */
export function nameToCarry(
	row: Pick<Page, 'type' | 'name'>,
	document: PageDocument
): string | null {
	const { name } = document;
	return row.type === 'campaign' && name !== undefined && name !== row.name ? name : null;
}

/** a campaign's name as its settings row holds it, as long as a form's name may be. */
export function ownedName(name: string): string {
	return name.slice(0, MAX_FORM_NAME);
}

/** the owned settings row `formId` named `name`, under `when` over the page row. */
export function renamingOwned(db: Db, formId: string, name: string, when: SQL | undefined) {
	return db
		.update(form)
		.set({ name: ownedName(name) })
		.where(and(eq(form.id, formId), exists(db.select({ id: page.id }).from(page).where(when))));
}

/** whether `slug` is an address `freeSlug` gives `name`: its own, or a `-2`, `-3` after it. */
function followsName(slug: string | null, name: string | null): boolean {
	if (slug === null || name === null) return false;
	const suffix = /-(\d+)$/.exec(slug);
	const given = new Set<string>();
	for (let n = 1; n <= (suffix === null ? 1 : Number(suffix[1])); n += 1) {
		const next = freeSlug(name, given);
		if (next === slug) return true;
		given.add(next);
	}
	return false;
}

/** a page's draft donation settings, as its draft holds them. */
export type DraftSettings = NonNullable<PageDocument['settings']>;

/**
 * the donation settings a page's draft stands for: its own where it holds them, else the owned
 * settings row's, which is what the draft publishes unchanged.
 */
export async function draftSettingsOf(db: Db, row: Page): Promise<DraftSettings> {
	const { settings } = readableDraft(row);
	if (settings !== undefined) return settings;
	return settingsOfRow(await readOwnedRow(db, row));
}

/** the settings row a page owns; `page_form_id_idx` and its foreign key hold that there is one. */
export async function readOwnedRow(db: Db, row: Page): Promise<StoredForm> {
	const owned = await readForm(db, row.formId);
	if (owned === null) throw new Error(`page ${row.id}'s settings row ${row.formId} is gone`);
	return owned;
}

/** a settings row as a page document's `settings` holds it. */
export function settingsOfRow(owned: StoredForm): DraftSettings {
	const { revenueAccountId, minMinor, maxMinor, currency, programMode, programId } = owned;
	const { suggestedAmounts, allowedOrigins } = owned;
	return {
		revenueAccountId,
		minMinor,
		maxMinor,
		currency,
		programMode,
		programId,
		suggestedAmounts,
		allowedOrigins
	};
}

/** the page a donation-settings save writes: a campaign by its id, or the one Donation page. */
export type SettingsTarget =
	| { readonly type: 'campaign'; readonly id: string }
	| { readonly type: 'donation_page' };

/** the page `target` names; null where there is none. */
export async function readTarget(db: Db, target: SettingsTarget): Promise<Page | null> {
	const [row] = await db
		.select()
		.from(page)
		.where(
			target.type === 'campaign'
				? and(eq(page.id, target.id), eq(page.type, 'campaign'))
				: eq(page.type, 'donation_page')
		);
	return row ?? null;
}

/**
 * the draft donation settings of `row` with the program, the bounds and the suggested amounts moved
 * to these, the fund, currency and sites as the draft holds them. a cause newly pinned must be one
 * still offered; a pin the draft already holds is kept as it is, as the form screen keeps a form's.
 */
export async function draftSettingsAfter(
	db: Db,
	row: Page,
	input: {
		readonly program: ParsedFormProgram;
		readonly bounds: Pick<ParsedFormGiving, 'minMinor' | 'maxMinor'>;
		readonly suggestedAmounts: readonly number[];
	}
): Promise<DraftSettings | 'unknown_program'> {
	const held = await draftSettingsOf(db, row);
	const { programMode, programId } = input.program;
	if (programId !== null && programId !== held.programId) {
		const offered = await readActivePrograms(db);
		if (!offered.some((cause) => cause.id === programId)) return 'unknown_program';
	}
	return {
		...held,
		programMode,
		programId,
		minMinor: input.bounds.minMinor,
		maxMinor: input.bounds.maxMinor,
		suggestedAmounts: [...input.suggestedAmounts]
	};
}

/** a page document's keys the Settings sheet sets one at a time; `undefined` removes a key. */
export type DraftKeys = Partial<Pick<PageDocument, 'goalMinor' | 'endsAt' | 'endsZone'>>;

const pageOf = (target: SettingsTarget) =>
	target.type === 'campaign' ? target.id : 'donation_page';
