import { z } from 'zod';

// what the organisation's legal identity may hold — the caps, which boxes refuse a blank, the
// EIN's shape and the one spelling it is stored in — the whole of it, in the one module every
// surface reads them from.
//
// **the rules are here because two surfaces apply them to the same nine values.** the deployment
// parses every profile it is sent (`packages/app/src/lib/server/org/org-input.ts`) and the console
// applies them in front of the person typing, at the boxes ./org.ts names
// (`packages/console-ui/src/lib/org-fold.tsx`). a copy in the console would be the cheaper answer
// and is exactly how the two come to disagree: one end takes eight digits for an EIN and the other
// refuses the save, which is an operator told a value is fine and then told it is not, with
// nothing on either screen saying which half was right. one module is what makes both ends agree.
//
// **the deployment's parse stays the authority.** the console reading a profile first is a
// courtesy to the operator and never a replacement for the boundary: `/console/org` is reachable
// by anything holding a console session, so the worker parses every profile it is sent whatever
// asked it to.
//
// **a surface reading these ahead of a press reads the issues and never the output.** `tax_id`'s
// rule rewrites what it stores, and that rewrite is the deployment's to make — a screen asks what
// is wrong with a box, never what would be stored, so nothing re-spells a value the operator is
// still typing.
//
// zod here, where ../origins.ts and ../admin-password.ts are plain typescript, and the two shapes
// are not in tension. those are sequences: each check answers a question the next one depends on
// and the first failure is the only message worth showing, which each of them argues on itself.
// this is nine independent boxes, and every offending one has to be reported at once — a profile
// that named one problem per press is how nine boxes take nine presses.
//
// this package is a leaf and imports nothing of the app's, which is what makes it the only place
// both ends can reach, and it is what `packages/app/form-rules.spec.ts` requires of a schema the
// browser runs: a component may not import from `$lib/server/**` at all.
//
// what is deliberately not validated here. `country` is free text for the reason its column
// comment in `packages/app/src/lib/server/db/schema.ts` argues at length. `tax_id` is the opposite
// and is checked to the digit — this product is for US 501(c)(3) organisations, so the number is
// an EIN, and a fork serving another jurisdiction changes this file the way it changes everything
// else about the deployment (CLAUDE.md).
//
// each rule is written once here and wrapped where it runs: `FIELD_LIMITS` in
// `packages/app/src/lib/server/org/org-input.ts` takes that file's clean stage, where a blank has
// already become `null`, which is why the same rule is `.nullable()` there and bare here.

/**
 * generous, and only here to stop a pathological row rather than to model a real address.
 * 320 is the RFC 5321 maximum for an address; the rest is round-number headroom, sized so
 * that no real value is refused. `tax_id` has no cap among them and needs none: {@link EIN}
 * says it is nine digits, which bounds it at ten characters.
 */
export const MAX_LEGAL_NAME = 200;
export const MAX_ADDRESS_LINE = 200;
export const MAX_LOCALITY = 100;
export const MAX_POSTAL_CODE = 20;
export const MAX_EMAIL = 320;
/**
 * deliberately weak: something, `@`, something, no whitespace. lifted from
 * `packages/app/src/lib/contacts/input-schema.ts`, and the reasoning is that file's.
 *
 * a stricter pattern rejects addresses that deliver — quoted locals, new TLDs, `+` tags —
 * and still cannot tell whether anyone reads the mailbox. the only cheap error worth
 * catching is a value that is plainly not an address at all (an org name typed in the
 * wrong box), and this catches it.
 */
export const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * an employer identification number as an operator can type it: nine digits, with the dash the IRS
 * prints between the second and the third optional.
 *
 * the dash is optional on the way in and never on the way out — {@link einAsPrinted} is what makes
 * one stored spelling of a number an operator may paste four ways. nothing downstream normalises
 * again, and a receipt prints the column, so two deployments that typed the same number
 * differently would otherwise print it differently.
 *
 * nothing wider is accepted. an EIN is issued by one authority in one format, so a value that is
 * not one is a typo rather than a jurisdiction this pattern has not heard of.
 */
export const EIN = /^\d{2}-?\d{7}$/;

/** the stored spelling: `XX-XXXXXXX`, from a value {@link EIN} has already accepted. */
export const einAsPrinted = (value: string): string => {
	const digits = value.replace('-', '');
	return `${digits.slice(0, 2)}-${digits.slice(2)}`;
};

/**
 * the sentence a box the save refuses blank gets, and it is one word: the box it is drawn under
 * is labelled, so a sentence naming the field again or arguing what it is for is the label spelled
 * twice under itself. which boxes are refused blank, and why, is stated on each rule below.
 */
export const REQUIRED = 'required';

/**
 * what a value that is not nine digits gets: the shape, and that the dash is not the problem.
 *
 * the dash is named as optional because that is what an operator wants to know about the box they
 * have just been refused at: they pasted it one way or the other, and a message that showed only
 * the dashed spelling would read as the dash being the problem.
 */
export const MALFORMED_TAX_ID = 'Nine digits, written `12-3456789`. The dash is optional.';

/**
 * the message a value over its cap gets, stating both the length and the limit so the operator
 * knows how much to cut. `missing` is the sentence a field that is not `.nullable()` gets when
 * the shape stage handed it `null`, and the sentence a box the request did not carry at all
 * gets — both are the string check failing, which is what a schema-level `error` covers and a
 * per-check one does not.
 *
 * the trim is measured before the cap, so what is counted is what would be stored — and it is
 * idempotent against the deployment parser's clean stage, which has already trimmed by the time
 * `FIELD_LIMITS` runs.
 *
 * `issue.input` is typed `unknown` because an issue is a general shape, but a length check
 * only ever runs on a value that already passed the string check above it.
 */
export function bounded(max: number, missing?: string) {
	return z
		.string({ error: missing })
		.trim()
		.max(max, {
			error: (issue) =>
				`This is ${String(issue.input).length} characters, over the ${max}-character limit.`
		});
}

/**
 * one rule per box, and the only place a rule about one of them is stated.
 *
 * five of them refuse a blank — `legal_name`, the three address boxes a receipt is printed from,
 * and the EIN no donation form is served without — and each says so twice for two different arms:
 * the string check for a box that arrived `null` or absent, and `.min(1)` for one that arrived
 * empty. the deployment parser's clean stage turns a blank into `null` before `FIELD_LIMITS` runs,
 * so its reading reaches the first arm; a browser reading a box as typed reaches the second. both
 * carry the same sentence, so which one fired never shows.
 *
 * a pattern is declared last on the field that carries one deliberately — more than one check may
 * fail at once, and one message per field is what a screen has room for, so the more specific is
 * the one that ends up under the input (`fieldErrorsFrom` in ../zod-issues.ts keeps the last issue
 * on a key). both patterns pass a blank rather than failing it, for two different reasons:
 * `notification_email` is optional, so an empty box is a value and not an omission, and `tax_id`
 * has `.min(1)` already refusing a blank — a pattern that also fired would replace that word with
 * the shape of an EIN.
 */
export const ORG_PROFILE_FIELD_RULES = {
	// refused blank because the row's existence is what makes it meaningful: there is no seeded row,
	// so a saved profile is one a human filled in, and this is what stops that from meaning "a row
	// of blanks". a receipt with no legal name on it is not a receipt.
	legal_name: bounded(MAX_LEGAL_NAME, REQUIRED).min(1, { error: REQUIRED }),
	// refused blank on `legal_name`'s precedent, and a blank here is a total outage rather than a
	// degraded receipt: `publishedConfig` in
	// `packages/app/src/lib/server/forms/published-config.ts` serves no form at all while it is
	// empty, and `readFormConfig` in `packages/form/src/config.ts` drops the whole config over it.
	// being required and having a format are two different questions, and this field answers
	// both — it must not be empty, and what is in it must be an EIN.
	//
	// the one rule here that rewrites what it stores, and the one with no cap: nine digits is the
	// whole of what it may be. the transform sits behind a pipe, so an input that raised any issue
	// above never reaches it and what it is handed is always a value `EIN` accepted.
	tax_id: z
		.string({ error: REQUIRED })
		.trim()
		.min(1, { error: REQUIRED })
		.refine((value) => value === '' || EIN.test(value), { error: MALFORMED_TAX_ID })
		.transform(einAsPrinted),
	// the three address boxes a receipt is printed from — this one, `city` and `country` — are
	// refused blank on `legal_name`'s precedent, so that a saved profile is always one a receipt can
	// be printed from. `region` and `postal_code` are not among them and must not join them: plenty
	// of countries have neither a state level nor a postcode, so requiring them would refuse a
	// complete Irish or Emirati address. `address_line2` is a suite number.
	address_line1: bounded(MAX_ADDRESS_LINE, REQUIRED).min(1, { error: REQUIRED }),
	address_line2: bounded(MAX_ADDRESS_LINE),
	city: bounded(MAX_LOCALITY, REQUIRED).min(1, { error: REQUIRED }),
	region: bounded(MAX_LOCALITY),
	postal_code: bounded(MAX_POSTAL_CODE),
	country: bounded(MAX_LOCALITY, REQUIRED).min(1, { error: REQUIRED }),
	notification_email: bounded(MAX_EMAIL).refine((value) => value === '' || EMAIL.test(value), {
		error: 'Not an email address.'
	})
} as const;
