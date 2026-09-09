import { z } from 'zod';
import { formatMinorBrief } from '../../donations/money';
import { FORM_CURRENCY, majorEntry, readAmount, readSuggestedAmounts } from '../../forms/amounts';
import {
	FORM_INPUT_FIELDS,
	FORM_TEXT_FIELDS,
	type FormInputFieldErrors,
	type FormInputValues
} from '../../forms/fields';
import { FORM_FIELD_RULES, INVERTED_BOUNDS, pinnedProgramRule } from '../../forms/input-schema';
import type { ProgramMode } from '../../forms/program-modes';
import { readOriginList } from '@better-giving/operator/origins';
import type { EditableFormStatus } from '../../forms/statuses';
import type { Form } from '../db/schema';
import { fieldErrorsFrom } from '@better-giving/operator/zod-issues';
import { redact } from '../../redact';

// parsing and validating what a donation form is — its sites, its amounts, its rails — with
// no database in sight.
//
// split from ./queries.ts for the same reason `../org/org-input.ts` is: every rule about what
// a form may be — what an origin is, which amounts may be suggested, which rails may be
// offered — is decidable from the submitted text alone, so keeping them here means they are
// testable with no D1 and no browser, and the /admin/forms actions stay a translation layer
// rather than the place the rules live.
//
// the sites rules are why this file reads the way it does, and they live in
// `@better-giving/operator/origins` — read that header for why a row that is nearly right is
// repaired into the origin it was trying to be, and why what is left of one is refused in two
// words. CLAUDE.md's 4xx rule is written for `/api/v1`; the reason behind it is the same.
// the suggested amounts followed them out for the same reason, into ../../forms/amounts.ts beside
// the rest of the money grammar.
//
// how the rules are split, the same way ../contacts/contact-input.ts splits them. field-level
// rules — trim, the two length caps, whether a box holds a figure the currency can be written in,
// whether a status is one an operator may choose, whether a row editor's rows are usable — are
// zod schemas, because each is a property of a single value and reads better
// declared than branched. those rules are stated in ../../forms/input-schema.ts rather than here,
// because the create and edit screens run the same rules in the browser and a component may not
// import from `$lib/server/**` at all. what stays plain typescript below them is everything whose rule is
// an *order*, and each such block carries its own note saying so: a schema runs its checks in
// whatever order it likes and reports all of them at once, which is the opposite of what those
// blocks are. `readOriginList` and `readSuggestedAmounts` both stop at their count cap instead
// of saying anything about individual lines, `readRow` inside the first is a repair and three
// checks that must run in sequence, and the suggested amounts are measured against whatever the two
// bound boxes parsed to.
//
// the sites rules and the suggested-amounts rules live outside this file — in
// `@better-giving/operator/origins` and ../../forms/amounts.ts — and what puts them there is where
// their message has to be emitted from: it has to reach the browser before a round trip does, so
// each sentence comes out of the shared schema, which is the one both halves run. what they key it
// to differs — a ticked site is not a field, where an amount row is an input with an indexed name,
// so the sites answer as a group and the amounts answer per row. both are plain typescript, called
// in the same order, and this file calls each for the list it stores.
//
// the sites rules sit one step further out still, in the leaf package both operator surfaces read
// from, because the console applies them in front of the person typing as well — before a first
// deploy makes a Turnstile widget out of hosts this deployment would then refuse to serve.
//
// four groups, four parsers, and `parseFormInput` composes them. the screen that edits a form
// saves one group at a time — four forms, four writes that can each fail on their own — so each
// group needs its own parse, and the screen that makes a form needs all four at once. every cross-field rule this file keeps is inside one group (the two bounds and the
// suggested amounts measured against them are the giving group), which is what makes the
// composition sound rather than convenient: no rule is lost by parsing a group alone.
//
// the two amount bounds are parsed on their own rather than as part of `FIELD_LIMITS`, and it
// is the same reason the clean stage is separate from the limits stage rather than piped onto
// it: a failed parse carries no data. inside one object schema a blank name would leave the
// bounds with nothing to read, and the suggested amounts would silently stop being
// range-checked against a form's own limits.
//
// error identity is carried by the object key. the schema's keys are the form field names, so
// `issue.path[0]` already is a `FormInputField` and the map a form renders is built by reading
// it — see `fieldErrorsFrom` in `@better-giving/operator/zod-issues`, which is where that walk and
// its reasons live for the three parsers that share it.
//
// the brand on `ParsedForm` is not zod's `.brand()`, which is compile-time only and would mark
// a value as checked without checking it. see the note on `ParsedForm`.

// ---------------------------------------------------------------------------
// the whole form, which is the only shape an operator ever submits.
//
// a deployment ships with no forms, so this is what stands between an operator and a row
// that cannot serve: `readFormConfig` in packages/form/src/config.ts refuses a config with a
// missing bound, and refuses it silently — the element renders a
// message about a field, and the operator sees a form that will not load with nothing on the
// screen that saved it to say why. so every rule that file reads at request time is refused
// here at save time, in front of the person who typed it.
//
// the id is not a field. a create does not have one yet, and an edit takes it from the route
// rather than from a body a browser posted, so there is nothing here for a stale tab to aim
// at a different form.
// ---------------------------------------------------------------------------

// the field names and the two shapes keyed by them live in `../../forms/fields.ts`, which a
// component may import and this file may not be: the create and edit screens write these names
// into `name=` attributes and render out of `FormInputValues`, so a copy here would be a second
// vocabulary for one set of boxes. imported and not re-exported — a caller wanting the shapes
// this parser takes and returns imports them from there too, so there is one door rather than a
// parser that also serves as a passageway to a module beside it.

/**
 * the floor under `min_minor`, in minor units.
 *
 * a card or bank debit below this is refused by the processor, so a form with a lower minimum is
 * one that takes nothing — and the operator meets that as a donation that fails at the last step
 * rather than as a message about this field.
 *
 * minor units because that is what it is compared against, and never what it is said in: the
 * sentence it appears in goes through `money` below, like every other figure an operator reads.
 */
export const MIN_AMOUNT_MINOR = 50;

/**
 * a figure as the operator who typed it reads it back.
 *
 * every amount in a message on this screen goes through here. the boxes are written in major units
 * — `readAmount` in ../../forms/amounts.ts is what turns one into the integer stored — so a message
 * quoting the stored integer would answer a `25.00` box with `2500`, which is a number the operator
 * cannot find anywhere on their screen.
 */
const money = (amountMinor: number) => formatMinorBrief(amountMinor, FORM_CURRENCY);

/**
 * the mark a value carries once it has been past every check in this module.
 *
 * it is what makes the parsers below hard to skip — the same discipline `ParsedOrgProfile` in
 * ../org/org-input.ts is under. without it a hand-built object literal of the same shape reaches
 * `createForm`, and "every stored form can actually serve" is kept only by callers who happened
 * to read this file.
 *
 * a `unique symbol` intersection, minted by a double assertion at the end of a parse and past
 * every check in it. zod's `.brand()` is not what enforces it and must not be: that is a
 * compile-time no-op which returns its input untouched, so it marks a value as checked wherever
 * it is written, including in front of nothing.
 *
 * one symbol for all five shapes below rather than five, because the shapes already tell them
 * apart: a `ParsedFormName` has two fields and a `ParsedFormGiving` has three different ones,
 * so neither is assignable where the other is wanted. what the brand answers is the only question
 * a caller could otherwise get wrong — whether the object came from a parser at all.
 */
declare const PARSED: unique symbol;
type Parsed<T> = T & { readonly [PARSED]: true };

/** the name group's columns, with every value already one the database will accept. */
export type FormNameValues = {
	readonly name: string;
	readonly status: EditableFormStatus;
};

/** the giving group's columns: the two bounds and the tiles measured against them. */
export type FormGivingValues = {
	readonly suggestedAmounts: readonly number[];
	readonly minMinor: number;
	readonly maxMinor: number;
};

/** the origins group's one column, deduped and every entry the origin a browser will send. */
export type FormOriginsValues = {
	readonly allowedOrigins: readonly string[];
};

/**
 * the program group's two columns, which are one decision.
 *
 * `programId` is null in every mode but `pinned`, and that is not a convenience: the column pair
 * is held to it by `form_program_pinned_check` in ../db/schema.ts, so a value with both halves
 * disagreeing is a constraint error rather than a row.
 */
export type FormProgramValues = {
	readonly programMode: ProgramMode;
	readonly programId: string | null;
};

export type ParsedFormName = Parsed<FormNameValues>;
export type ParsedFormGiving = Parsed<FormGivingValues>;
export type ParsedFormOrigins = Parsed<FormOriginsValues>;
export type ParsedFormProgram = Parsed<FormProgramValues>;

/**
 * a form's whole configuration, which is what the screen that makes one submits.
 *
 * the three groups together and nothing else. `currency` is absent because it is not an input —
 * see `FORM_CURRENCY` in ../../forms/amounts.ts. so is how often a gift may repeat: what a donor
 * may pick is the processor account's answer rather than a submission's, and `offeredCadences` in
 * ./offered-cadences.ts is where it is decided.
 */
export type ParsedForm = Parsed<
	FormNameValues & FormProgramValues & FormGivingValues & FormOriginsValues
>;

export type ParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly errors: FormInputFieldErrors };

export type FormParseResult = ParseResult<ParsedForm>;

/**
 * a form as the screen that edits one sees it: every column an operator configures, with the
 * two array columns already decoded.
 *
 * it lives beside `ParsedForm` rather than with the query that reads it, because the two are
 * the same edit read in opposite directions — `parseFormInput` turns the boxes into a row and
 * `formInputValuesFrom` turns the row back into the boxes, and the separator grammar that has
 * to agree between them is this module's. keeping it here is also what keeps this file free of
 * ./queries.ts, which is what "with no database in sight" at the top of it means.
 *
 * `copy` is absent: nothing reads it, nothing writes it, and this folder owns no codec for it,
 * so selecting it would hand a raw JSON string across the query boundary.
 *
 * `status` is the column's full union rather than the two an operator may choose between: an
 * archived form is still readable, so a type narrowed to the editable pair would be lying
 * about what a row can hold.
 *
 * derived from `Form` rather than written out, so a column that is renamed or retyped is a
 * compile error here rather than a key that silently stops arriving.
 */
export type FormRecord = Pick<
	Form,
	| 'id'
	| 'name'
	| 'status'
	| 'revenueAccountId'
	| 'minMinor'
	| 'maxMinor'
	| 'currency'
	| 'programMode'
	| 'programId'
> & {
	suggestedAmounts: number[];
	allowedOrigins: string[];
};

/** trims, and treats a box the browser did not send as one that was left empty. */
const cleanText = z
	.string()
	.optional()
	.transform((value) => value?.trim() ?? '');

/**
 * a list field with its values trimmed, in the order they arrived and with the repeats left in.
 *
 * the repeats stay because both readers take their own out and one of them has something to say
 * about them: `readOriginList` in `@better-giving/operator/origins` refuses a list that holds a
 * site twice, and a dedupe here would answer that in front of it — the tick boxes would silently
 * store what the rule turns down, which is the disagreement the shared module exists to close.
 * `readSuggestedAmounts` in ../../forms/amounts.ts takes its own repeats out and is unaffected.
 *
 * it is also what leaves this parse reading the list the screens' own schema reads: the check in
 * `FORM_FIELD_RULES` (../../forms/input-schema.ts) runs over what the browser posted, so a stage
 * here that reshaped it first would be the two ends refusing different lists.
 *
 * a group the browser sent nothing for arrives as no key at all rather than as an empty list,
 * which is why the fallback is here and not at the call site. it is what a row editor with no rows
 * looks like.
 */
const cleanList = z
	.array(z.string())
	.optional()
	.transform((values) => (values ?? []).map((value) => value.trim()));

/**
 * the shape stage, one per group: every box trimmed, and nothing that can fail.
 *
 * each runs ahead of its group's limits stage rather than being piped onto the front of it, for
 * the reason the module header gives — a failed parse carries no data — and it also closes a hole
 * a single stage would open: a box the browser did not send reaches a bare `z.string()` as
 * `undefined`, whose message is zod's own `Invalid input: expected string, received undefined`.
 * that is a sentence about a type, in front of an operator, on a form where the box is simply
 * blank. normalising to `''` first is what lets every message below be one this app wrote.
 */
const CLEAN_NAME_FIELDS = z.object({
	name: cleanText,
	status: cleanText
});

const CLEAN_GIVING_FIELDS = z.object({
	suggested_amounts: cleanList,
	min_minor: cleanText,
	max_minor: cleanText
});

const CLEAN_ORIGINS_FIELDS = z.object({
	allowed_origins: cleanList
});

const CLEAN_PROGRAM_FIELDS = z.object({
	program_mode: cleanText,
	program_id: cleanText
});

/**
 * the check stage for the name group: everything decidable from one box.
 *
 * the keys are the form field names, which is what makes `issue.path[0]` an error key with
 * nothing to translate. every rule is `FORM_FIELD_RULES` in ../../forms/input-schema.ts, which
 * the create and edit screens' own schemas state too.
 */
const NAME_LIMITS = z.object({
	name: FORM_FIELD_RULES.name,
	status: FORM_FIELD_RULES.status
});

/**
 * the two bound boxes, checked but not yet converted.
 *
 * the rules are `FORM_FIELD_RULES`' in ../../forms/input-schema.ts and the number comes out of
 * `readAmount` below rather than out of a `.transform()` here — the same call the schema's check
 * already made, read for the amount this time instead of for the sentence. that is the arrangement
 * the sites are already under: one rule, two answers, no second statement of it.
 */
const MIN_MINOR = FORM_FIELD_RULES.min_minor;
const MAX_MINOR = FORM_FIELD_RULES.max_minor;

/**
 * validates the name group: what a form is called and whether it is published.
 *
 * every rule is a property of one box, so this is the clean stage and the limits stage and
 * nothing else.
 */
export function parseFormName(values: FormInputValues): ParseResult<ParsedFormName> {
	const clean = CLEAN_NAME_FIELDS.parse(values);
	const limits = NAME_LIMITS.safeParse(clean);
	if (!limits.success) {
		return { ok: false, errors: fieldErrorsFrom(limits.error, FORM_INPUT_FIELDS) };
	}
	return {
		ok: true,
		// the assertion is here rather than smuggled into the type, so the unsoundness is spent
		// once, past every check above. the mapping stays singular — one field per column, spelled
		// out — for the reason `newContactRow` gives: a spread is what makes a later field reach a
		// column nobody decided to store.
		value: {
			name: limits.data.name,
			status: limits.data.status
		} as unknown as ParsedFormName
	};
}

/**
 * validates the giving group: the two bounds and the suggested tiles measured against them.
 *
 * this is the one group carrying rules about more than one box, and it is why the three fields
 * are one group rather than three: the floor under the smallest gift, the two bounds being the
 * right way round, and a suggestion being inside them are all comparisons, so a screen that
 * saved any one of the three on its own would be saving against a bound it had not read.
 *
 * returns every field error at once rather than the first, for the reason `../org/org-input.ts`
 * gives about its nine fields: one problem per round trip is how a save takes as many submissions
 * as the form has inputs.
 */
export function parseFormGiving(values: FormInputValues): ParseResult<ParsedFormGiving> {
	const clean = CLEAN_GIVING_FIELDS.parse(values);
	const errors: FormInputFieldErrors = {};

	// parsed one box at a time rather than inside an object schema, so that a bound survives
	// another field being wrong: the three rules below read the *numbers* these two boxes hold,
	// and inside one schema a refused suggestion would take them down with it.
	//
	// the number is `readAmount`'s and comes out of the box that has already passed the same call
	// inside the schema, so it is never null here. a null is taken as "no bound" all the same,
	// which is what the three comparisons below already answer for a box that was refused.
	const min = MIN_MINOR.safeParse(clean.min_minor);
	const max = MAX_MINOR.safeParse(clean.max_minor);
	const minMinor = min.success ? readAmount(min.data, FORM_CURRENCY).minor : null;
	const maxMinor = max.success ? readAmount(max.data, FORM_CURRENCY).minor : null;

	if (!min.success) {
		errors.min_minor = onlyMessage(min.error);
	} else if (minMinor !== null && minMinor < MIN_AMOUNT_MINOR) {
		// an `else if`, so a box that holds no number is told that and nothing else: the floor is
		// a sentence about a number, and there isn't one yet.
		errors.min_minor = `must be at least ${money(MIN_AMOUNT_MINOR)}`;
	}

	if (!max.success) {
		errors.max_minor = onlyMessage(max.error);
	} else if (minMinor !== null && maxMinor !== null && minMinor > maxMinor) {
		// guarded on the smallest having parsed as well as the largest: with a blank minimum there
		// is no pair to invert, and the sentence would be about a bound nobody set.
		errors.max_minor = INVERTED_BOUNDS;
	}

	// last of the three, because it is the only one measured against what another field parsed
	// to — a suggestion is in range or not according to the two bounds above, and a bound that
	// did not parse takes its half of the range check with it.
	//
	// the rule is `readSuggestedAmounts` in ../../forms/amounts.ts and the shared schema checks the
	// same call, which is not a rule spelled twice but the same one read for two different answers:
	// the schema's object check reads the *messages*, which it keys one per offending row, and this
	// reads the *list*, because that is what gets stored. this side runs it whatever the bounds did,
	// where zod skips its object check over a value whose bound aborted — so a mistyped bound is
	// answered by its own box's message on the screen and by this call at the boundary that decides
	// what may be written.
	//
	// the rows are folded back into one string, because this map is keyed by field and the two form
	// routes drop this key on purpose — `isTextField` in `src/routes/_app.admin.forms.new.tsx` says
	// why. so the sentence has left the boxes and has to name which one it is about: each row's
	// problem carries the text that row held, through ../../redact.ts, the app's one echo policy.
	const suggested = readSuggestedAmounts(clean.suggested_amounts, minMinor, maxMinor);
	const rowsRefused = suggested.problems
		.map(({ row, problem }) => `\`${redact(clean.suggested_amounts[row] ?? '')}\` ${problem}`)
		.join('; ');
	if (suggested.problem !== null) errors.suggested_amounts = suggested.problem;
	else if (rowsRefused.length > 0) errors.suggested_amounts = rowsRefused;

	if (minMinor === null || maxMinor === null || Object.keys(errors).length > 0) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		value: {
			suggestedAmounts: suggested.amounts,
			minMinor,
			maxMinor
		} as unknown as ParsedFormGiving
	};
}

/**
 * the check stage for the program group: the mode, the cause, and the one rule that reads both.
 *
 * the rules are `FORM_FIELD_RULES`' and `pinnedProgramRule`'s in ../../forms/input-schema.ts,
 * which the create and edit screens' own schemas state too — so the browser refuses a half-made
 * pair before a round trip and this refuses it before a write.
 */
const PROGRAM_LIMITS = z
	.object({
		program_mode: FORM_FIELD_RULES.program_mode,
		program_id: FORM_FIELD_RULES.program_id
	})
	.check(pinnedProgramRule);

/**
 * validates the program group: which cause this form's gifts are recorded against.
 *
 * the one group whose output is not what arrived. the program box stays in the tree in every mode
 * and is hidden in two of them (`$lib/admin/forms/program-fields.tsx`), so a form moved off
 * `pinned` submits the id it was drawn with — and stored, that id would credit every gift to a
 * cause the form has stopped offering, while `form_program_pinned_check` in ../db/schema.ts would
 * refuse the row outright. so the mode decides: a cause survives only the mode that names one.
 *
 * it is dropped rather than refused for the reason `pinnedProgramRule` states: a message under a
 * control nobody can see is a refusal with no way out of it.
 *
 * whether the cause named is one this deployment still offers is not decidable here and is not
 * this module's — it is a table, and `createForm` and `updateFormProgram` in ./queries.ts are
 * where a form is held to an active one.
 */
export function parseFormProgram(values: FormInputValues): ParseResult<ParsedFormProgram> {
	const clean = CLEAN_PROGRAM_FIELDS.parse(values);
	const limits = PROGRAM_LIMITS.safeParse(clean);
	if (!limits.success) {
		return { ok: false, errors: fieldErrorsFrom(limits.error, FORM_INPUT_FIELDS) };
	}
	return {
		ok: true,
		value: {
			programMode: limits.data.program_mode,
			programId: limits.data.program_mode === 'pinned' ? limits.data.program_id : null
		} as unknown as ParsedFormProgram
	};
}

/**
 * validates the origins group: the sites a browser may load this form from.
 *
 * `readOriginList` in `@better-giving/operator/origins` is the whole of the rule, and the same call
 * runs in the shared schema — which is not a rule spelled twice but the same one read for two
 * different answers. the schema's `.check()` reads the *message*, because that is the only way a
 * group-level sentence reaches an array field; this reads the *list*, because that is what gets
 * stored — and the list it hands back is what each row normalised to rather than what was ticked,
 * which is the origin a browser will send.
 */
export function parseFormOrigins(values: FormInputValues): ParseResult<ParsedFormOrigins> {
	const clean = CLEAN_ORIGINS_FIELDS.parse(values);
	const { origins, problem } = readOriginList(clean.allowed_origins);
	if (problem !== null) return { ok: false, errors: { allowed_origins: problem } };
	return { ok: true, value: { allowedOrigins: origins } as unknown as ParsedFormOrigins };
}

/**
 * validates a whole submitted form, which is what the screen that makes one posts.
 *
 * the three groups run whatever each other did, and their error maps are merged — one problem per
 * round trip is how a form takes as many submissions as it has inputs, and a create screen is
 * where that is worst because every box is blank at once.
 *
 * composed rather than written out, so no rule is stated a second time. it is sound because every
 * cross-field rule this module keeps lives inside one group: nothing the whole form knows is
 * unavailable to the group that owns it.
 */
export function parseFormInput(values: FormInputValues): FormParseResult {
	const name = parseFormName(values);
	const program = parseFormProgram(values);
	const giving = parseFormGiving(values);
	const origins = parseFormOrigins(values);

	if (!name.ok || !program.ok || !giving.ok || !origins.ok) {
		return {
			ok: false,
			errors: {
				...(name.ok ? {} : name.errors),
				...(program.ok ? {} : program.errors),
				...(giving.ok ? {} : giving.errors),
				...(origins.ok ? {} : origins.errors)
			}
		};
	}

	return {
		ok: true,
		// the one place a whole `ParsedForm` comes into existence. spread from four values that are
		// each already branded, so the assertion re-mints rather than skips a check.
		value: {
			...name.value,
			...program.value,
			...giving.value,
			...origins.value
		} as unknown as ParsedForm
	};
}

/**
 * the message from a parse of a single box.
 *
 * every schema parsed that way states its rules with `abort` where two could fire, so there is
 * exactly one — and the join is this module's own answer for the other case rather than a
 * fallback that would have to invent a sentence: `readOriginList` and `readSuggestedAmounts` both
 * hand back one string about one field, however many things are wrong with the list.
 */
function onlyMessage(error: z.ZodError): string {
	return error.issues.map((issue) => issue.message).join(' ');
}

/**
 * the boxes an edit page renders a stored form back into.
 *
 * the inverse of `parseFormInput`, and it lives beside it rather than in the route because what it
 * has to write is this module's: every amount is written the way the box that takes it is parsed,
 * so a page that rendered one some other way would render something its own parser refuses and
 * nothing else in the repo would notice.
 *
 * nothing is joined here at all. the sites and the suggested amounts are one `<input>` per value,
 * so each list crosses as a list and there is no separator grammar for this function and the
 * parser to agree about.
 *
 * every amount is written in major units, because that is what the boxes take: `majorEntry` in
 * ../../forms/amounts.ts is an exact inverse of the `readAmount` these values are saved back
 * through, so a form rendered here and saved untouched stores the amounts it was rendered from.
 * `majorEntry` and not the padded `majorText` beside it, because these are the boxes themselves
 * rather than an example of one: a $50 tile was typed as `50` and reads back as `50`, where cents
 * are written wherever there are cents. `FORM_CURRENCY` and not the row's own column, for the
 * reason the schema states: the box is parsed against that constant, so it has to be written in it.
 *
 * a missing amount bound renders as an empty box rather than as a number: the columns are
 * nullable for rows nothing in v0 can create, and `0` is a bound somebody set — which arrives here
 * as `0` and is a figure like any other.
 */
export function formInputValuesFrom(record: FormRecord): FormInputValues {
	return {
		name: record.name,
		status: record.status,
		suggested_amounts: record.suggestedAmounts.map((amount) => majorEntry(amount, FORM_CURRENCY)),
		min_minor: record.minMinor === null ? '' : majorEntry(record.minMinor, FORM_CURRENCY),
		max_minor: record.maxMinor === null ? '' : majorEntry(record.maxMinor, FORM_CURRENCY),
		allowed_origins: record.allowedOrigins,
		program_mode: record.programMode,
		// the blank is the select's first line, which carries a word rather than nothing: a form
		// with no cause is `none` above, and `null` written into the box would put the text `null`
		// in front of an operator.
		program_id: record.programId ?? ''
	};
}

/**
 * one row of the amounts editor, as conform names it in a submitted body.
 *
 * `suggested_amounts[0]` is the one bracket a body may carry — `../conform.ts` bounds the index
 * rather than refusing it, precisely so a repeating row editor can submit — and the index is what
 * puts the rows back in the order they were typed.
 */
const AMOUNT_ROW = /^suggested_amounts\[(\d+)\]$/;

/**
 * the submitted body as the parsers above take it: a string per text box, a list per group.
 *
 * read off the body rather than off the parsed submission, because a submission the schema refused
 * carries no values at all and the parsers have to run on that arm too — every offending box comes
 * back in one round trip whichever of the two stages refused it.
 *
 * it reads the whole vocabulary rather than one group's, and both screens that call it want that:
 * the create submits every box at once, and the editor submits one group at a time and hands the
 * result to that group's own parser, which reads its own keys and no others.
 *
 * the text boxes come off `FORM_TEXT_FIELDS` rather than being listed again, so a box added there
 * arrives here without anyone having to remember to add it.
 */
export function formInputValues(body: FormData): FormInputValues {
	const text: Record<string, string> = {};
	for (const box of FORM_TEXT_FIELDS) {
		const value = body.get(box);
		if (typeof value === 'string') text[box] = value;
	}

	// the rows in the order their indices name, with a gap read as an empty box: a body may skip an
	// index, and a hole handed to a parser would be `undefined` where it expects a string.
	const rows: string[] = [];
	for (const [key, value] of body.entries()) {
		const at = AMOUNT_ROW.exec(key);
		if (at?.[1] !== undefined && typeof value === 'string') rows[Number(at[1])] = value;
	}

	return {
		...text,
		allowed_origins: body.getAll('allowed_origins').filter((v) => typeof v === 'string'),
		suggested_amounts: Array.from(rows, (row) => row ?? '')
	};
}
