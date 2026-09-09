import type { OrgProfile } from '../db/schema';
import type { OrgProfileField } from './org-input';

// which of the organisation's own details a receipt cannot be printed without — and the one
// place that question is answered.
//
// a leaf, and that direction is the point. a receipt template asking a screen's module the
// question would make a tax document's precondition depend on a screen, so the shared half lives
// here and every caller imports it — `../email/receipt.ts` turns the answer into a refusal to
// render, and nothing in this file knows that module exists.
//
// nothing here reads the database, renders anything, or imports a status vocabulary.

/**
 * the fields a receipt prints, `legal_name` first because it is the one that is mandatory.
 *
 * it is in this list even though a saved row always has one, and that is the point: the
 * column is NOT NULL, so a saved row never reports it — while a deployment where nothing is
 * filled in at all would otherwise name four optional fields and skip the required one. a page
 * that highlights these inputs would then highlight everything except the box that has to be
 * filled.
 *
 * `region` and `postal_code` are not here on purpose: plenty of countries have neither a
 * state level nor a postcode, so requiring them would report a complete Irish or Emirati
 * address as incomplete. `address_line2` is a suite number. `notification_email` is not
 * receipt content at all — it is where operational mail goes, and whether this deployment sends
 * anything is the mail settings' question rather than this one's.
 */
export const RECEIPT_FIELDS = [
	'legal_name',
	'tax_id',
	'address_line1',
	'city',
	'country'
] as const satisfies readonly OrgProfileField[];

/** the fields a receipt needs, as a type — narrower than `OrgProfileField`. */
export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

/** what to call each of those in a sentence a fundraiser reads. */
export const RECEIPT_FIELD_WORDS: Record<ReceiptField, string> = {
	legal_name: 'registered name',
	tax_id: 'EIN',
	address_line1: 'street address',
	city: 'city',
	country: 'country'
};

/** the row properties behind `RECEIPT_FIELDS` — the other half of `valueOf`'s mapping. */
type ReceiptRowKey = 'legalName' | 'taxId' | 'addressLine1' | 'city' | 'country';

/**
 * a profile that has been proven to carry every field a receipt prints.
 *
 * the point of the narrowing is that a template holding one of these has no `??` in it. handed
 * an `OrgProfile` with four nullable columns and a completeness check performed in another
 * module, `org.taxId ?? ''` is the only thing standing between a dropped list entry and a
 * receipt printing a bare `EIN: ` line — `'EIN: '` is not `''`, so the empty-line filter
 * does not catch it. with this type the fallback does not compile, which is a much better guard
 * than a fallback nobody re-reads.
 */
export type ReceiptReadyProfile = OrgProfile & { readonly [K in ReceiptRowKey]: string };

/**
 * the fields a receipt prints, and nothing else off the row.
 *
 * narrower than `ReceiptReadyProfile`, which is a whole `OrgProfile` with its receipt fields
 * proven — `id`, the timestamps, the notification address and the deductibility wording come with
 * that and none of them belongs on a receipt. this is what a template is
 * handed instead: the five required fields as strings, and the three plenty of countries do
 * not have as stored. every `ReceiptReadyProfile` is one.
 *
 */
export type ReceiptIdentity = { readonly [K in ReceiptRowKey]: string } & {
	readonly addressLine2: string | null;
	readonly region: string | null;
	readonly postalCode: string | null;
};

/**
 * a profile good enough to print, or the list of what is stopping it.
 *
 * a proven value rather than a verdict. a boolean or a `missing.length === 0` leaves the
 * caller to re-establish, at every use, something this module already knows.
 */
export type ProfileForReceipt =
	| { readonly ok: true; readonly org: ReceiptReadyProfile }
	| { readonly ok: false; readonly missing: readonly ReceiptField[] };

/**
 * which fields a given profile cannot supply — the whole list when there is no profile at
 * all, because nothing being saved means every field is blank.
 *
 * a fresh array every time, never `RECEIPT_FIELDS` itself. the module-level constant is
 * aliased into two result types and onto a page's props; handing it out is handing out a
 * reference to the source of truth for anyone to sort or splice in place.
 */
export function missingForReceipt(profile: OrgProfile | null): readonly ReceiptField[] {
	if (profile === null) return [...RECEIPT_FIELDS];
	return RECEIPT_FIELDS.filter((field) => !present(fieldValueOf(profile, field)));
}

/**
 * the profile a receipt may be printed from, or what is missing.
 *
 * the one entry point for a template. a caller reporting a gap wants the list
 * (`missingForReceipt`); anything that renders wants the row with the nulls gone, and asking for
 * both separately is how a completeness check and the code it protects drift apart.
 */
export function profileForReceipt(profile: OrgProfile | null): ProfileForReceipt {
	if (profile !== null && isReceiptReady(profile)) return { ok: true, org: profile };
	return { ok: false, missing: missingForReceipt(profile) };
}

/**
 * the same predicate `missingForReceipt` runs, expressed as the narrowing the compiler needs.
 *
 * one function, so a field can never be required by the list and unproven by the type.
 */
function isReceiptReady(profile: OrgProfile): profile is ReceiptReadyProfile {
	return missingForReceipt(profile).length === 0;
}

/**
 * "a, b and c" — a list a person reads, not `join(', ')`.
 *
 * shared by every caller that names a gap and by the template's refusal, so the two name the same
 * fields in the same words. CLAUDE.md: a column name never reaches a screen, so this is what a
 * caller renders and `ReceiptField[]` is what it hands a machine.
 */
export function listFields(fields: readonly ReceiptField[]): string {
	const words = fields.map((field) => RECEIPT_FIELD_WORDS[field]);
	if (words.length <= 1) return words[0] ?? '';
	return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * whether a column carries something somebody actually typed.
 *
 * not `!== null` alone, and the reason is what this is handed: an `OrgProfile` value rather than
 * a row. every one of those columns carries a `not_blank` check, so a blank is unstorable and
 * this is not covering a hole in the table — but nothing in the type records that a constraint
 * ran, and a value that reached here some other way passes a null test while printing exactly the
 * blank line this module exists to prevent. trimmed, because `' '` is the same nothing.
 *
 * `trim()` is wider than that check, which strips a fixed list of seven codepoints; a thin space
 * is blank here and not there. so the question is answered here rather than left to the database,
 * and the wider answer is the one every caller gets.
 *
 * exported for ./identity.ts, ./deductibility.ts and ../forms/published-config.ts, which ask it of
 * the two a donation form is refused without and of the wording a form states, each gated on for a
 * different reason. one standard for "unset", or a blank row is unset to a receipt and filled in
 * to the screen asking whether a form may be served.
 *
 * a predicate rather than a `boolean`, which is what its callers outside this file need: the
 * branch past `present(taxId)` in ../forms/published-config.ts holds a `string`, and narrowing it
 * here is what keeps that from being a cast at the call site.
 */
export function present(value: string | null): value is string {
	return value !== null && value.trim() !== '';
}

/**
 * the column behind a field name.
 *
 * spelled out rather than derived from the name, because the two vocabularies differ by
 * design — `address_line1` is the column and the input, `addressLine1` is the row — and a
 * string transform between them is the kind of thing that silently starts returning
 * `undefined` when a column is renamed. this way a rename is a type error.
 */
function fieldValueOf(profile: OrgProfile, field: ReceiptField): string | null {
	switch (field) {
		// never null in practice — the column is NOT NULL — but spelled out so the switch stays
		// exhaustive over `RECEIPT_FIELDS` and the `missing` branch has a word for it.
		case 'legal_name':
			return profile.legalName;
		case 'tax_id':
			return profile.taxId;
		case 'address_line1':
			return profile.addressLine1;
		case 'city':
			return profile.city;
		case 'country':
			return profile.country;
	}
}
