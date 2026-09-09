import { describe, expect, it } from 'vitest';
import {
	ORG_PROFILE_FIELDS,
	parseOrgProfile,
	type OrgProfileFieldErrors,
	type OrgProfileFormValues,
	type ParsedOrgProfile
} from './org-input';

// node pool, no database — the same split `contact-input.spec.ts` makes, for the same
// reason: every rule asserted here is decidable from the submitted values alone.

/**
 * the smallest submission that parses: the five fields the row cannot exist without.
 *
 * the legal name, the three address parts a receipt is printed from, and the EIN a donation form is
 * served under — so every case below that spreads this one is asserting its own rule against a
 * submission that is otherwise saveable, rather than against one that would have been refused
 * anyway.
 *
 * `deductibility_statement` is on no submission here and is not a field this parser has: no screen
 * posts a wording, and ./deductibility.ts is what a served form reads instead.
 */
const MINIMAL: OrgProfileFormValues = {
	legal_name: 'Hope Foundation',
	tax_id: '12-3456789',
	address_line1: '12 Kigali Road',
	city: 'Kigali',
	country: 'Rwanda'
};

/** unwraps a result that must have parsed, reporting the errors if it did not. */
function parsed(values: OrgProfileFormValues): ParsedOrgProfile {
	const result = parseOrgProfile(values);
	if (!result.ok) {
		throw new Error(`expected these values to parse, got ${JSON.stringify(result.errors)}`);
	}
	return result.value;
}

/** the mirror: unwraps the error map from a result that must have been rejected. */
function rejected(values: OrgProfileFormValues): OrgProfileFieldErrors {
	const result = parseOrgProfile(values);
	if (result.ok) {
		throw new Error(`expected these values to be rejected, got ${JSON.stringify(result.value)}`);
	}
	return result.errors;
}

describe('parseOrgProfile — legal name', () => {
	it('accepts a submission carrying nothing beyond what a receipt needs', () => {
		expect(parsed(MINIMAL).legalName).toBe('Hope Foundation');
	});

	it('rejects a missing legal name', () => {
		expect(rejected({}).legal_name).toBeDefined();
	});

	it('rejects a legal name that is only whitespace', () => {
		// the column's check would refuse this too — this is the layer that says so in a
		// sentence instead of an SQLITE_CONSTRAINT_CHECK.
		expect(rejected({ legal_name: ' \t\n' }).legal_name).toBeDefined();
	});

	it('rejects a legal name that is only a non-breaking space', () => {
		// U+00A0 is what a paste out of a word processor produces; it renders as a blank
		// cell on every screen. JS `.trim()` covers it, and so does the column's check.
		expect(rejected({ legal_name: ' ' }).legal_name).toBeDefined();
	});

	it('trims the value it stores', () => {
		expect(parsed({ ...MINIMAL, legal_name: '  Hope Foundation  ' }).legalName).toBe(
			'Hope Foundation'
		);
	});
});

/**
 * the three address boxes a receipt is printed from, refused on the legal name's precedent.
 *
 * asserted here and not only against the settings form, because the two stages have to refuse the
 * same submission: the header of `@better-giving/operator/console/org-rules` states that a rule
 * declared twice
 * drifts, and that the half that drifts silently is the client's — a form that refuses a value
 * this parser accepts leaves nobody able to tell which of the two was right. `.nullable()` on
 * these three here is precisely how that drift would be reintroduced: a blank is already `null` by
 * the time this stage runs, and a nullable wrapper answers `null` without ever running the rule
 * underneath it.
 *
 * the word is written out rather than imported: a test that reads its expectation out of the
 * module under test asserts nothing about the wording — the same rule the length limits below are
 * pinned by. it is one word and names no field, because the box it is drawn under is labelled and
 * the key names it to a machine.
 */
describe('parseOrgProfile — the address a receipt is printed from', () => {
	it.each(['address_line1', 'city', 'country'] as const)('rejects an absent %s', (field) => {
		const values = { ...MINIMAL };
		delete values[field];
		expect(rejected(values)[field]).toBe('required');
	});

	it.each(['address_line1', 'city', 'country'] as const)(
		'rejects a %s that is only whitespace',
		(field) => {
			// the clean stage turns a blank into `null` before any rule runs, so this is the same arm
			// an absent box lands on — and it is the one an operator actually produces, by typing a
			// space into a box and pressing Save.
			expect(rejected({ ...MINIMAL, [field]: ' \t\n' })[field]).toBeDefined();
		}
	);

	it('accepts the smallest submission a receipt could be printed from', () => {
		expect(parsed(MINIMAL)).toMatchObject({
			legalName: 'Hope Foundation',
			addressLine1: '12 Kigali Road',
			city: 'Kigali',
			country: 'Rwanda'
		});
	});

	it('does not ask for a region or a postcode', () => {
		// they are deliberately not in `RECEIPT_FIELDS` (./receipt-fields.ts): plenty of countries
		// have neither a state level nor a postcode, so requiring them would refuse a complete Irish
		// or Emirati address.
		expect(parsed({ ...MINIMAL, region: '', postal_code: '' })).toMatchObject({
			region: null,
			postalCode: null
		});
	});
});

/**
 * the EIN, which is the one box a donation form is refused over that is not an address.
 *
 * what a blank costs here is sharper than a gap on a receipt, which is why it is its own block
 * rather than one more row above: `publishedConfig` (../forms/published-config.ts) serves no form
 * at all while it is empty, so a deployment that saved a blank has no working donation form
 * anywhere and finds out from a donor.
 *
 * asserted here and not only against the settings form for the reason the address block above
 * gives: the two stages have to refuse the same submission, and `.nullable()` on this one in
 * `FIELD_LIMITS` is precisely how the drift would come back — a nullable wrapper answers `null`
 * without ever running the rule underneath it.
 */
describe('parseOrgProfile — the EIN a donation form is served under', () => {
	it('rejects an absent EIN', () => {
		const values = { ...MINIMAL };
		delete values.tax_id;
		expect(rejected(values).tax_id).toBe('required');
	});

	it('rejects an EIN that is only whitespace', () => {
		// the clean stage turns a blank into `null` before any rule runs, so this is the same arm an
		// absent box lands on — and it is the one an operator actually produces, by clearing the box
		// and pressing Save.
		expect(rejected({ ...MINIMAL, tax_id: ' \t\n' }).tax_id).toBe('required');
	});
});

describe('parseOrgProfile — optional fields', () => {
	it('stores an omitted field as null, never as an empty string', () => {
		// `''` in a nullable column is "stated as nothing", which is the one the check on
		// each of these columns refuses. every field that may be omitted at all is here — the
		// five `MINIMAL` carries are refused blank instead, and are covered above.
		expect(parsed(MINIMAL)).toMatchObject({
			addressLine2: null,
			region: null,
			postalCode: null,
			notificationEmail: null
		});
	});

	it('treats a blank submitted field as absent', () => {
		expect(parsed({ ...MINIMAL, region: '   ', postal_code: '' })).toMatchObject({
			region: null,
			postalCode: null
		});
	});

	it('trims and stores every address part it was given', () => {
		expect(
			parsed({
				...MINIMAL,
				address_line1: ' 12 Kigali Road ',
				address_line2: 'Suite 4',
				city: 'Kigali',
				region: 'Kigali City',
				postal_code: '00000',
				country: 'Rwanda'
			})
		).toMatchObject({
			addressLine1: '12 Kigali Road',
			addressLine2: 'Suite 4',
			city: 'Kigali',
			region: 'Kigali City',
			postalCode: '00000',
			country: 'Rwanda'
		});
	});
});

/**
 * the EIN's shape, which this product has because it is for US 501(c)(3) organisations.
 *
 * one stored spelling for the four an operator can produce, so nothing downstream has to normalise
 * again: a receipt prints the column, and two deployments that typed the same number differently
 * would print it differently.
 */
describe('parseOrgProfile — what an EIN may look like', () => {
	it.each([
		['as the IRS prints it', '47-1234567'],
		['with no dash', '471234567'],
		['with spaces around the dashed form', '  47-1234567  '],
		['with spaces around the bare digits', ' 471234567 ']
	])('stores %s as `47-1234567`', (_label, typed) => {
		expect(parsed({ ...MINIMAL, tax_id: typed }).taxId).toBe('47-1234567');
	});

	it.each([
		['eight digits', '4712345'],
		['ten digits', '47-12345678'],
		['a registration number from another jurisdiction', 'GB 123 4567 89'],
		['a dash in the wrong place', '4712-34567'],
		['letters mixed into the digits', '47-123456X']
	])('rejects %s', (_label, typed) => {
		expect(rejected({ ...MINIMAL, tax_id: typed }).tax_id).toContain('Nine digits');
	});

	it('says what an EIN looks like, rather than only refusing', () => {
		// the key names the box; the sentence is the shape. "invalid" leaves an operator guessing
		// whether the dash was the problem.
		expect(rejected({ ...MINIMAL, tax_id: '4712345' }).tax_id).toContain('12-3456789');
	});
});

describe('parseOrgProfile — country', () => {
	it('stores a country name as typed rather than demanding a code', () => {
		// deliberately free text; see the column comment in db/schema.ts for the trade.
		expect(parsed({ ...MINIMAL, country: 'United States' }).country).toBe('United States');
	});
});

describe('parseOrgProfile — notification email', () => {
	it('accepts an address with a plus tag', () => {
		expect(
			parsed({ ...MINIMAL, notification_email: 'giving+ops@example.org' }).notificationEmail
		).toBe('giving+ops@example.org');
	});

	it('rejects a value that is plainly not an address', () => {
		expect(
			rejected({ ...MINIMAL, notification_email: 'Hope Foundation' }).notification_email
		).toBeDefined();
	});

	it('leaves the address optional', () => {
		expect(parsed({ ...MINIMAL, notification_email: '' }).notificationEmail).toBeNull();
	});
});

describe('parseOrgProfile — reporting', () => {
	it('reports every offending field at once, not the first', () => {
		// a form that reports one problem per round trip is how a ten-field save takes
		// ten submissions.
		const errors = rejected({
			...MINIMAL,
			legal_name: '',
			notification_email: 'not-an-address',
			city: 'x'.repeat(5000)
		});
		expect(Object.keys(errors).sort()).toEqual(['city', 'legal_name', 'notification_email']);
	});

	it('keys every error to a field name that exists', () => {
		const errors = rejected({ notification_email: 'nope' });
		for (const key of Object.keys(errors)) {
			expect(ORG_PROFILE_FIELDS).toContain(key);
		}
	});

	it('does not put a column name in front of a fundraiser', () => {
		// CLAUDE.md: the schema's names never reach a screen. the key is what a machine
		// reads; the message is a sentence.
		const errors = rejected({});
		expect(errors.legal_name).not.toContain('legal_name');
		expect(errors.legal_name).not.toContain('org_profile');
	});
});

describe('parseOrgProfile — length limits', () => {
	it('rejects an overlong value on the field it was typed into', () => {
		const errors = rejected({ ...MINIMAL, address_line1: 'x'.repeat(5000) });
		expect(errors.address_line1).toBeDefined();
		expect(errors.legal_name).toBeUndefined();
	});

	it('rejects an overlong legal name', () => {
		expect(rejected({ legal_name: 'x'.repeat(5000) }).legal_name).toBeDefined();
	});

	// the boundary, field by field. the limits are generous by design — they exist to stop a
	// pathological row, not to model a real value — so the failure worth catching is an
	// off-by-one that refuses a value at the limit, which reads to an operator as the app
	// rejecting something it plainly said was allowed. the numbers are restated here rather
	// than imported: the constants are private, and a test that reads its expectation out of
	// the code under test asserts nothing about the number.
	it('accepts a legal name of exactly 200 characters and refuses 201', () => {
		expect(parsed({ ...MINIMAL, legal_name: 'x'.repeat(200) }).legalName).toHaveLength(200);
		expect(rejected({ ...MINIMAL, legal_name: 'x'.repeat(201) }).legal_name).toBeDefined();
	});

	// the EIN has no cap of its own and needs none: nine digits is the whole of what it may be, and
	// the block above is where that is asserted.

	it('accepts an address line of exactly 200 characters and refuses 201', () => {
		expect(parsed({ ...MINIMAL, address_line2: 'x'.repeat(200) }).addressLine2).toHaveLength(200);
		expect(rejected({ ...MINIMAL, address_line2: 'x'.repeat(201) }).address_line2).toBeDefined();
	});

	it('accepts a locality of exactly 100 characters and refuses 101', () => {
		expect(parsed({ ...MINIMAL, city: 'x'.repeat(100) }).city).toHaveLength(100);
		expect(rejected({ ...MINIMAL, city: 'x'.repeat(101) }).city).toBeDefined();
	});

	it('accepts a postal code of exactly 20 characters and refuses 21', () => {
		expect(parsed({ ...MINIMAL, postal_code: 'x'.repeat(20) }).postalCode).toHaveLength(20);
		expect(rejected({ ...MINIMAL, postal_code: 'x'.repeat(21) }).postal_code).toBeDefined();
	});

	it('accepts an email of exactly 320 characters and refuses 321', () => {
		// 320 is the RFC 5321 maximum for an address, so this is the one limit that is a real
		// number rather than round-number headroom.
		const domain = '@example.org';
		const at320 = 'x'.repeat(320 - domain.length) + domain;
		expect(parsed({ ...MINIMAL, notification_email: at320 }).notificationEmail).toHaveLength(320);
		expect(
			rejected({ ...MINIMAL, notification_email: `x${at320}` }).notification_email
		).toBeDefined();
	});

	it('measures the trimmed value, not what was typed', () => {
		// `clean` runs first, so surrounding whitespace is not part of the length. a value that
		// fits once trimmed must not be refused for the spaces around it.
		expect(parsed({ ...MINIMAL, legal_name: `  ${'x'.repeat(200)}  ` }).legalName).toHaveLength(
			200
		);
	});

	it('names the length and the limit, so the operator knows how much to cut', () => {
		// CLAUDE.md: an error body names the offending value and where to fix it. "too long"
		// leaves someone deleting characters one at a time.
		const message = rejected({ ...MINIMAL, postal_code: 'x'.repeat(21) }).postal_code;
		expect(message).toContain('21');
		expect(message).toContain('20');
	});
});
