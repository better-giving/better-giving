// minor units as a donor reads them, and back again.
//
// every figure this component paints comes through here: the tile amounts, the receipt rows, the
// total on the control that spends it. one module, so the button and the fee line cannot state
// the same amount two ways.
//
// there is one deliberate second way and it is stated here rather than discovered: a preset tile
// drops a fraction that is all zeroes and every other figure keeps it. a tile is an offer and a
// receipt row is a statement, and `formatOffer` below is the only entry point that may be used for
// the first. the bounds the amount sentence names are offers too — what the org will accept, not
// what anyone is charged. anything a donor is charged against goes through `formatMinor`.
//
// `formatFigure` is a third way and is not a third precision: it is the offer's, without the
// currency. the one box that carries its currency as marks around itself rather than inside itself
// is the amount entry, and it is the only caller.
//
// the currency and the locale are untrusted JSON. they arrive from `/api/v1` into code running on
// a stranger's page, and `Intl.NumberFormat` throws a `RangeError` on a currency that is not a
// three-letter code or a locale tag it cannot parse. a throw here would stop a donation form from
// rendering at all, so every entry point degrades instead: the org's own locale, then `en-US`,
// then a plain decimal with the code in front of it.
//
// the number of minor units is the currency's, never two. `USD` divides by 100, `JPY` by 1 and
// `KWD` by 1000, and `Intl` already knows which — so the exponent is read back off the resolved
// formatter rather than being a constant here that is wrong for two currencies out of three.
//
// imports nothing. this file is in the same directory as ./v1.ts and under the same rule: no
// framework, no DOM, no network.
//
// `../package.json` exports this module as `./money`. the deployment's own donation page states
// these same figures on this same card, and the deliberate second precision above is why it may not
// format them itself: an offer and a statement round differently, and that distinction only holds
// while there is one module deciding it.

/** the resolved formatters, keyed by the pair that produced them. */
const FORMATTERS = new Map<string, Intl.NumberFormat | null>();

/**
 * a currency formatter for this locale, or `null` when neither it nor the fallback can be built.
 *
 * tries the org's locale first, then `en-US` with the same currency — a locale tag this project
 * cannot parse is a formatting preference, while the currency is the unit the money is in, so the
 * locale is what gets dropped. both failing means the currency itself is unusable.
 *
 * `minimumFractionDigits` is what tells a statement from an offer, and it is part of the key: the
 * two formatters are different objects for the same pair, and one cache entry serving both would
 * hand whichever was built first to both callers.
 */
function formatterFor(
	locale: string,
	currency: string,
	minimumFractionDigits?: number
): Intl.NumberFormat | null {
	const options = { style: 'currency', currency, minimumFractionDigits } as const;
	const key = `${locale} ${currency} ${minimumFractionDigits ?? ''}`;
	const cached = FORMATTERS.get(key);
	if (cached !== undefined) return cached;

	let formatter: Intl.NumberFormat | null;
	try {
		formatter = new Intl.NumberFormat(locale, options);
	} catch {
		try {
			formatter = new Intl.NumberFormat('en-US', options);
		} catch {
			formatter = null;
		}
	}
	FORMATTERS.set(key, formatter);
	return formatter;
}

/**
 * how many minor units make one major unit, as a power of ten.
 *
 * two for most currencies, zero for `JPY`, three for `KWD`. read off the formatter rather than
 * assumed, because the assumption is what turns a ¥2,500 gift into ¥25.
 */
export function minorUnitDigits(locale: string, currency: string): number {
	const formatter = formatterFor(locale, currency);
	if (formatter === null) return 2;
	const { maximumFractionDigits: digits } = formatter.resolvedOptions();
	return typeof digits === 'number' && Number.isInteger(digits) && digits >= 0 ? digits : 2;
}

/**
 * a minor-unit amount as the donor's own currency string.
 *
 * a non-finite or fractional input yields an empty string rather than `NaN` on a screen asking
 * for money — the caller renders nothing, which is recoverable, instead of a figure that is not
 * one.
 */
export function formatMinor(amountMinor: number, locale: string, currency: string): string {
	if (!Number.isFinite(amountMinor)) return '';
	const digits = minorUnitDigits(locale, currency);
	const major = amountMinor / 10 ** digits;
	const formatter = formatterFor(locale, currency);
	if (formatter === null) return `${currency} ${major.toFixed(digits)}`;
	return formatter.format(major);
}

/**
 * a minor-unit amount as a preset tile offers it: `formatMinor`'s figure with a zero fraction gone.
 *
 * a tile is an offer and a receipt row is a statement, which is the whole of the split. `$25.00` on
 * a shortcut past the free entry states a precision the org never offered, and states it four
 * glyphs wide on the narrowest box on the card; `$25.00` on the line a donor is charged against is
 * the amount leaving their account. an amount that carries real cents keeps them either way, so a
 * `$27.50` tile is unchanged.
 *
 * the exponent is the currency's, as it is everywhere in this file: what comes off a `KWD` figure
 * is three digits and what comes off a `JPY` one is nothing at all.
 */
export function formatOffer(amountMinor: number, locale: string, currency: string): string {
	if (!Number.isFinite(amountMinor)) return '';
	const digits = minorUnitDigits(locale, currency);
	const unit = 10 ** digits;
	if (amountMinor % unit !== 0) return formatMinor(amountMinor, locale, currency);
	const major = amountMinor / unit;
	const formatter = formatterFor(locale, currency, 0);
	if (formatter === null) return `${currency} ${major}`;
	return formatter.format(major);
}

/**
 * a minor-unit amount as the figure alone, for the one box that carries its currency elsewhere.
 *
 * the amount entry draws the symbol and the code as marks at either end of itself (../views.ts), so
 * a figure written into it through `formatMinor` or `formatOffer` above would state the currency
 * twice — and would state it in the middle of a value a donor is about to edit.
 *
 * an offer's precision rather than a statement's, for the same reason a tile has it: what a press on
 * a `$25` tile writes here is `25`, which is what a donor typing that amount would have written. it
 * is `Intl` rather than a `toFixed`, so the decimal character is the locale's — `parseMinor` below
 * reads back exactly what this writes, in every locale it writes it for, and "writes a figure the
 * box itself would read back" in ../element.dom.spec.ts is the round trip.
 *
 * the grouping is the one thing it does not take from the locale, and the option below argues it.
 *
 * degrades the way every entry point in this file does: a locale `Intl` cannot parse falls to
 * `en-US`, and a currency it cannot parse falls to a plain decimal — with no code in front of it
 * here, because a code inside this box is the thing the split exists to avoid.
 */
export function formatFigure(amountMinor: number, locale: string, currency: string): string {
	if (!Number.isFinite(amountMinor)) return '';
	const digits = minorUnitDigits(locale, currency);
	const unit = 10 ** digits;
	const major = amountMinor / unit;
	const fraction = amountMinor % unit === 0 ? 0 : digits;
	const options = {
		// latin digits, whatever the locale's own numbering system is, because `parseMinor` below
		// reads `\d` and `\d` is `[0-9]` — a figure written into the box in Arabic-Indic digits is
		// one the box cannot read back, and the amount would be taken as `null` on the keystroke
		// after. this is the one entry point in this file whose output is read again rather than
		// only shown, so it is the only one that asks.
		numberingSystem: 'latn',
		// and no grouping, which is the other half of the same rule and not a second format. a tile
		// keeps its separators — `$1,000` there is a label, and a label is read rather than edited —
		// but this goes into a text box a donor puts a caret into, where a separator the field
		// inserted is the one character in the value that nothing they typed put there: it moves the
		// caret, and it reformats under them mid-word.
		//
		// grouping only. the decimal character stays the locale's, so a `de-DE` deployment still
		// writes `1000,50` and `parseMinor` below still reads it back — the round trip is swept in
		// both directions in ./money.spec.ts, which is where the thousandths defect was caught.
		useGrouping: false,
		minimumFractionDigits: fraction,
		maximumFractionDigits: digits
	} as const;
	try {
		return new Intl.NumberFormat(locale, options).format(major);
	} catch {
		try {
			return new Intl.NumberFormat('en-US', options).format(major);
		} catch {
			return major.toFixed(fraction);
		}
	}
}

/**
 * the symbol this locale writes the currency with, or the code itself where it writes no symbol.
 *
 * the free entry's leading mark, and the reason it is conditional: `en-US` writes `USD` as `$` and
 * `CHF` as `CHF`, so a card that drew this at the start of the box and the code at the end of it
 * would state the currency twice on the currencies with no symbol of their own. ../views.ts draws
 * the mark only where the two differ.
 */
export function currencySymbol(locale: string, currency: string): string {
	const code = currency.toUpperCase();
	const formatter = formatterFor(locale, currency);
	if (formatter === null) return code;
	return formatter.formatToParts(0).find((piece) => piece.type === 'currency')?.value ?? code;
}

/**
 * the character this locale writes a decimal point with, in the digits the box is read in.
 *
 * `latn` for the reason `formatFigure` above states it: this answer is compared against what came
 * out of a text box, and `parseMinor` below has already stripped everything but `[\d.,]` from that.
 * a locale whose own numbering system is not latin writes a decimal separator this comparison can
 * never see — `ar-KW` writes `٫` — so asked without it, the tie-break below reads every `KWD` amount
 * carrying thousandths as a thousands group, which is a gift a thousand times the one that was
 * written.
 *
 * `.` when the locale cannot be parsed, which is the same direction `formatMinor` degrades in.
 */
function decimalSymbol(locale: string): string {
	try {
		const parts = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).formatToParts(1000.5);
		return parts.find((piece) => piece.type === 'decimal')?.value ?? '.';
	} catch {
		return '.';
	}
}

/**
 * what a donor typed, as minor units, or `null` when it is not an amount.
 *
 * what follows the separator decides, and the locale breaks the one tie. the field takes
 * `inputmode="decimal"`, so what arrives is whatever the donor's own keyboard offers on a page
 * that may be in a different language from their phone: `1,234.56` and `1.234,56` both turn up,
 * and so does `25,79` from a German donor on an English page. so a separator with one, two or
 * four-plus digits behind it is a decimal point whatever character it is — no thousands group is
 * ever that long — and only a separator with exactly three digits behind it is ambiguous. that
 * one case asks the locale which character it writes a decimal point with, which is what tells
 * `25.005` and `1,000` apart in `en-US` and `25,005` and `1.000` apart in `de-DE`.
 *
 * the tie-break matters in the expensive direction: read as thousands, `25.005` would send
 * `SET_AMOUNT` a gift a thousand times the one the donor typed.
 *
 * rounds the halfway case up, exactly as the fee gross-up in ./fee.ts does, so that a donor who
 * types more precision than the currency has is never charged less than they wrote.
 *
 * returns `null` rather than throwing or coercing. this feeds `SET_AMOUNT`, and a `NaN` reaching
 * the flow is an amount the bounds check in ./value.ts would let through as a comparison that is
 * false in both directions.
 */
export function parseMinor(text: string, locale: string, currency: string): number | null {
	const cleaned = text.replace(/[^\d.,]/g, '');
	if (cleaned.length === 0) return null;

	const lastSeparator = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
	const tail = lastSeparator === -1 ? '' : cleaned.slice(lastSeparator + 1);
	const groups =
		lastSeparator === -1 ||
		(/^\d{3}$/.test(tail) && cleaned[lastSeparator] !== decimalSymbol(locale));

	const whole = (groups ? cleaned : cleaned.slice(0, lastSeparator)).replace(/[.,]/g, '');
	const fraction = groups ? '' : tail;
	if (whole.length === 0 && fraction.length === 0) return null;
	if (!/^\d*$/.test(fraction)) return null;

	const digits = minorUnitDigits(locale, currency);
	const padded = fraction.padEnd(digits, '0');
	const minor = Number(`${whole.length === 0 ? '0' : whole}${padded.slice(0, digits)}`);
	if (!Number.isSafeInteger(minor)) return null;

	const dropped = padded[digits];
	return dropped !== undefined && Number(dropped) >= 5 ? minor + 1 : minor;
}
