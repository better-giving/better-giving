// how a stored amount is shown, in the one place both a `load` and a component may import from.
//
// money is stored as an integer number of minor units and every sum in this app is taken over
// those integers; what happens here is the last step before a screen, and no result of it is ever
// read back as a number.
//
// how wide a currency's minor unit is comes out of the same formatter the figure does, which is
// what keeps a screen and the box an operator types into from disagreeing about how many decimal
// places one gift has — `$lib/forms/amounts.ts` reads it from here for the boxes.

/**
 * the locale every figure in /admin is formatted in.
 *
 * fixed rather than negotiated from the request. nothing in this app selects a language, so a
 * locale taken from an `Accept-Language` header would be the browser's rather than the
 * organisation's — the same gift would read `$1,234.56` to one staff member and `1.234,56 $` to
 * another, and a figure copied out of one screen into an email would not match the next. it also
 * makes the string a `load` renders on the Worker the string a browser would render, which is what
 * keeps this out of the hydration mismatch an `Intl` call inside a component is.
 */
const DISPLAY_LOCALE = 'en-US';

/**
 * how many minor units make one major unit, as a power of ten.
 *
 * two for most currencies, none for JPY, three for KWD — and it is read back out of the formatter
 * rather than assumed, because the assumption is what turns a ¥2,500 gift into ¥25.
 *
 * the type declares it optional — a formatter built without `style: 'currency'` may resolve no
 * digit count at all — and this one always resolves it. two is the exponent of every currency but a
 * handful, so it is the fallback that is wrong least often on a branch that is not reachable from
 * here.
 */
export function minorUnitDigits(currency: string): number {
	const format = new Intl.NumberFormat(DISPLAY_LOCALE, { style: 'currency', currency });
	return format.resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * a stored amount, as a screen shows it.
 *
 * the currency decides the exponent, and it is read back out of the formatter rather than assumed
 * to be two: JPY has none, and a yen amount divided by a hundred is a gift a hundredth of its size
 * with nothing on the page disagreeing about it.
 *
 * the division is the one and only place a stored amount becomes a float, and it is the last one —
 * the result is a string. the input is an integer well inside the exactly-representable range and
 * the quotient is rounded straight back to the currency's own digits, so the value shown is the
 * value stored. nothing computed here is ever added, compared or written back.
 *
 * `currency` is a three-letter code because the column's check constraint makes it one (see
 * `donation` in `$lib/server/db/schema.ts`); a code no currency uses formats as itself rather than
 * throwing, which is the right answer for a figure whose job is to be reconciled against a
 * statement.
 */
export function formatMinor(amountMinor: number, currency: string): string {
	const format = new Intl.NumberFormat(DISPLAY_LOCALE, { style: 'currency', currency });
	return format.format(amountMinor / 10 ** minorUnitDigits(currency));
}

/**
 * a stored amount as an operator wrote it: the currency's full width when there are minor units,
 * and none when there are not — `$20` for what was typed as `20`, `$20.50` for `20.50`.
 *
 * for a message that echoes a bound back at the box beside it. the screen shows a figure at full
 * width (`formatMinor` above); a message repeating a figure the operator typed shows it the way
 * they typed it, and decimals nobody wrote are what makes `$20.00` read as somebody else's number.
 * the arithmetic is `formatMinor`'s, and the same last step.
 */
export function formatMinorBrief(amountMinor: number, currency: string): string {
	const digits = minorUnitDigits(currency);
	const whole = amountMinor % 10 ** digits === 0;
	const format = new Intl.NumberFormat(DISPLAY_LOCALE, {
		style: 'currency',
		currency,
		...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {})
	});
	return format.format(amountMinor / 10 ** digits);
}
