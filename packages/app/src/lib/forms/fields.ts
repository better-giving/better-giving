// the names of the boxes a donation form is configured by, in the one place both a component
// and the parser may import from.
//
// not under `$lib/server/**`, for the reason `$lib/contacts/kinds.ts` and ./statuses.ts are not:
// these names are what the markup writes into `name=` attributes, what `FORM_INPUT_FORM` in
// ./input-schema.ts names its keys after so the parser finds them in a submitted body, and what
// every error is keyed by — and a component may not import from `$lib/server/**`. keeping
// them there would mean the create and edit screens re-declaring the shape of what they render,
// with nothing tying the two lists together.
//
// they are the column names, which is deliberate: one vocabulary a developer or an agent can
// find in the markup, in the error map and in the table, with the sentence a fundraiser reads
// carried by the message rather than by the key.
//
// the dependency runs server -> shared and never back: `$lib/server/forms/form-input.ts` imports
// this, this imports nothing.

/** the fields submitted as one value each — text boxes and a `<select>`. */
export const FORM_TEXT_FIELDS = [
	'name',
	'status',
	'program_mode',
	'program_id',
	'min_minor',
	'max_minor'
] as const;

/**
 * the fields submitted once per control, so each arrives as a list.
 *
 * each is a group of controls rather than one box: one `<input>` per value, read with `getAll` —
 * a checkbox per listed site for the first, a repeating row editor for the second.
 * either way the message belongs to the group and not to a row, so each rule emits its own issue
 * from inside the schema, keyed by the box's own name (`$lib/server/conform.ts`). see
 * `@better-giving/operator/origins` and `$lib/forms/amounts.ts`.
 */
export const FORM_LIST_FIELDS = ['allowed_origins', 'suggested_amounts'] as const;

export const FORM_INPUT_FIELDS = [...FORM_TEXT_FIELDS, ...FORM_LIST_FIELDS] as const;
export type FormInputField = (typeof FORM_INPUT_FIELDS)[number];

/**
 * what each box is called on a screen.
 *
 * keyed by `FormInputField` rather than `string`, and the totality is doing work rather than
 * decorating: a form is rendered twice — as the boxes that edit one, and as the read-only
 * record an archived one shows — and the second is a screen nobody looks at until the form can
 * no longer be changed. a field added to the boxes and forgotten on the record is invisible,
 * because a record that never mentions a setting looks exactly like a record of a form that
 * never had it. keyed here, both renderings read out of one list and a new box does not compile
 * until it has a word.
 *
 * the same discipline `FORM_STATUS_LABELS` in ./statuses.ts is under, and the words are a
 * fundraiser's rather than the schema's: the keys are the column names, and that is as far as
 * schema vocabulary goes.
 *
 * `allowed_origins` reads `Sites`, and that gap is the rule rather than a lapse. a screen says
 * site and means one whole web address written the way a browser's address bar shows it; the key
 * keeps the column's name, which is the word the `Origin` header and ./origins.ts use. never close
 * the gap by renaming the label to the key — the words in the messages ./origins.ts returns are
 * under the same rule.
 */
export const FORM_FIELD_LABELS: Record<FormInputField, string> = {
	name: 'Name',
	status: 'Status',
	suggested_amounts: 'Suggested amounts',
	// the unit is not in either bound's label. it is one fact about three boxes, so it is stated
	// once — in the hint inside the gift-bounds fieldset and in the hint over the suggested
	// amounts — rather than three times in three labels a fundraiser reads as three settings.
	min_minor: 'Smallest gift',
	max_minor: 'Largest gift',
	// the pair is one decision and the two words say which half each box holds: the mode is how
	// many causes the form asks about, and the program is the one a pinned form names. neither
	// says `cause`, which is the schema's word for the table and not a fundraiser's.
	program_mode: 'Mode',
	program_id: 'Program',
	allowed_origins: 'Sites'
};

/**
 * one message per offending field, keyed by the field the operator must edit.
 *
 * the message is what a fundraiser reads, the key is what a machine reads. a whole-request
 * failure — the database being unreachable — is not one of these: it belongs to no field, and
 * pinning it on one tells the operator to edit something that is fine, so the actions carry it
 * separately.
 */
export type FormInputFieldErrors = Partial<Record<FormInputField, string>>;

/**
 * what the form submits: a string per text field, a list per row editor, and absent for anything
 * the browser did not send.
 *
 * `parseFormInput` takes this rather than `FormData` so a test states its input as an object
 * literal, and the screens render out of it — which is why it lives here rather than beside the
 * parser: it is the shape both ends of the edit hold.
 */
export type FormInputValues = Partial<Record<(typeof FORM_TEXT_FIELDS)[number], string>> &
	Partial<Record<(typeof FORM_LIST_FIELDS)[number], readonly string[]>>;
