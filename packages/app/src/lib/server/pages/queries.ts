import { and, eq, exists, inArray, isNotNull, ne, notExists } from 'drizzle-orm';
import { type Page as PageDocument, parsePage } from '../../page/catalog';
import { freeSlug } from '../../page/slug';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { chatTurn, form, type Page, page } from '../db/schema';
import type { ParsedFormGiving, ParsedFormProgram } from '../forms/form-input';
import { readForm } from '../forms/queries';
import { readActivePrograms } from '../programs/queries';

// one page read by its id, the one module that deletes a `page`, gated by ./sole-deleter.spec.ts,
// where a live campaign ends, the editor's two writes that are not page content — a campaign's
// name and its address — and its donation settings, which are, each against the version the editor
// was drawn at.
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
 * deletes a never-published campaign, its chat and the donation-settings row it owns, in one
 * `batch()`. false when the page is missing, is the donation page, or has ever been live.
 *
 * the read only finds which settings row the page owns; every statement carries its own guard, so
 * a campaign published between the read and the batch loses nothing. the settings row goes only
 * once no page owns it, and a gift already naming it fails the batch whole on its foreign key.
 */
export async function deleteNeverPublishedCampaign(db: Db, pageId: string): Promise<boolean> {
	const [found] = await db.select({ formId: page.formId }).from(page).where(eq(page.id, pageId));
	if (!found) return false;

	const deletable = and(
		eq(page.id, pageId),
		eq(page.type, 'campaign'),
		eq(page.state, 'never_published')
	);
	const [, deleted] = await db.batch([
		db
			.delete(chatTurn)
			.where(inArray(chatTurn.pageId, db.select({ id: page.id }).from(page).where(deletable))),
		db.delete(page).where(deletable).returning({ id: page.id }),
		db
			.delete(form)
			.where(
				and(
					eq(form.id, found.formId),
					notExists(db.select({ id: page.id }).from(page).where(eq(page.formId, found.formId)))
				)
			)
	]);
	return deleted.length === 1;
}

/**
 * ends a live campaign: the page to `ended` and the settings row it owns out of service, in one
 * `batch()`. false when the page is missing, is the donation page, or is not live.
 *
 * the owned row goes to `draft`, which the served config and the gift endpoint refuse as they refuse
 * any unpublished form, so the address takes no new gift while a commitment already made on the row
 * keeps collecting (`readForm` in ../donations/collect.ts reads no status). the row's update runs
 * first and names the page by the same guard, so a campaign that is not live leaves its row alone.
 */
export async function endCampaign(db: Db, pageId: string): Promise<boolean> {
	const endable = and(eq(page.id, pageId), eq(page.type, 'campaign'), eq(page.state, 'live'));
	const [, ended] = await db.batch([
		db
			.update(form)
			.set({ status: 'draft' })
			.where(
				and(
					eq(form.status, 'live'),
					inArray(form.id, db.select({ id: page.formId }).from(page).where(endable))
				)
			),
		db.update(page).set({ state: 'ended' }).where(endable).returning({ id: page.id })
	]);
	return ended.length === 1;
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
 * moves a campaign to `slug`, one the address rule (`checkSlug` in ../../page/slug.ts) has passed,
 * while the page is still the version it was drawn at. an address is not page content: it takes
 * effect here, not at publish.
 */
export async function updateCampaignSlug(
	db: Db,
	pageId: string,
	version: Date,
	slug: string,
	confirmed: SlugConfirmed
): Promise<SlugWrite> {
	const [row] = await db
		.select({ slug: page.slug, state: page.state })
		.from(page)
		.where(and(eq(page.id, pageId), eq(page.type, 'campaign')));
	if (!row) return { kind: 'gone' };
	if (row.slug === slug) return { kind: 'written' };

	const holder = await slugHolder(db, slug);
	if (holder !== null && holder.state !== 'ended') return { kind: 'taken', by: holder.name };
	if (row.state !== 'never_published' && row.slug !== null && !confirmed.move) {
		return { kind: 'ask', ask: 'move', from: row.slug };
	}
	if (holder !== null && !confirmed.takeover) {
		return { kind: 'ask', ask: 'takeover', holder: holder.name };
	}

	// both statements are guarded on the page still being the version it was drawn at, so a stale
	// save leaves the ended campaign its address; the release runs first, for `page_slug_idx`.
	const drawn = and(eq(page.id, pageId), eq(page.updatedAt, version));
	const move = db.update(page).set({ slug }).where(drawn).returning({ id: page.id });
	try {
		let moved: { id: string }[];
		if (holder === null) {
			moved = await move;
		} else {
			[, moved] = await db.batch([
				db
					.update(page)
					.set({ slug: null })
					.where(
						and(
							eq(page.id, holder.id),
							eq(page.state, 'ended'),
							eq(page.slug, slug),
							exists(db.select({ id: page.id }).from(page).where(drawn))
						)
					),
				move
			]);
		}
		return moved.length === 1 ? { kind: 'written' } : { kind: 'stale' };
	} catch (error) {
		// a campaign took the address, or an ended holder was published again, between the read and
		// the write: `page_slug_idx` refused the batch whole.
		if (sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
		const taker = await slugHolder(db, slug);
		if (taker === null) throw error;
		return { kind: 'taken', by: taker.name };
	}
}

/** the campaign holding `slug`, or null where none does. */
async function slugHolder(
	db: Db,
	slug: string
): Promise<{ id: string; name: string; state: Page['state'] } | null> {
	const [held] = await db
		.select({ id: page.id, name: page.name, state: page.state })
		.from(page)
		.where(eq(page.slug, slug));
	if (!held) return null;
	// unreachable: `page_slug_check` gives no donation page a slug and `page_name_check` no
	// campaign a null name.
	if (held.name === null) throw new Error(`page ${held.id} holds "${slug}" and has no name`);
	return { id: held.id, name: held.name, state: held.state };
}

/** what a rename did: the page as drawn is no longer the page stored, or there is none. */
export type NameWrite = 'written' | 'stale' | 'gone';

/** a free address is found this many times before a rename gives up on the race. */
const SLUG_ATTEMPTS = 5;

/**
 * renames a campaign — the row's `name`, which the dashboard shows, and its draft's, which donors
 * see from the next publish — while the page is still the version it was drawn at. until the first
 * publish the address follows the name, to the first `-2`, `-3` free, as a new campaign's does
 * (`freeSlug` in ../../page/slug.ts); once published it stays where it is.
 */
export async function updateCampaignName(
	db: Db,
	pageId: string,
	version: Date,
	name: string
): Promise<NameWrite> {
	for (let attempt = 1; ; attempt += 1) {
		const [row] = await db
			.select({ state: page.state, slug: page.slug, draft: page.draft })
			.from(page)
			.where(and(eq(page.id, pageId), eq(page.type, 'campaign')));
		if (!row) return 'gone';

		const draft = JSON.stringify({ ...JSON.parse(row.draft), name });
		let slug = row.slug;
		if (row.state === 'never_published') {
			const held = await db
				.select({ slug: page.slug })
				.from(page)
				.where(and(isNotNull(page.slug), ne(page.id, pageId)));
			slug = freeSlug(name, new Set(held.map((each) => each.slug)));
		}
		try {
			const renamed = await db
				.update(page)
				.set({ name, draft, slug })
				.where(and(eq(page.id, pageId), eq(page.updatedAt, version), eq(page.draft, row.draft)))
				.returning({ id: page.id });
			return renamed.length === 1 ? 'written' : 'stale';
		} catch (error) {
			if (attempt === SLUG_ATTEMPTS || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') {
				throw error;
			}
		}
	}
}

/** a page's draft donation settings, as its draft holds them. */
export type DraftSettings = NonNullable<PageDocument['settings']>;

/**
 * the donation settings a page's draft stands for: its own where it holds them, else the owned
 * settings row's, which is what the draft publishes unchanged.
 */
export async function draftSettingsOf(db: Db, row: Page): Promise<DraftSettings> {
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(`page ${row.id}'s stored draft fails its rule: ${draft.message}`);
	if (draft.page.settings !== undefined) return draft.page.settings;
	const owned = await readForm(db, row.formId);
	if (owned === null) throw new Error(`page ${row.id}'s settings row ${row.formId} is gone`);
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

/** what a donation-settings save did; `unknown_program` pins a cause no longer offered. */
export type SettingsWrite = 'written' | 'stale' | 'gone' | 'unknown_program';

/**
 * writes a page's draft donation settings — the program and what a donor may give — while the page
 * is still the version it was drawn at. the draft alone: the owned settings row, which /donate, a
 * campaign's address and every gift read, moves only at Publish. the fund, currency and sites stay
 * as the draft holds them.
 *
 * a cause newly pinned must be one still offered; a pin the draft already holds is kept as it is,
 * as the form screen keeps a form's.
 */
export async function updateDraftSettings(
	db: Db,
	target: SettingsTarget,
	version: Date,
	input: { readonly program: ParsedFormProgram; readonly giving: ParsedFormGiving }
): Promise<SettingsWrite> {
	const [row] = await db
		.select()
		.from(page)
		.where(
			target.type === 'campaign'
				? and(eq(page.id, target.id), eq(page.type, 'campaign'))
				: eq(page.type, 'donation_page')
		);
	if (!row) return 'gone';

	const held = await draftSettingsOf(db, row);
	const { programMode, programId } = input.program;
	if (programId !== null && programId !== held.programId) {
		const offered = await readActivePrograms(db);
		if (!offered.some((cause) => cause.id === programId)) return 'unknown_program';
	}
	const settings: DraftSettings = {
		...held,
		programMode,
		programId,
		minMinor: input.giving.minMinor,
		maxMinor: input.giving.maxMinor,
		suggestedAmounts: [...input.giving.suggestedAmounts]
	};
	const draft = JSON.stringify({ ...JSON.parse(row.draft), settings });
	const written = await db
		.update(page)
		.set({ draft })
		.where(and(eq(page.id, row.id), eq(page.updatedAt, version), eq(page.draft, row.draft)))
		.returning({ id: page.id });
	return written.length === 1 ? 'written' : 'stale';
}
