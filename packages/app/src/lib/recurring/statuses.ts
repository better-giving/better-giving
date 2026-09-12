// the recurring commitment `status` vocabulary, in the one place both a component and the schema
// may import from.
//
// not under `$lib/server/**`, for the reason `$lib/forms/statuses.ts` is not: the array is the
// source of the `recurring_plan_status_check` constraint in `$lib/server/db/schema.ts` *and* the
// source of the words screens render, and a component cannot import from `$lib/server/**` at all. a second reader is what turns a declaration in the schema into a shared vocabulary, and
// /admin/recurring — which puts a word to a status — is that reader.
//
// the dependency runs server -> shared and never back: schema.ts imports this, this imports
// nothing.

/**
 * where a commitment stands.
 *
 *   active     charging on schedule.
 *   cancelled  stopped by the operator. the only deliberate end there is — the operator
 *              cancels from /admin and a donor who wants out writes to the organization,
 *              because the donation page serves a form and nothing else: there is nowhere
 *              a donor signs in to manage a commitment (CLAUDE.md).
 *   lapsed     the rail exhausted its own retries on a card that kept failing and gave up.
 *
 * no fourth member, and two omissions are decisions rather than gaps. cancelling stops the
 * charges at once, so there is no interval between the operator pressing cancel and the
 * commitment ending for a state to describe. and there is no "created at the rail, nothing
 * charged yet" — that is a rule about when a row may be written, stated on the `recurring_plan`
 * table in `$lib/server/db/schema.ts`.
 */
export const RECURRING_PLAN_STATUSES = ['active', 'cancelled', 'lapsed'] as const;
export type RecurringPlanStatus = (typeof RECURRING_PLAN_STATUSES)[number];

/**
 * what a status is called on a screen.
 *
 * keyed by `RecurringPlanStatus` rather than `string`, so a fourth status is a type error here
 * rather than a raw `lapsed` rendered somewhere by a `?? value` fallback — the same discipline
 * `DONATION_STATUS_LABELS` in `$lib/donations/statuses.ts` is under.
 *
 * `Stopped` and never `Cancelled`, which is the one word here worth arguing.
 * `DONATION_STATUS_LABELS.cancelled` already means a payment outcome on a list read beside this
 * one, and every confirmation in this dashboard is escaped by a link labelled `Cancel` — one word
 * with two meanings on adjacent screens.
 *
 * `Payment failed` and not `Lapsed`, for the reason every label in this dashboard is written: it
 * says what happened rather than what the column holds.
 */
export const RECURRING_STATUS_LABELS: Record<RecurringPlanStatus, string> = {
	active: 'Active',
	cancelled: 'Stopped',
	lapsed: 'Payment failed'
};

/**
 * the sentence under the heading on /admin/recurring/[id], one per status, written against the
 * processor the commitment is on.
 *
 * `active` carries none, the same way `FORM_STATUS_NOTES.live` carries none: the label says Active
 * and the Next charge row on that screen gives the date, so a note there would be a third telling.
 * the other two each have a consequence a staff member acts on that the label alone does not say.
 *
 * one function per status rather than one string, because a caller must not have to know which of
 * them names a processor. what it holds is the name to write, and what it gets back is the sentence
 * or nothing.
 *
 * the `lapsed` note is the one that carries weight. `revives` in
 * `$lib/server/donations/collect.ts` moves a lapsed row back to `active` when the rail reports the
 * card went through, so a staff member who reads "payment failed" as "already over" leaves a donor
 * being collected from after they asked to stop. it names the way out, which is the control on the
 * same screen.
 *
 * the stopped note names what a donor would do instead, because there is no un-stopping in this
 * product and a screen with a status and no control on it reads as broken otherwise. it names no
 * processor at all — what it states is what this deployment does — so it is written for every
 * commitment alike.
 */
const NOTES: Record<RecurringPlanStatus, (processor: string | null) => string | null> = {
	active: () => null,
	cancelled: () =>
		'Nothing further is collected. To give again, this donor sets up a new gift on one of your ' +
		'donation forms.',
	lapsed: (processor) =>
		processor === null
			? null
			: `${processor} stopped collecting after this donor's payments kept failing. It can start ` +
				'collecting again on its own if their card goes through. Stopping it here is what ' +
				'prevents that.'
};

/**
 * what the status word costs, said in the words the commitment's own processor is named in, or
 * `null` where there is nothing to add.
 *
 * `processor` is the name an operator reads — `PROCESSOR_LABELS` in
 * `$lib/server/payments/provider.ts` is the one spelling of each, and the screen resolves it there
 * because a component may not import from `$lib/server/**`.
 *
 * `null` is a commitment no processor stands behind: `recurring_plan.provider` keeps `manual`,
 * which no adapter answers for. a sentence claiming a processor did something is then not softened
 * but dropped — naming the wrong processor sends a staff member to an account they hold nothing on,
 * and naming none says less than the label already does.
 */
export function recurringStatusNote(
	status: RecurringPlanStatus,
	processor: string | null
): string | null {
	return NOTES[status](processor);
}
