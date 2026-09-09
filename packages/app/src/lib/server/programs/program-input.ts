import { z } from 'zod';
import { fieldErrorsFrom } from '@better-giving/operator/zod-issues';
import {
	PROGRAM_TEXT_FIELDS,
	type ProgramInputFieldErrors,
	type ProgramInputValues
} from '../../programs/fields';
import { PROGRAM_FIELD_RULES } from '../../programs/input-schema';

// parsing and validating what a cause is, with no database in sight.
//
// split from ./queries.ts for the reason `../forms/form-input.ts` is split from its own: every
// rule about what a cause may be is decidable from the submitted text alone, so keeping them here
// means they are testable with no D1 and no browser, and the /admin/programs actions stay a
// translation layer rather than the place the rules live.
//
// the rules themselves are one step further out again, in `$lib/programs/input-schema.ts`, because
// the two screens run the same rules in the browser and a component may not import from
// `$lib/server/**` at all. what is here is the two stages and the brand.
//
// nothing in this file is ordered typescript and nothing is a cross-field rule, which is the whole
// difference from `../forms/form-input.ts` and `../org/org-input.ts`: a cause is a name and a
// sentence, and neither is measured against the other. the one thing a schema cannot decide is
// whether another cause already carries the name, and that is not decidable from the text at all —
// it is the unique index on the column, answered by ./queries.ts.
//
// error identity is carried by the object key. the schema's keys are the box names, so
// `issue.path[0]` already is a `ProgramInputField` and the map a screen renders is built by
// reading it — `fieldErrorsFrom` in `@better-giving/operator/zod-issues` is where that walk and
// its reasons live.

/**
 * the mark a value carries once it has been past every check in this module.
 *
 * a `unique symbol` intersection, minted by a double assertion at the end of the parse and past
 * every check in it — the same discipline `ParsedForm` in `../forms/form-input.ts` is under. zod's
 * `.brand()` is not what enforces it and must not be: that is a compile-time no-op which returns
 * its input untouched, so it marks a value as checked wherever it is written, including in front
 * of nothing.
 */
declare const PARSED: unique symbol;

/** a cause's two columns, with every value already one the database will accept. */
export type ProgramValues = {
	readonly name: string;
	readonly description: string | null;
};

export type ParsedProgram = ProgramValues & { readonly [PARSED]: true };

export type ProgramParseResult =
	| { readonly ok: true; readonly value: ParsedProgram }
	| { readonly ok: false; readonly errors: ProgramInputFieldErrors };

/** trims, and treats a box the browser did not send as one that was left empty. */
const cleanText = z
	.string()
	.optional()
	.transform((value) => value?.trim() ?? '');

/**
 * the shape stage: both boxes trimmed, and nothing that can fail.
 *
 * it runs ahead of the limits stage rather than being piped onto the front of it, for the reason
 * `$lib/forms/input-schema.ts`'s header gives — a failed parse carries no data, so one over-long
 * box would silently turn *every error at once* into *the first one*.
 */
const CLEAN_FIELDS = z.object({
	name: cleanText,
	description: cleanText
});

/** the check stage: the rules both screens also run in the browser. */
const LIMITS = z.object({
	name: PROGRAM_FIELD_RULES.name,
	description: PROGRAM_FIELD_RULES.description
});

/**
 * validates a submitted cause, which is what both program screens post.
 *
 * every offending box comes back at once rather than the first, for the reason
 * `../org/org-input.ts` gives about its nine fields: one problem per round trip is how a save takes
 * as many submissions as the form has inputs.
 */
export function parseProgramInput(values: ProgramInputValues): ProgramParseResult {
	const clean = CLEAN_FIELDS.parse(values);
	const limits = LIMITS.safeParse(clean);
	if (!limits.success) {
		return { ok: false, errors: fieldErrorsFrom(limits.error, PROGRAM_TEXT_FIELDS) };
	}
	return {
		ok: true,
		// the assertion is here rather than smuggled into the type, so the unsoundness is spent once,
		// past every check above. the mapping stays singular — one field per column, spelled out —
		// because a spread is what makes a later field reach a column nobody decided to store.
		value: {
			name: limits.data.name,
			description: limits.data.description
		} as unknown as ParsedProgram
	};
}

/**
 * the boxes an edit page renders a stored cause back into.
 *
 * the inverse of `parseProgramInput`, and it lives beside it rather than in the route because the
 * two are the same edit read in opposite directions.
 *
 * the description is written as the empty box rather than as `null`: `null` is what the column
 * holds for a cause nobody described, and a box seeded from it would show the word.
 */
export function programInputValuesFrom(record: ProgramValues): ProgramInputValues {
	return {
		name: record.name,
		description: record.description ?? ''
	};
}

/**
 * the submitted body as the parser above takes it: a string per box.
 *
 * read off the body rather than off the parsed submission, because a submission the schema refused
 * carries no values at all and the parser has to run on that arm too — every offending box comes
 * back in one round trip whichever of the two stages refused it.
 *
 * the boxes come off `PROGRAM_TEXT_FIELDS` rather than being listed again, so a box added there
 * arrives here without anyone having to remember to add it.
 */
export function programInputValues(body: FormData): ProgramInputValues {
	const values: Record<string, string> = {};
	for (const box of PROGRAM_TEXT_FIELDS) {
		const value = body.get(box);
		if (typeof value === 'string') values[box] = value;
	}
	return values;
}
