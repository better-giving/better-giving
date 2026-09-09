import { z } from 'zod';
import { formatMinor, formatMinorBrief, minorUnitDigits } from '../donations/money';

// what an operator writes in an amount box, and the integer it is stored as, in the one place a
// server parser and a browser may both import from.
//
// not under `$lib/server/**`, for the reason ./fields.ts, ./statuses.ts and ./origins.ts are not:
// ./input-schema.ts states these rules as field rules and is the schema the create and edit
// screens hand to `zod4Client`, and a component cannot import from `$lib/server/**` at all.
//
// the dependency runs server -> shared and never back: `$lib/server/forms/form-input.ts` imports
// this, this imports `$lib/donations/money.ts`.
//
// an operator types major units — dollars — and the database stores minor units. that split is the
// whole of this module: the boxes, the hints, every sentence a refusal is written in and the record
// an archived form renders are all in the currency a fundraiser thinks in, and nothing outside here
// has an opinion about how one becomes the other.
//
// the conversion is string-based and never `Math.round(parseFloat(text) * 100)`. `0.29 * 100` is
// 28.999999999999996 and `8.11 * 100` is 810.9999999999999, so multiplying stores a form whose
// smallest gift is a cent under the one that was typed, with no screen disagreeing about it. the
// typed string is split at its point and the fraction padded to the currency's own width, so the
// integer is arrived at without a float ever holding the value.
//
// more precision than the currency has is refused and never rounded. these boxes gate every gift
// the form will take, and `25.005` quietly becoming `25.01` is a bound nobody set and nobody can
// account for later. `parseMinor` in `packages/form/src/money.ts` rounds a donor's over-precise entry up
// instead, which is that side's rule and deliberately not this one: a donor is typing one gift and
// a rounded cent is the safer of two answers, where an operator is typing a rule.
//
// `readSuggestedAmounts` at the foot of this file is here for the reason the rest of the module is,
// with one more on top of it: the suggested amounts are a repeating row editor whose messages have
// to come out of the schema — `setError` cannot name an array field — and ./input-schema.ts is the
// schema the create and edit screens hand to `zod4Client`, which a component may not reach into
// `$lib/server/**` for. it reads the two gift bounds as well as its own boxes, which is why it takes
// them as arguments rather than looking anything up.
//
// it answers per row as well as for the group, because a row *is* a field: each carries its own
// indexed name — `suggested_amounts[1]` — so `suggestedAmountsRule` in ./input-schema.ts keys one
// issue to the box that holds the offending figure. only the count cap stays the group's, because
// it is a fact about the list rather than about any row.
//
// `AMOUNT_TEXT` at the foot of this file is the one zod statement here, and it is here rather than
// in a screen's own schema module for the reason the rest of the module is: it is the rule above as
// a field rule, and ./input-schema.ts pipes into it for a donation form's two bounds.
//
// the number of decimal places is `Intl`'s and never a constant here. JPY has none and KWD has
// three, and a hard-coded two turns a ¥2,500 gift into ¥25 in one direction or refuses it in the
// other.

/**
 * the currency every form this app creates is denominated in, and it is not an input.
 *
 * v0 is USD-only by decision rather than by omission: a non-USD form surfaces bank-debit rails
 * whose mandate flow the client machine under `packages/form/src/` does not model, so offering the choice
 * would be offering a form that cannot complete a gift.
 *
 * here rather than beside the parser that writes it into the row, because the boxes are parsed
 * against it in the browser too — a schema that runs there cannot reach into `$lib/server/**`, and
 * a second copy of the code would be the one that drifts.
 */
export const FORM_CURRENCY = 'USD';

/**
 * what an amount box holds, or the one sentence saying why it holds nothing.
 *
 * a discriminated pair rather than a nullable number, so a caller cannot read the amount without
 * having answered the refusal — the same shape `readOriginList` in
 * `@better-giving/operator/origins` hands back for the same reason.
 */
export type AmountRead =
	| { readonly minor: number; readonly problem: null }
	| { readonly minor: null; readonly problem: string };

/**
 * digits, and at most one point with digits behind it.
 *
 * no sign, no exponent, no symbol and no thousands separator. the separator is the one worth
 * stating: the suggested amounts are one box per amount, so a comma inside a box is a thousands
 * separator or a second figure, and both are a box nobody can store.
 */
const AMOUNT = /^(\d+)(?:\.(\d+))?$/;

/**
 * how an amount must be written, as one clause a hint and a refusal both end with.
 *
 * one wording for the standing rule and for every failure of it, so the box an operator is typing
 * into and the message they are refused with cannot describe the same rule differently. the example
 * is the whole of the rule, showing the decimals, and is built from the currency rather than written
 * out: at two places it reads `write 25.00 for $25.00`, and at none it reads `write 25 for ¥25`.
 *
 * lowercase and unpunctuated because every message it ends is a field message, which is the
 * predicate of the label over it — the rule is on `REQUIRED` in ./input-schema.ts.
 */
export function amountRule(currency: string): string {
	const example = 25 * 10 ** minorUnitDigits(currency);
	return `write ${majorText(example, currency)} for ${formatMinor(example, currency)}`;
}

/**
 * what one box holds, as the integer minor units it is stored in.
 *
 * the sentence names no value, because it is drawn under the box holding it — a message that
 * repeats what the operator is looking at is one they read twice, and these boxes take free text
 * with no cap in front of them. the one place the value is named is where the sentence has left its
 * box: `parseFormGiving` in `$lib/server/forms/form-input.ts` folds every refused row into one
 * string, and prefixes each with the typed text through ../redact.ts, which is the app's one echo
 * policy.
 *
 * the safe-integer check closes the end the shape rule cannot: a thirty-digit paste is digits all
 * the way along and parses to a float that is an integer and is not the number that was typed.
 */
export function readAmount(text: string, currency: string): AmountRead {
	const match = AMOUNT.exec(text);
	if (match === null) {
		return { minor: null, problem: `must be an amount, ${amountRule(currency)}` };
	}

	const [, whole = '', fraction = ''] = match;
	const digits = minorUnitDigits(currency);
	if (fraction.length > digits) {
		return {
			minor: null,
			problem: `must not be finer than ${formatMinor(1, currency)}, ${amountRule(currency)}`
		};
	}

	const minor = Number(`${whole}${fraction.padEnd(digits, '0')}`);
	if (!Number.isSafeInteger(minor)) {
		return { minor: null, problem: `must be an amount, ${amountRule(currency)}` };
	}
	return { minor, problem: null };
}

/**
 * a stored amount written to the currency's full width: major units, digits only, no grouping.
 *
 * the padded rendering, and what `amountRule` above builds its example out of. that sentence is
 * there to demonstrate the shape a box takes, and `write 25.00 for $25.00` stops teaching it the moment
 * the zeros come off — which is the whole reason this and `majorEntry` below are two functions.
 *
 * the inverse of `readAmount` and it has to stay one: the example is text an operator may copy
 * straight into the box, so a value rendered with a thousands separator or a currency symbol would
 * be one this module's own parser refuses.
 *
 * `formatMinor` in `$lib/donations/money.ts` is the third rendering and answers a different
 * question: that one is a figure a person reads, this one and `majorEntry` are text a parser reads
 * back.
 *
 * string arithmetic for the reason the parse is: the digits are moved, never divided.
 */
export function majorText(amountMinor: number, currency: string): string {
	const digits = minorUnitDigits(currency);
	if (digits === 0) return String(amountMinor);
	const padded = String(amountMinor).padStart(digits + 1, '0');
	return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/**
 * a stored amount as the operator who typed it would have written it: major units, digits only, no
 * grouping, and a point only where there are cents to write.
 *
 * what every amount box on an edit screen is seeded from, and the placeholder beside them. an
 * operator offering a fifty-dollar tile typed `50`, and a box handing it back as `50.00` shows
 * them a figure they did not write and invites an edit that changes nothing. cents survive where
 * there are cents: `12.50` is written whole, and `0.05` is five cents rather than five of
 * anything.
 *
 * an inverse of `readAmount` exactly as `majorText` is, and it has to stay one — the boxes an edit
 * screen seeds are parsed again by the same rules the moment they are saved, so a value rendered
 * with a thousands separator or a currency symbol would be one this module's own parser refuses.
 * `AMOUNT` takes a whole number with no point at all, which is what makes leaving the zeros off
 * safe rather than lossy.
 *
 * built on `majorText` rather than beside it: the digits are moved there, once, and what happens
 * here is a fraction of nothing but zeros being left off the end. no division and no `parseFloat`,
 * for the reason the parse has none.
 */
export function majorEntry(amountMinor: number, currency: string): string {
	const digits = minorUnitDigits(currency);
	const text = majorText(amountMinor, currency);
	if (digits === 0) return text;
	const fraction = text.slice(-digits);
	// the point comes off with the zeros: `50.` is not an amount this module's own parser reads.
	return /^0+$/.test(fraction) ? text.slice(0, -(digits + 1)) : text;
}

/**
 * caps, generous and here to stop a pathological row rather than to model a real form.
 *
 * `suggested_amounts` is read and JSON-parsed on every `/api/v1` config request and each
 * entry becomes a tile in a card 375px wide, so a list of fifty is a broken form rather
 * than a generous one.
 *
 * exported so the spec asserts the boundary rather than a number copied out of this file,
 * which is how a cap silently stops being tested when it is raised.
 */
export const MAX_SUGGESTED_AMOUNTS = 12;

/**
 * a figure as the operator who typed it reads it back.
 *
 * every amount in a message about these boxes goes through here. they are written in major units, so
 * a message quoting the stored integer would answer a `25.00` box with `2500`, which is a number the
 * operator cannot find anywhere on their screen.
 *
 * `FORM_CURRENCY` rather than a parameter, for the reason that constant is in this module at all: the
 * boxes are parsed against it on both sides of the wire, so a message about one of them written in
 * anything else would name a figure the parser never read.
 */
const money = (amountMinor: number) => formatMinorBrief(amountMinor, FORM_CURRENCY);

/**
 * the suggested amounts as the repeating row editor submits them, checked against this form's own
 * bounds.
 *
 * `readFormConfig` in `packages/form/src/config.ts` drops an out-of-range suggestion silently, so a $5 tile
 * under a $10 minimum is a form that renders without it and an operator who is never told which one
 * went missing. refusing it here is what makes the boxes honest.
 *
 * one row per amount, so what arrives is one form entry per box rather than one box holding commas.
 * the trim and the blank-row skip are what a row an operator added and never typed into needs: it
 * is a blank entry rather than a value, so it is dropped. the dedupe answers a different thing —
 * one amount entered in two boxes, which would store two identical tiles. a bad value is named
 * rather than dropped.
 *
 * plain typescript rather than a schema, for two rules a schema would express worse. the count cap
 * is an early return that deliberately says nothing about individual entries, where an array
 * schema's `.max()` would report the cap and one issue per bad element on top of it; and the range
 * check reads the two bound boxes' parsed values, which makes it a rule about three fields rather
 * than a property of this one. the same arrangement `readOriginList` in
 * `@better-giving/operator/origins` is under, and that file's header states it at length.
 *
 * two answers rather than one, and the split is what each is about. `problem` is the count cap and
 * nothing else, because the list holding too many is a fact about the group; `problems` is one
 * entry per offending row, carrying the row's own position so a screen can draw the sentence under
 * the box that holds the figure. an offending row therefore leaves `problem` null — the two never
 * both speak.
 *
 * `row` is the position in `rows` as handed in, blanks and repeats included, and never a position
 * in some compacted list: it is what the caller keys an issue by, and a renumbered index would
 * mark up the wrong box.
 *
 * either bound arrives as `null` when its own box did not parse, and the range check that reads it
 * is skipped rather than guessed at: an operator who mistyped the largest gift must not also be told
 * their amounts are outside a bound nobody set.
 *
 * the repeats come out before the count is taken, because the cap and the dedupe are the same paste
 * read twice and they have to agree about it: a repeat is "a paste rather than a mistake" below, so
 * a group that would store twelve tiles cannot be refused for holding fifteen boxes. two spellings
 * of one amount — `25` and `25.00` — survive that pass and are caught by the numeric dedupe further
 * down, which is the one the stored list is built from.
 */
export function readSuggestedAmounts(
	rows: readonly string[],
	minMinor: number | null,
	maxMinor: number | null
): {
	amounts: number[];
	problem: string | null;
	problems: ReadonlyArray<{ row: number; problem: string }>;
} {
	const seen = new Set<string>();
	const entries: { row: number; text: string }[] = [];
	rows.forEach((entry, row) => {
		const text = entry.trim();
		if (text.length === 0 || seen.has(text)) return;
		seen.add(text);
		entries.push({ row, text });
	});

	if (entries.length > MAX_SUGGESTED_AMOUNTS) {
		// checked instead of the entries, not alongside them: a paste of fifty boxes would otherwise
		// come back as fifty sentences about individual amounts, none of which is the problem.
		return {
			amounts: [],
			problem: `at most ${MAX_SUGGESTED_AMOUNTS}`,
			problems: []
		};
	}

	const amounts: number[] = [];
	const problems: { row: number; problem: string }[] = [];
	for (const { row, text } of entries) {
		// the same rule the two bound boxes are held to, called directly rather than through a
		// schema: a dozen boxes measured against a bound the schema cannot see from the key is a
		// rule about three fields, and this is where it is stated once for both sides of the wire.
		const read = readAmount(text, FORM_CURRENCY);
		if (read.problem !== null) {
			problems.push({ row, problem: read.problem });
			continue;
		}
		const amount = read.minor;
		if (minMinor !== null && amount < minMinor) {
			problems.push({ row, problem: `must be more than smallest gift of ${money(minMinor)}` });
			continue;
		}
		if (maxMinor !== null && amount > maxMinor) {
			problems.push({ row, problem: `must be less than largest gift of ${money(maxMinor)}` });
			continue;
		}
		// a repeat is a paste rather than a mistake, and two identical tiles is what storing it
		// would render. first-seen order is kept: the order is the operator's, and it is the
		// order the buttons appear in.
		if (!amounts.includes(amount)) amounts.push(amount);
	}

	return { amounts, problem: null, problems };
}

/**
 * one amount box, as the operator's own currency and still as text.
 *
 * here rather than in a screen's own schema module, because it is a rule about an amount box and
 * not about any one form's boxes: `amountBound` in ./input-schema.ts pipes into it for a donation
 * form's two bounds. a second `.check()` calling `readAmount` at that site would be the same rule
 * spelled twice.
 *
 * an operator writes major units — dollars — and the row stores minor units. `readAmount` in
 * ./amounts.ts is the whole of that rule and the sentence for every way of getting it wrong, and
 * the same call is what `$lib/server/forms/form-input.ts` reads the integer out of: one rule read
 * for two answers, the arrangement `readOriginList` in `@better-giving/operator/origins` is under. so the two bound boxes
 * and the suggested-amounts box cannot drift into saying it differently, and the box a browser
 * refuses is the box the Worker refuses.
 *
 * the currency is `FORM_CURRENCY` rather than the row's own column, and it has to be: this schema
 * runs in a browser that is holding a form rather than a record, and the parse on the other side
 * of the wire reads the same constant — a screen that validated against one currency and stored
 * against another would turn a typed figure into a different gift.
 *
 * one `.check()` rather than a chain, because there is one answer: a value that is not a figure at
 * all and one carrying more places than the currency has are two sentences, never both.
 *
 * the issue aborts — which is what an issue pushed from a `.check()` does unless it says otherwise —
 * and here that is load-bearing rather than incidental: it is what stops `suggestedAmountsRule` in
 * ./input-schema.ts from measuring every suggested amount against a bound that could not be read — see the note
 * on `suggestedAmountsRule` in ./input-schema.ts.
 */
export const AMOUNT_TEXT = z.string().check((ctx) => {
	const { problem } = readAmount(ctx.value, FORM_CURRENCY);
	if (problem !== null) {
		ctx.issues.push({ code: 'custom', input: ctx.value, message: problem });
	}
});
