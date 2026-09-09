import { ADMIN_TOKENS } from '@better-giving/operator/styles/tokens';

// the operator design system, in the values a mail client can actually render.
//
// the system is one file — packages/operator/src/styles/tokens.css — and this package reads it
// through the copy beside it, packages/operator/src/styles/tokens.ts, which is the same values as
// css text. no value is decided here and none may be: what this module does is convert. a screen
// hands the browser `var(--admin-ink)` and the browser resolves a custom property, an `oklch()` and
// a `rem` for it. a mail has none of that. it is a set of inline style attributes read by clients
// whose css support was fixed years ago — Outlook desktop renders through Word — so what a template
// writes has to be a six-digit hex triple and a pixel count, already resolved.
//
// two conversions and one shorthand, and every value a template writes comes out of them. a number
// a template states for itself is the thing this module exists to make unnecessary: react writes
// `px` after a unitless number in a style object, so `padding: 16` and `padding: '16px'` are the
// same declaration and only one of them is a value somebody chose in this file.

/** what a `rem` resolves against.
 *
 * the browser's default, because that is what the operator surfaces resolve one against too:
 * packages/operator/src/styles/base.css states that the document root's font-size may not move, so
 * a rem there and a rem here are the same length. */
const ROOT_FONT_SIZE = 16;

/**
 * a css length as the pixel count a style object states.
 *
 * `rem` and `px` are the two units ../../operator/src/styles/tokens.css writes, and anything else
 * throws rather than resolving to something: a mail rendered with a silently dropped size is a mail
 * nobody sees go wrong.
 */
export function pxFromLength(value: string): number {
	const rem = /^(-?[\d.]+)rem$/.exec(value);
	if (rem?.[1]) return Number(rem[1]) * ROOT_FONT_SIZE;
	const px = /^(-?[\d.]+)px$/.exec(value);
	if (px?.[1]) return Number(px[1]);
	throw new Error(`not a length this converts: ${value}`);
}

/** the sRGB transfer function — linear light to the encoded channel. */
const encode = (channel: number) =>
	channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

const channelHex = (channel: number) =>
	Math.min(255, Math.max(0, Math.round(encode(channel) * 255)))
		.toString(16)
		.padStart(2, '0');

/**
 * an `oklch()` colour as the six-digit sRGB hex a mail client understands.
 *
 * the arithmetic is CSS Color 4's (https://www.w3.org/TR/css-color-4/#color-conversion-code):
 * oklch to oklab by polar coordinates, oklab to LMS and cube to linear sRGB through the published
 * matrices, then the transfer function above. ./tokens.spec.ts checks it against the three sRGB
 * primaries, whose oklch coordinates that specification publishes and whose hex everyone knows.
 *
 * out of gamut is clipped per channel rather than reduced in chroma, and the difference does not
 * arise: every colour the operator system authors is inside sRGB — its own screens are drawn in it
 * by a browser doing this same conversion, so a colour that needed real gamut mapping would already
 * be a different colour on /admin than the file states.
 */
export function hexFromOklch(value: string): string {
	const parsed = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
	if (!parsed) throw new Error(`not an oklch colour this converts: ${value}`);
	const [lightness, chroma, hue] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];

	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);

	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`;
}

/**
 * a `margin` or `padding` shorthand from pixel counts.
 *
 * a shorthand rather than four longhands because a mail states its box in one declaration and a
 * client that keeps one declaration keeps the whole box with it. a zero is written bare, as css
 * writes it.
 */
export const box = (...sides: number[]) =>
	sides.map((side) => (side === 0 ? '0' : `${side}px`)).join(' ');

// ---- the values a template writes ----------------------------------------------------------
//
// every one is a token converted, and the name says the job rather than the rung. what each is for
// is at its own line where the choice was not the obvious one.

/** the ground the document is read on, and the two a block inside it sits on. */
export const PAGE_BG = hexFromOklch(ADMIN_TOKENS['--admin-page']);
/** the receipt's own block: a ground, and no rule around it. */
export const PANEL_BG = hexFromOklch(ADMIN_TOKENS['--admin-surface-sunken']);
/** the heavier band under the §6115 disclosure and the alert's instruction — a step darker. */
export const BLOCK_BG = hexFromOklch(ADMIN_TOKENS['--admin-surface-fill']);

export const INK = hexFromOklch(ADMIN_TOKENS['--admin-ink']);
/** the small print under the rule: real text, and the rung the system cut to carry it. */
export const INK_MUTED = hexFromOklch(ADMIN_TOKENS['--admin-ink-muted']);
export const DIVIDER = hexFromOklch(ADMIN_TOKENS['--admin-divider']);
export const LINK = hexFromOklch(ADMIN_TOKENS['--admin-link']);

export const FONT_SANS = ADMIN_TOKENS['--admin-font-sans'];
export const FONT_MONO = ADMIN_TOKENS['--admin-font-mono'];

/** what a mail is read at. a step of the scale and not `--admin-body-size`, which is 14px because
 * an operator screen is dense; a mail is a document in somebody's client. */
export const TEXT_BODY = pxFromLength(ADMIN_TOKENS['--admin-text-md']);
/** the small print, and the machine-readable facts on an alert. */
export const TEXT_SMALL = pxFromLength(ADMIN_TOKENS['--admin-text-base']);
export const TEXT_HEADING = pxFromLength(ADMIN_TOKENS['--admin-text-lg']);
/** an id somebody reads character by character. the system sets code a step under the small print
 * and this is that step. */
export const TEXT_CODE = pxFromLength(ADMIN_TOKENS['--admin-code-size']);

export const LH_BODY = Number(ADMIN_TOKENS['--admin-lh-body']);
export const LH_HEADING = Number(ADMIN_TOKENS['--admin-lh-heading']);
export const LH_CODE = Number(ADMIN_TOKENS['--admin-code-lh']);
export const WEIGHT_BOLD = Number(ADMIN_TOKENS['--admin-weight-bold']);

export const SPACE_2 = pxFromLength(ADMIN_TOKENS['--admin-space-2']);
export const SPACE_4 = pxFromLength(ADMIN_TOKENS['--admin-space-4']);
export const SPACE_6 = pxFromLength(ADMIN_TOKENS['--admin-space-6']);
export const SPACE_8 = pxFromLength(ADMIN_TOKENS['--admin-space-8']);

export const BORDER_WIDTH = pxFromLength(ADMIN_TOKENS['--admin-border-width']);
/** 2px is state rather than structure in this system, and the disclosure's border is exactly that:
 * the one block on the page whose prominence is a statutory standard. */
export const BORDER_WIDTH_STRONG = pxFromLength(ADMIN_TOKENS['--admin-border-width-strong']);
/** the band a block carries at one edge, which is what the alert's instruction wears. */
export const EDGE = pxFromLength(ADMIN_TOKENS['--admin-edge']);
/** the measure the document is read at. the system's measures are screen columns and none of them
 * is a mail's; this is the one that lands where a line of body type stops being comfortable. */
export const MEASURE = pxFromLength(ADMIN_TOKENS['--admin-measure-dialog']);
