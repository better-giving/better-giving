import { z } from 'zod';
import { AMOUNT_TEXT, FORM_CURRENCY, readAmount, readSuggestedAmounts } from './amounts';
import { readOriginList } from '@better-giving/operator/origins';
import { PROGRAM_MODES, type ProgramMode } from './program-modes';
import { EDITABLE_FORM_STATUSES } from './statuses';

// what one box of a donation form may hold, in the one place a server parser and a browser may
// both import from.
//
// not under `$lib/server/**`, for the reason ./fields.ts and ./statuses.ts are not: these rules
// are the source of what `$lib/server/forms/form-input.ts` refuses *and* the source of what the
// create and edit screens check in the browser before they submit, and a component may not import
// from `$lib/server/**` at all. declared twice they drift, and the half that drifts silently is
// the client's — it would refuse a value the server accepts, with no way for anyone to tell which
// of the two was right.
//
// that is the general rule and not a local arrangement: a schema that runs in the browser cannot
// live under `$lib/server/**`. the browser half runs the very schema a screen stated —
// `$lib/admin/use-admin-form.ts` hands it to conform's `onValidate` — so the shared schema modules
// sit at `$lib/contacts/` and here, next to the vocabulary they already share, and
// `packages/app/form-rules.ts` is what refuses one reached for from the server tree. the
// dependency runs server -> shared and never back: form-input.ts imports this, and nothing here
// imports from `$lib/server/**`.
//
// what a site allowed to embed a form may be is not in this folder at all, and sits one step
// further out than that: `@better-giving/operator/origins` holds those rules, because the console
// applies the same ones in front of the operator typing a site — before it levels a Turnstile
// widget against a host this deployment would then refuse to serve. the constraint above is
// unchanged by the move and is what the leaf package satisfies: it imports nothing of the app's, so
// the schema below still reaches the rules from a browser where `$lib/server/**` is closed to it.
//
// what is here is field-level with three stated exceptions. two are the giving group's: the
// suggested amounts, which read three boxes, and the two bounds being the right way round, which
// read two. the third is the program group's, where a pinned mode and the cause it names are one
// decision the column itself holds to one answer. each is an object-level check rather than a field
// rule because a `.check()` on a key cannot see a sibling, and the amounts have a second reason on
// top of that: the box it is about —
// like the sites — is a repeating row editor, so it is an array field whose message `setError`
// cannot key, and the sentence has to come out of the schema or nowhere. the rules themselves are
// still the plain typescript in `@better-giving/operator/origins` and ./amounts.ts, for the reasons
// stated on them. the floor under the smallest gift is the one rule about an amount that stays in
// form-input.ts, where `MIN_AMOUNT_MINOR` is; the pair is stated here and the server re-checks it
// on the numbers it stores.
//
// ---------------------------------------------------------------------------
// the rules every parse boundary in this repo is written to. every field rule below is an
// instance of them, and each exists because the failure it names is a parse that *succeeds* —
// nothing here is caught by the type checker.
//
// a parse boundary is two schemas and never one `.pipe()` across the whole of it: a clean stage
// (trim, blank -> null) is `parse`d, then a limits stage is `safeParse`d over its output. a
// failed pipe carries no data, so one over-long field would leave every cross-field rule with
// nothing to read and *every error at once* would silently become *the first one*. the clean
// stage earns its keep on its own too — an absent key on a bare `z.string()` yields
// `Invalid input: expected string, received undefined`, a library sentence in front of an
// operator whose box is simply blank.
//
// half of each parser is deliberately not zod, and every retained block says why on itself.
// `$lib/server/contacts/contact-input.ts`, `$lib/server/org/org-input.ts`,
// `$lib/server/forms/form-input.ts` and `$lib/server/donations/quote-input.ts` are each part schema
// and part ordered typescript: a rule whose *sequence* is the rule (`readRow` in
// `@better-giving/operator/origins` has to test for `*` before the parse, which accepts one), a
// count cap that must say nothing about the individual lines (`.array().max()` reports the cap
// *and* one issue per element), and a rule about three fields at once. do not finish the port —
// read the comment on the block first, because somebody already decided.
//
// error identity is `issue.path[0]`, never `flatten()`, which files a nested issue under the
// top-level key and leaves a form with a sentence and no input to put it under; the walk is
// `fieldErrorsFrom` in `@better-giving/operator/zod-issues`. zod's `.brand()` is a runtime no-op,
// so a parser that marks its output as checked does it with a hand-rolled `unique symbol` and
// exactly one `as unknown as` at the return — see `PostableAccountId` in
// `$lib/server/db/postable.ts`.
//
// `.default()` never runs the checks above it and `.prefault()` does: a trivially conformant
// literal may be defaulted, and anything a rule could refuse must be prefaulted. the live case
// is the two row editors below, argued on the field blocks. and no `z.coerce.*` anywhere —
// it is javascript coercion, and the values it silently accepts are exactly the ones a form
// sends: the string `'false'` coerces to true, an empty box to 0.
// ---------------------------------------------------------------------------

/**
 * caps, generous and here to stop a pathological row rather than to model a real form.
 *
 * exported so the spec asserts the boundary rather than a number copied out of this file, which
 * is how a cap silently stops being tested when it is raised.
 */
export const MAX_FORM_NAME = 200;

/**
 * a required amount bound, which is stricter than the column it lands in.
 *
 * the columns are nullable for rows nothing in v0 can create, and `readFormConfig` in
 * packages/form/src/config.ts returns null when either bound is missing — so a form saved with a blank
 * bound is one that renders nothing and says nothing about why. the blank check aborts, because
 * a blank box is not also worth a sentence about how to write a figure, and the same sentence is
 * the string check's so that a box the request did not carry at all reads the same as one left
 * empty.
 */
export function amountBound() {
	return z.string({ error: REQUIRED }).min(1, { error: REQUIRED, abort: true }).pipe(AMOUNT_TEXT);
}

/**
 * the ticked sites this deployment no longer has listed.
 *
 * the one rule about the sites group that cannot be a schema rule: what a deployment has listed is
 * a table, and this schema runs in a browser. so the check is the two form actions' — each re-reads
 * the list through `readSites` in `$lib/server/sites/queries.ts` and refuses there — and what lives
 * here is the comparison and the sentence, once, so the screens and the actions cannot word it
 * differently.
 *
 * it is a real state rather than a guard against one. both invariants over these two lists are
 * read-then-write and D1 has no interactive transaction (see `$lib/server/db/client.ts`), so a site
 * can leave the shared list between a form screen being drawn and its save being pressed. the
 * residue is a form holding a site the list no longer has, which is harmless on the public path —
 * `corsHeaders` in `$lib/server/api/cors.ts` reads the form's own column and knows nothing about the
 * shared list — and has to be visible and clearable all the same.
 *
 * read through `readOriginList` rather than compared raw, so the trim and the dedupe are the same
 * ones the parse does: a body carrying a padded copy of a listed site would otherwise slip past a
 * literal comparison and be stored as a site the list does not have.
 *
 * only `origins` is read, and the sentence beside it is deliberately dropped: this asks what the
 * ticked list would come to, not whether it may be stored. a repeated site is turned down by the
 * same rule at the field's own check below and again in the parse, so what is wanted here is the
 * set difference and nothing else.
 */
export function unlistedSites(ticked: readonly string[], listed: readonly string[]): string[] {
	return readOriginList(ticked).origins.filter((origin) => !listed.includes(origin));
}

/**
 * what a save is refused with while it still ticks a site this deployment no longer lists.
 *
 * one sentence per site rather than one naming them all, for the reason `readOriginList` gives
 * about its own lines: a sentence per offending thing is what lets an operator clear a list in one
 * pass. `null` is nothing in the way, which is what the caller acts on.
 *
 * it names the two ways out, because either is a real answer: the site can be unticked here, or it
 * can be listed again on the console and stay on this form.
 */
export function unlistedSiteProblem(unlisted: readonly string[]): string | null {
	if (unlisted.length === 0) return null;
	return unlisted
		.map(
			(origin) =>
				`\`${origin}\` is no longer listed for this deployment. Untick it, or list it again ` +
				'on the console.'
		)
		.join(' ');
}

/**
 * what a required box left blank is told, and the shape every field message on an operator screen
 * takes.
 *
 * a message is the predicate of the label over it and nothing more — `required`, `must be at most
 * 200 characters`, `must be less than largest gift of $20` — lowercase, with no period and no
 * verb the label supplies, because the screen draws label, box and message as one column and the
 * three read as one sentence. and it is an instruction rather than a report: it says what the
 * value must be, never what is wrong with it, because the operator is about to retype it. a
 * figure it echoes is written the way the operator wrote it (`formatMinorBrief` in
 * `$lib/donations/money.ts`), so `$20` and never a `$20.00` nobody typed. a message that repeats
 * the label reads it twice, and a message that adds a consequence says what the screen already
 * shows. `$lib/contacts/input-schema.ts` and `src/routes/login.tsx` word theirs the same way, and
 * each states the word itself because the three schemas import from nothing in common.
 *
 * exported so ./input-schema.spec.ts asserts the sentence rather than a copy of it.
 */
export const REQUIRED = 'required';

/**
 * one rule per box, and the only place either stage states one.
 *
 * every rule is stated here rather than at each call site, because both stages read these and a
 * rule spelled twice is a rule that drifts.
 */
export const FORM_FIELD_RULES = {
	/**
	 * `.prefault('')` so a box that never arrived is refused by `.min(1)` below rather than by the
	 * type check above it, which is what keeps the giving group's cross-field rules running.
	 *
	 * conform strips an empty box to `undefined`, and `z.string()` meeting that pushes an issue that
	 * aborts the field — after which zod runs no object-level `.check()` at all, so a create screen
	 * submitted with a blank name would say nothing about the two bounds being the wrong way round
	 * until the name was fixed. prefaulting to `''` runs the same checks a typed-then-cleared box
	 * meets, and their issues continue.
	 *
	 * the sentence is unchanged either way: `REQUIRED` is both rules' message, so a box the body
	 * never carried reads the same as one left empty.
	 */
	name: z
		.string({ error: REQUIRED })
		.trim()
		.min(1, { error: REQUIRED })
		.max(MAX_FORM_NAME, { error: `must be at most ${MAX_FORM_NAME} characters` })
		.prefault(''),
	// the check constraint on `form.status` is derived from `FORM_STATUSES`, of which this is the
	// editable subset, so a value that passes here is one the database accepts by construction.
	// the message is stated rather than left to the default, which would list the values it
	// expected — those are column values, and CLAUDE.md keeps them off a screen. stated at the
	// schema level so it is also what a request carrying no status at all is told.
	status: z.enum(EDITABLE_FORM_STATUSES, { error: REQUIRED }),
	min_minor: amountBound(),
	max_minor: amountBound(),
	// the check constraint on `form.program_mode` is derived from `PROGRAM_MODES`, so a value that
	// passes here is one the database accepts by construction. the message is stated rather than
	// left to the default, which would list the values it expected — those are column values, and
	// CLAUDE.md keeps them off a screen. stated at the schema level so it is also what a request
	// carrying no mode at all is told.
	program_mode: z.enum(PROGRAM_MODES, { error: REQUIRED }),
	/**
	 * the cause a pinned form names, blank in the other two modes.
	 *
	 * the one field rule in this file that refuses nothing, and the blank is why: the box is in the
	 * tree in every mode and hidden in two of them
	 * (`$lib/admin/forms/program-fields.tsx`), so what a `none` form submits is the empty string and
	 * that is the value rather than a box left unfilled. `null` is what the column holds for it, so
	 * the shape is settled here and the mode decides the rest — `pinnedProgramRule` below.
	 *
	 * `.optional()` in front of the transform rather than `.prefault('')`, because conform strips
	 * an empty box to `undefined` and the two have to reach the same answer: a box the body never
	 * carried is refused by `mustArrive` (`$lib/server/conform.ts`) before this ever runs, so what
	 * is left for this to read is a blank one.
	 *
	 * no length cap and no shape check. an id is minted by the column's own `$defaultFn` and never
	 * typed, so what an operator can put here is one of the options the screen drew — and a body
	 * naming anything else is answered by the write, which reads the program before it pins to one
	 * (`$lib/server/forms/queries.ts`).
	 */
	program_id: z
		.string()
		.optional()
		.transform((value) => {
			const chosen = value?.trim() ?? '';
			return chosen === '' ? null : chosen;
		}),
	/**
	 * the sites box, which is one `<input type="checkbox" name="allowed_origins">` per site this
	 * deployment has listed, read with `getAll`.
	 *
	 * a browser submits the ticked boxes and nothing else, so what arrives is a list either way and
	 * the rules below are unchanged by the control that feeds them. a group with nothing ticked
	 * submits no key at all, which `.prefault([])` on the field block below is what stands in for.
	 *
	 * nothing ticked is a form and not a refusal, which is the rule this block does not state. every
	 * form this deployment serves loads on the donation page it serves on its own address, accepted
	 * from the origin a request arrived on rather than from any form's own list — so a form on no
	 * site loads there and takes real gifts there, and there is no arrangement in which a form loads
	 * nowhere.
	 *
	 * so the whole of what is stated here is the shape rule, `readOriginList` in
	 * `@better-giving/operator/origins`, which stays plain typescript there for the reasons stated on
	 * it — the count cap must say nothing about the individual rows, and `readRow` is a sequence in
	 * which the `*` test has to run before the parse, which accepts one. what is added here is the
	 * way its message reaches a screen.
	 *
	 * it reaches the screen from inside the schema, because it is a rule the schema can state.
	 * pushed from a `.check()`, the issue takes this key's own path and arrives keyed by
	 * `allowed_origins` — the input's own name, which is how a repeated input's message is keyed
	 * (`$lib/server/conform.ts`). an action reaches the same key: the ticked-but-unlisted refusal in
	 * both form routes is a rejection keyed `allowed_origins`, because which sites this deployment
	 * lists is a table and no schema running in a browser can read it. the two arrive at one place.
	 *
	 * one message for the whole group and none per box, which is where this group and the amounts
	 * part company: a tick box is not a field with a name of its own, so a per-box message would be
	 * one keyed to nothing, where an amount row carries an indexed name and takes its own.
	 */
	allowed_origins: z.array(z.string()).check((ctx) => {
		const { problem } = readOriginList(ctx.value);
		if (problem !== null) {
			ctx.issues.push({ code: 'custom', input: ctx.value, message: problem, continue: true });
		}
	}),
	/**
	 * the suggested amounts box, which is one `<input>` per amount in a repeating row editor.
	 *
	 * nothing but the shape is stated here, and the whole rule about what the boxes may hold is
	 * `suggestedAmountsRule` below. it cannot be a field rule: every amount is measured against the
	 * two gift bounds, and a `.check()` on this key cannot see a sibling.
	 *
	 * a row nobody typed into is an empty box, and the form layer strips one to `undefined` — so
	 * without the default here a bare `z.string()` element refuses the state both form screens are
	 * *drawn* in: a form suggesting no amounts opens with one blank row, and an operator who saves
	 * the group without touching it would be refused under that row's own key, with zod's sentence
	 * about a type. it is not the ban on a default standing in for a box that must arrive, which is about a
	 * key a body never carried: this row arrived, empty, and empty is what a row editor's spare box
	 * is. what happens to it is `readSuggestedAmounts` in ./amounts.ts, which drops it.
	 */
	suggested_amounts: z.array(z.string().default(''))
} as const;

/**
 * the boxes the giving group's one cross-field rule reads.
 *
 * narrower than either schema it is checked on, which is what lets one statement of the rule serve
 * both: a payload carrying more keys than these is still a payload carrying these.
 */
type GivingBoxes = {
	min_minor: string;
	max_minor: string;
	suggested_amounts: string[];
};

/**
 * what a save is refused with while the two bounds are the wrong way round.
 *
 * one sentence for the browser and for `$lib/server/forms/form-input.ts`, which re-checks the pair
 * on the numbers it would store: the two sides cannot word the refusal differently.
 */
export const INVERTED_BOUNDS = 'must be larger than smallest gift';

/**
 * the two gift bounds the right way round, as one message under the largest gift.
 *
 * an inverted pair is a form that refuses every gift, and the browser says so before a round trip
 * does. keyed to `max_minor` because that is the box the sentence names; a pair has no field of
 * its own. an object-level check because it reads a sibling, which a `.check()` on a key cannot.
 *
 * only when both bounds parsed: a bound that did not is answered by its own box, and a pair with a
 * bound missing is not inverted, it is unset.
 *
 * `continue: true` because an issue pushed from a `.check()` stops every check chained after it,
 * and `suggestedAmountsRule` still has to measure the amounts: `parseFormGiving` in
 * `$lib/server/forms/form-input.ts` measures them whatever the bounds did, so a screen that skipped
 * them would call a save fine that the boundary then refuses.
 */
export function boundsRule(ctx: z.core.ParsePayload<GivingBoxes>): void {
	const minMinor = readAmount(ctx.value.min_minor, FORM_CURRENCY).minor;
	const maxMinor = readAmount(ctx.value.max_minor, FORM_CURRENCY).minor;
	if (minMinor !== null && maxMinor !== null && minMinor > maxMinor) {
		ctx.issues.push({
			code: 'custom',
			input: ctx.value.max_minor,
			path: ['max_minor'],
			message: INVERTED_BOUNDS,
			continue: true
		});
	}
}

/**
 * the boxes the program group's one cross-field rule reads.
 *
 * narrower than either schema it is checked on, which is what lets one statement of the rule serve
 * both: a payload carrying more keys than these is still a payload carrying these.
 */
type ProgramBoxes = {
	program_mode: ProgramMode;
	program_id: string | null;
};

/**
 * a pinned form names a cause, as one message under the program box.
 *
 * the two boxes are one decision and the database says so — `form_program_pinned_check` in
 * `$lib/server/db/schema.ts` holds `program_id is not null` and `program_mode = 'pinned'` to the
 * same answer — so a half-made pair is a write the column would refuse with a constraint error and
 * a 500. it is caught here instead, in the browser, before a round trip.
 *
 * keyed to `program_id` because that is the box to fill in: the mode is the thing the operator
 * chose. an object-level check because it reads a sibling, which a `.check()` on a key cannot.
 *
 * only one direction is stated. the other half of the constraint — a mode that is not `pinned`
 * holding an id — is not a refusal at all: the box is hidden in those modes and submits whatever it
 * was drawn with, so the id is dropped rather than complained about, by the one thing that decides
 * what is stored (`parseFormProgram` in `$lib/server/forms/form-input.ts`). a message under a
 * control nobody can see is a refusal with no way out of it.
 *
 * `continue: true` because an issue pushed from a `.check()` stops every check chained after it,
 * and the giving group's two rules still have to run: an operator who left the program box blank
 * would otherwise be told about their amounts one round trip later.
 */
export function pinnedProgramRule(ctx: z.core.ParsePayload<ProgramBoxes>): void {
	if (ctx.value.program_mode === 'pinned' && ctx.value.program_id === null) {
		ctx.issues.push({
			code: 'custom',
			input: ctx.value.program_id,
			path: ['program_id'],
			message: REQUIRED,
			continue: true
		});
	}
}

/**
 * every suggested amount measured against this form's own bounds, as one message under each box
 * that holds an offending figure.
 *
 * the rule is `readSuggestedAmounts` in ./amounts.ts and stays plain typescript there for the
 * reasons stated on it — the count cap must say nothing about the individual boxes, and the range
 * check is a comparison between three fields. what is added here is only the way the messages reach
 * a screen.
 *
 * an object-level check rather than a field rule, because the rule reads two siblings and a
 * `.check()` on the key cannot. pushed from here with an explicit `path`, an issue arrives under
 * the name the box that carries it was drawn with: `['suggested_amounts', 1]` is the row editor's
 * second input, `suggested_amounts[1]`, which is the one bracket a submitted body may hold
 * (`$lib/server/conform.ts`) and what `getFieldList()` reads that row's `errors` from. the count
 * cap keeps the bare group path, because the list holding too many is a fact about no one row.
 *
 * it stays here rather than moving to an action because the schema can state it, and because the
 * schema is what the browser runs too: a rule an action owns is a round trip the operator waits
 * for.
 *
 * the bounds are read back through `readAmount` rather than taken as numbers, because they are still
 * text at this point: `amountBound` above stops at the check and produces no number, so what this
 * rule is handed is what the boxes carried. a `null` from that read cannot be reached from here —
 * a bound that did not parse aborts, and an aborted field is why this never runs — and is passed
 * on rather than asserted away, because the rule below takes it from
 * `$lib/server/forms/form-input.ts` too and that side does reach it.
 *
 * whether it runs at all is carried by the abort flag on the other fields' issues, and that is a
 * decision rather than a default. zod does not run an object check over a value one of whose fields
 * aborted, and an issue pushed from a `.check()` aborts unless it says `continue: true` — so which
 * refusals silence this one is exactly which of them leave it off. the two bound rules keep it: a
 * mistyped bound makes this say nothing, because the ruler every amount is measured against is the
 * thing that could not be read, and telling an operator their amounts are out of a range nobody set
 * is a sentence about the wrong box. every other rule in this file sets `continue: true` for the
 * opposite reason: a bad origin has nothing to do with the amounts, and swallowing this message would
 * cost the operator a whole round trip to be told the second thing.
 *
 * `$lib/server/forms/form-input.ts` reaches the same function whatever the bounds did and is the
 * authority on what may be stored.
 *
 * an issue per offending row rather than one sentence naming them all, which the sites group beside
 * it cannot do: a tick box has no name of its own, where a row is an input with an indexed one. a
 * row's own message is what lets an operator read the refusal off the box they have to edit, and
 * `readSuggestedAmounts` numbers its rows by their position in the submitted list — blanks and
 * repeats skipped rather than renumbered — so the key names the box the figure is actually in.
 *
 * stated once and checked onto both schema assemblies below, the way `FORM_FIELD_RULES` above is one
 * statement of every field rule.
 */
export function suggestedAmountsRule(ctx: z.core.ParsePayload<GivingBoxes>): void {
	const minMinor = readAmount(ctx.value.min_minor, FORM_CURRENCY).minor;
	const maxMinor = readAmount(ctx.value.max_minor, FORM_CURRENCY).minor;
	const rows = ctx.value.suggested_amounts;
	const { problem, problems } = readSuggestedAmounts(rows, minMinor, maxMinor);
	if (problem !== null) {
		ctx.issues.push({
			code: 'custom',
			input: rows,
			path: ['suggested_amounts'],
			message: problem
		});
	}
	for (const refused of problems) {
		ctx.issues.push({
			code: 'custom',
			input: rows[refused.row],
			path: ['suggested_amounts', refused.row],
			message: refused.problem
		});
	}
}

/**
 * the four blocks a donation form's boxes are grouped into, each one exactly the fields its own
 * heading covers.
 *
 * they are the shared half of two arrangements rather than a third list. the screen that makes a
 * form draws all three inside one `<form>` and posts them together; the screen that edits one
 * draws each inside a `<form>` of its own and posts one at a time. so the whole-form schema and
 * the three group schemas below are both assembled from these, and a rule is stated once in
 * `FORM_FIELD_RULES` above and grouped once here.
 *
 * how often a gift may repeat is in none of them and is not an input at all: what a donor may pick
 * is decided by whether this deployment's own processor account can collect a repeating gift
 * (`offeredCadences` in `$lib/server/forms/offered-cadences.ts`), so no box on either screen posts
 * it. the same move the rails made — see `$lib/forms/offered-rails.ts`.
 *
 * the defaults are the reason each block is a plain object rather than three `z.object` calls
 * merged: `.prefault()` and `.default()` belong to the field and travel with it into whichever
 * schema takes it, so an empty row editor answers for itself the same way on both screens.
 *
 * a required single-value text box takes `.prefault('')`, and what that buys is which rule refuses
 * an absent key. conform strips an empty box to `undefined`, and a `z.string()` meeting that aborts
 * the field — after which zod runs no object-level check at all, so the giving group's two
 * cross-field rules would go silent on any submission that was also missing a name. `''` is what an
 * untouched box submits, so the prefaulted value meets the same `.min(1)` a cleared box does and an
 * empty POST is still a refusal, in the same words. `status` takes none: an enum has no blank to
 * stand in for, and its `<select>` posts a member.
 *
 * `.default('')` on one of them would be the failure that arrangement exists to avoid — it hands
 * its value back without ever running the check above it, so a body carrying no name would
 * validate as a form called nothing. the one `.default('')` in this file is a row of the amounts
 * editor rather than a box, argued on its own field block above.
 *
 * the two list fields take `.prefault([])` and not `.default([])`, and the difference is the whole
 * rule. a group with nothing in it — no ticked box, no typed row — is absent from a submitted body
 * rather than empty, so something has to stand in; but `.default()` hands its value back without
 * ever running the check above it, so a rule that could refuse the empty list would never see it.
 * `.prefault([])` feeds it through the same check a rendered page's empty group meets.
 *
 * neither list refuses its empty value: a form suggesting no amounts is an ordinary form, and a form
 * on no site loads on this deployment's own donation page. so what `.prefault` buys on both is that
 * the empty list is answered by the field's own rule rather than by this line.
 */
const FORM_NAME_FIELDS = {
	name: FORM_FIELD_RULES.name,
	status: FORM_FIELD_RULES.status
} as const;

const FORM_PROGRAM_FIELDS = {
	program_mode: FORM_FIELD_RULES.program_mode,
	program_id: FORM_FIELD_RULES.program_id
} as const;

const FORM_GIVING_FIELDS = {
	min_minor: FORM_FIELD_RULES.min_minor,
	max_minor: FORM_FIELD_RULES.max_minor,
	suggested_amounts: FORM_FIELD_RULES.suggested_amounts.prefault([])
} as const;

const FORM_ORIGINS_FIELDS = {
	allowed_origins: FORM_FIELD_RULES.allowed_origins.prefault([])
} as const;

/**
 * the create screen as it is submitted, and as the browser checks it before it is.
 *
 * flat, with no nested object, and that is not a style choice: a nested name posted against a flat
 * schema is discarded and the form still validates. `$lib/forms/definition.ts` holds the shape at
 * both ends rather than at the first submission (`$lib/server/conform.ts`) — its own type refuses a
 * nested output, and `defineForm` refuses a nested input when the form is stated. the two amount
 * bounds stay text here and `form-input.ts` is where the number comes out of them.
 *
 * every field and every default is the three blocks above, so the create screen and the editor's
 * three groups cannot disagree about what a box may hold.
 *
 * the giving group's two cross-field rules are checked onto this whole-form schema and onto the
 * group's own schema below, from the one statement of each above: the fields they read are in both,
 * and a rule stated twice is a rule that drifts. the pair rule goes first; `boundsRule` says why
 * the order matters.
 */
export const FORM_INPUT_FORM = z
	.object({
		...FORM_NAME_FIELDS,
		...FORM_PROGRAM_FIELDS,
		...FORM_GIVING_FIELDS,
		...FORM_ORIGINS_FIELDS
	})
	.check(pinnedProgramRule)
	.check(boundsRule)
	.check(suggestedAmountsRule);

export type FormInputForm = z.infer<typeof FORM_INPUT_FORM>;

/**
 * the four groups the screen that edits a form saves one at a time, as four schemas.
 *
 * assembled from the same `FORM_FIELD_RULES` and the same three field blocks the whole-form
 * schema above is, which is the rule they exist under: a rule must not be spelled twice. the
 * editor posts one group at a time — three `<form>` elements, three actions, three writes that can
 * each fail on their own — so each action needs a schema covering its own fields and nothing
 * else. a group validated against the whole form would refuse a save because a box in a
 * different group, that this submission never carried, is blank.
 *
 * the ids these are validated under are stated as literals at each action, never derived
 * (`$lib/server/conform.ts`). an id derived from the schema's shape makes two structurally
 * identical groups one form, after which each action's response would update both forms on the
 * screen. see the three `FORM_*_ID` constants in
 * `src/routes/_app.admin.forms.$id.tsx`.
 *
 * the create screen keeps one form and one schema: a form that does not exist yet cannot have a
 * group saved against it, so `FORM_INPUT_FORM` above is what `../new/` validates.
 */
export const FORM_NAME_INPUT = z.object(FORM_NAME_FIELDS);
export const FORM_PROGRAM_INPUT = z.object(FORM_PROGRAM_FIELDS).check(pinnedProgramRule);
export const FORM_GIVING_INPUT = z
	.object(FORM_GIVING_FIELDS)
	.check(boundsRule)
	.check(suggestedAmountsRule);
export const FORM_ORIGINS_INPUT = z.object(FORM_ORIGINS_FIELDS);

export type FormNameInput = z.infer<typeof FORM_NAME_INPUT>;
export type FormProgramInput = z.infer<typeof FORM_PROGRAM_INPUT>;
export type FormGivingInput = z.infer<typeof FORM_GIVING_INPUT>;
export type FormOriginsInput = z.infer<typeof FORM_ORIGINS_INPUT>;
