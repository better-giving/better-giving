import type { ProgramMode } from '../forms/program-modes';

// the editor's Donation settings sheet as it posts: one form for the program, what a donor may give
// and where the page's donation box opens, stated as `PAGE_SETTINGS_INPUT`
// (../forms/input-schema.ts) under this id where it is mounted
// ($lib/admin/editor/donation-settings.tsx) and where it is read ($lib/server/pages/editor.ts), and
// named by both editors' actions.

export const PAGE_SETTINGS_FORM_ID = 'page-settings';

type ProgramOption = { readonly value: string; readonly label: string };

/** what the editor's loader hands the sheet: its seed, and the Settings row's line for it. */
export type SettingsSeed = {
	/** the boxes as a form's program and giving groups hold them. */
	readonly boxes: {
		readonly program_mode: ProgramMode;
		readonly program_id: string;
		readonly min_minor: string;
		readonly max_minor: string;
		readonly suggested_amounts: readonly string[];
	};
	readonly currency: string;
	/** every active program, as the program select lists them. */
	readonly programs: readonly ProgramOption[];
	/** the archived program the draft is still pinned to, which the select carries until changed. */
	readonly retired: ProgramOption | null;
	/** what the settings come to — `One program · Winter coats · $25, $50 · Open on monthly`. */
	readonly summary: string;
	/** the page's two switches as the draft holds them, under the boxes' names. */
	readonly switches: { readonly open_on_monthly: boolean; readonly dedication_on: boolean };
	/**
	 * whether this deployment offers monthly gifts now. Open on monthly is saved either way and opens
	 * the box on monthly only once it does.
	 */
	readonly monthlyOffered: boolean;
};

/** each switch's name, as its checkbox row and the Settings row's line both say it. */
export const SWITCH_LABELS = {
	open_on_monthly: 'Open on monthly',
	dedication_on: 'Dedication on by default'
} as const satisfies Record<keyof SettingsSeed['switches'], string>;
