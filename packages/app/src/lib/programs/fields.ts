// the names of the boxes a cause is described by, in the one place both a component and the parser
// may import from.
//
// not under `$lib/server/**`, for the reason `$lib/forms/fields.ts` is not: these names are what
// the markup writes into `name=` attributes, what `PROGRAM_INPUT_FORM` in ./input-schema.ts names
// its keys after so the parser finds them in a submitted body, and what every error is keyed by —
// and a component may not import from `$lib/server/**`.
//
// they are the column names, which is deliberate: one vocabulary a developer or an agent can find
// in the markup, in the error map and in the table, with the sentence a fundraiser reads carried by
// the message rather than by the key.
//
// the dependency runs server -> shared and never back: `$lib/server/programs/program-input.ts`
// imports this, this imports nothing.

/**
 * the whole of what an operator types about a cause, and there is no list field.
 *
 * everything else a screen shows about one — whether it is still offered, what has been given
 * through it — is read rather than typed, which is why this is one list rather than the pair
 * `$lib/forms/fields.ts` keeps.
 */
export const PROGRAM_TEXT_FIELDS = ['name', 'description'] as const;
export type ProgramInputField = (typeof PROGRAM_TEXT_FIELDS)[number];

/**
 * what each box is called on a screen.
 *
 * keyed by `ProgramInputField` rather than `string`, so a third box is a type error here rather
 * than one rendered from a `?? value` fallback — the same discipline `FORM_FIELD_LABELS` in
 * `$lib/forms/fields.ts` is under.
 *
 * the name is the donor-facing word, and the label says nothing about that: which of the two a
 * donor ever reads is the hint under the description box
 * (`$lib/admin/programs/fields.tsx`), because it is a fact about a donation form on somebody
 * else's site and no label can carry it.
 */
export const PROGRAM_FIELD_LABELS: Record<ProgramInputField, string> = {
	name: 'Name',
	description: 'Description'
};

/**
 * one message per offending field, keyed by the field the operator must edit.
 *
 * a whole-request failure — the database being unreachable — is not one of these: it belongs to no
 * field, and pinning it on one tells the operator to edit something that is fine, so the actions
 * carry it separately.
 */
export type ProgramInputFieldErrors = Partial<Record<ProgramInputField, string>>;

/**
 * what the form submits: a string per box, and absent for anything the browser did not send.
 *
 * `parseProgramInput` takes this rather than `FormData` so a test states its input as an object
 * literal, and the screens render out of it — which is why it lives here rather than beside the
 * parser: it is the shape both ends of the edit hold.
 */
export type ProgramInputValues = Partial<Record<ProgramInputField, string>>;
