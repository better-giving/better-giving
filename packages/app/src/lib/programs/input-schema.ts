import { z } from 'zod';
import { MAX_FORM_NAME } from '$lib/forms/input-schema';

// what one box of a cause may hold, in the one place a server parser and a browser may both import
// from.
//
// not under `$lib/server/**`, for the reason `$lib/forms/input-schema.ts` is not: these rules are
// the source of what `$lib/server/programs/program-input.ts` refuses *and* the source of what the
// two program screens check in the browser before they submit, and a component may not import from
// `$lib/server/**` at all. declared twice they drift, and the half that drifts silently is the
// client's — it would refuse a value the server accepts, with no way for anyone to tell which of
// the two was right.
//
// every rule here is field-level and there is no cross-field check, which is the whole of what
// makes this file short next to the form's: a cause is a name and a sentence, and neither is
// measured against the other.
//
// the two-stage shape `$lib/forms/input-schema.ts`'s header argues applies unchanged — a clean
// stage is `parse`d and this limits stage is `safeParse`d over its output, in
// `$lib/server/programs/program-input.ts` — and so does the rest of it: error identity is
// `issue.path[0]` rather than `flatten()`, the brand on a parsed value is a hand-rolled
// `unique symbol` rather than zod's `.brand()`, `.default()` never runs the checks above it where
// `.prefault()` does, and there is no `z.coerce.*` anywhere.
//
// the dependency runs server -> shared and never back: the parser imports this, and nothing here
// imports from `$lib/server/**`.

/**
 * how long a cause's description may be.
 *
 * generous, and here to stop a pathological row rather than to model a real one — the same job the
 * caps in `$lib/forms/input-schema.ts` do. exported so ./input-schema.spec.ts asserts the boundary
 * rather than a number copied out of this file, which is how a cap silently stops being tested when
 * it is raised.
 */
export const MAX_PROGRAM_DESCRIPTION = 500;

/**
 * what a required box left blank is told, and the shape every field message on an operator screen
 * takes.
 *
 * a message is the predicate of the label over it and nothing more — lowercase, no period, no verb
 * the label supplies, because the screen draws label, box and message as one column and the three
 * read as one sentence. `$lib/forms/input-schema.ts` and `$lib/contacts/input-schema.ts` word
 * theirs the same way, and each states the word itself because the schemas import from nothing in
 * common.
 */
export const REQUIRED = 'required';

/**
 * one rule per box.
 *
 * the name shares the form's cap rather than declaring one of its own, and the import is the
 * point: both are a name a fundraiser types for a thing a donor sees, and two numbers for one
 * decision is how they come to disagree.
 *
 * `.prefault('')` on both, for the reason `$lib/forms/input-schema.ts` gives: conform strips an
 * empty box to `undefined`, and a bare `z.string()` meeting that pushes an issue about a type in
 * front of an operator whose box is simply blank. `''` is what an untouched box submits, so the
 * prefaulted value meets the same checks a cleared box does.
 */
export const PROGRAM_FIELD_RULES = {
	name: z
		.string({ error: REQUIRED })
		.trim()
		.min(1, { error: REQUIRED })
		.max(MAX_FORM_NAME, { error: `must be at most ${MAX_FORM_NAME} characters` })
		.prefault(''),
	/**
	 * the sentence a cause is described by, and `null` where there is none.
	 *
	 * the column is nullable and carries `program_description_not_blank_check`
	 * (`$lib/server/db/schema.ts`), so "not stated" is the normal state and `''` is the one value
	 * the database refuses — which is what the transform at the end is for. it is the last step
	 * rather than the first, so the cap is measured on what an operator typed.
	 */
	description: z
		.string()
		.trim()
		.max(MAX_PROGRAM_DESCRIPTION, {
			error: `must be at most ${MAX_PROGRAM_DESCRIPTION} characters`
		})
		.prefault('')
		.transform((value) => (value === '' ? null : value))
} as const;

/**
 * a cause as both screens submit it, and as the browser checks it before they do.
 *
 * flat, with no nested object, and that is not a style choice: a nested name posted against a flat
 * schema is discarded and the form still validates. `$lib/forms/definition.ts` holds the shape at
 * both ends.
 *
 * one schema and not a group per heading, unlike a donation form's four: the two boxes are the
 * whole of a cause, so the screen that makes one and the screen that edits one submit the same
 * shape and there is nothing to split.
 */
export const PROGRAM_INPUT_FORM = z.object(PROGRAM_FIELD_RULES);

export type ProgramInputForm = z.infer<typeof PROGRAM_INPUT_FORM>;
