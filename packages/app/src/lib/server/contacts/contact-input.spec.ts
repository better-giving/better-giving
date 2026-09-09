import { describe, expect, it } from 'vitest';
import {
	CONTACT_FIELDS,
	parseContact,
	type ContactField,
	type ContactFormValues,
	type ParsedContact
} from './contact-input';

// node pool, no database — which is the point of the split. every rule asserted here is
// decidable from the submitted values, so none of these tests needs D1 to be true.

/** the submitted shape of a valid individual, for tests that vary one field off it. */
const INDIVIDUAL: ContactFormValues = {
	kind: 'individual',
	first_name: 'Ada',
	last_name: 'Okafor'
};

/** unwraps a result that must have parsed, reporting the errors if it did not. */
function parsed(values: ContactFormValues): ParsedContact {
	const result = parseContact(values);
	if (!result.ok) {
		throw new Error(`expected these values to parse, got ${JSON.stringify(result.errors)}`);
	}
	return result.value;
}

/** the mirror: unwraps the error map from a result that must have been rejected. */
function rejected(values: ContactFormValues): Partial<Record<ContactField, string>> {
	const result = parseContact(values);
	if (result.ok) {
		throw new Error(`expected these values to be rejected, got ${JSON.stringify(result.value)}`);
	}
	return result.errors;
}

describe('parseContact — kind', () => {
	it('rejects a kind that is not one of the three', () => {
		expect(rejected({ ...INDIVIDUAL, kind: 'donor' }).kind).toBeDefined();
	});

	it('does not echo the rejected kind back into the message', () => {
		// it is a `<select>`, so a bad value means a broken form or a hand-written POST, and
		// neither is helped by the page repeating it. it is also the one reflection with no
		// length check in front of it, since every `FIELD_LIMITS` cap runs after this return.
		const errors = rejected({ kind: 'x'.repeat(5000), first_name: 'Ada' });
		expect(errors.kind).not.toContain('xxx');
		expect(errors.kind!.length).toBeLessThan(200);
	});

	it('does not put a schema value in front of a fundraiser', () => {
		// CLAUDE.md: the schema's names never reach a screen — the page renders "Person",
		// and an error that says `individual` walks it straight back.
		const errors = rejected({ ...INDIVIDUAL, kind: 'donor' });
		expect(errors.kind).not.toContain('individual');
		expect(errors.kind).not.toContain('household');
	});

	it('rejects a missing kind rather than defaulting to individual', () => {
		// a default here would silently file an organization as a person, which no later
		// screen would flag.
		expect(rejected({ first_name: 'Ada' }).kind).toBeDefined();
	});

	it('reports nothing but kind when kind is invalid', () => {
		// every other rule depends on which kind it is, so reporting them alongside would
		// mean reporting rules that may not apply.
		expect(Object.keys(rejected({ kind: 'donor', primary_email: 'not-an-email' }))).toEqual([
			'kind'
		]);
	});
});

describe('parseContact — display_name', () => {
	it('derives an individual display name from both names', () => {
		expect(parsed(INDIVIDUAL).displayName).toBe('Ada Okafor');
	});

	it('accepts an individual with only a first name', () => {
		// a donor known only as "Ada" is a real record; requiring both names is how a "." ends
		// up in the other box.
		expect(parsed({ kind: 'individual', first_name: 'Ada' }).displayName).toBe('Ada');
	});

	it('accepts an individual with only a last name', () => {
		expect(parsed({ kind: 'individual', last_name: 'Okafor' }).displayName).toBe('Okafor');
	});

	it('rejects an individual with neither name', () => {
		expect(rejected({ kind: 'individual' }).first_name).toBeDefined();
	});

	it('derives an organization display name from legal_name', () => {
		expect(parsed({ kind: 'organization', legal_name: 'Kigali Trust' }).displayName).toBe(
			'Kigali Trust'
		);
	});

	it('rejects an organization with no legal_name', () => {
		expect(rejected({ kind: 'organization' }).legal_name).toBeDefined();
	});

	it('takes a household name verbatim', () => {
		expect(parsed({ kind: 'household', display_name: 'The Okafor Family' }).displayName).toBe(
			'The Okafor Family'
		);
	});

	it('rejects a household with no display_name, since nothing derives one', () => {
		expect(rejected({ kind: 'household' }).display_name).toBeDefined();
	});

	it('lets an explicit display_name override the derived one', () => {
		expect(parsed({ ...INDIVIDUAL, display_name: 'Dr. Okafor' }).displayName).toBe('Dr. Okafor');
	});

	it('rejects an individual whose only name is a display_name', () => {
		// the bypass. resolving the display name first and then testing *that* for null lets
		// a submitted `display_name` answer for a person with no name at all — and a form
		// still labelled "Household name" that submits `kind=individual` then parses clean,
		// filing a household as a person under a name no name column holds.
		const errors = rejected({ kind: 'individual', display_name: 'The Okafor Family' });
		expect(errors.first_name).toBeDefined();
	});

	it('rejects an organization whose only name is a display_name', () => {
		const errors = rejected({ kind: 'organization', display_name: 'The Okafor Family' });
		expect(errors.legal_name).toBeDefined();
	});

	it('never lets display_name stand in for the name a kind requires', () => {
		// the override is honoured for every kind, and for none of them does it substitute:
		// the required name is checked before `display_name` is allowed to speak for it. the
		// error is keyed to the field that kind actually renders, so it lands under an input.
		for (const [kind, field] of [
			['individual', 'first_name'],
			['organization', 'legal_name']
		] as const) {
			expect(Object.keys(rejected({ kind, display_name: 'Anything At All' })), kind).toEqual([
				field
			]);
		}
	});

	it('never yields a blank display name, whatever the kind', () => {
		// the column is notNull, which `''` satisfies — so this, not the schema, is what keeps
		// the "always populated" promise a list view relies on.
		for (const values of [
			INDIVIDUAL,
			{ kind: 'organization', legal_name: 'Kigali Trust' },
			{ kind: 'household', display_name: 'The Okafor Family' }
		]) {
			expect(parsed(values).displayName.trim()).not.toBe('');
		}
	});
});

describe('parseContact — blanks and whitespace', () => {
	it('trims every value', () => {
		const contact = parsed({
			kind: 'individual',
			first_name: '  Ada  ',
			last_name: '\tOkafor\n',
			primary_email: ' ada@example.org ',
			primary_phone: ' +250 788 000 000 '
		});
		expect(contact).toMatchObject({
			firstName: 'Ada',
			lastName: 'Okafor',
			primaryEmail: 'ada@example.org',
			primaryPhone: '+250 788 000 000'
		});
		expect(contact.displayName).toBe('Ada Okafor');
	});

	it('stores an omitted optional as null, never an empty string', () => {
		// `''` in a nullable column is a third state that every downstream `is null` check
		// misses — the list would render an empty email as present.
		expect(parsed(INDIVIDUAL)).toMatchObject({ primaryEmail: null, primaryPhone: null });
	});

	it('treats a whitespace-only value as absent', () => {
		expect(parsed({ ...INDIVIDUAL, primary_email: '   ' }).primaryEmail).toBeNull();
	});

	it('rejects an individual whose names are only whitespace', () => {
		expect(
			rejected({ kind: 'individual', first_name: '  ', last_name: '\t' }).first_name
		).toBeDefined();
	});
});

describe('parseContact — fields the kind does not use', () => {
	it('drops a legal_name submitted for an individual', () => {
		// staff switch kind mid-form and the hidden inputs keep their values; without this the
		// row carries a name no screen shows and every export does.
		expect(parsed({ ...INDIVIDUAL, legal_name: 'Kigali Trust' }).legalName).toBeNull();
	});

	it('drops first_name and last_name submitted for an organization', () => {
		const contact = parsed({
			kind: 'organization',
			legal_name: 'Kigali Trust',
			first_name: 'Ada',
			last_name: 'Okafor'
		});
		expect(contact).toMatchObject({ firstName: null, lastName: null, legalName: 'Kigali Trust' });
	});

	it('drops every name column for a household', () => {
		const contact = parsed({
			kind: 'household',
			display_name: 'The Okafor Family',
			first_name: 'Ada',
			legal_name: 'Kigali Trust'
		});
		expect(contact).toMatchObject({ firstName: null, lastName: null, legalName: null });
	});

	it('keeps email and phone on every kind', () => {
		const contact = parsed({
			kind: 'organization',
			legal_name: 'Kigali Trust',
			primary_email: 'gifts@example.org'
		});
		expect(contact.primaryEmail).toBe('gifts@example.org');
	});
});

describe('parseContact — email', () => {
	it('accepts the addresses a stricter pattern would wrongly reject', () => {
		for (const primary_email of [
			'ada+donations@example.org',
			'ada@sub.domain.example.museum',
			"o'okafor@example.org",
			'ada@localhost'
		]) {
			expect(parsed({ ...INDIVIDUAL, primary_email }).primaryEmail, primary_email).toBe(
				primary_email
			);
		}
	});

	it('rejects a value that is plainly not an address', () => {
		for (const primary_email of ['Ada Okafor', 'ada.example.org', '@example.org', 'ada@']) {
			expect(rejected({ ...INDIVIDUAL, primary_email }).primary_email, primary_email).toBeDefined();
		}
	});

	it('does not require an email at all', () => {
		// a cash gift from a walk-in has no address.
		expect(parsed(INDIVIDUAL).primaryEmail).toBeNull();
	});
});

describe('parseContact — lengths', () => {
	it('rejects an over-long name, naming the box and the limit', () => {
		const error = rejected({ ...INDIVIDUAL, first_name: 'a'.repeat(201) }).first_name;
		expect(error).toBe('must be at most 200 characters');
		expect(error).toContain('200');
	});

	it('accepts a name exactly at the limit', () => {
		expect(parsed({ kind: 'individual', first_name: 'a'.repeat(200) }).firstName).toHaveLength(200);
	});

	it('rejects an over-long email', () => {
		const primary_email = `${'a'.repeat(320)}@example.org`;
		expect(rejected({ ...INDIVIDUAL, primary_email }).primary_email).toContain('320');
	});

	it('rejects a derived display name that overruns, though each part fits', () => {
		// the cap is checked on the submitted fields, and the derived name is not one of
		// them: two names at the limit join into a 401-character `display_name`, and the
		// column has no check that would stop it.
		const errors = rejected({
			kind: 'individual',
			first_name: 'a'.repeat(200),
			last_name: 'b'.repeat(200)
		});
		expect(errors.first_name).toBe('with last name must be at most 200 characters');
		expect(errors.last_name).toBeUndefined();
	});

	it('reports an over-long part at its own input rather than as a derived name', () => {
		// the join overruns too, but saying so under "First name" as well would be one
		// problem reported twice, and the vaguer of the two would be the one on top.
		const errors = rejected({ ...INDIVIDUAL, first_name: 'a'.repeat(201) });
		expect(Object.keys(errors)).toEqual(['first_name']);
		expect(errors.first_name).toBe('must be at most 200 characters');
	});

	it('does not re-measure a display name that was typed rather than derived', () => {
		// it was already measured as a submitted field, and reporting it twice would put the
		// same complaint under two different inputs.
		const errors = rejected({ ...INDIVIDUAL, display_name: 'a'.repeat(201) });
		expect(Object.keys(errors)).toEqual(['display_name']);
	});
});

describe('parseContact — reporting', () => {
	it('reports every bad field at once, not just the first', () => {
		// one problem per round trip is how a five-field create takes five submissions.
		const errors = rejected({
			kind: 'individual',
			first_name: 'a'.repeat(201),
			primary_email: 'nope',
			primary_phone: '0'.repeat(41)
		});
		expect(Object.keys(errors).sort()).toEqual(['first_name', 'primary_email', 'primary_phone']);
	});

	it('keys every message to a field the form renders, and says none of them out loud', () => {
		// the machine vocabulary is the key; the message is a sentence a fundraiser reads
		// under the input. CLAUDE.md keeps the schema's names off a screen, and an error
		// that says `legal_name` is the shortest path back onto one. nothing is lost — if
		// `/api/v1` wants an agent-readable body it composes `${field}: ${message}` from
		// this same map, which is a route's concern rather than the string's.
		const errors = rejected({
			kind: 'individual',
			primary_email: 'nope',
			primary_phone: '0'.repeat(41)
		});
		expect(Object.keys(errors).length).toBeGreaterThan(0);
		for (const [field, message] of Object.entries(errors)) {
			expect(CONTACT_FIELDS, field).toContain(field);
			expect(message, field).not.toContain('_');
		}
	});
});
