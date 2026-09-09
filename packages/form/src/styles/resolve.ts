// the ramp, read off a live cascade and handed to ./appearance.ts.
//
// ./appearance.ts names tokens and never colors, and says its caller must give it resolved
// values. this is that caller. the `--_` steps are unregistered custom properties, so
// `getPropertyValue('--_p')` hands back the `oklch(from …)` expression rather than a color;
// every read here assigns the token to a standard property on a probe element and reads that
// property back, which is the only way a computed color exists at all.
//
// colors leave here as sRGB `rgb(r, g, b)` rather than in the space they are authored in. two
// reasons, and the first is the load-bearing one: the appearance object is parsed by the
// provider's own code inside its own frame, which derives further shades from what it is given —
// a color notation it cannot parse is not a wrong color, it is no color, and the field renders
// on a default with nothing on screen saying why. the second is that this is what a browser
// paints anyway, so the conversion is the same one the card itself goes through.
//
// what that costs is stated rather than hidden: a brand seed outside the sRGB gamut is clipped
// on the way through the canvas, while the card paints it with the engine's own gamut mapping.
// the two can differ by a shade at extreme chroma. the alternative is handing over a notation
// that may not survive the frame boundary at all.

import { stripeAppearance, type StripeAppearance, type TokenReader } from './appearance';

/**
 * the tokens whose resolved value is a color.
 *
 * classified here rather than inferred, and ./resolve.spec.ts holds this partition to covering
 * every member of `APPEARANCE_INPUTS` — a token added to the map and not to one of these lists
 * otherwise arrives as an unresolved string instead of as a failure.
 */
const COLOR_TOKENS: readonly string[] = [
	'--_bad',
	'--_edge-control',
	'--_focus-ring',
	'--_n1',
	'--_n11',
	'--_n12',
	'--_n3',
	'--_p'
];

/**
 * the tokens whose resolved value is a length. read through a property the engine resolves to px.
 *
 * exported for ./resolve.browser.spec.ts, which holds every member of it to landing somewhere in
 * the appearance object as a px value — a carrier that reports the kind but hands the value back
 * unusably would otherwise fail silently, as every length quietly absent.
 */
export const LENGTH_TOKENS: readonly string[] = [
	'--_border',
	'--_focus-width',
	'--_inset',
	'--_r',
	'--_sp1',
	'--_sp3',
	'--_t-sm'
];

/**
 * the tokens whose resolved value is a bare number, which their carrier bounds to a weight.
 *
 * exported for ./resolve.browser.spec.ts, which holds every member of it to the weight
 * ./tokens.css states — the same guard `LENGTH_TOKENS` carries, for the same reason.
 */
export const NUMBER_TOKENS: readonly string[] = ['--_w-bold'];

/**
 * every token this module knows a carrier for, whatever kind it is.
 *
 * exported for ./resolve.spec.ts, which holds this to `APPEARANCE_INPUTS` in the node pool — the
 * one that gates a commit. nothing in production reads it: `carrier` below asks the three lists
 * directly, because what it needs is the kind and not the membership.
 */
export const CLASSIFIED_TOKENS: readonly string[] = [
	...COLOR_TOKENS,
	...LENGTH_TOKENS,
	...NUMBER_TOKENS
];

/**
 * the property each of the three kinds is resolved through.
 *
 * which property carries a kind is what decides how an unresolved token comes back, so it is not
 * free choice. a step invalid at computed-value time behaves as `unset`: on an inherited property
 * that is whatever the wrapper below sets, and on every other one it is that property's own initial
 * value. `padding-left` carries a length perfectly well and hands back `0px` for a token that never
 * resolved — a zero nothing downstream can tell from a corner or a border weight a host chose — so
 * a length is carried by an inherited property with a sentinel behind it, as a color is.
 *
 * `font-weight` is the same arrangement for the number kind, and what it can hold is what bounds
 * that kind. a number outside [1, 1000] is not clamped to fit: the declaration is invalid, so it
 * inherits, which is the sentinel, and the reader drops it. so a number token that is not a weight
 * — a line height, a ratio — would split on this carrier rather than fail on it, `1.5` arriving
 * intact where `0.9` never arrives at all and leaves the surface it fed unstyled with nothing
 * saying why. one needs a carrier of its own, and a sentinel to go with it.
 */
const CARRIERS = {
	color: 'color',
	length: 'text-indent',
	number: 'font-weight'
} as const;

/**
 * what the probe inherits, so that a token which did not resolve is visible as one.
 *
 * a step that is invalid at computed-value time takes the inherited value, and an inherited
 * color is a perfectly ordinary color — handed on it would be a wrong color rather than an
 * absent one, which is exactly what ./appearance.ts refuses to send. transparent is the one
 * value no step in ./tokens.css can ever hold, because no shade in this system is made by
 * lowering opacity, so it can stand in for "this did not resolve".
 */
const UNRESOLVED = 'rgba(0, 0, 0, 0)';

/**
 * the same sentinel for the length kind, and it stands on the same kind of impossibility.
 *
 * every length in `LENGTH_TOKENS` is non-negative and cannot be made otherwise from outside: the
 * only seed this element takes is a colour, and every length in ./tokens.css is a literal or a
 * positive multiple of a root clamped into `[15px, 18px]`. so a negative computed length is not a
 * token this form could ever have been given, and it is the one length that can stand for "this did
 * not resolve".
 *
 * compared exactly rather than by sign, because the value is read straight back off the computed
 * style: `text-indent` resolves to the computed value, not a used one, so what is written here is
 * what comes back.
 */
const UNRESOLVED_LENGTH = '-99999px';

/**
 * and the same again for the number kind, where the fallback is the most misleading of the three:
 * the weight a probe inherits from a host page's own text is `400`, which ./tokens.css declares as
 * `--_w-normal`. an unresolved weight would arrive as a step of this ramp.
 *
 * `1` is the floor the engine clamps a weight to and it is not a weight anything is set at — the
 * ramp is `--_w-normal` and `--_w-bold`, and text at `1` is text nobody can read. so it is the one
 * weight that can stand for "this did not resolve".
 */
const UNRESOLVED_WEIGHT = '1';

/**
 * one color as sRGB bytes, or `null` where nothing paintable was resolved.
 *
 * two sentinels rather than one. assigning an unparseable value to `fillStyle` is ignored and
 * leaves the previous one in place, so a single sentinel cannot tell a rejected value from a
 * value that happens to equal it — no color equals both.
 */
function bytes(context: CanvasRenderingContext2D, value: string): readonly number[] | null {
	const read = (sentinel: string): readonly number[] => {
		context.fillStyle = sentinel;
		context.fillStyle = value;
		context.clearRect(0, 0, 1, 1);
		context.fillRect(0, 0, 1, 1);
		const pixel = context.getImageData(0, 0, 1, 1).data;
		return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, pixel[3] ?? 0];
	};
	const first = read('#000000');
	const second = read('#ffffff');
	if (first[3] === 0) return null;
	return first[0] === second[0] && first[1] === second[1] && first[2] === second[2]
		? [first[0] ?? 0, first[1] ?? 0, first[2] ?? 0]
		: null;
}

/**
 * the appearance object for one mounted card, resolved once against the cascade it is in.
 *
 * `host` is any node inside the shadow root the token sheet is adopted into: the steps are
 * declared on `:host` and inherited, so a probe anywhere under it resolves them. the probe is
 * removed before this returns — nothing is left in the card that the card did not build.
 *
 * resolved at mount and never again. a host page that changes `--donate-primary` afterwards
 * gets a form that follows and provider fields that do not until the next mount, which
 * ./appearance.ts states as the accepted cost.
 */
export function resolveAppearance(host: HTMLElement): StripeAppearance {
	const doc = host.ownerDocument;
	const view = doc.defaultView;
	if (view === null) return stripeAppearance(() => '');

	// out of flow and invisible: these nodes exist to be measured, and a card that reflowed while
	// its own colors were being read would be reflowing on a stranger's page. the wrapper carries
	// nothing but the sentinel each kind falls back to, one per carrier.
	const HIDDEN = 'position:absolute;visibility:hidden;pointer-events:none;';
	const wrapper = doc.createElement('div');
	wrapper.style.cssText =
		`${HIDDEN}color:${UNRESOLVED};` +
		`text-indent:${UNRESOLVED_LENGTH};font-weight:${UNRESOLVED_WEIGHT};`;
	const probe = doc.createElement('div');
	wrapper.appendChild(probe);
	host.appendChild(wrapper);

	const canvas = doc.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d');

	const carrier = (property: string): string | null => {
		if (COLOR_TOKENS.includes(property)) return CARRIERS.color;
		if (LENGTH_TOKENS.includes(property)) return CARRIERS.length;
		if (NUMBER_TOKENS.includes(property)) return CARRIERS.number;
		return null;
	};

	const read: TokenReader = (property) => {
		const through = carrier(property);
		// a standard property needs no carrier: `font-size` and `font-family` are declared on
		// `:host` and reach the probe by inheritance already resolved.
		probe.style.cssText = through === null ? '' : `${through}: var(${property});`;
		const resolved = view.getComputedStyle(probe).getPropertyValue(through ?? property);
		if (through === CARRIERS.length) return resolved === UNRESOLVED_LENGTH ? '' : resolved;
		if (through === CARRIERS.number) return resolved === UNRESOLVED_WEIGHT ? '' : resolved;
		if (through !== CARRIERS.color) return resolved;
		if (context === null) return '';
		const painted = bytes(context, resolved);
		return painted === null ? '' : `rgb(${painted[0]}, ${painted[1]}, ${painted[2]})`;
	};

	try {
		return stripeAppearance(read);
	} finally {
		wrapper.remove();
	}
}
