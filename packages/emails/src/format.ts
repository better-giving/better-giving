// how money and dates are spelled on an email that leaves this deployment.
//
// kept out of the templates so the receipt and the alert cannot disagree about what a
// number looks like, and kept out of `$lib` because nothing on a screen shares it: a page
// formats in the browser's locale for the person reading it, and a receipt cannot — see
// below.

/** the ISO-4217 shape `donation.currency`'s check already enforces at the database. */
const CURRENCY = /^[A-Z]{3}$/;

/**
 * the one locale, pinned, and not the reader's.
 *
 * an email has no `Accept-Language` and this app stores no locale for anyone, so there is
 * nothing to negotiate — the choice is between one pinned locale and a formatter that
 * silently follows whatever the Worker's default resolves to. pinned wins: a receipt is a
 * document two people (a donor and their tax authority) read later, and a figure that
 * formats differently depending on which isolate rendered it is the kind of difference
 * nobody notices until it matters.
 */
const LOCALE = 'en-US';

/**
 * minor units -> a figure a donor can hand to their tax authority.
 *
 * `currencyDisplay: 'code'` — `USD 100.00`, never `$100.00`. the symbol is ambiguous across
 * four currencies this app can legitimately hold and the code is ambiguous across none, and
 * a receipt is exactly the document where "which dollar" is a real question.
 *
 * the exponent comes from the currency, not from `/ 100`. minor units are not always
 * hundredths — JPY and KRW have none, and dividing one of those by 100 understates a gift by
 * two orders of magnitude on a document somebody files. `resolvedOptions()` is where ICU
 * already knows the answer, so there is no table to maintain here and no currency this app
 * has not heard of.
 *
 * an unusable currency code falls back rather than throwing: this is called from a template,
 * templates do not throw (see ./templates/receipt.tsx), and `Intl.NumberFormat` raises a
 * `RangeError` on a malformed code. the database check means the fallback is unreachable
 * from a stored row; it exists so that reaching it prints a wrong-looking number instead of
 * killing a send.
 *
 * the code is uppercased before it is tested. the pattern is anchored uppercase, so an
 * unnormalised `'jpy'` fails it and takes the fallback — which is the one float path in this
 * function and hard-codes hundredths, printing `jpy 100.00` for a gift of ¥10,000. the fallback
 * exists for a value that is not a currency code at all, not for one whose case is wrong, and
 * `Intl` accepts either case anyway.
 */
export function formatMoney(minorUnits: number, currency: string): string {
	const code = currency.toUpperCase();
	// the fallback quotes what was actually stored, not the normalised form: it prints only
	// when the value is not a currency code, and the point is to show the operator their value.
	if (!CURRENCY.test(code)) return `${currency} ${(minorUnits / 100).toFixed(2)}`;

	const formatter = new Intl.NumberFormat(LOCALE, {
		style: 'currency',
		currency: code,
		currencyDisplay: 'code'
	});
	const digits = formatter.resolvedOptions().minimumFractionDigits ?? 2;
	// ICU separates the code from the number with U+00A0, a non-breaking space, and it is
	// normalised away here rather than left in. this string is pasted into spreadsheets and
	// searched for by donors and their accountants, and an invisible character that is not
	// the space it looks like turns `USD 100.00` into a value a `find` cannot match. it also
	// keeps the two branches of this function producing the same shape.
	return formatter.format(minorUnits / 10 ** digits).replaceAll('\u00A0', ' ');
}

/**
 * the business date of a gift, spelled out — `January 5, 2026`, never `01/05/2026`, which
 * reads as the 1st of May to most of the world. the month-first order is `LOCALE`'s, and the
 * specs assert it.
 *
 * `timeZone: 'UTC'` is not a default, it is the encoding. every time column in this schema is
 * Unix ms UTC (CLAUDE.md), and a formatter left to the runtime's zone would render a gift
 * received at 23:30 UTC on the 31st as the 1st of the next month — moving it into the wrong
 * tax year on the one document where the year is the point.
 */
export function formatDate(at: Date): string {
	return new Intl.DateTimeFormat(LOCALE, {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(at);
}
