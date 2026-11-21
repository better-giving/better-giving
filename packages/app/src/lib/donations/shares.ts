// how a pledged share count travels: as decimal text on the wire and the screen, as an integer of
// millionths in `pledge.shares_millionths` (../server/db/schema.ts), for the reason money is minor
// units. in the one place a `load`, a component and the mail may import from.

/** the decimal places a fractional share is quoted to, and the width of a millionth. */
export const SHARE_DECIMALS = 6;
const MILLIONTHS = 10 ** SHARE_DECIMALS;

/**
 * the most shares one pledge may name: ten million. far past any gift a donor makes, and its
 * millionths stay well inside `Number.MAX_SAFE_INTEGER`, so the count is exact on both sides.
 */
export const MAX_SHARES = 10_000_000;

/** digits, then at most six decimals after a point: no sign, no exponent, no separators. */
const SHARES_TEXT = new RegExp(`^(\\d+)(?:\\.(\\d{1,${SHARE_DECIMALS}}))?$`);

/**
 * a share count typed as decimal text, in millionths — or `null` where it is not a plain decimal of
 * at most six places, is zero, or is past `MAX_SHARES`. no float is ever involved: `0.1` shares is
 * `100000`, not whatever `0.1 * 1e6` rounds to.
 */
export function sharesFromText(text: string): number | null {
	const match = SHARES_TEXT.exec(text);
	if (match === null) return null;
	const [, whole = '', fraction = ''] = match;
	const wholeShares = Number(whole);
	if (wholeShares > MAX_SHARES) return null;
	const millionths = wholeShares * MILLIONTHS + Number(fraction.padEnd(SHARE_DECIMALS, '0'));
	return millionths > 0 && millionths <= MAX_SHARES * MILLIONTHS ? millionths : null;
}

/** millionths as the shortest decimal text that states them: `50`, `12.5`, `0.000001`. */
export function sharesText(millionths: number): string {
	const whole = Math.floor(millionths / MILLIONTHS);
	const fraction = String(millionths % MILLIONTHS)
		.padStart(SHARE_DECIMALS, '0')
		.replace(/0+$/, '');
	return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}
