import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { MAX_SUGGESTED_AMOUNTS } from './amounts';
import {
	FORM_GIVING_INPUT,
	FORM_INPUT_FORM,
	FORM_PROGRAM_INPUT,
	INVERTED_BOUNDS,
	REQUIRED
} from './input-schema';

// what a donation form's boxes may hold, checked with no database and no browser — these are the
// schemas `$lib/admin/use-admin-form.ts` hands conform and the two form actions parse a body
// against, so a case here is a case about both sides of the wire at once.
//
// every case runs against both schemas, because the giving group's rules are stated on both: the
// create screen posts one form (`FORM_INPUT_FORM`) and the editor posts the group on its own
// (`FORM_GIVING_INPUT`). a rule that reached only one of them is a screen quietly checking less
// than the other.

/** a form every rule accepts, which each case below spoils one box of. */
const FORM_BOXES = {
	name: 'Gala 2026',
	status: 'draft',
	min_minor: '5.00',
	max_minor: '10000.00',
	suggested_amounts: ['25.00'],
	allowed_origins: [],
	program_mode: 'none',
	program_id: ''
};

/**
 * the two schemas the giving group's rules are stated on, each fed the whole form.
 *
 * the group's own schema is a plain `z.object`, so the two name boxes it does not state are
 * stripped rather than refused — which is what lets one fixture stand for both.
 */
const SCHEMAS = [
	['the whole form', FORM_INPUT_FORM],
	['the giving group', FORM_GIVING_INPUT]
] as const;

/**
 * what `refusals` below reads a submission against.
 *
 * the base type rather than either schema's own, because the groups are different objects and a
 * union of them is a value assignable to neither: what every case here needs is `safeParse` and
 * the issues it hands back.
 */
type Schema = z.ZodType;

/**
 * every message one box was refused with, keyed the way conform keys it.
 *
 * the key is the input's own `name`, which for a row of the amounts editor is indexed —
 * `suggested_amounts[1]`. `@conform-to/zod`'s `parseWithZod` composes exactly this from the issue
 * path, so a case here reads the key a screen's `getFieldList()` row reads its errors from.
 */
function refusals(schema: Schema, values: Record<string, unknown>): Record<string, string[]> {
	const parsed = schema.safeParse(values);
	if (parsed.success) return {};
	const errors: Record<string, string[]> = {};
	for (const issue of parsed.error.issues) {
		const key = issue.path.reduce<string>(
			(name, segment) =>
				typeof segment === 'number' ? `${name}[${segment}]` : `${name}${String(segment)}`,
			''
		);
		(errors[key] ??= []).push(issue.message);
	}
	return errors;
}

describe('the two gift bounds', () => {
	it('refuses a pair the wrong way round, under the largest gift', () => {
		// an inverted pair rejects every gift the form will ever be offered, and the browser says so
		// before a round trip does. keyed to the largest gift because that is the box the sentence
		// names.
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, { ...FORM_BOXES, min_minor: '50.00', max_minor: '20.00' });
			expect(errors.max_minor, screen).toEqual([INVERTED_BOUNDS]);
		}
	});

	it('says nothing about an inverted pair when a bound could not be read', () => {
		// the ruler is the thing that could not be read, so a sentence about the pair would be about
		// a bound nobody set. it is zod's doing rather than a branch: the bound rules abort, and an
		// object check does not run over a value one of whose fields did.
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, { ...FORM_BOXES, min_minor: 'lots', max_minor: '20.00' });
			expect(errors.max_minor, screen).toBeUndefined();
			expect(errors.min_minor, screen).toHaveLength(1);
		}
	});

	it('still measures the suggested amounts when the pair is inverted', () => {
		// an issue pushed from one object check stops every check chained after it unless it says
		// `continue: true`, so this pins the pair rule to running first and continuing: otherwise
		// `parseFormGiving` in `$lib/server/forms/form-input.ts`, which measures the amounts whatever
		// the bounds did, would refuse a save the screen had called fine.
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, {
				...FORM_BOXES,
				min_minor: '50.00',
				max_minor: '20.00',
				suggested_amounts: ['25.00']
			});
			expect(errors.max_minor, screen).toEqual([INVERTED_BOUNDS]);
			expect(errors['suggested_amounts[0]'], screen).toHaveLength(1);
		}
	});

	it('still reads the pair when a box in another group never arrived', () => {
		// the create screen posts every box at once, so a blank name and an inverted pair are one
		// submission. conform strips an empty box to `undefined`, and a required rule that met that as
		// a type error rather than as its own `.min(1)` would abort the field — after which zod runs no
		// object check at all, and the pair would be reported only once the name was fixed. this is
		// `FORM_INPUT_FORM`'s alone: the group schemas state no box outside their own group.
		const { name, ...absent } = FORM_BOXES;
		const errors = refusals(FORM_INPUT_FORM, {
			...absent,
			min_minor: '50.00',
			max_minor: '20.00'
		});
		expect(errors.name).toEqual([REQUIRED]);
		expect(errors.max_minor).toEqual([INVERTED_BOUNDS]);
	});

	it('accepts a pair that is equal, which is a form offering one amount', () => {
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, {
				...FORM_BOXES,
				min_minor: '25.00',
				max_minor: '25.00',
				suggested_amounts: ['25.00']
			});
			expect(errors, screen).toEqual({});
		}
	});
});

describe('the suggested amounts', () => {
	it('keys a refused row to its own box, and says nothing under a good one', () => {
		// each row is an `<input>` with an indexed name, so the sentence about a figure is drawn
		// under the box holding it rather than as one message about the group — an operator with
		// three rows and two mistakes reads which two.
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, {
				...FORM_BOXES,
				suggested_amounts: ['25.00', 'lots', '1.00']
			});
			expect(errors['suggested_amounts[0]'], screen).toBeUndefined();
			expect(errors['suggested_amounts[1]'], screen).toEqual([
				'must be an amount, write 25.00 for $25.00'
			]);
			expect(errors['suggested_amounts[2]'], screen).toEqual([
				'must be more than smallest gift of $5'
			]);
			// and nothing on the group itself: the count cap is the only message that belongs there.
			expect(errors.suggested_amounts, screen).toBeUndefined();
		}
	});

	it('numbers a row by where it sits, so a blank row above it does not shift the key', () => {
		// what a row editor is full of: the spare box Add leaves behind. renumbered around it, the
		// message would mark up the row above the one that is wrong.
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, { ...FORM_BOXES, suggested_amounts: ['', 'lots'] });
			expect(errors['suggested_amounts[1]'], screen).toEqual([
				'must be an amount, write 25.00 for $25.00'
			]);
			expect(errors['suggested_amounts[0]'], screen).toBeUndefined();
		}
	});

	it('answers the count cap on the group and nothing per row', () => {
		// the cap is a fact about the list, so it is the one message with no box to sit under: a
		// paste of fifty would otherwise come back as fifty sentences, none of which is the problem.
		const many = Array.from({ length: MAX_SUGGESTED_AMOUNTS + 1 }, (_, i) => String(10 + i));
		for (const [screen, schema] of SCHEMAS) {
			const errors = refusals(schema, { ...FORM_BOXES, suggested_amounts: many });
			expect(errors.suggested_amounts, screen).toEqual([`at most ${MAX_SUGGESTED_AMOUNTS}`]);
			expect(errors['suggested_amounts[0]'], screen).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// the program group, on the whole form and on the group the editor saves alone.
// ---------------------------------------------------------------------------

/** the two schemas the program group's rule is stated on, each fed the whole form. */
const PROGRAM_SCHEMAS = [
	['the whole form', FORM_INPUT_FORM],
	['the program group', FORM_PROGRAM_INPUT]
] as const;

describe('the program group', () => {
	it('refuses a pinned form that names no program, under the program box', () => {
		// the two boxes are one decision — `form_program_pinned_check` in
		// `$lib/server/db/schema.ts` holds them to one answer — so a mode the operator chose with
		// the box beneath it left blank is a save the browser turns down before a round trip does.
		// keyed to the program box because that is the one to fill in: the mode is what they meant.
		for (const [screen, schema] of PROGRAM_SCHEMAS) {
			const errors = refusals(schema, { ...FORM_BOXES, program_mode: 'pinned', program_id: '' });
			expect(errors.program_id, screen).toEqual([REQUIRED]);
		}
	});

	it('accepts a pinned form that names one', () => {
		for (const [screen, schema] of PROGRAM_SCHEMAS) {
			const errors = refusals(schema, {
				...FORM_BOXES,
				program_mode: 'pinned',
				program_id: '019fb100-0000-7000-8000-0000000000aa'
			});
			expect(errors, screen).toEqual({});
		}
	});

	it('says nothing about a program box the other two modes leave blank', () => {
		// the box is hidden in those modes and submits the blank it was drawn with, so a refusal
		// here would be one nobody can reach a control to answer.
		for (const [screen, schema] of PROGRAM_SCHEMAS) {
			for (const mode of ['none', 'choice']) {
				const errors = refusals(schema, { ...FORM_BOXES, program_mode: mode, program_id: '' });
				expect(errors, `${screen}: ${mode}`).toEqual({});
			}
		}
	});

	it('refuses a mode that is not one of the three', () => {
		// the check constraint on the column is derived from the same list, so a value that passes
		// here is one the database accepts by construction. the message is stated rather than left
		// to zod, which would list the column values it expected.
		for (const [screen, schema] of PROGRAM_SCHEMAS) {
			const errors = refusals(schema, { ...FORM_BOXES, program_mode: 'everything' });
			expect(errors.program_mode, screen).toEqual([REQUIRED]);
		}
	});

	it('still measures the suggested amounts when the pin is refused', () => {
		// an issue pushed from one object check stops every check chained after it unless it says
		// `continue: true`: without it an operator fixing the pin would then be told about their
		// amounts, one round trip later.
		const errors = refusals(FORM_INPUT_FORM, {
			...FORM_BOXES,
			program_mode: 'pinned',
			program_id: '',
			suggested_amounts: ['nonsense']
		});
		expect(errors.program_id).toEqual([REQUIRED]);
		expect(errors['suggested_amounts[0]']).toHaveLength(1);
	});
});
