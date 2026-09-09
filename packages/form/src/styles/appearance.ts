// Stripe's Payment Element paints inside an iframe on Stripe's origin, so none of this
// component's CSS reaches it. its `appearance` object is the only channel there is, and this
// module is what fills that object from the same ramp the rest of the form is painted with
// (./tokens.css) — otherwise the card fields read as a foreign widget bolted into the form.
//
// this module names tokens, never colors. every value it emits is read back out of the
// cascade through the `read` function its caller supplies, so changing a step in tokens.css
// changes what Stripe is handed with nothing here to edit. a hex literal in this file would
// be a second copy of the ramp that drifts from the first one silently.
//
// no Stripe import, no DOM, no network: the caller owns the element and the Stripe handle,
// this owns the mapping. that is what lets ./appearance.spec.ts assert the whole map from a
// plain object in the node pool, and what lets ./resolve.browser.spec.ts drive the same
// function off a real cascade in a real browser.

/**
 * reads one resolved value out of the cascade.
 *
 * the same shape as `getComputedStyle(el).getPropertyValue(property)`, which is what a caller
 * passes. `property` is either a custom property (`--_p`) or a standard one (`font-size`).
 *
 * must return a resolved value, and that is not what `getPropertyValue` alone gives for the
 * `--_` tokens: they are unregistered custom properties, so their computed value is the
 * `oklch(from …)` expression rather than the color it evaluates to. a caller resolves each
 * token through a standard property on a probe element first — the technique
 * ./tokens.browser.spec.ts uses and asserts.
 *
 * a property that cannot be resolved returns an empty string, and whatever it fed is left out
 * of the result rather than sent empty. an empty string is the only absence there is: a `0px`
 * is a length the ramp states and is drawn as one, so a caller that cannot tell an unresolved
 * length from a zero has to answer that question before it gets here — ./resolve.ts does it
 * with a sentinel the probe inherits.
 */
export type TokenReader = (property: string) => string;

/**
 * what Stripe's `elements({ appearance })` option is handed.
 *
 * declared here rather than imported from Stripe's types: this module is the mapping, and
 * taking a dependency on the SDK to describe a plain object would put a package between the
 * ramp and the spec that asserts it. the caller passes this straight through.
 */
export type StripeAppearance = {
	readonly theme: 'flat';
	readonly variables: Readonly<Record<string, string>>;
	readonly rules: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

/**
 * every property `stripeAppearance` asks its reader for.
 *
 * exported so a caller can resolve exactly this set once at mount rather than probing the
 * cascade lazily per lookup, and so a spec can assert that the set asked for is the set
 * declared — a token renamed in tokens.css and not here otherwise shows up as one silently
 * missing Stripe variable rather than as a failure.
 */
export const APPEARANCE_INPUTS = [
	'--_bad',
	'--_border',
	'--_edge-control',
	'--_focus-ring',
	'--_focus-width',
	'--_inset',
	'--_n1',
	'--_n11',
	'--_n12',
	'--_n3',
	'--_p',
	'--_r',
	'--_sp1',
	'--_sp3',
	'--_t-sm',
	'--_w-bold',
	'font-family',
	'font-size'
] as const;

const EM = /^(-?(?:\d+\.?\d*|\.\d+))em$/;
const PX = /^(-?(?:\d+\.?\d*|\.\d+))px$/;

/**
 * whether a resolved value can be handed over at all.
 *
 * an unresolved `var()` is the one value that must not travel. Stripe drops these strings
 * into its own iframe, where this component's shadow root does not exist, so a `var(--_p)`
 * names nothing there and yields no color at all rather than a wrong one. dropping the
 * variable leaves Stripe on its own default, which is a visible mismatch someone can see and
 * fix; sending it produces an unstyled field with nothing to explain it.
 */
function usable(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	if (trimmed.includes('var(')) return undefined;
	return trimmed;
}

/** the numeric part of a `px` length, or `undefined` if the value is not one. */
function pxNumber(value: string | undefined): number | undefined {
	const digits = value === undefined ? undefined : PX.exec(value)?.[1];
	return digits === undefined ? undefined : Number(digits);
}

/**
 * an `em` length restated in `px` against the form's own resolved root.
 *
 * the size and spacing tokens are `em` so they ride the clamped root in tokens.css. inside
 * Stripe's iframe there is no such root — an `em` resolves against whatever font-size Stripe
 * happens to have applied where the variable is used — so the conversion happens here, where
 * the base is known. the factor comes out of the token itself rather than being restated,
 * which is what keeps this from being a second copy of the type scale.
 *
 * anything that is not an `em` length is passed through untouched: it is already absolute, or it
 * is an expression that resolves the same on either side of the iframe boundary.
 */
function toPx(value: string | undefined, basePx: number | undefined): string | undefined {
	if (value === undefined) return undefined;
	const factor = EM.exec(value)?.[1];
	if (factor === undefined || basePx === undefined) return value;
	return `${Number((Number(factor) * basePx).toFixed(4))}px`;
}

/** assigns a key only when there is a value for it, so a failed read leaves no empty string. */
function put(target: Record<string, string>, key: string, value: string | undefined): void {
	if (value !== undefined) target[key] = value;
}

/**
 * the ramp, expressed as Stripe's `appearance`.
 *
 * `theme: 'flat'` is the base with the least of its own opinion to override, so the rules
 * below are additions rather than corrections.
 *
 * resolved once, by the caller, at mount. a host that changes `--donate-primary` afterwards
 * gets a form that follows and card fields that do not until the next mount; that is a narrow
 * case and the fix for it, if it is ever needed, is a method on the element rather than an
 * attribute, because the element's public attribute surface is closed.
 */
export function stripeAppearance(read: TokenReader): StripeAppearance {
	const value = (property: string) => usable(read(property));

	// the root the `em` tokens are relative to. a standard property, so the browser has already
	// resolved it to px — unlike the `--_` tokens, which have not been computed at all.
	const rootSize = value('font-size');
	const basePx = pxNumber(rootSize);

	const n1 = value('--_n1');
	const n11 = value('--_n11');
	const edge = value('--_edge-control');
	const primary = value('--_p');
	const focusRing = value('--_focus-ring');
	const borderWidth = value('--_border');
	const focusWidth = value('--_focus-width');

	const variables: Record<string, string> = {};
	put(variables, 'colorPrimary', primary);
	put(variables, 'colorBackground', n1);
	put(variables, 'colorText', value('--_n12'));
	put(variables, 'colorTextSecondary', n11);
	// placeholder takes the same step as secondary text rather than one of the fill steps. inside
	// the card fields the placeholder is what names the field — `MM / YY`, `CVC` — so it is read,
	// not decoration, and 4.5:1 applies to it. the form's own fields carry a label above them and
	// do not depend on a placeholder to say what they are.
	put(variables, 'colorTextPlaceholder', n11);
	put(variables, 'colorDanger', value('--_bad'));
	put(variables, 'fontFamily', value('font-family'));
	put(variables, 'fontSizeBase', rootSize);
	put(variables, 'borderRadius', value('--_r'));
	const unit = toPx(value('--_sp1'), basePx);
	put(variables, 'spacingUnit', unit);
	// the rails stack flush. `../embed/stripe.ts` draws each as a container of its own and the rule
	// below draws it bare and square, running to the card's own edges, so the fill on the open one is
	// what tells one rail from the next — and a gap between two of those bands is a stripe of the
	// card's ground cutting across a list that is one object. what separates two closed rails is the
	// pad each carries, which is the same room the open one's name stands in.
	//
	// stated as a length rather than read off a token: it is not a step on the card's spacing ladder
	// that someone could retune, it is the absence of one. Stripe reads it only while the items are
	// spaced, which is the layout that file asks for.
	variables.accordionItemSpacing = '0px';

	// the same frame every other control a donor has to find carries, at the same weight, so the
	// card fields do not read as a foreign widget bolted into the form.
	const frame: Record<string, string> = {};
	if (borderWidth !== undefined && edge !== undefined)
		frame.border = `${borderWidth} solid ${edge}`;
	put(frame, 'backgroundColor', n1);

	// the container each rail is drawn in draws no edge and no lift: the fields inside it are what a
	// donor finds, and they carry the frame above; a box around the rail as well is a second ring
	// around boxes that already have one. it does take a top pad, because the open rail is filled
	// (`--_n3` below) and so the band has a top edge of its own — with none, the method's name sits
	// against that edge. the step is the one that lands level with the pad the provider leaves under
	// the name, which it derives from the `spacingUnit` above and exposes as no length of its own;
	// that bottom pad stays for the same reason it always did — it is the whole of what stands
	// between a rail's name and its first field. the layout in ../embed/stripe.ts draws no radio, so
	// a rail's name is a bare press and the open one is the one with its fields under it.
	//
	// the side pad is the card body's own inset, and it is room rather than an inset: `[part~='payment']`
	// in ./parts.css pulls the whole box out by that same length, so the rail's band runs to the card's
	// left and right edges while the fields inside it land back on the seam the rest of the card's
	// controls sit on. the two are one decision and move together — the pull is a length in that sheet
	// and this is the resolved value of the same token. the pad is also the room the provider needs:
	// it paints one box inside a rail — the Link sign-up block — wider than the rail's own content,
	// and a rail with no side pad clips its left and right edges away inside the provider's frame,
	// leaving a box with a top and a bottom and no sides.
	//
	// the inset is stated off the clamped root rather than in `em` (./tokens.css), so it crosses the
	// frame boundary already absolute and takes no conversion; the top pad is a spacing step and is
	// `em`, so it takes the same conversion every other one here does.
	const railPad = value('--_inset');
	const rail: Record<string, string> = {
		border: 'none',
		boxShadow: 'none',
		// the band runs to the card's own left and right edges — `[part~='payment']` in ./parts.css
		// pulls the box out by the inset this rule pads back in — so it has no corner to round: the
		// radius the `borderRadius` variable above carries would cut a notch of the card's ground out
		// of each end of a band that reaches the edge. the variable stays what it is, because the
		// fields inside the rail are boxes that do have corners and carry the same radius every other
		// control on the card does.
		borderRadius: '0'
	};
	put(rail, 'paddingTop', toPx(value('--_sp3'), basePx));
	put(rail, 'paddingLeft', railPad);
	put(rail, 'paddingRight', railPad);

	// which rail is open, said on the band itself rather than only by the fields standing under it.
	// the provider draws no radio in this layout (../embed/stripe.ts), so without a fill the name of
	// the open method reads exactly like the names of the closed ones.
	//
	// `--selected` is the provider's own state suffix on a class its appearance API exposes, which
	// is what keeps this on the same channel as every other rule here: nothing reaches into the
	// frame. `--_n3` is the ramp's faint fill — the first step above the card's own ground that is
	// visible as a wash — and other things on this card already rest on it; it is the ladder's step
	// for this, not a meaning taken from one of them.
	const railSelected: Record<string, string> = {};
	put(railSelected, 'backgroundColor', value('--_n3'));

	// the same ring the rest of the form draws on a focused control, so moving from an email field
	// into the card field does not change what focus looks like — which means a rung of the ladder
	// rather than the brand. the split holds across the frame boundary as well as inside it: a fill
	// the donor acts on is the primary above, a line saying where the caret is is this, and the two
	// never meet here either, because the field this rings carries no primary edge at all — only a
	// chosen rail does, and a rail is not a field.
	const inputFocus: Record<string, string> = {};
	if (focusWidth !== undefined && focusRing !== undefined) {
		inputFocus.boxShadow = `0 0 0 ${focusWidth} ${focusRing}`;
	}

	const label: Record<string, string> = {};
	put(label, 'fontSize', toPx(value('--_t-sm'), basePx));
	put(label, 'color', n11);
	put(label, 'fontWeight', value('--_w-bold'));

	const rules: Record<string, Record<string, string>> = {};
	for (const [selector, declarations] of [
		['.Input', frame],
		['.AccordionItem', rail],
		['.AccordionItem--selected', railSelected],
		['.Input:focus', inputFocus],
		['.Label', label]
	] as const) {
		// a rule whose every declaration failed to resolve is left out entirely: an empty rule
		// object is a claim that the surface was styled.
		if (Object.keys(declarations).length > 0) rules[selector] = declarations;
	}

	return { theme: 'flat', variables, rules };
}
