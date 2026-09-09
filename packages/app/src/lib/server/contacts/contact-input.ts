import { z } from 'zod';
import {
	CHOOSE_KIND,
	CONTACT_FIELD_RULES,
	CONTACT_KIND,
	MAX_NAME,
	REQUIRED
} from '../../contacts/input-schema';
import type { ContactKind } from '../../contacts/kinds';
import { fieldErrorsFrom } from '@better-giving/operator/zod-issues';

// parsing and validating the contact form, with no database in sight.
//
// split from ./queries.ts for the same reason `post()` is pure: every rule about what a
// contact may be — which name a `kind` requires, what `display_name` is derived from, what
// counts as an email — is decidable from the submitted values alone. keeping it here means
// those rules are testable with no D1 and no browser, and it means the form action stays a
// translation layer rather than the place the rules live.
//
// why `display_name` is derived here rather than in the form. the column is `notNull` and
// the schema calls it "denormalized and always populated, so a list view never has to
// branch on kind" — a promise nothing in the database keeps, since `''` satisfies
// `notNull`. this module is where it is kept, which is why `ParsedContact` is the only
// shape ./queries.ts will insert — and why it is branded rather than structural, so
// `parseContact` is the only thing that can produce one.
//
// how the rules are split, since the sibling parsers under $lib/server follow this one.
// field-level rules — trim, blank becomes `null`, the length caps, the email pattern — are
// a zod schema, because each is a property of a single value and reads better declared than
// branched. those rules are stated in ../../contacts/input-schema.ts rather than here, because
// the donor form runs the same rules in the browser and a component may not import from
// `$lib/server/**` at all; what this file adds to them is `.nullable()`.
// everything that is not one of those stays plain typescript below the schemas:
// which name a `kind` requires, what `display_name` is derived from, and which columns a
// kind stores `null`. those rules are ordered, cross-field and produce a value, and the
// order is itself the rule (see the note above `required` in `parseContact`), so they are
// written as statements that run top to bottom rather than as checks a schema may run in
// any order.
//
// error identity is carried by the object key. the schema's keys are the form field names,
// so `issue.path[0]` already is a `ContactField` and the map a form renders is built by
// reading it — see `fieldErrorsFrom` in `@better-giving/operator/zod-issues`, which is where that
// walk and its reasons live for the three parsers that share it.
//
// the brand on `ParsedContact` is not zod's `.brand()`, which is compile-time only and
// would mark a value as checked without checking it. see the note on `ParsedContact`.

/**
 * the form field names, which are also the error keys and also the column names.
 *
 * one vocabulary rather than three, and it is carried by the error *key* rather than by
 * the message: `legal_name` names something a developer or an agent can find in the
 * markup, in the error map and in the table, while the message itself is a sentence a
 * fundraiser reads under the input. see the note on `ContactFieldErrors`.
 */
export const CONTACT_FIELDS = [
	'kind',
	'first_name',
	'last_name',
	'legal_name',
	'display_name',
	'primary_email',
	'primary_phone'
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/**
 * one message per offending field, keyed by the field the operator must edit.
 *
 * the message is what a fundraiser reads, the key is what a machine reads. today the only
 * consumer is a `<p role="alert">` under the input, so the prose says "First name or last
 * name required" rather than naming `first_name` — CLAUDE.md keeps schema vocabulary off a
 * screen, and this map is one of the places it would otherwise walk straight back on
 * (`total_minor is 12.5` is the version of that sentence nobody should ever be shown).
 * nothing is lost: the field name is right here in the key. if `/api/v1` ever wants the
 * agent-readable body CLAUDE.md asks for, its serializer composes `${field}: ${message}`
 * from this same map — that is a route's concern, not the string's.
 *
 * a whole-request failure — the database being unreachable — is not one of these. it
 * belongs to no field, and pinning it on one tells the operator to edit something that is
 * fine; the form action carries it separately.
 */
export type ContactFieldErrors = Partial<Record<ContactField, string>>;

/**
 * a contact whose `displayName` is derived and whose blanks are already `null`.
 *
 * the fields are exactly `contact`'s writable columns and no more — `id`, `created_at` and
 * `updated_at` belong to the column defaults, and `archived_at` is a soft delete rather
 * than something a create form sets.
 *
 * the brand is what makes `parseContact` hard to skip. without it this is a structural type,
 * so `createContact(db, { kind: 'individual', displayName: '', ... })` type-checks and the
 * `display_name` promise above is kept only by callers who happened to read this file. with
 * it, that call is a type error. it is not a lock: a single `as ParsedContact` still
 * compiles, because a value differing from this type only by the brand stays comparable to
 * it. what the brand buys is that the mint has to be written — an accidental object literal
 * is refused, and a deliberate one is a visible line a reviewer sees and a `grep` finds. the
 * same trick `PostableAccountId` and `Posting` play, for the same reason and with the same
 * limit.
 *
 * the brand is a `unique symbol` intersection minted by exactly one double assertion, at the
 * end of `parseContact` and past every check in it. zod's `.brand()` is not what enforces
 * it and must not be: that is a compile-time no-op which returns its input untouched, so it
 * marks a value as checked wherever it is written, including in front of nothing.
 *
 * it is not a substitute for `contact_display_name_not_blank_check` on the column, and the
 * check is not a substitute for it — the brand stops a *caller*, the check stops a
 * hand-written `wrangler d1 execute` that never passes through TypeScript at all.
 */
export type ParsedContact = {
	readonly kind: ContactKind;
	readonly displayName: string;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly legalName: string | null;
	readonly primaryEmail: string | null;
	readonly primaryPhone: string | null;
} & { readonly __parsed: unique symbol };

export type ContactParseResult =
	| { readonly ok: true; readonly value: ParsedContact }
	| { readonly ok: false; readonly errors: ContactFieldErrors };

/**
 * what the form submits: every value is a string or absent, because that is what
 * `FormData` yields.
 *
 * `parseContact` takes this rather than `FormData` so a test states its input as an object
 * literal — `{ kind: 'individual', first_name: 'Ada' }` is the case being made, where the
 * `FormData` that builds it is four lines of noise around it. it is also what keeps a body off
 * this parser entirely: `CONTACT_FORM` in ../../contacts/input-schema.ts keys itself by these
 * same field names, so `parseForm` in ../conform.ts reads the body and hands its values straight
 * in, and `/api/v1` assembles the same object from wire names it has already parsed.
 */
export type ContactFormValues = Partial<Record<ContactField, string>>;

/**
 * the submitted `kind`, trimmed and matched against the vocabulary.
 *
 * the vocabulary, the message and the check on it are `CONTACT_KIND` in
 * ../../contacts/input-schema.ts; what is added here is the trim, which the donor form's own
 * schema does not need — a `<select>` submits an option's value and cannot pad it — and this
 * does, because `/api/v1` reaches `parseContact` through a body somebody wrote by hand.
 */
const KIND = z.preprocess(
	(value) => (typeof value === 'string' ? value.trim() : value),
	CONTACT_KIND
);

/** trims, and treats a blank as absent — an empty string must never reach a column. */
const cleanText = z
	.string()
	.optional()
	.transform((value) => {
		const trimmed = value?.trim() ?? '';
		return trimmed.length > 0 ? trimmed : null;
	});

/**
 * the shape stage: every submitted field trimmed, with a blank already `null`.
 *
 * it cannot fail on a `ContactFormValues` — every key there is optional and `cleanText` reads an
 * absent one as a blank, so nothing about a submission can refuse it. every rule that can fail is in
 * `FIELD_LIMITS` below, which runs *over this stage's output* rather than being piped onto
 * the end of it. a failed parse carries no data, so a pipe would leave the kind-dependent
 * rules in `parseContact` with nothing to read the moment one field was too long, and they
 * would stop reporting the fields that are also wrong. reporting every offending field in
 * one pass is the point (see "reports every bad field at once" in ./contact-input.spec.ts).
 */
const CLEAN_FIELDS = z.object({
	first_name: cleanText,
	last_name: cleanText,
	legal_name: cleanText,
	display_name: cleanText,
	primary_email: cleanText,
	primary_phone: cleanText
});

/**
 * the check stage: the caps, and the one thing an email must look like.
 *
 * the keys are the form field names, which is what makes `issue.path[0]` an error key with
 * nothing to translate. every rule is `CONTACT_FIELD_RULES` in ../../contacts/input-schema.ts,
 * which the donor form's own schema states too — the only thing this stage adds is `.nullable()`,
 * because a blank is already `null` by the time it runs where a submitted box is `''`.
 */
const FIELD_LIMITS = z.object({
	first_name: CONTACT_FIELD_RULES.first_name.nullable(),
	last_name: CONTACT_FIELD_RULES.last_name.nullable(),
	legal_name: CONTACT_FIELD_RULES.legal_name.nullable(),
	display_name: CONTACT_FIELD_RULES.display_name.nullable(),
	primary_email: CONTACT_FIELD_RULES.primary_email.nullable(),
	primary_phone: CONTACT_FIELD_RULES.primary_phone.nullable()
});

/**
 * the field a kind's required name is typed into.
 *
 * it is the error key for a missing name and for a derived `display_name` that overruns,
 * and it is the field the form renders for that kind — which is what makes an error keyed
 * to it visible. an individual has no `display_name` input on the page, so an error keyed
 * `display_name` for one would be rendered nowhere.
 */
const REQUIRED_NAME_FIELD: Record<ContactKind, ContactField> = {
	individual: 'first_name',
	organization: 'legal_name',
	household: 'display_name'
};

/**
 * what to say when that field is empty: the predicate alone, in the shape `REQUIRED` in
 * `$lib/forms/input-schema.ts` states. the individual's names both boxes because either one
 * satisfies the rule, so no single label sits over it.
 */
const MISSING_NAME: Record<ContactKind, string> = {
	individual: 'First name or last name required',
	organization: REQUIRED,
	household: REQUIRED
};

/**
 * validates a submitted contact and resolves its `display_name`.
 *
 * returns every field error at once rather than the first: a form that reports one problem
 * per round trip is how a five-field create takes five submissions.
 */
export function parseContact(values: ContactFormValues): ContactParseResult {
	const submittedKind = KIND.safeParse(values.kind);
	if (!submittedKind.success) {
		// this one is fatal on its own: every rule below depends on which kind it is, so
		// there is nothing further to check and nothing useful to report about it.
		//
		// the submitted value is not echoed back. it is a `<select>`, so the only ways here
		// are a broken form and a hand-written POST, and neither is helped by the page
		// repeating what it was sent — while echoing an unbounded string into the body is a
		// reflection with no length check in front of it (every cap below is checked after
		// this return). the cause is the log's job; the key says which control.
		return { ok: false, errors: { kind: CHOOSE_KIND } };
	}
	const kind = submittedKind.data;

	const clean = CLEAN_FIELDS.parse(values);
	const limits = FIELD_LIMITS.safeParse(clean);
	const errors: ContactFieldErrors = limits.success
		? {}
		: fieldErrorsFrom(limits.error, CONTACT_FIELDS);

	const {
		first_name: firstName,
		last_name: lastName,
		legal_name: legalName,
		display_name: givenDisplayName,
		primary_email: primaryEmail,
		primary_phone: primaryPhone
	} = clean;

	// what a kind's `display_name` is derived from when none was typed. this is the whole
	// reason `kind` is checked first.
	let derived: string | null;
	switch (kind) {
		case 'individual':
			// either name alone is enough. a donor known only as "Ada" is a real record, and
			// requiring both is how staff end up typing "." into the other box.
			derived = [firstName, lastName].filter(Boolean).join(' ') || null;
			break;
		case 'organization':
			derived = legalName;
			break;
		case 'household':
			// nothing to derive from: a household has no first/last and no legal name, so the
			// name is typed directly. this is the field the form labels "Household name".
			derived = null;
			break;
	}

	// the required name is checked before `display_name` is allowed to speak for it.
	// resolving the display name first and then testing *that* for null is a hole: a
	// submitted `display_name` is never null, so it satisfies the test on behalf of a
	// person with no name at all. a form still labelled "Household name" that submits
	// `kind=individual` then parses clean, and a household is filed as a person — with the
	// one field that leaked across kinds being the one that becomes the row's identity.
	const required = kind === 'household' ? givenDisplayName : derived;
	if (required === null) {
		errors[REQUIRED_NAME_FIELD[kind]] = MISSING_NAME[kind];
	}

	// only once that holds does an explicit `display_name` rename the row: an individual
	// filed as "Dr. Okafor" is a real preference, and it overrides rather than substitutes.
	const displayName = givenDisplayName ?? derived;

	// `FIELD_LIMITS` saw only the submitted fields, and this one is not submitted: a
	// 200-character first name and a 200-character last name each pass, and join into a
	// 401-character `display_name` that no check on the column stops. a *typed* display
	// name was already measured, so only the derived one is re-checked here — and only when
	// the parts it was built from all fit, since a part that is itself over the limit is
	// already reported at the input it was typed into and this would only say so again,
	// under a different one.
	const partsFit =
		errors.first_name === undefined &&
		errors.last_name === undefined &&
		errors.legal_name === undefined;
	if (givenDisplayName === null && partsFit && derived !== null && derived.length > MAX_NAME) {
		errors[REQUIRED_NAME_FIELD[kind]] = `with last name must be at most ${MAX_NAME} characters`;
	}

	if (Object.keys(errors).length > 0 || displayName === null) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		// the one place a `ParsedContact` comes into existence, and the reason the double
		// assertion is here rather than smuggled into the type: this object genuinely is not a
		// `ParsedContact` — it lacks the brand, which is the entire point. making the brand
		// optional so this could be a single `as` would let any module build one. so the
		// unsoundness is spent once, on this line, past every check above.
		value: {
			kind,
			displayName,
			// the columns a kind does not use are stored `null` rather than carrying whatever
			// was left in a hidden input when staff switched kind mid-form. otherwise an
			// organization keeps a stray `first_name` that no screen shows and every export does.
			firstName: kind === 'individual' ? firstName : null,
			lastName: kind === 'individual' ? lastName : null,
			legalName: kind === 'organization' ? legalName : null,
			primaryEmail,
			primaryPhone
		} as unknown as ParsedContact
	};
}
