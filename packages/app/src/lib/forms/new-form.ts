import type { FormInputValues } from './fields';

// what a form opens on: the new-form screen's boxes (src/routes/_app.admin.forms.new.tsx), and the
// Donation page's settings row the first time anything asks for that page
// ($lib/server/pages/donation-page.ts). one set of figures for both, so a first gift on /donate
// and a first form offer the same amounts.

/**
 * the values a form is born with, which is what the boxes bind to.
 *
 * `draft` matches the column default, and it is the only status a form should be made in: a form
 * that goes live in the same click that creates it has never been looked at. the amount bounds open
 * on figures rather than blank, the way the suggestions below do: both are starting figures the
 * operator edits, not bounds this file decides. `1.00` is set low enough to block nothing — the
 * floor a save actually enforces is `MIN_AMOUNT_MINOR` in `$lib/server/forms/form-input.ts`, which
 * is a different thing and argues itself there. `10000.00` is a rail against a mistyped amount and
 * a card that is not the donor's; no rule outside this repo puts it at that figure.
 *
 * how often a gift may repeat and what a donor may pay by are not here and are not values a new form
 * is born with: both are the deployment's, and neither is read on this screen at all.
 *
 * no sites either, and the empty list is the value rather than the absence of one: the tick boxes
 * are drawn from the deployment's own list and a new form is on none of them. it is a form a
 * deployment can serve rather than a state to be corrected, so nothing on this screen opens asking
 * for a tick.
 *
 * every box is stated rather than left absent, because a box conform was handed no value for is a
 * box with nothing to bind to — and the two the screen would otherwise be silent about are the
 * status, whose select must open on `draft`, and the amount rows, which open on the three below.
 */
export const NEW_FORM = {
	name: '',
	status: 'draft',
	// a form asks about no cause until somebody says otherwise, which is what the column defaults
	// to as well. the program box is blank rather than absent: it is in the tree in every mode and
	// hidden in two of them, so it has to have something to bind to
	// (`$lib/admin/forms/program-fields.tsx`).
	program_mode: 'none',
	program_id: '',
	min_minor: '1.00',
	max_minor: '10000.00',
	// three suggestions rather than none, which is what a new form's tray shows before anyone
	// thinks about it; the operator edits or clears them in the row editor.
	suggested_amounts: ['25', '50', '100'],
	allowed_origins: [] as string[]
} as const satisfies FormInputValues;
