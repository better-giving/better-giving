import { z } from 'zod';
import { CONTACT_KINDS } from './kinds';

// what a contact's individual fields may hold, in the one place a server parser and a browser
// may both import from.
//
// not under `$lib/server/**`, for the reason ./kinds.ts is not: these rules are the source of
// what `$lib/server/contacts/contact-input.ts` refuses *and* the source of what the donor form
// checks in the browser before it is ever submitted, and a component may not import from
// `$lib/server/**` at all. declared twice they drift, and the half that drifts silently is
// the client's — it would refuse a value the server accepts, with no way for anyone to tell
// which of the two was right.
//
// the dependency runs server -> shared and never back: contact-input.ts imports this, this
// imports only ./kinds.ts.
//
// what is here is field-level and nothing else: a rule is here when it is decidable from one
// submitted value. which name a `kind` requires, what `display_name` is derived from and which
// columns a kind stores `null` are ordered, cross-field and value-producing, so they stay in
// `contact-input.ts` as plain typescript — that split is stated at length in that file's header
// and this module is the half of it a schema expresses well.
//
// each rule is written once and wrapped twice, and the wrapping is the genuine difference
// between the two stages rather than a second declaration. `CONTACT_FORM` takes a submitted
// box, where an untouched one is `''`; `FIELD_LIMITS` in contact-input.ts takes that file's
// clean stage, where a blank has already become `null`. so the same rule is `.default('')` here
// and `.nullable()` there.

/**
 * generous, and only here to stop a pathological row rather than to model a real name.
 * 320 is the RFC 5321 maximum for an address; the rest is round-number headroom.
 */
export const MAX_NAME = 200;
export const MAX_EMAIL = 320;
export const MAX_PHONE = 40;

/**
 * deliberately weak: something, `@`, something, no whitespace.
 *
 * a stricter pattern rejects addresses that deliver — quoted locals, new TLDs, `+` tags —
 * and still cannot tell whether anyone reads the mailbox. the only cheap error worth
 * catching is a value that is plainly not an address at all (a name typed in the wrong
 * box), and this catches it. a receipt is sent to this address (`sendReceipt` in
 * `$lib/server/donations/settle.ts`), so passing here is a typo catch and never a promise
 * that the mail arrives.
 */
export const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * what a required box left blank is told, in the shape `REQUIRED` in ../forms/input-schema.ts
 * states for every field message: the predicate of the label over it, and never the label.
 */
export const REQUIRED = 'required';

/**
 * the one sentence a bad `kind` produces, held as a constant because the schema and the
 * early return in `parseContact` must say the same thing and neither may say more.
 */
export const CHOOSE_KIND = REQUIRED;

/**
 * the submitted `kind`, matched against the vocabulary.
 *
 * the check constraint on `contact.kind` is derived from this same array, so a value that
 * passes here is one the database accepts by construction. the message is stated rather
 * than left to the default, which would list the three values it expected — those are
 * column values, and CLAUDE.md keeps them off a screen. it is the message for a `kind` that
 * is not one of the three *and* for one that was not submitted at all, which is what a
 * schema-level `error` covers and a per-check one does not.
 */
export const CONTACT_KIND = z.enum(CONTACT_KINDS, { error: CHOOSE_KIND });

/**
 * the message a value over its cap gets, naming the limit.
 *
 * the trim is measured before the cap, so what is counted is what would be stored — and it is
 * idempotent against `contact-input.ts`'s clean stage, which has already trimmed by the time
 * `FIELD_LIMITS` runs.
 */
export function bounded(max: number) {
	return z
		.string()
		.trim()
		.max(max, { error: `must be at most ${max} characters` });
}

/**
 * one rule per box, and the only place either stage states one.
 *
 * the email pattern is declared after the cap on the same field deliberately — both may fail at
 * once, and one message per field is what a screen has room for, so the more specific of the two
 * is the one that ends up under the input.
 *
 * a blank passes the pattern rather than failing it, and that is the rule rather than a
 * concession: an email is optional, so an empty box is a value and not an omission. `FIELD_LIMITS`
 * never reaches that arm — a blank is `null` by the time it runs — which is why the two wrappings
 * can share one rule.
 */
export const CONTACT_FIELD_RULES = {
	first_name: bounded(MAX_NAME),
	last_name: bounded(MAX_NAME),
	legal_name: bounded(MAX_NAME),
	display_name: bounded(MAX_NAME),
	primary_email: bounded(MAX_EMAIL).refine((value) => value === '' || EMAIL.test(value), {
		error: 'must be an email address'
	}),
	primary_phone: bounded(MAX_PHONE)
} as const;

/**
 * the donor form as it is submitted, and as the browser checks it before it is.
 *
 * flat, with no nested object, and that is not a style choice: a nested name posted against a flat
 * schema is discarded and the form still validates. `$lib/forms/definition.ts` holds the shape at
 * both ends rather than at the first submission (`$lib/server/conform.ts`) — its own type refuses a
 * nested output, and `defineForm` refuses a nested input when the form is stated.
 *
 * `kind` carries no default, which is what makes an empty POST a refusal rather than a donor. every
 * box a form states must arrive and `parseForm` refuses a body missing one before the schema is
 * allowed to fill it in — so `kind` is never stood in for by the enum's *first* member and the
 * request filed as a person. every other box defaults to `''`, which is what an untouched box submits
 * and what the two boxes a kind does not render send nothing for.
 */
export const CONTACT_FORM = z.object({
	kind: CONTACT_KIND,
	first_name: CONTACT_FIELD_RULES.first_name.default(''),
	last_name: CONTACT_FIELD_RULES.last_name.default(''),
	legal_name: CONTACT_FIELD_RULES.legal_name.default(''),
	display_name: CONTACT_FIELD_RULES.display_name.default(''),
	primary_email: CONTACT_FIELD_RULES.primary_email.default(''),
	primary_phone: CONTACT_FIELD_RULES.primary_phone.default('')
});

export type ContactForm = z.infer<typeof CONTACT_FORM>;
