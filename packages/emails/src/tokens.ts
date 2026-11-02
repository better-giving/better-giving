import { ADMIN_TOKENS } from '@better-giving/operator/styles/tokens';

// the operator design system, in the values a mail client can actually render.
//
// the system is one file — packages/operator/src/styles/tokens.css — and this package reads it
// through the copy beside it, packages/operator/src/styles/tokens.ts, which is the same values as
// css text. no value is decided here and none may be: what this module does is check and convert.
// a screen hands the browser `var(--admin-ink)` and the browser resolves a custom property and a
// `rem` for it. a mail has none of that. it is a set of inline style attributes read by clients
// whose css support was fixed years ago — Outlook desktop renders through Word — so what a template
// writes has to be a six-digit hex triple and a pixel count, already resolved.
//
// one check, one conversion and one shorthand, and every value a template writes comes out of
// them. a number a template states for itself is the thing this module exists to make unnecessary:
// react writes `px` after a unitless number in a style object, so `padding: 16` and `padding: '16px'` are the
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

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * a colour as the six-digit hex a mail client understands.
 *
 * ../../operator/src/styles/tokens.css writes every colour a mail reads as radix's published hex, so
 * nothing is converted and this only refuses what a client could not render: a short hex, an alpha
 * channel, a colour function, a `var()`. lowercase, so a rendered attribute is one spelling.
 */
export function hexColour(value: string): string {
	if (!HEX_COLOUR.test(value)) throw new Error(`not a six-digit hex colour: ${value}`);
	return value.toLowerCase();
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
// every one is a token checked or converted, and the name says the job rather than the step. what
// each is for is at its own line where the choice was not the obvious one.

/** the ground the document is read on, the plane its body sits on, and the two a block on that
 * plane sits on. */
export const PAGE_BG = hexColour(ADMIN_TOKENS['--admin-page']);
/** a mail's body is one group, and one group is one plane: the system's plane step on the page's,
 * with the step-6 edge every operator plane draws and no shadow. */
export const PLANE_BG = hexColour(ADMIN_TOKENS['--admin-surface']);
/** the receipt's own block: a ground, and no rule around it. */
export const PANEL_BG = hexColour(ADMIN_TOKENS['--admin-surface-sunken']);
/** the band under the §6115 disclosure, step 3, two steps off the plane. */
export const BLOCK_BG = hexColour(ADMIN_TOKENS['--admin-surface-fill']);
/** the alert's instruction, set as `.adm-banner` sets a note: the tint carries it, no edge does. */
export const BANNER_BG = hexColour(ADMIN_TOKENS['--admin-tone-note-tint']);

export const INK = hexColour(ADMIN_TOKENS['--admin-ink']);
/** the small print under the rule: real text, on the low-contrast text step, slate 11. */
export const INK_MUTED = hexColour(ADMIN_TOKENS['--admin-ink-muted']);
export const DIVIDER = hexColour(ADMIN_TOKENS['--admin-divider']);
export const LINK = hexColour(ADMIN_TOKENS['--admin-link']);
/** a literal set in a sentence — a destination's address — on the ground the system gives code. */
export const CODE_BG = hexColour(ADMIN_TOKENS['--admin-code-bg']);
export const CODE_INK = hexColour(ADMIN_TOKENS['--admin-code-ink']);

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

export const SPACE_1 = pxFromLength(ADMIN_TOKENS['--admin-space-1']);
export const SPACE_2 = pxFromLength(ADMIN_TOKENS['--admin-space-2']);
export const SPACE_4 = pxFromLength(ADMIN_TOKENS['--admin-space-4']);
export const SPACE_6 = pxFromLength(ADMIN_TOKENS['--admin-space-6']);
export const SPACE_8 = pxFromLength(ADMIN_TOKENS['--admin-space-8']);

export const BORDER_WIDTH = pxFromLength(ADMIN_TOKENS['--admin-border-width']);
/** 2px is state rather than structure in this system, and the disclosure's border is exactly that:
 * the one block on the page whose prominence is a statutory standard. */
export const BORDER_WIDTH_STRONG = pxFromLength(ADMIN_TOKENS['--admin-border-width-strong']);
/** the corner of a control, a literal set in a sentence, and a banner. */
export const RADIUS = pxFromLength(ADMIN_TOKENS['--admin-radius']);
/** the corner of a plane and of a block set on one. */
export const RADIUS_PLANE = pxFromLength(ADMIN_TOKENS['--admin-radius-plane']);
/** the measure the document is read at. the system's measures are screen columns and none of them
 * is a mail's; this is the one that lands where a line of body type stops being comfortable. */
export const MEASURE = pxFromLength(ADMIN_TOKENS['--admin-measure-dialog']);
