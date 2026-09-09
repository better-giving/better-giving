// the donation form `status` vocabulary, in the one place both a component and the schema may
// import from.
//
// not under `$lib/server/**`, for the reason `$lib/contacts/kinds.ts` is not: the array is the
// source of the `form_status_check` constraint in `$lib/server/db/schema.ts` *and* the source of
// the words screens render, and a component cannot import from `$lib/server/**` at all. declared
// in a route instead, the labels are declared again by the next screen that renders a status —
// the create and edit screens are already two.
//
// the dependency runs server -> shared and never back: schema.ts imports this, this imports
// nothing.

/**
 * `archived` is the terminal state and there is no fourth: a form is never deleted. a pasted
 * snippet outlives the form it points at — it sits in someone else's HTML on a site we cannot
 * reach — so a hard delete breaks a live donation page with no way to find out. `archived`
 * renders a graceful message instead of a 404.
 */
export const FORM_STATUSES = ['draft', 'live', 'archived'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

/**
 * the two statuses an operator may choose between.
 *
 * `archived` is not one of them, and that is not a UI preference: `FORM_STATUSES` and
 * `archived_at` are two representations of one fact, so a `<select>` writing `archived` without
 * the timestamp leaves a form that reads archived on a screen and live to `readForms`. archiving
 * is `archiveForm` in `$lib/server/forms/queries.ts`, which sets both.
 *
 * `satisfies` against the full union is what keeps this a subset rather than a second list: a
 * status renamed above stops compiling here.
 */
export const EDITABLE_FORM_STATUSES = ['draft', 'live'] as const satisfies readonly FormStatus[];
export type EditableFormStatus = (typeof EDITABLE_FORM_STATUSES)[number];

/**
 * what a status is called on a screen.
 *
 * keyed by `FormStatus` rather than `string`, so a fourth status is a type error here rather than
 * a raw `draft` rendered somewhere by a `?? value` fallback — the same discipline `KIND_LABELS`
 * in `$lib/contacts/kinds.ts` is under.
 */
export const FORM_STATUS_LABELS: Record<FormStatus, string> = {
	draft: 'Draft',
	live: 'Live',
	archived: 'Archived'
};

/**
 * `null` where the label says everything, which is what `live` is.
 *
 * the draft note is the one that carries weight: it is the sentence that stops a snippet rendered
 * beside "Draft" from reading as an oversight. so it names the way out, and it names the same one
 * `publishedConfig` in `$lib/server/forms/published-config.ts` gives a snippet that asked for a
 * draft form — a note and a refusal that disagreed about how a form is published would leave an
 * operator with two sets of instructions and no way to tell which is current.
 *
 * one screen renders it, and that is the screen the box is on: `src/routes/_app.admin.forms.$id.tsx`.
 * the forms list draws no note at all — its records carry a status word and the sentence about a
 * draft's snippet, and nothing from here. so the draft note may name the box directly.
 *
 * the archived note is the sentence a read-only screen needs, because a page with no editable box
 * on it and nothing saying why reads as broken.
 */
export const FORM_STATUS_NOTES: Record<FormStatus, string | null> = {
	draft:
		'A draft shows nothing on a site with its snippet on it. Set the status to Live below and save.',
	live: null,
	archived:
		'Nothing on an archived form can be changed. Its snippet keeps working wherever it was already pasted.'
};
