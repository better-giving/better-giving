import { describe, expect, it } from 'vitest';
import {
	amountRule,
	majorEntry,
	majorText,
	MAX_SUGGESTED_AMOUNTS,
	readAmount,
	readSuggestedAmounts
} from './amounts';

// node pool, no database: every rule here is decidable from one typed string and a currency code.

/** the minor units a box parsed to, failing loudly rather than asserting on a null. */
function minor(text: string, currency = 'USD'): number {
	const read = readAmount(text, currency);
	if (read.problem !== null) throw new Error(`expected \`${text}\` to parse: ${read.problem}`);
	return read.minor;
}

/** the mirror: the one sentence a box was refused with. */
function refusal(text: string, currency = 'USD'): string {
	const read = readAmount(text, currency);
	if (read.problem === null) {
		throw new Error(`expected \`${text}\` to be refused, got ${read.minor}`);
	}
	return read.problem;
}

describe('readAmount', () => {
	it('reads a whole number as whole major units', () => {
		// what an operator types when the gift is a round figure, read as major units: `25` is
		// twenty-five dollars, not twenty-five cents.
		expect(minor('25')).toBe(2500);
		expect(minor('0')).toBe(0);
		expect(minor('10000')).toBe(1000000);
	});

	it('reads a fraction exactly, where multiplying by a hundred would not', () => {
		// the whole reason the conversion is string-based. `0.29 * 100` is 28.999999999999996 and
		// truncates to 28, and `8.11 * 100` is 810.9999999999999 — a form whose smallest gift is a
		// cent under what the operator typed, with nothing on any screen disagreeing about it.
		expect(minor('0.29')).toBe(29);
		expect(minor('0.07')).toBe(7);
		expect(minor('8.11')).toBe(811);
		expect(minor('1.10')).toBe(110);
		expect(minor('2500.00')).toBe(250000);
	});

	it('pads a short fraction rather than reading it as minor units', () => {
		// `5.5` is five fifty, not five and five cents. the fraction is padded to the currency's
		// own width from the left of the point outwards.
		expect(minor('5.5')).toBe(550);
		expect(minor('0.5')).toBe(50);
	});

	it('refuses more precision than the currency has, rather than rounding it', () => {
		// these two boxes gate every gift the form will ever take, so a value quietly rounded to
		// `25.01` is a bound nobody set and nobody can explain later. the sentence names the finest
		// unit and shows the shape.
		const message = refusal('25.005');
		expect(message).toContain('must not be finer than $0.01');
		expect(message).toContain('write 25.00 for $25.00');
		expect(refusal('0.001')).toContain('must not be finer than $0.01');
	});

	it('refuses anything that is not a plain figure, naming it', () => {
		// no sign, no exponent, no thousands separator and no currency symbol: the suggested amounts
		// are one box per amount, so a comma inside a box is a thousands separator or a second
		// figure, and both are a box nobody can store.
		for (const text of ['', ' ', 'lots', '-5', '+5', '1e6', '25,00', '1,000', '$25', '25.', '.5']) {
			expect(refusal(text)).toBeTypeOf('string');
		}
		expect(refusal('lots')).toBe('must be an amount, write 25.00 for $25.00');
	});

	it('refuses a paste too long to be a number this app can hold', () => {
		// a thirty-digit paste parses to a float that is an integer and is not the number that was
		// typed, and the column it would land in is an integer.
		expect(refusal('9'.repeat(30))).toBeTypeOf('string');
	});

	it('names no value, because the box the message sits under is holding it', () => {
		// a field message is the predicate of the label over it (`REQUIRED` in ./input-schema.ts),
		// and these boxes have no length cap in front of them — an echoed paste would be a message
		// nobody can read, sitting under the box already showing it.
		const long = 'x'.repeat(400);
		expect(refusal(long)).toBe('must be an amount, write 25.00 for $25.00');
		expect(refusal('25.005')).not.toContain('25.005');
	});

	it('takes the number of places from the currency rather than assuming two', () => {
		// the exponent is `Intl`'s. a currency with none accepts the whole number and refuses the
		// decimal point outright, where a hard-coded two would store a gift a hundred times the
		// one that was typed.
		expect(minor('2500', 'JPY')).toBe(2500);
		expect(refusal('25.0', 'JPY')).toBe('must not be finer than ¥1, write 25 for ¥25');
	});
});

describe('majorText', () => {
	it('writes a stored integer as the box holds it', () => {
		expect(majorText(500, 'USD')).toBe('5.00');
		expect(majorText(2500, 'USD')).toBe('25.00');
		expect(majorText(1000000, 'USD')).toBe('10000.00');
	});

	it('keeps the point in front of an amount smaller than one major unit', () => {
		// the padding is what stops `5` being written as `5.` or as `5.00`: it is five cents.
		expect(majorText(5, 'USD')).toBe('0.05');
		expect(majorText(50, 'USD')).toBe('0.50');
		expect(majorText(0, 'USD')).toBe('0.00');
	});

	it('writes no point at all for a currency with no minor unit', () => {
		expect(majorText(2500, 'JPY')).toBe('2500');
	});

	it('round-trips every stored amount back to itself', () => {
		// the claim the edit screen rests on: a form rendered into its boxes and saved untouched
		// stores the same form. both directions read the currency's width out of one place, so the
		// only way this breaks is one of them being changed alone.
		for (const stored of [0, 1, 5, 50, 99, 500, 811, 2500, 100000, 1000000]) {
			expect(readAmount(majorText(stored, 'USD'), 'USD').minor).toBe(stored);
		}
	});
});

describe('majorEntry', () => {
	it('writes a round figure without the zeros nobody typed', () => {
		// the whole reason this sits beside `majorText`: an operator offering a fifty-dollar tile
		// typed `50`, and a box handing it back as `50.00` shows them a figure they did not write
		// and invites an edit that changes nothing.
		expect(majorEntry(5000, 'USD')).toBe('50');
		expect(majorEntry(500, 'USD')).toBe('5');
		expect(majorEntry(1000000, 'USD')).toBe('10000');
		expect(majorEntry(0, 'USD')).toBe('0');
	});

	it('keeps the cents of an amount that has cents', () => {
		// dropping a fraction that is not zeros would be a different amount, and the padding inside
		// it is what stops `5` — five cents — reading as five dollars.
		expect(majorEntry(1250, 'USD')).toBe('12.50');
		expect(majorEntry(811, 'USD')).toBe('8.11');
		expect(majorEntry(50, 'USD')).toBe('0.50');
		expect(majorEntry(5, 'USD')).toBe('0.05');
	});

	it('takes the width from the currency rather than assuming two', () => {
		// JPY has no minor unit and KWD has three, so what counts as "no cents to write" is the
		// currency's own question — a hard-coded two writes 5000 fils as `50.00` rather than as `5`.
		expect(majorEntry(2500, 'JPY')).toBe('2500');
		expect(majorEntry(0, 'JPY')).toBe('0');
		expect(majorEntry(5000, 'KWD')).toBe('5');
		expect(majorEntry(5250, 'KWD')).toBe('5.250');
		expect(majorEntry(5, 'KWD')).toBe('0.005');
	});

	it('round-trips every stored amount back to itself', () => {
		// the same claim `majorText` is held to, and the one the edit screen rests on: a form
		// rendered into its boxes and saved untouched stores the amounts it was rendered from.
		// `AMOUNT` takes a whole number with no point at all, which is what makes leaving the
		// zeros off safe rather than lossy.
		for (const currency of ['USD', 'JPY', 'KWD']) {
			for (const stored of [0, 1, 5, 50, 99, 500, 811, 2500, 100000, 1000000]) {
				expect(readAmount(majorEntry(stored, currency), currency).minor).toBe(stored);
			}
		}
	});
});

describe('readSuggestedAmounts', () => {
	/** the amounts a set of boxes stored, failing loudly rather than asserting on a refusal. */
	function stored(rows: string[], min: number | null = null, max: number | null = null): number[] {
		const read = readSuggestedAmounts(rows, min, max);
		if (read.problem !== null) throw new Error(`expected these boxes to parse: ${read.problem}`);
		if (read.problems.length > 0) {
			const refusals = read.problems.map(({ row, problem }) => `row ${row}: ${problem}`);
			throw new Error(`expected these boxes to parse: ${refusals.join('; ')}`);
		}
		return read.amounts;
	}

	/** the mirror for the list: the one sentence the group as a whole was refused with. */
	function capped(rows: string[], min: number | null = null, max: number | null = null): string {
		const read = readSuggestedAmounts(rows, min, max);
		if (read.problem === null) {
			throw new Error(`expected this group to be refused, got ${read.amounts.join(', ')}`);
		}
		return read.problem;
	}

	/** the mirror for a box: what each offending row was refused with, and which row it was. */
	function perRow(
		rows: string[],
		min: number | null = null,
		max: number | null = null
	): ReadonlyArray<{ row: number; problem: string }> {
		return readSuggestedAmounts(rows, min, max).problems;
	}

	it('reads one box as one amount, in the order they were written', () => {
		// the order is the operator's — it is the order the buttons appear in on the card — so a
		// list that came back sorted would read as the form having eaten an edit.
		expect(stored(['100', '25.00', '50'])).toEqual([10000, 2500, 5000]);
	});

	it('takes a box holding a comma as one amount and refuses it', () => {
		// one box per amount is the whole shape of this field: a comma inside a box is a
		// thousands separator or a second figure, and both are a box nobody can store.
		expect(perRow(['1,000'])).toEqual([
			{ row: 0, problem: 'must be an amount, write 25.00 for $25.00' }
		]);
	});

	it('drops a box nobody typed into', () => {
		// what "Add another amount" leaves behind, and what a form offering no amounts is. a blank
		// row is not a value, so it is dropped rather than refused.
		expect(stored(['', '25.00', '   '])).toEqual([2500]);
		expect(stored([])).toEqual([]);
		expect(stored([''])).toEqual([]);
	});

	it('drops a repeat rather than storing two identical tiles', () => {
		// two spellings of one amount reach the numeric pass as different text, and it is that pass
		// the stored list is built from. first-seen order is kept.
		expect(stored(['50', '25.00', '50.00'])).toEqual([5000, 2500]);
	});

	it('measures every box against the form\u2019s own bounds, naming the bound it missed', () => {
		// `readFormConfig` in `packages/form/src/config.ts` drops an out-of-range suggestion silently, so a
		// $1 tile under a $5 minimum is a form that renders without it and an operator who is never
		// told which one went missing. the figure is not repeated: it is in the box the message
		// sits under.
		expect(perRow(['1.00', '25.00'], 500, 1000000)).toEqual([
			{ row: 0, problem: 'must be more than smallest gift of $5' }
		]);
		expect(perRow(['25.00', '999999.99'], 500, 1000000)).toEqual([
			{ row: 1, problem: 'must be less than largest gift of $10,000' }
		]);
	});

	it('says nothing about a range when a bound did not parse', () => {
		// an operator who mistyped the largest gift must not also be told their amounts are outside
		// a bound nobody set. the shape of each box is still answered.
		expect(stored(['1.00', '999999.99'], null, null)).toEqual([100, 99999999]);
		expect(stored(['1.00'], null, 1000000)).toEqual([100]);
	});

	it('keys every offending box to its own row and leaves the good ones alone', () => {
		// each row is an input with an indexed name, so a refusal is drawn under the box holding
		// the figure rather than as one sentence about the group.
		expect(perRow(['lots', '25.00', '25.005'])).toEqual([
			{ row: 0, problem: 'must be an amount, write 25.00 for $25.00' },
			{ row: 2, problem: 'must not be finer than $0.01, write 25.00 for $25.00' }
		]);
	});

	it('numbers a row by where it sits, counting the blanks it skipped', () => {
		// the number is what the caller keys an issue by — `suggested_amounts[1]` is the second
		// input on the screen whether or not the first one was typed into. renumbered around the
		// blank, the message would mark up the wrong box.
		expect(perRow(['', 'lots', '25.00'])).toEqual([
			{ row: 1, problem: 'must be an amount, write 25.00 for $25.00' }
		]);
	});

	it('stops at the count cap and says nothing about individual boxes', () => {
		// the cap firing is the moment an operator most needs one sentence rather than a dozen: each
		// amount is a button on a card a donor reads on a phone.
		const many = Array.from({ length: MAX_SUGGESTED_AMOUNTS + 1 }, (_, i) => String(10 + i));
		expect(capped(many)).toContain(String(MAX_SUGGESTED_AMOUNTS));
		expect(perRow(many)).toEqual([]);
	});

	it('takes the repeats out before the count, so the cap and the dedupe agree', () => {
		// a group that would store twelve tiles cannot be refused for holding thirteen boxes.
		const typed = Array.from({ length: MAX_SUGGESTED_AMOUNTS }, (_, i) => String(10 + i));
		expect(stored([...typed, '10'])).toHaveLength(MAX_SUGGESTED_AMOUNTS);
	});

	it('names no value in a row\u2019s own message, because that row is the box showing it', () => {
		// these boxes have no length cap in front of them. where the sentence has to leave the box —
		// `parseFormGiving` in `$lib/server/forms/form-input.ts` folds the rows into one string — it
		// is that call that prefixes the typed text through `../redact.ts`.
		const long = 'x'.repeat(400);
		expect(perRow([long])).toEqual([
			{ row: 0, problem: 'must be an amount, write 25.00 for $25.00' }
		]);
	});
});

describe('amountRule', () => {
	it('states the places and shows a figure in the currency', () => {
		// what a hint and a refusal both end with, so the box and the message about it cannot word
		// one rule two ways. lowercase and unpunctuated: it is the tail of a field message.
		expect(amountRule('USD')).toBe('write 25.00 for $25.00');
	});

	it('shows a whole number for a currency with no minor unit', () => {
		// `25.00 for ¥25` would teach a shape the box refuses, and this is the branch that keeps the
		// exponent `Intl`'s rather than a constant.
		expect(amountRule('JPY')).toBe('write 25 for ¥25');
	});
});
