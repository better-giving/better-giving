import { describe, expect, it } from 'vitest';
import { MAX_FORM_NAME } from '../../forms/input-schema';
import type { ProgramInputFieldErrors, ProgramInputValues } from '../../programs/fields';
import { MAX_PROGRAM_DESCRIPTION, REQUIRED } from '../../programs/input-schema';
import { parseProgramInput, programInputValuesFrom } from './program-input';

// node pool, no database — the same split `../forms/form-input.spec.ts` makes, for the same
// reason: every rule asserted here is decidable from the submitted values alone.

/** a submission that parses, so every case below states only what it is about. */
function complete(over: Partial<ProgramInputValues> = {}): ProgramInputValues {
	return { name: 'Clean Water', description: 'Wells in the eastern districts.', ...over };
}

/** unwraps a result that must have parsed, reporting the errors if it did not. */
function parsed(values: ProgramInputValues) {
	const result = parseProgramInput(values);
	if (!result.ok) {
		throw new Error(`expected these values to parse, got ${JSON.stringify(result.errors)}`);
	}
	return result.value;
}

/** the mirror: unwraps the error map from a result that must have been rejected. */
function rejected(values: ProgramInputValues): ProgramInputFieldErrors {
	const result = parseProgramInput(values);
	if (result.ok) {
		throw new Error(`expected these values to be rejected, got ${JSON.stringify(result.value)}`);
	}
	return result.errors;
}

describe('parseProgramInput', () => {
	it('hands back the two values a cause is, and nothing else', () => {
		expect({ ...parsed(complete()) }).toEqual({
			name: 'Clean Water',
			description: 'Wells in the eastern districts.'
		});
	});

	it('trims both boxes, because a name padded either side is a second cause on the list', () => {
		expect({ ...parsed(complete({ name: '  Clean Water  ', description: '  wells  ' })) }).toEqual({
			name: 'Clean Water',
			description: 'wells'
		});
	});

	it('reads a blank description as none, which is what the column holds', () => {
		// `program_description_not_blank_check` in `../db/schema.ts` refuses `''`, so a box left
		// empty has to reach the column as null rather than as the empty string it submitted.
		expect(parsed(complete({ description: '   ' })).description).toBeNull();
	});

	it('reads a description the body never carried the same way', () => {
		const values = complete();
		delete values.description;
		expect(parsed(values).description).toBeNull();
	});

	it('refuses a blank name, which no cause may have', () => {
		expect(rejected(complete({ name: '   ' }))).toEqual({ name: REQUIRED });
	});

	it('refuses a name over the cap, naming the cap', () => {
		expect(rejected(complete({ name: 'x'.repeat(MAX_FORM_NAME + 1) })).name).toContain(
			String(MAX_FORM_NAME)
		);
	});

	it('accepts a description at the cap and refuses the one past it', () => {
		expect(
			parsed(complete({ description: 'x'.repeat(MAX_PROGRAM_DESCRIPTION) })).description
		).toHaveLength(MAX_PROGRAM_DESCRIPTION);
		expect(
			rejected(complete({ description: 'x'.repeat(MAX_PROGRAM_DESCRIPTION + 1) })).description
		).toContain(String(MAX_PROGRAM_DESCRIPTION));
	});

	it('reports both offending boxes at once', () => {
		// one problem per round trip is how a save takes as many submissions as the form has boxes.
		expect(
			Object.keys(
				rejected({ name: '', description: 'x'.repeat(MAX_PROGRAM_DESCRIPTION + 1) })
			).sort()
		).toEqual(['description', 'name']);
	});
});

describe('programInputValuesFrom', () => {
	it('renders a stored cause back into the boxes that made it', () => {
		expect(
			programInputValuesFrom({ name: 'Clean Water', description: 'Wells in the east.' })
		).toEqual({ name: 'Clean Water', description: 'Wells in the east.' });
	});

	it('renders a cause with no description as an empty box', () => {
		// `null` is the column and `''` is the box: a record rendered as `null` would put the text
		// `null` in front of an operator.
		expect(programInputValuesFrom({ name: 'General', description: null })).toEqual({
			name: 'General',
			description: ''
		});
	});

	it('re-parses to the values it was rendered from', () => {
		// an edit page that renders a stored cause and saves it untouched must store the same cause.
		const record = { name: 'Clean Water', description: null };
		expect({ ...parsed(programInputValuesFrom(record)) }).toEqual(record);
	});
});
