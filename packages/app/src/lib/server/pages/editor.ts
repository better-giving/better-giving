import { eq } from 'drizzle-orm';
import { groupedEntry } from '../../forms/amounts';
import type { SettingsSeed } from '../../page/settings-form';
import type { Db } from '../db/client';
import { type Page, program } from '../db/schema';
import { cachedCadences } from '../forms/cadence-cache';
import { createPaymentProviders } from '../payments/factory';
import { readableDraft, readDocument } from './document';
import { readActivePrograms } from '../programs/queries';
import { type DraftSettings, draftSettingsOf } from './queries';

// what a page's edit screen reads beside its cards' seeds (./section-seeds.ts): whether the draft
// reads at all, and the donation settings as the draft holds them.
//
// **the donation settings** are the draft's own (`draftSettingsOf` in ./queries.ts), drawn as a
// form's program and giving groups are drawn, with the page's two switches beside them, which are
// the draft's `switches` and never the owned settings row's: where the box opens is a fact about
// the page, and a form has no such setting.

/** the edit screen over a draft the read rule refuses: a notice, and the press that repairs it. */
export type UnreadableEditor = {
	/** whether the live page reads, so Discard changes has a page to put the draft back to. */
	readonly discardable: boolean;
};

/** the notice over `row` where the read rule refuses its draft; null where the draft reads. */
export function unreadableEditor(row: Page): UnreadableEditor | null {
	if (readDocument(row, 'draft', row.draft).ok) return null;
	return {
		discardable: row.published !== null && readDocument(row, 'published', row.published).ok
	};
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
	return {
		boxes: settingsBoxes(settings),
		currency: settings.currency,
		programs,
		retired,
		switches: draftSwitches(row),
		monthlyOffered: cadences.includes('monthly')
	};
}

function draftSwitches(row: Page): SettingsSeed['switches'] {
	const { openOnMonthly, dedicationOn } = readableDraft(row).switches;
	return { open_on_monthly: openOnMonthly, dedication_on: dedicationOn };
}

function settingsBoxes(settings: DraftSettings): SettingsSeed['boxes'] {
	const entry = (minor: number | null) =>
		minor === null ? '' : groupedEntry(minor, settings.currency);
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
