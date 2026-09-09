import { describe, expect, it } from 'vitest';
import {
	currencySymbol,
	formatFigure,
	formatMinor,
	formatOffer,
	minorUnitDigits,
	parseMinor
} from './money';

// node pool: `Intl` is a platform primitive, not a DOM one, so every claim here is assertable
// without a browser. what a real browser adds is a different set of locale data, which is why
// nothing below asserts an exact separator or an exact symbol placement.

describe('the minor-unit exponent', () => {
	it('reads two for a currency that has cents', () => {
		expect(minorUnitDigits('en-US', 'USD')).toBe(2);
	});

	it('reads zero for a currency that has none', () => {
		// the assumption this exists to refuse: dividing a ¥2,500 gift by 100 states it as ¥25.
		expect(minorUnitDigits('ja-JP', 'JPY')).toBe(0);
	});

	it('reads three for a currency that has thousandths', () => {
		expect(minorUnitDigits('ar-KW', 'KWD')).toBe(3);
	});

	it('falls back to two when the currency cannot be resolved at all', () => {
		expect(minorUnitDigits('en-US', 'not-a-currency')).toBe(2);
	});
});

describe('formatting a figure', () => {
	it('states a minor-unit amount in major units', () => {
		expect(formatMinor(2579, 'en-US', 'USD')).toBe('$25.79');
	});

	it('states a zero-decimal currency without inventing decimals', () => {
		expect(formatMinor(2500, 'ja-JP', 'JPY')).toBe('￥2,500');
	});

	it('keeps the currency when the locale is one it cannot parse', () => {
		// the locale is a preference and the currency is the unit the money is in, so an unusable
		// locale is what gets dropped.
		expect(formatMinor(2579, 'not a locale tag', 'USD')).toBe('$25.79');
	});

	it('states the amount with its code when the currency itself is unusable', () => {
		expect(formatMinor(2579, 'en-US', 'BOGUS')).toBe('BOGUS 25.79');
	});

	it('renders nothing rather than NaN on a screen asking for money', () => {
		expect(formatMinor(Number.NaN, 'en-US', 'USD')).toBe('');
	});
});

describe('formatting an offer', () => {
	it('drops a fraction that is all zeroes', () => {
		// a tile is an offer and a receipt row is a statement. `$25.00` on a shortcut past the free
		// entry states a precision the org did not offer, and states it four glyphs wide.
		expect(formatOffer(2500, 'en-US', 'USD')).toBe('$25');
	});

	it('keeps cents an amount actually carries', () => {
		expect(formatOffer(2750, 'en-US', 'USD')).toBe('$27.50');
		expect(formatOffer(2579, 'en-US', 'USD')).toBe('$25.79');
	});

	it('leaves a zero-decimal currency exactly where formatting it as a figure leaves it', () => {
		// nothing to drop: `JPY` has no minor units, so the offer and the statement are one string.
		expect(formatOffer(2500, 'ja-JP', 'JPY')).toBe(formatMinor(2500, 'ja-JP', 'JPY'));
	});

	it('drops the thousandths of a currency that has three of them', () => {
		// the exponent is the currency's rather than two, here as everywhere else in this file: what
		// comes off `KWD 25.000` is three digits and a separator, not two.
		const statement = formatMinor(25_000, 'ar-KW', 'KWD');
		const offer = formatOffer(25_000, 'ar-KW', 'KWD');

		expect(offer).not.toBe(statement);
		expect(statement.length - offer.length).toBe(4);
	});

	it('states the amount with its code when the currency itself is unusable', () => {
		expect(formatOffer(2500, 'en-US', 'BOGUS')).toBe('BOGUS 25');
	});

	it('renders nothing rather than NaN on a screen asking for money', () => {
		expect(formatOffer(Number.NaN, 'en-US', 'USD')).toBe('');
	});
});

describe('formatting the figure alone', () => {
	// what a preset press writes into the amount entry. the box draws the symbol and the code as
	// marks at either end of itself, so a currency inside it would be stated twice.
	it('carries no currency at all', () => {
		expect(formatFigure(2500, 'en-US', 'USD')).toBe('25');
		expect(formatFigure(2750, 'en-US', 'USD')).toBe('27.50');
	});

	// and no grouping either. a tile keeps its separators — `$1,000` there is a label, and a label is
	// read rather than edited — but this goes into a text box a donor puts a caret into, where a
	// character nothing they typed put there is one they have to type around.
	it('groups nothing, in a locale that groups and in one that groups the other way round', () => {
		expect(formatFigure(100_000, 'en-US', 'USD')).toBe('1000');
		expect(formatFigure(123_456_789, 'en-US', 'USD')).toBe('1234567.89');
		expect(formatFigure(100_050, 'de-DE', 'EUR')).toBe('1000,50');
		expect(formatFigure(1_234_567, 'ja-JP', 'JPY')).toBe('1234567');
	});

	// the round trip is the whole point of it: the two controls are two views of one number, so
	// what a press writes has to be what the box would have read back off a donor typing it.
	it('writes what the box reads back, in a locale that groups the other way round', () => {
		// both directions, and the second is the one the ungrouped figure could have broken: a value
		// written without separators and read back by a parser that expected them is exactly the shape
		// of the thousandths defect this sweep was added for.
		for (const [locale, currency] of [
			['en-US', 'USD'],
			['de-DE', 'EUR'],
			['ja-JP', 'JPY'],
			['ar-KW', 'KWD']
		] as const) {
			for (const amount of [500, 2500, 2750, 100_000, 1_234_567, 123_456_789]) {
				const written = formatFigure(amount, locale, currency);
				expect(written).not.toMatch(/[^\d.,]/);
				expect(parseMinor(written, locale, currency)).toBe(amount);
				// and back out again unchanged, which is what says the box is holding the same figure
				// after a donor has been round it rather than one the two ends merely agree to differ on.
				expect(formatFigure(parseMinor(written, locale, currency) ?? -1, locale, currency)).toBe(
					written
				);
			}
		}
	});

	it('renders nothing rather than NaN on a screen asking for money', () => {
		expect(formatFigure(Number.NaN, 'en-US', 'USD')).toBe('');
	});
});

describe('the symbol a currency is written with', () => {
	it('reads the symbol the locale writes', () => {
		expect(currencySymbol('en-US', 'USD')).toBe('$');
	});

	it('reads the code itself for a currency this locale writes no symbol for', () => {
		// what the free entry's leading mark is conditioned on: `CHF` is its own symbol in `en-US`, so
		// a card drawing it at both ends of the box would state the currency twice.
		expect(currencySymbol('en-US', 'CHF')).toBe('CHF');
	});

	it('reads the code when the currency cannot be resolved at all', () => {
		expect(currencySymbol('en-US', 'not-a-currency')).toBe('NOT-A-CURRENCY');
	});
});

describe('reading what a donor typed', () => {
	it('reads a whole number of major units', () => {
		expect(parseMinor('25', 'en-US', 'USD')).toBe(2500);
	});

	it('reads a decimal point as a decimal point', () => {
		expect(parseMinor('25.79', 'en-US', 'USD')).toBe(2579);
	});

	it('reads a comma with two digits behind it as a decimal point too', () => {
		// the field takes `inputmode="decimal"` and the donor's keyboard may not be the page's
		// language, so both separators arrive on the same form.
		expect(parseMinor('25,79', 'en-US', 'USD')).toBe(2579);
	});

	it('reads the locale’s own group separator with three digits behind it as thousands', () => {
		expect(parseMinor('1,000', 'en-US', 'USD')).toBe(100_000);
		expect(parseMinor('1.000', 'de-DE', 'EUR')).toBe(100_000);
	});

	it('reads the locale’s own decimal point with three digits behind it as a decimal', () => {
		// the one ambiguous shape, and it is broken in the expensive direction: read as thousands,
		// this is a gift a thousand times the one the donor typed.
		expect(parseMinor('25.005', 'en-US', 'USD')).toBe(2501);
		expect(parseMinor('25,005', 'de-DE', 'EUR')).toBe(2501);
	});

	it('reads a grouped amount with a decimal part, either way round', () => {
		expect(parseMinor('1,234.56', 'en-US', 'USD')).toBe(123_456);
		expect(parseMinor('1.234,56', 'de-DE', 'EUR')).toBe(123_456);
	});

	it('ignores the symbol a donor pasted along with the number', () => {
		expect(parseMinor('$25.79', 'en-US', 'USD')).toBe(2579);
	});

	it('rounds the halfway case up, in the donor’s favour and never the org’s', () => {
		// the same direction ./fee.ts rounds: the org receives at least what the donor wrote.
		expect(parseMinor('25.0051', 'en-US', 'USD')).toBe(2501);
		expect(parseMinor('25.0049', 'en-US', 'USD')).toBe(2500);
	});

	it('takes a zero-decimal currency at face value', () => {
		expect(parseMinor('2500', 'ja-JP', 'JPY')).toBe(2500);
	});

	it('reads a leading decimal point', () => {
		expect(parseMinor('.5', 'en-US', 'USD')).toBe(50);
	});

	it('refuses an empty field', () => {
		expect(parseMinor('', 'en-US', 'USD')).toBeNull();
	});

	it('refuses a field with no digit in it at all', () => {
		expect(parseMinor('abc', 'en-US', 'USD')).toBeNull();
	});

	it('refuses a number too large to be an exact integer', () => {
		// a `NaN` or an imprecise integer reaching `SET_AMOUNT` is an amount the bounds check in
		// ./value.ts compares falsely in both directions.
		expect(parseMinor('9007199254740993', 'en-US', 'USD')).toBeNull();
	});
});
