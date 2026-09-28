import type { FormInputValues } from './fields';

// what a form opens on: the new-form screen's boxes (src/routes/_app.admin.forms.new.tsx), and the
// settings row the donation page owns, made the first time anything asks for that page
// ($lib/server/pages/donation-page.ts). one set of figures for both, so a first gift on /donate and
// a first form offer the same amounts.

/**
 * the values a form is born with.
 *
 * `draft` matches the column default, and it is the status a form is made in: a form that goes live
 * in the same click that creates it has never been looked at. the donation page's row is the one
 * exception, made `live` by its caller, because that page is live from the start and takes gifts
 * through the row before anyone has edited it.
 *
 * the amount bounds open on figures rather than blank, the way the suggestions below do: both are
 * starting figures the operator edits, not bounds this module decides. `1.00` is set low enough to
 * block nothing — the floor a save actually enforces is `MIN_AMOUNT_MINOR` in
 * `$lib/server/forms/form-input.ts`, which is a different thing and argues itself there.
 * `10000.00` is a rail against a mistyped amount and a card that is not the donor's; no rule outside
 * this repo puts it at that figure.
 *
 * how often a gift may repeat and what a donor may pay by are not here and are not values a new form
 * is born with: both are the deployment's.
 *
 * no sites either, and the empty list is the value rather than the absence of one: a new form is on
 * none of the deployment's sites, and its snippet loads nowhere until one is ticked.
 *
 * every box is stated rather than left absent, because the new-form screen binds each box to its
 * value here, and a box conform was handed no value for is a box with nothing to bind to — the
 * status's select must open on `draft`, and the amount rows open on the three below.
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
