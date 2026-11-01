import type { ProgramMode } from '../forms/program-modes';

// a page's donation settings as its draft holds them, read by $lib/server/pages/editor.ts for the
// edit screens' seeds ($lib/server/pages/section-seeds.ts), and the names its two switches are
// drawn under ($lib/admin/page-edit/).

type ProgramOption = { readonly value: string; readonly label: string };

/** a page's donation settings as the boxes hold them. */
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
	/** the page's two switches as the draft holds them, under the boxes' names. */
	readonly switches: { readonly open_on_monthly: boolean; readonly dedication_on: boolean };
	/**
	 * whether this deployment offers monthly gifts now. Open on monthly is saved either way and opens
	 * the box on monthly only once it does.
	 */
	readonly monthlyOffered: boolean;
};

/** each switch's name, as its checkbox row says it. */
export const SWITCH_LABELS = {
	open_on_monthly: 'Open on monthly',
	dedication_on: 'Dedication on by default'
} as const satisfies Record<keyof SettingsSeed['switches'], string>;
