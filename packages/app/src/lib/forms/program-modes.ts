// the `form.program_mode` vocabulary, in the one place both a component and the schema may import
// from.
//
// not under `$lib/server/**`, for the reason ./statuses.ts is not: the array is the source of the
// `form_program_mode_check` constraint in `$lib/server/db/schema.ts` *and* the source of the words
// a screen renders, and a component cannot import from `$lib/server/**` at all. declared in a
// route instead, the labels are declared again by the next screen that renders a mode.
//
// the dependency runs server -> shared and never back: `$lib/server/db/schema.ts` imports this,
// this imports nothing.

/**
 * what a form does about causes: names one, offers the donor the active list, or asks nothing.
 *
 * `none` is what every form holds until somebody changes it, so a deployment that never makes a
 * cause never meets the other two.
 */
export const PROGRAM_MODES = ['none', 'pinned', 'choice'] as const;
export type ProgramMode = (typeof PROGRAM_MODES)[number];

/**
 * what a mode is called on a screen.
 *
 * keyed by `ProgramMode` rather than `string`, so a fourth mode is a type error here rather than a
 * raw `pinned` rendered somewhere by a `?? value` fallback — the same discipline
 * `FORM_STATUS_LABELS` in ./statuses.ts is under.
 *
 * none of the three is the value it writes. `pinned` is a word about a row, and what an operator
 * is choosing between is how many causes the form asks about: none, one, or theirs to pick.
 */
export const PROGRAM_MODE_LABELS: Record<ProgramMode, string> = {
	none: 'No program',
	pinned: 'One program',
	choice: 'Donor chooses'
};

/**
 * what the chosen mode does to a gift, said beside the box while that mode is the one chosen.
 *
 * every mode carries one and none is null, which is where this parts company with
 * `FORM_STATUS_NOTES` in ./statuses.ts: a status label names a state an operator already
 * recognises, and these three name what happens after the form is saved — which is the whole
 * difference between them and is in none of the three labels.
 */
export const PROGRAM_MODE_NOTES: Record<ProgramMode, string> = {
	none: 'Gifts are recorded without a program.',
	pinned: 'Every gift on this form goes to the program you pick.',
	choice: 'Donors pick from your active programs, or leave it for wherever it’s needed most.'
};
