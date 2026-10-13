import { and, eq, exists, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineForm, type RejectionStatus } from '../../forms/definition';
import {
	FORM_FIELD_LABELS,
	type FormInputField,
	type FormInputFieldErrors
} from '../../forms/fields';
import type { Page as PageDocument, PageRefusal } from '../../page/catalog';
import { dayWords, endDayOf } from '../../page/end-date';
import { stateAt } from '../../page/ended';
import {
	DISCARD_FORM_ID,
	FIRST_PUBLISH_FORM_ID,
	GIFTS_GO_TO,
	PUBLISH_FORM_ID,
	PUBLISH_FORMS,
	UNDO_FORM_ID
} from '../../page/publish-form';
import { freeSlug } from '../../page/slug';
import { invalid, type ParsedForm, parseForm, submittedForm, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { chatTurn, form, type Page, page, program } from '../db/schema';
import {
	formInputValuesFrom,
	type ParseResult,
	parseFormGiving,
	parseFormProgram
} from '../forms/form-input';
import { encodeSuggestedAmounts } from '../forms/form-json';
import type { StoredForm } from '../forms/queries';
import { readDocument } from './document';
import { unchosenSettings } from './donation-page';
import {
	type DraftSettings,
	nameToCarry,
	ownedName,
	readOwnedRow,
	readTarget,
	renamingOwned,
	SLUG_ATTEMPTS,
	type SettingsTarget,
	settingsOfRow
} from './queries';

// Publish, Undo and Discard changes: the editor's presses on the whole page, the Donation page's
// and a campaign's alike, and the action arm both editors answer them with. each is one `batch()`
// guarded on the version the editor was drawn at (`submittedVersion` in ../conform.ts), so a press
// drawn before any other write moves nothing.
//
// **Publish** holds the draft to the page rule (`parsePage`), a campaign's end date to the future,
// and its donation settings to a form row's program and giving rules, then makes it live: `published`
// is the draft, the draft is that same text, `last_published` keeps the page it replaced, and the
// owned settings row takes the draft's settings and goes live, so what donors see and what a gift
// is checked against move together (`page` in ../db/schema.ts). the chat is kept. a draft holding
// no settings of its own — the Donation page's until the operator saves Donation settings — goes
// live holding none, and the row keeps what it has.
// - where gifts go ("Gifts go to") is answered at a campaign's first Publish and nowhere else: a
//   first Publish without that answer is refused, and so is an answer on a page already published,
//   whose program is Donation settings'.
// - a program newly pinned must be one still offered; the one the row pins, or the draft already
//   pins, is taken as it is.
// - an ended campaign published again, ended by End or by its end date (../../page/ended.ts), is
//   live at its address, or, where another took it meanwhile, at the next free `-2`, `-3` from its
//   name, with nothing to undo: the page it replaced is the one it ended on.
//
// **Undo** swaps `published` and `last_published`. `last_published` carries the settings row as it
// stood before the Publish, so the swap puts back both the page and what a gift is charged against;
// one carrying none puts back the Donation page's settings from before the operator chose
// (`unchosenSettings` in ./donation-page.ts).
// the page replaced is kept for Undo only where it still passes the page rule. an Undo that would
// pin gifts to a program retired since, and not pinned now, is refused, and so is one that would put
// back a page whose end date has passed since, as Publish refuses it. the draft stays as it is,
// and the editor reads it as changes not published.
//
// **Discard changes** puts the draft back to the live page, a campaign's name with it, and empties
// the page's chat.

/** what a Publish did. */
export type PublishOutcome =
	| { readonly kind: 'published'; readonly undoable: boolean }
	/** the page as drafted may not go live; `text` names why and what to change. */
	| { readonly kind: 'refused'; readonly text: string }
	/** the page has been written since the editor was drawn. */
	| { readonly kind: 'stale' }
	| { readonly kind: 'gone' };

/** a refusal's sentence: nothing moved, and why. */
const refused = (why: string): PublishOutcome => ({
	kind: 'refused',
	text: `Nothing was published: ${why}.`
});

/** the page rule's refusal, with where it lands unless the message already names the block. */
function ruleRefusal(refusal: PageRefusal): string {
	const [root] = refusal.path;
	return root === undefined || root === 'blocks'
		? refusal.message
		: `${refusal.message} (at ${refusal.path.join('.')})`;
}

/** a document's end as its day in words, in the zone it was chosen in. */
function endWords(document: PageDocument, endsAt: number): string {
	return dayWords(endDayOf(document) ?? new Date(endsAt).toISOString().slice(0, 10));
}

/**
 * the settings row's columns a Publish or an Undo moves: the program and what a donor may give,
 * which the Donation settings sheet edits. the fund, currency and sites are the row's own and no
 * draft moves them.
 */
function settingsColumns(settings: DraftSettings) {
	return {
		minMinor: settings.minMinor,
		maxMinor: settings.maxMinor,
		programMode: settings.programMode,
		programId: settings.programId,
		suggestedAmounts: encodeSuggestedAmounts(settings.suggestedAmounts)
	};
}

/**
 * the draft's donation settings held to a form row's program and giving rules, as the owned row
 * will hold them; a refusal names each box that fails, as the Donation settings sheet labels it.
 */
function settingsRule(owned: StoredForm, settings: DraftSettings): ParseResult<DraftSettings> {
	const { programMode, programId, minMinor, maxMinor, suggestedAmounts } = settings;
	const values = formInputValuesFrom({
		...owned,
		programMode,
		programId,
		minMinor,
		maxMinor,
		suggestedAmounts
	});
	const program = parseFormProgram(values);
	const giving = parseFormGiving(values);
	if (!program.ok || !giving.ok) {
		return {
			ok: false,
			errors: { ...(program.ok ? {} : program.errors), ...(giving.ok ? {} : giving.errors) }
		};
	}
	return {
		ok: true,
		value: {
			...settings,
			programMode: program.value.programMode,
			programId: program.value.programId,
			minMinor: giving.value.minMinor,
			maxMinor: giving.value.maxMinor,
			suggestedAmounts: [...giving.value.suggestedAmounts]
		}
	};
}

function settingsRefusal(errors: FormInputFieldErrors): string {
	const each = Object.entries(errors).map(
		([box, sentence]) => `${FORM_FIELD_LABELS[box as FormInputField]} ${sentence}`
	);
	return `in Donation settings, ${each.join('; ')}`;
}

export async function publishPage(
	db: Db,
	target: SettingsTarget,
	version: Date,
	at: {
		readonly now: number;
		/**
		 * a first Publish's answer to where gifts go: a program to pin, or null to keep what the
		 * draft's donation settings hold. absent, a campaign never published is refused.
		 */
		readonly giftsGoTo?: string | null | undefined;
	}
): Promise<PublishOutcome> {
	const row = await readTarget(db, target);
	if (row === null) return { kind: 'gone' };
	const draft = readDocument(row, 'draft', row.draft);
	if (!draft.ok) return refused(ruleRefusal(draft));
	const { endsAt } = draft.page;
	if (endsAt !== undefined && endsAt <= at.now) {
		return refused(
			`the end date, ${endWords(draft.page, endsAt)}, has passed. Change or clear it in Settings, then publish`
		);
	}
	const first = row.state === 'never_published';
	if (first && at.giftsGoTo === undefined) {
		return refused(
			'a campaign’s first Publish says where its gifts go. Publish it from its editor, choosing under “Gifts go to”'
		);
	}
	if (!first && at.giftsGoTo !== undefined) {
		return refused(
			'where gifts go is asked only at a campaign’s first Publish. Change it in Settings, Donation settings, then publish'
		);
	}
	const owned = await readOwnedRow(db, row);
	const live = settingsOfRow(owned);
	const drafted = draft.page.settings ?? live;
	const ruled = settingsRule(
		owned,
		typeof at.giftsGoTo === 'string'
			? { ...drafted, programMode: 'pinned', programId: at.giftsGoTo }
			: drafted
	);
	if (!ruled.ok) return refused(settingsRefusal(ruled.errors));
	const settings = ruled.value;
	const held = [live.programId, drafted.programId];
	if ((await retiredPin(db, settings.programId, held)) !== null) {
		return refused('the program chosen for gifts is no longer offered. Choose another');
	}
	// a draft holding no settings of its own publishes none, and the row keeps what it holds: the
	// Donation page's program goes on following the active programs (./donation-page.ts).
	const carried = draft.page.settings !== undefined || typeof at.giftsGoTo === 'string';
	const published: PageDocument = carried ? { ...draft.page, settings } : draft.page;
	const replaced = stateAt(row, at.now) === 'live' ? kept(row, live) : null;
	const document = JSON.stringify(published);
	// a name the draft holds and the row does not is the campaign's from now on, as a rename makes it
	// (`renaming` in ./queries.ts), the address aside: the first Publish's confirm named that.
	const renamed = nameToCarry(row, draft.page);

	const drawn = and(eq(page.id, row.id), eq(page.updatedAt, version), eq(page.draft, row.draft));
	for (let attempt = 1; ; attempt += 1) {
		const slug = await addressFor(db, row);
		try {
			const [, made] = await db.batch([
				db
					.update(form)
					.set({
						...(carried ? settingsColumns(settings) : {}),
						...(renamed === null ? {} : { name: ownedName(renamed) }),
						status: 'live'
					})
					.where(
						and(eq(form.id, row.formId), exists(db.select({ id: page.id }).from(page).where(drawn)))
					),
				db
					.update(page)
					.set({
						draft: document,
						published: document,
						lastPublished: replaced,
						state: 'live',
						slug,
						...(renamed === null ? {} : { name: renamed })
					})
					.where(drawn)
					.returning({ id: page.id })
			]);
			return made.length === 1
				? { kind: 'published', undoable: replaced !== null }
				: { kind: 'stale' };
		} catch (error) {
			// another campaign took the free address between the read and the batch.
			const retry = row.slug === null && attempt < SLUG_ATTEMPTS;
			if (!retry || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
		}
	}
}

/**
 * the live page a Publish replaces, with the settings row as it stood inside it where that page
 * carried settings, for Undo; null where that page no longer passes the page rule, which an Undo
 * could not put back.
 */
function kept(row: Page, live: DraftSettings): string | null {
	if (row.published === null) return null;
	const replaced = readDocument(row, 'published', row.published);
	if (!replaced.ok) return null;
	return JSON.stringify(
		replaced.page.settings === undefined ? replaced.page : { ...replaced.page, settings: live }
	);
}

/**
 * the name of the program `programId` pins where it is retired and not among the pins `held`
 * already; null where the pin may stand.
 */
async function retiredPin(
	db: Db,
	programId: string | null,
	held: readonly (string | null)[]
): Promise<string | null> {
	if (programId === null || held.includes(programId)) return null;
	const [pinned] = await db
		.select({ name: program.name, archivedAt: program.archivedAt })
		.from(program)
		.where(eq(program.id, programId));
	// an id no program has, posted by hand, may take no gift either; the id stands in for its name.
	if (pinned === undefined) return programId;
	return pinned.archivedAt === null ? null : pinned.name;
}

/**
 * where the page answers once live: the address it holds, or, for an ended campaign whose address
 * another took meanwhile, the first `-2`, `-3` free from its name (`freeSlug`).
 */
async function addressFor(db: Db, row: Page): Promise<string | null> {
	if (row.type !== 'campaign' || row.slug !== null) return row.slug;
	// unreachable: `page_name_check` holds every campaign to a name.
	if (row.name === null) throw new Error(`campaign ${row.id} has no name`);
	const held = await db.select({ slug: page.slug }).from(page).where(isNotNull(page.slug));
	return freeSlug(row.name, new Set(held.map((each) => each.slug)));
}

/** what an Undo did; `nothing` is a page no Publish has replaced. */
export type UndoOutcome =
	| { readonly kind: 'undone' }
	| { readonly kind: 'nothing' }
	| { readonly kind: 'refused'; readonly text: string }
	| { readonly kind: 'stale' }
	| { readonly kind: 'gone' };

/**
 * puts back the page the last Publish replaced, and the donation settings it went live with, in
 * one `batch()`: `published` and `last_published` swap, and the owned row takes the settings the
 * restored document carries. the draft stays as it is.
 */
export async function undoPublish(
	db: Db,
	target: SettingsTarget,
	version: Date,
	at: { readonly now: number }
): Promise<UndoOutcome> {
	const row = await readTarget(db, target);
	if (row === null) return { kind: 'gone' };
	if (row.lastPublished === null || row.published === null) return { kind: 'nothing' };
	const restored = readDocument(row, 'last_published', row.lastPublished);
	// a Publish keeps only a page that passes the rule.
	if (!restored.ok) throw new Error(`page ${row.id}'s last published page cannot be put back`);
	const { endsAt } = restored.page;
	if (endsAt !== undefined && endsAt <= at.now) {
		return {
			kind: 'refused',
			text: `Nothing was undone: the page before ended on ${endWords(restored.page, endsAt)}, which has passed.`
		};
	}
	const owned = await readOwnedRow(db, row);
	// only the Donation page publishes a page with no settings of its own (a campaign is made with
	// them), and the row it stood on then held the Donation page's own until the operator chose.
	const settings = restored.page.settings ?? (await unchosenSettings(db, owned));
	const retired = await retiredPin(db, settings.programId, [owned.programId]);
	if (retired !== null) {
		return {
			kind: 'refused',
			text: `Nothing was undone: the page before gave its gifts to ${retired}, which is no longer offered.`
		};
	}

	const drawn = and(
		eq(page.id, row.id),
		eq(page.updatedAt, version),
		eq(page.published, row.published),
		eq(page.lastPublished, row.lastPublished)
	);
	const [, undone] = await db.batch([
		db
			.update(form)
			.set(settingsColumns(settings))
			.where(
				and(eq(form.id, row.formId), exists(db.select({ id: page.id }).from(page).where(drawn)))
			),
		db
			.update(page)
			.set({ published: row.lastPublished, lastPublished: row.published })
			.where(drawn)
			.returning({ id: page.id })
	]);
	return undone.length === 1 ? { kind: 'undone' } : { kind: 'stale' };
}

/** what a Discard changes did; `nothing` is a campaign never published, with no live page. */
export type DiscardOutcome =
	| { readonly kind: 'discarded' }
	| { readonly kind: 'nothing' }
	| { readonly kind: 'stale' }
	| { readonly kind: 'gone' };

/**
 * the draft back to the live page and the page's chat emptied, in one `batch()`. a campaign renamed
 * since takes the live page's name back, everywhere a rename reaches (`renamingOwned` in
 * ./queries.ts), since the draft's name and the row's are one.
 */
export async function discardChanges(
	db: Db,
	target: SettingsTarget,
	version: Date
): Promise<DiscardOutcome> {
	const row = await readTarget(db, target);
	if (row === null) return { kind: 'gone' };
	if (row.published === null) return { kind: 'nothing' };

	// the chat's delete runs first and names the page by the same guard, since the page's update
	// moves the version it is guarded on.
	const drawn = and(
		eq(page.id, row.id),
		eq(page.updatedAt, version),
		eq(page.published, row.published)
	);
	const live = readDocument(row, 'published', row.published);
	const renamed = live.ok ? nameToCarry(row, live.page) : null;
	const statements = [
		db
			.delete(chatTurn)
			.where(
				and(eq(chatTurn.pageId, row.id), exists(db.select({ id: page.id }).from(page).where(drawn)))
			),
		db
			.update(page)
			.set({ draft: row.published, ...(renamed === null ? {} : { name: renamed }) })
			.where(drawn)
			.returning({ id: page.id })
	] as const;
	const [, discarded] =
		renamed === null
			? await db.batch(statements)
			: await db
					.batch([renamingOwned(db, row.formId, renamed, drawn), ...statements])
					.then(([, ...rest]) => rest);
	return discarded.length === 1 ? { kind: 'discarded' } : { kind: 'stale' };
}

const PUBLISH = defineForm({ id: PUBLISH_FORM_ID, schema: z.object({}) });
const FIRST_PUBLISH = defineForm({
	id: FIRST_PUBLISH_FORM_ID,
	schema: z.object({ [GIFTS_GO_TO]: z.string('required') })
});
const UNDO = defineForm({ id: UNDO_FORM_ID, schema: z.object({}) });
const DISCARD = defineForm({ id: DISCARD_FORM_ID, schema: z.object({}) });

export const STALE =
	'Nothing was changed: this page has been saved since the editor was opened. Reload it, then try again.';
const NOTHING_TO_UNDO = 'Nothing was undone: no earlier version of this page was published.';
const NOTHING_TO_DISCARD =
	'Nothing was discarded: this campaign has never been published, so there is no live page to go back to.';
/** every press this module answers; the Donation page's action routes all but the first Publish. */
const PRESSES = [...PUBLISH_FORMS, FIRST_PUBLISH_FORM_ID] as const;
type PublishForm = (typeof PRESSES)[number];

const FAILED: Record<PublishForm, string> = {
	[PUBLISH_FORM_ID]: 'Publishing failed and nothing was changed. Try again.',
	[FIRST_PUBLISH_FORM_ID]: 'Publishing failed and nothing was changed. Try again.',
	[UNDO_FORM_ID]: 'Undoing failed and nothing was changed. Try again.',
	[DISCARD_FORM_ID]: 'Discarding the changes failed and nothing was changed. Try again.'
};

/** a first Publish's answer as `publishPage` takes it: a mode word keeps the draft's program. */
function giftsGoTo(answer: string): string | null {
	return answer === 'none' || answer === 'choice' ? null : answer;
}

/**
 * the editors' Publish, first Publish, Undo and Discard changes, for either editor: the press read
 * off the body, run against the version the editor was drawn at on the page `target` names, and
 * answered at the control pressed. `gone` is what a press on no such page is told.
 */
export async function answerPublishPress(
	db: Db,
	target: SettingsTarget,
	body: FormData,
	gone: string
) {
	const now = Date.now();
	switch (submittedForm(body, PRESSES)) {
		case PUBLISH_FORM_ID:
			return answer(PUBLISH_FORM_ID, parseForm(body, PUBLISH), (seen) =>
				publishPage(db, target, seen, { now })
			);
		case FIRST_PUBLISH_FORM_ID:
			return answer(FIRST_PUBLISH_FORM_ID, parseForm(body, FIRST_PUBLISH), (seen, value) =>
				publishPage(db, target, seen, { now, giftsGoTo: giftsGoTo(value[GIFTS_GO_TO]) })
			);
		case UNDO_FORM_ID:
			return answer(UNDO_FORM_ID, parseForm(body, UNDO), (seen) =>
				undoPublish(db, target, seen, { now })
			);
		case DISCARD_FORM_ID:
			return answer(DISCARD_FORM_ID, parseForm(body, DISCARD), (seen) =>
				discardChanges(db, target, seen)
			);
	}

	async function answer<T>(
		which: PublishForm,
		submission: ParsedForm<T>,
		run: (seen: Date, value: T) => Promise<PublishOutcome | UndoOutcome | DiscardOutcome>
	) {
		if (!submission.ok) return invalid(400, submission.reject());
		const seen = submittedVersion(body);
		const refuse = (status: RejectionStatus, text: string) =>
			invalid(status, submission.reject({ formErrors: [text] }));
		let outcome: PublishOutcome | UndoOutcome | DiscardOutcome;
		try {
			outcome = await run(seen, submission.value);
		} catch (e) {
			console.error(`${which} on ${JSON.stringify(target)} failed:`, e);
			return refuse(500, FAILED[which]);
		}
		switch (outcome.kind) {
			case 'published':
				return { published: true as const, undoable: outcome.undoable };
			case 'undone':
				return { undone: true as const };
			case 'discarded':
				return { discarded: true as const };
			case 'refused':
				return refuse(422, outcome.text);
			case 'nothing':
				return refuse(409, which === UNDO_FORM_ID ? NOTHING_TO_UNDO : NOTHING_TO_DISCARD);
			case 'stale':
				return refuse(409, STALE);
			case 'gone':
				return refuse(404, gone);
		}
	}
}
