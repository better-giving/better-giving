// the two hues a page's palette draws its section grounds at, worked out where the page is
// rendered and handed to the page root as inline custom properties. css reads them and holds the
// rest: the lightness and chroma of every ground are $lib/donate/page.css's, off the form's `--_p`.
//
// they are computed here rather than in the sheet because each one is a condition on a number —
// a hue landing in the window below moves out of it — and a relative colour can do arithmetic on a
// channel but cannot branch on one.
//
// pure, and not under `$lib/server/**`: the page root that writes them is a component.

import type { Palette } from './keys';

// the error red (`--_bad`, hue 27) through the warning amber (`--_warn-*`, hue 85) in
// packages/form/src/styles/tokens.css, with room either side. a section ground in there reads as a
// refusal or a caution band rather than as the organisation's colour: a tint ground off a red brand
// is 0.972 lightness at hue 27, which is `--_bad-tint` give or take a trace of chroma.
const WINDOW_FROM = 2;
const WINDOW_TO = 105;
const OUT_OF_WINDOW = 115;

const SHIFT: Partial<Record<Palette, number>> = { duo: 150, bright: 60 };

const turn = (hue: number) => ((hue % 360) + 360) % 360;

/** a hue off the red-through-amber window: one landing from 2° to 105° inclusive draws at 115°. */
export function groundHue(hue: number): number {
	return hue >= WINDOW_FROM && hue <= WINDOW_TO ? OUT_OF_WINDOW : hue;
}

/**
 * the second hue a palette draws a ground at: the brand's plus 150 on `duo` and plus 60 on
 * `bright`, off the window. `null` on a palette that draws every ground at the brand's own hue.
 */
export function pageHue2(brandHue: number, palette: Palette): number | null {
	const shift = SHIFT[palette];
	return shift === undefined ? null : groundHue(turn(brandHue + shift));
}

const decode = (channel: number) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

export type Oklch = { l: number; c: number; h: number };

/**
 * a `#rrggbb` colour in oklch, hue in degrees from 0 up to 360, by
 * https://bottosson.github.io/posts/oklab/'s matrices.
 */
export function oklchFromHex(hex: string): Oklch {
	const channel = (at: number) => decode(Number.parseInt(hex.slice(at, at + 2), 16) / 255);
	const [r, g, b] = [channel(1), channel(3), channel(5)];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		c: Math.hypot(A, B),
		h: turn((Math.atan2(B, A) * 180) / Math.PI)
	};
}

/**
 * the oklch hue of a brand colour — the `h` the browser reads off `--donate-primary`, which the
 * fill band in packages/form/src/styles/tokens.css passes through untouched. a grey has no hue and
 * reads as whatever its rounding leaves; every ground drawn at it takes the grey's zero chroma, so
 * the number is never seen.
 */
export function brandHue(hex: string): number {
	return oklchFromHex(hex).h;
}
