import { eq } from 'drizzle-orm';
import { formatMinorBrief } from '../../donations/money';
import { majorEntry } from '../../forms/amounts';
import { FORM_TEXT_FIELDS, type FormInputFieldErrors } from '../../forms/fields';
import { PROGRAM_MODE_LABELS } from '../../forms/program-modes';
import { endDayOf } from '../../page/end-date';
import { stateAt } from '../../page/ended';
import { defineForm } from '../../forms/definition';
import { PAGE_SETTINGS_INPUT } from '../../forms/input-schema';
import { PAGE_SETTINGS_FORM_ID, type SettingsSeed, SWITCH_LABELS } from '../../page/settings-form';
import { invalid, parseForm, submittedVersion } from '../conform';
import type { Db } from '../db/client';
import { type Page, program } from '../db/schema';
import { cachedCadences } from '../forms/cadence-cache';
import { formInputValues, parseFormGiving, parseFormProgram } from '../forms/form-input';
import { createPaymentProviders } from '../payments/factory';
import { readableDraft, readDocument } from './document';
import { readActivePrograms } from '../programs/queries';
import {
	type DraftSettings,
	draftSettingsOf,
	type SettingsTarget,
	type SettingsWrite,
	updateDraftSettings
} from './queries';

// what the editor is drawn with, the Donation page's and a campaign's alike: where the page stands
// against what donors see, the version every press on it is written against, the preview route
// that frames its draft (src/routes/preview.$pageId.tsx), and the route its chat is asked by
// (src/routes/_app.admin.pages.$pageId.chat.ts).
//
// the Settings sheet's rows read the draft, which is what the editor changes; a goal and an end
// date are a campaign's alone and read null on the Donation page.
//
// **the donation settings** are the draft's own (`draftSettingsOf` in ./queries.ts), drawn into
// the Settings sheet's Donation settings as a form's program and giving groups are drawn, and saved
// by its one Done through `saveDraftSettings` below under a form's own rules — to the draft only,
// so neither the live page nor what a gift is charged moves before Publish. the same Done writes the
// page's two switches into the draft's `switches`, never into the owned settings row: where the box
// opens is a fact about the page, and a form has no such setting.
//
// the version is the row's `updated_at`, which every write to the row moves — a chat turn's draft,
// a rename, an address — so a press drawn before any of them is refused rather than putting back
// what that write moved (`submittedVersion` in ../conform.ts). the preview is keyed on it too, so the
// frame reloads on the render any write's revalidation lands in.

/** where a page stands against what donors see. */
export type EditorState = 'unpublished' | 'changed' | 'live' | 'ended';

/** what the editor draws whether or not its draft reads. */
type EditorFrame = {
	readonly state: EditorState;
	/** the row's `updated_at` in unix ms. */
	readonly version: number;
	readonly preview: string;
	readonly chat: string;
};

export type EditorPage = EditorFrame & {
	readonly unreadable: false;
	/** the draft's own share message, or null while it takes the Organisation's. */
	readonly shareMessage: string | null;
	readonly goalMinor: number | null;
	/** the day the draft's end closes, `YYYY-MM-DD`, in the zone it was chosen in. */
	readonly endDate: string | null;
};

/** the editor over a draft the read rule refuses: a notice, and the presses that repair it. */
export type UnreadableEditor = EditorFrame & {
	readonly unreadable: true;
	/** whether the live page reads, so Discard changes has a page to put the draft back to. */
	readonly discardable: boolean;
};

function editorFrame(row: Page, now: number): EditorFrame {
	return {
		state: editorState(row, now),
		version: row.updatedAt.getTime(),
		preview: `/preview/${row.id}`,
		chat: `/admin/pages/${row.id}/chat`
	};
}

/** the page as the editor draws it; its state as of `now`, a campaign past its end reading ended. */
export function editorPage(row: Page, now: number): EditorPage {
	const draft = readableDraft(row);
	return {
		...editorFrame(row, now),
		unreadable: false,
		shareMessage: draft.shareMessage ?? null,
		goalMinor: draft.goalMinor ?? null,
		endDate: endDayOf(draft)
	};
}

/** the editor over `row` where the read rule refuses its draft; null where the draft reads. */
export function unreadableEditor(row: Page, now: number): UnreadableEditor | null {
	if (readDocument(row, 'draft', row.draft).ok) return null;
	return {
		...editorFrame(row, now),
		unreadable: true,
		discardable: row.published !== null && readDocument(row, 'published', row.published).ok
	};
}

function editorState(row: Page, now: number): EditorState {
	switch (stateAt(row, now)) {
		case 'never_published':
			return 'unpublished';
		case 'ended':
			return 'ended';
		case 'live':
			return row.draft === row.published ? 'live' : 'changed';
	}
}

/**
 * the Donation settings sheet's seed and the Settings row's line, as the draft stands. whether
 * monthly is offered is read as the box's served config reads it (../forms/cadence-cache.ts), off
 * `origin`, the origin the request arrived on.
 */
export async function readEditorSettings(
	db: Db,
	env: unknown,
	row: Page,
	origin: string
): Promise<SettingsSeed> {
	const [settings, active, cadences] = await Promise.all([
		draftSettingsOf(db, row),
		readActivePrograms(db),
		cachedCadences(createPaymentProviders(env), origin)
	]);
	const programs = active.map((cause) => ({ value: cause.id, label: cause.name }));
	const pinned = settings.programId;
	let retired: SettingsSeed['retired'] = null;
	if (pinned !== null && !programs.some((cause) => cause.value === pinned)) {
		const [held] = await db
			.select({ value: program.id, label: program.name })
			.from(program)
			.where(eq(program.id, pinned));
		retired = held ?? null;
	}
	const named = programs.find((cause) => cause.value === pinned) ?? retired;
	const switches = draftSwitches(row);
	return {
		boxes: settingsBoxes(settings),
		currency: settings.currency,
		programs,
		retired,
		summary: settingsSummary(settings, named?.label ?? null, switches),
		switches,
		monthlyOffered: cadences.includes('monthly')
	};
}

function draftSwitches(row: Page): SettingsSeed['switches'] {
	const { openOnMonthly, dedicationOn } = readableDraft(row).switches;
	return { open_on_monthly: openOnMonthly, dedication_on: dedicationOn };
}

function settingsBoxes(settings: DraftSettings): SettingsSeed['boxes'] {
	const entry = (minor: number | null) =>
		minor === null ? '' : majorEntry(minor, settings.currency);
	const amounts = settings.suggestedAmounts.map(entry);
	return {
		program_mode: settings.programMode,
		program_id: settings.programId ?? '',
		min_minor: entry(settings.minMinor),
		max_minor: entry(settings.maxMinor),
		// one blank row where none are suggested, as the form screen opens one: a box to type in.
		suggested_amounts: amounts.length > 0 ? amounts : ['']
	};
}

function settingsSummary(
	settings: DraftSettings,
	programName: string | null,
	switches: SettingsSeed['switches']
): string {
	const mode = PROGRAM_MODE_LABELS[settings.programMode];
	const amounts = settings.suggestedAmounts
		.map((minor) => formatMinorBrief(minor, settings.currency))
		.join(', ');
	const on = (Object.keys(SWITCH_LABELS) as (keyof typeof SWITCH_LABELS)[])
		.filter((name) => switches[name])
		.map((name) => SWITCH_LABELS[name]);
	return [mode, settings.programMode === 'pinned' ? programName : null, amounts, ...on]
		.filter((part) => part !== null && part !== '')
		.join(' · ');
}

const PAGE_SETTINGS = defineForm({ id: PAGE_SETTINGS_FORM_ID, schema: PAGE_SETTINGS_INPUT });

const SETTINGS_STALE =
	'Nothing was changed: this page has been saved since the editor was opened. Reload it, then make this change again.';
const SETTINGS_FAILED = 'Saving the donation settings failed and nothing was changed. Try again.';
/** the form screen's sentence for the same refusal. */
const NO_SUCH_PROGRAM = 'Choose an active program.';

/** the parsers' messages under the boxes; the amounts' come keyed per row from the schema. */
function boxErrors(errors: FormInputFieldErrors): Record<string, string[]> {
	const keyed: Record<string, string[]> = {};
	for (const [box, sentence] of Object.entries(errors)) {
		if ((FORM_TEXT_FIELDS as readonly string[]).includes(box)) keyed[box] = [sentence];
	}
	return keyed;
}

/**
 * the Donation settings sheet's Done, for either editor: the body parsed under a form's program and
 * giving rules, written to the draft of the page `target` names (`updateDraftSettings`) against the
 * version it was drawn at. a refusal names the box; a stale or failed save keeps what was typed.
 */
export async function saveDraftSettings(
	db: Db,
	target: SettingsTarget,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, PAGE_SETTINGS);
	const values = formInputValues(body);
	const chosen = parseFormProgram(values);
	const giving = parseFormGiving(values);
	if (!submission.ok || !chosen.ok || !giving.ok) {
		const errors = { ...(chosen.ok ? {} : chosen.errors), ...(giving.ok ? {} : giving.errors) };
		return invalid(400, submission.reject({ fieldErrors: boxErrors(errors) }));
	}
	const seen = submittedVersion(body);
	let written: SettingsWrite;
	try {
		const { open_on_monthly, dedication_on } = submission.value;
		written = await updateDraftSettings(db, target, seen, {
			program: chosen.value,
			giving: giving.value,
			switches: { openOnMonthly: open_on_monthly, dedicationOn: dedication_on }
		});
	} catch (e) {
		console.error(`saving donation settings for ${JSON.stringify(target)} failed:`, e);
		return invalid(500, submission.reject({ formErrors: [SETTINGS_FAILED] }));
	}
	switch (written) {
		case 'written':
			return { saved: 'settings' as const };
		case 'unknown_program':
			return invalid(400, submission.reject({ fieldErrors: { program_id: [NO_SUCH_PROGRAM] } }));
		case 'stale':
			return invalid(409, submission.reject({ formErrors: [SETTINGS_STALE] }));
		case 'gone':
			return invalid(404, submission.reject({ formErrors: [gone] }));
	}
}
