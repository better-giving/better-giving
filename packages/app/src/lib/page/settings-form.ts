// the editor's Donation settings sheet as it posts: one form for the program and what a donor may
// give, stated as `PAGE_SETTINGS_INPUT` (../forms/input-schema.ts) under this id where it is
// mounted ($lib/admin/editor/donation-settings.tsx) and where it is read
// ($lib/server/pages/editor.ts), and named by both editors' actions.

export const PAGE_SETTINGS_FORM_ID = 'page-settings';

type ProgramOption = { readonly value: string; readonly label: string };

/** what the editor's loader hands the sheet: its seed, and the Settings row's line for it. */
export type SettingsSeed = {
	/** the boxes as a form's program and giving groups hold them. */
	readonly boxes: {
		readonly program_mode: string;
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
	/** what the settings come to — `One program · Winter coats · $25, $50`. */
	readonly summary: string;
};
