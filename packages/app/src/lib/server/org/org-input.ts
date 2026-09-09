import { ORG_PROFILE_FIELDS, type OrgProfileField } from '@better-giving/operator/console/org';
import { ORG_PROFILE_FIELD_RULES } from '@better-giving/operator/console/org-rules';
import { fieldErrorsFrom } from '@better-giving/operator/zod-issues';
import { z } from 'zod';

// parsing and validating the organization's own details, with no database in sight.
//
// split from ./queries.ts for the same reason `contacts/contact-input.ts` is: every rule
// about what an org profile may be — which fields the row cannot exist without, what counts
// as an email, what a blank means — is decidable from the submitted values alone. keeping
// the parse here means it is testable with no D1 and no browser, and it means the endpoint
// that takes a profile over the wire (../../../routes/console.org.ts) stays a translation layer
// rather than the place the rules live.
//
// how the rules are stated. every rule an org profile has is a property of a single value —
// trim, blank becomes `null`, the length caps, the fields that must be filled in, the
// email pattern — so all of them are zod schemas and nothing is left as a hand-written check
// underneath. they are stated in `@better-giving/operator/console/org-rules` rather than here,
// along with what is deliberately not checked and why, because the console's Organisation fold
// runs the same rules in the browser in front of the person typing — and that package is a leaf
// this app and the console can both reach, where `$lib/server/**` is closed to a component
// (`packages/app/form-rules.spec.ts`). what this file adds to them is `.nullable()`.
// `contacts/contact-input.ts` keeps a block of plain typescript below its schemas for the rules
// that read more than one field at a time; there are none of those here, which is why the whole
// of `parseOrgProfile` is a parse and a mint.
//
// error identity is carried by the object key. the schema's keys are the form field names, so
// `issue.path[0]` already is an `OrgProfileField` and the map a form renders is built by
// reading it — see `fieldErrorsFrom` in `@better-giving/operator/zod-issues`, which travelled
// with the rules and is where that walk and its reasons live for every surface that shares it.
//
// the brand on `ParsedOrgProfile` is not zod's `.brand()`, which is compile-time only and
// would mark a value as checked without checking it. see the note on `ParsedOrgProfile`.

/**
 * the form field names, which are also the error keys and also the column names.
 *
 * one vocabulary rather than three, and it is carried by the error *key* rather than by
 * the message: `legal_name` names something a developer or an agent can find in the
 * markup, in the error map and in the table, while the message itself is a sentence a
 * fundraiser reads under the input.
 *
 * re-exported rather than written out again: the console draws a box per name and this side
 * states them in a save, so a list spelled on each side is a field one half stops sending while
 * the other goes on drawing a box for it (`@better-giving/operator/console/org`'s header).
 */
export { ORG_PROFILE_FIELDS, type OrgProfileField };

/**
 * one message per offending field, keyed by the field the operator must edit.
 *
 * the message is what a fundraiser reads, the key is what a machine reads — the same split
 * `ContactFieldErrors` makes, and the same reason: CLAUDE.md keeps schema vocabulary off a
 * screen, and an error map is one of the places it would otherwise walk straight back on.
 * nothing is lost, since the field name is right here in the key.
 *
 * a whole-request failure — the database being unreachable — is not one of these. it
 * belongs to no field, and pinning it on one tells the operator to edit something that is
 * fine; the form action carries it separately.
 */
export type OrgProfileFieldErrors = Partial<Record<OrgProfileField, string>>;

/**
 * an org profile whose blanks are already `null` and whose five required fields are known to be
 * real values — the legal name, the three address parts a receipt is printed from, and the EIN no
 * donation form is served without.
 *
 * those five being `string` rather than `string | null` is the whole promise: a saved row is one a
 * receipt can be printed from, so a template holding one of these has four fewer `??` in it than
 * the row does. the columns stay nullable, because a row written by `wrangler d1 execute` never
 * passed through here — see `missingForReceipt` in ./receipt-fields.ts and `identityMissing` in
 * ./identity.ts, which are what still report one.
 *
 * `deductibilityStatement` is not here and no screen posts one: `org_profile`'s column is a fork's
 * to write and ./deductibility.ts is what reads it, so a profile save leaves it exactly as it
 * found it (`saveOrgProfile` in ./queries.ts). the fields are otherwise `org_profile`'s writable
 * columns and no more — `id` is the singleton literal ./queries.ts writes, and
 * `created_at`/`updated_at` belong to the column defaults.
 *
 * the brand is what makes `parseOrgProfile` hard to skip. without it this is a structural
 * type, so `saveOrgProfile(db, { legalName: '', ... })` type-checks and the "the row's
 * existence means at minimum a legal name" promise is kept only by callers who happened to
 * read this file. with it, that call is a type error and the only way past is an assertion —
 * `as ParsedOrgProfile` is enough on its own, since a source that differs from the target
 * only by the brand is still comparable, so the double assertion below buys nothing the
 * single one does not. what the brand buys is that someone had to type it: an accidental
 * object literal is refused, and a deliberate mint is one `grep 'as ParsedOrgProfile'` away.
 * the same trick `ParsedContact`, `PostableAccountId` and `Posting` play, for the same
 * reason and with the same limit.
 *
 * the brand is a `unique symbol` intersection minted by exactly one double assertion, at the
 * end of `parseOrgProfile` and past every check in it. zod's `.brand()` is not what enforces
 * it and must not be: that is a compile-time no-op which returns its input untouched, so it
 * marks a value as checked wherever it is written, including in front of nothing.
 *
 * it is not a substitute for `org_profile_legal_name_not_blank_check` on the column, and
 * the check is not a substitute for it — the brand stops a *caller*, the check stops a
 * hand-written `wrangler d1 execute` that never passes through TypeScript at all.
 */
export type ParsedOrgProfile = {
	readonly legalName: string;
	readonly taxId: string;
	readonly addressLine1: string;
	readonly addressLine2: string | null;
	readonly city: string;
	readonly region: string | null;
	readonly postalCode: string | null;
	readonly country: string;
	readonly notificationEmail: string | null;
} & { readonly __parsed: unique symbol };

export type OrgProfileParseResult =
	| { readonly ok: true; readonly value: ParsedOrgProfile }
	| { readonly ok: false; readonly errors: OrgProfileFieldErrors };

/**
 * what the form submits: every value is a string or absent, because that is what
 * `FormData` yields.
 *
 * `parseOrgProfile` takes this rather than `FormData` so a test states its input as an
 * object literal — `{ legal_name: 'Hope Foundation' }` is the case being made, where the
 * `FormData` that builds it is four lines of noise around it. it is also what keeps a wire format
 * off this parser entirely: `orgValues` in ../../../routes/console.org.ts reads the console's
 * posted body onto this shape and `toFormValues` in ./form-values.ts projects a stored row back
 * onto the same one to seed the boxes, so what reaches here is never a body.
 */
export type OrgProfileFormValues = Partial<Record<OrgProfileField, string>>;

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
 * it cannot fail on an `OrgProfileFormValues` — every key there is optional and `cleanText` reads
 * an absent one as a blank, so nothing about a submission can refuse it. every rule that can fail is in
 * `FIELD_LIMITS` below, which runs *over this stage's output* rather than being piped onto
 * the end of it. that split is the shape `contacts/contact-input.ts` sets out and the sibling
 * parsers keep: a failed pipe carries no data, so a rule written after one has nothing left to
 * read the submission out of.
 */
const CLEAN_FIELDS = z.object({
	legal_name: cleanText,
	tax_id: cleanText,
	address_line1: cleanText,
	address_line2: cleanText,
	city: cleanText,
	region: cleanText,
	postal_code: cleanText,
	country: cleanText,
	notification_email: cleanText
});

/**
 * the check stage: the caps, the five fields that must be filled in, what an EIN must look like
 * and the one thing an email must look like.
 *
 * the keys are the form field names, which is what makes `issue.path[0]` an error key with
 * nothing to translate. every rule is `ORG_PROFILE_FIELD_RULES` in
 * `@better-giving/operator/console/org-rules`, which the console's Organisation fold runs too —
 * the only thing this stage adds is `.nullable()`, because a blank is already `null` by the time
 * it runs where a submitted box is `''`.
 *
 * `.nullable()` is therefore what makes a field optional here, and a field that must be filled in
 * does not take it: `legal_name`, the three address parts a receipt is printed from, and the EIN
 * no donation form is served without all fail the string check on `null` and come back with their
 * own sentence. a nullable wrapper over one of those rules would answer `null` without ever
 * running the rule underneath, which is how this stage would come to accept a submission the
 * console's fold refuses — the drift the header of `@better-giving/operator/console/org-rules`
 * exists to prevent. so a rule added there refusing a blank has to lose its `.nullable()` here in
 * the same edit. it is
 * also what makes this stage's output the value stored, since it is where those five stop being
 * `string | null`.
 */
const FIELD_LIMITS = z.object({
	legal_name: ORG_PROFILE_FIELD_RULES.legal_name,
	tax_id: ORG_PROFILE_FIELD_RULES.tax_id,
	address_line1: ORG_PROFILE_FIELD_RULES.address_line1,
	address_line2: ORG_PROFILE_FIELD_RULES.address_line2.nullable(),
	city: ORG_PROFILE_FIELD_RULES.city,
	region: ORG_PROFILE_FIELD_RULES.region.nullable(),
	postal_code: ORG_PROFILE_FIELD_RULES.postal_code.nullable(),
	country: ORG_PROFILE_FIELD_RULES.country,
	notification_email: ORG_PROFILE_FIELD_RULES.notification_email.nullable()
});

/**
 * validates a submitted org profile.
 *
 * returns every field error at once rather than the first: a form that reports one problem
 * per round trip is how a ten-field save takes ten submissions.
 */
export function parseOrgProfile(values: OrgProfileFormValues): OrgProfileParseResult {
	const clean = CLEAN_FIELDS.parse(values);
	const limits = FIELD_LIMITS.safeParse(clean);
	if (!limits.success) {
		return { ok: false, errors: fieldErrorsFrom(limits.error, ORG_PROFILE_FIELDS) };
	}

	return {
		ok: true,
		// the one place a `ParsedOrgProfile` comes into existence. the assertion is here rather
		// than smuggled into the type: this object genuinely is not a `ParsedOrgProfile` — it
		// lacks the brand, which is the entire point — so the unsoundness is spent once, on this
		// line, past every check above. `as unknown as` rather than a bare `as` buys nothing the
		// compiler cares about (see the brand's note above: one `as` compiles too); it is the
		// louder spelling, kept so this line reads as the deliberate act it is.
		//
		// the mapping stays singular: one field per column, spelled out, for the reason
		// `newContactRow` gives — a spread is what makes a later field reach a column nobody
		// decided to store. it is also the one place the form's snake_case name and the row's
		// camelCase name are put side by side, so a field that is renamed on one side and not
		// the other is a line that no longer reads straight across.
		value: {
			legalName: limits.data.legal_name,
			taxId: limits.data.tax_id,
			addressLine1: limits.data.address_line1,
			addressLine2: limits.data.address_line2,
			city: limits.data.city,
			region: limits.data.region,
			postalCode: limits.data.postal_code,
			country: limits.data.country,
			notificationEmail: limits.data.notification_email
		} as unknown as ParsedOrgProfile
	};
}

/**
 * the submitted body as the parser above takes it: one string per box, absent where the body
 * carried none.
 *
 * read off the body rather than off a parsed submission, because a submission the schema refused
 * carries no values at all and this parser has to run on that arm too — every offending box comes
 * back at once, or a ten-box save takes ten round trips. it is the same reading `formInputValues`
 * in ../forms/form-input.ts is, one vocabulary over.
 *
 * a key is stated only where the body carried a string, which is what `OrgProfileFormValues` admits
 * and what a null column becomes in `toFormValues`: `exactOptionalPropertyTypes` is on, so an
 * absent key and an `undefined` one are different types and only the first is one of these.
 */
export function orgProfileValues(body: FormData): OrgProfileFormValues {
	const values: OrgProfileFormValues = {};
	for (const field of ORG_PROFILE_FIELDS) {
		const value = body.get(field);
		if (typeof value === 'string') values[field] = value;
	}
	return values;
}
