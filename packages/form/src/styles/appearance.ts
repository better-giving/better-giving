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
	'--_n1',
	'--_n10',
	'--_n11',
	'--_n12',
	'--_n2',
	'--_p',
	'--_p-hover',
	'--_r',
	'--_r-in',
	'--_sp1',
	'--_sp3',
	'--_sp4',
	'--_sp5',
	'--_t-sm',
	'--_w-bold',
	'font-family',
	'font-size'
] as const;

/**
 * the box a payment rail is drawn as, named once for both kinds of rail: the provider's, which this
 * module sends as `.AccordionItem` and its states, and ours, which ./rows.css draws and
 * ../embed/rows.dom.spec.ts holds to these same names.
 *
 * a rail is a choice box: the white face every choice stands on, the outline that finds a box, the
 * corner preset's control radius, and the item gap between one rail and the next. the open rail is
 * the chosen one and is marked by the primary's edge on the same face (the head of
 * ./tokens.css). a pointer steps the edge and never the face.
 */
export const PAYMENT_ROW = {
	padBlock: '--_sp3',
	padInline: '--_sp4',
	ground: '--_n1',
	edge: '--_edge-control',
	edgeHover: '--_n10',
	chosenEdge: '--_p',
	chosenEdgeHover: '--_p-hover',
	radius: '--_r-in',
	gap: '--_sp5'
} as const;

const EM = /^(-?(?:\d+\.?\d*|\.\d+))em$/;
const PX = /^(-?(?:\d+\.?\d*|\.\d+))px$/;

/**
 * the floor a box a donor types into is drawn at.
 *
 * `[part~='field']` in ./parts.css states it and argues it, and the fields inside the provider's
 * frame are the same box wearing the same decision.
 */
const FIELD_MIN_PX = 16;

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

/** two `px` lengths added, or `undefined` unless both are `px`. */
function pxSum(a: string | undefined, b: string | undefined): string | undefined {
	const left = pxNumber(a);
	const right = pxNumber(b);
	return left === undefined || right === undefined ? undefined : `${left + right}px`;
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
 * resolved once, by the caller, at mount. a host that changes a seed afterwards gets a form
 * that follows and card fields that do not until the next mount; that is a narrow
 * case and the fix for it, if it is ever needed, is a method on the element rather than an
 * attribute, because the element's public attribute surface is closed.
 */
export function stripeAppearance(read: TokenReader): StripeAppearance {
	const value = (property: string) => usable(read(property));

	// the root the `em` tokens are relative to. a standard property, so the browser has already
	// resolved it to px — unlike the `--_` tokens, which have not been computed at all.
	const basePx = pxNumber(value('font-size'));

	// what the provider sizes everything inside its frame from, and it is the row's size rather than
	// the card's. the fields stand inside a payment row, and a row is drawn at `--_t-sm` — `.name` in
	// ./rows.css, which is matched to what the provider draws unasked — so a root at the card's own
	// base puts the fields a step above the row around them, which is the mismatch on the screen.
	const rowSize = toPx(value('--_t-sm'), basePx);

	// the same step, dropped rather than passed through when the root did not resolve: this is what
	// the two variables below are sent as, and a variable is the scale the frame's own `em`s resolve
	// against. a relative one there is that scale handed to whatever size the provider applied.
	const rowPx = pxNumber(rowSize) === undefined ? undefined : rowSize;

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
	put(variables, 'fontSizeBase', rowPx);
	// the name on each rail the provider paints. it scales off the root above unasked, and `.name` in
	// ./rows.css draws the rows we paint ourselves at this same step — so left to scale, the provider's
	// names and ours part company and the one list reads as two.
	put(variables, 'accordionItemLabelFontSize', rowPx);
	put(variables, 'borderRadius', value('--_r'));
	const unit = toPx(value('--_sp1'), basePx);
	put(variables, 'spacingUnit', unit);
	// the rails stand apart as boxes of their own, by the item gap the asks of one step stand apart
	// by. Stripe reads it only while the items are spaced, which is the layout ../embed/stripe.ts
	// asks for; ../embed/surface.ts spends the same step between the rows drawn outside the frame.
	put(variables, 'accordionItemSpacing', toPx(value(PAYMENT_ROW.gap), basePx));

	// the same text box every other box a donor types into is drawn as — the outline that finds it at
	// the same weight, and a field's fill inside it (`[part~='field']` in ./parts.css) — so the card
	// fields do not read as a foreign widget bolted into the form.
	const frame: Record<string, string> = {};
	if (borderWidth !== undefined && edge !== undefined)
		frame.border = `${borderWidth} solid ${edge}`;
	// the control corner, as the rail around the fields and the form's own fields are drawn: the
	// `borderRadius` variable above is the plane's, and a field inside a rail drawn at it stands
	// rounder than the box that holds it.
	put(frame, 'borderRadius', value(PAYMENT_ROW.radius));
	put(frame, 'backgroundColor', value('--_n2'));
	// and the size, which is the one thing on these fields that is not the row's: a field is drawn at
	// `FIELD_MIN_PX` above or at the card's root, whichever is larger, exactly as `[part~='field']` in
	// ./parts.css draws the boxes beside it. the root is the card's and not the one sent above — the
	// `em` half of that rule is converted here, where the base is known, like every other one.
	const fieldSize = basePx === undefined ? undefined : `${Math.max(FIELD_MIN_PX, basePx)}px`;
	put(frame, 'fontSize', fieldSize);

	// each rail is a box of its own, drawn the way ./rows.css draws ours (`PAYMENT_ROW` above). it
	// draws no lift: nothing that stands on the card is raised (`--_lift` in ./tokens.css). the edge
	// is sent whole or not at all, for the reason the field's frame above is. the layout in
	// ../embed/stripe.ts draws no radio, so a rail's name is a bare press and the open one is the one
	// with its fields under it.
	//
	// the pads are spacing steps and `em`, so they take the same conversion every other one here
	// does. the side pad is also room the provider needs: it paints one box inside a rail — the Link
	// sign-up block — wider than the rail's own content, and a rail with no side pad clips that
	// block's left and right edges away inside the provider's frame.
	//
	// the closed rail's ground is stated because the provider's flat theme paints one of its own,
	// which stands as a seam against the rows ./rows.css draws on the card's face beside it.
	const ground = value(PAYMENT_ROW.ground);
	const rail: Record<string, string> = { boxShadow: 'none' };
	if (borderWidth !== undefined && edge !== undefined) rail.border = `${borderWidth} solid ${edge}`;
	put(rail, 'borderRadius', value(PAYMENT_ROW.radius));
	put(rail, 'backgroundColor', ground);
	const railStep = toPx(value(PAYMENT_ROW.padBlock), basePx);
	put(rail, 'paddingTop', railStep);
	put(rail, 'paddingBottom', railStep);
	const railPad = toPx(value(PAYMENT_ROW.padInline), basePx);
	put(rail, 'paddingLeft', railPad);
	put(rail, 'paddingRight', railPad);

	// which rail is open, said on the box itself rather than only by the fields standing under it.
	// `--selected` is the provider's own state suffix on a class its appearance API exposes, which
	// is what keeps this on the same channel as every other rule here: nothing reaches into the
	// frame. the face is restated so the theme draws no selected ground of its own.
	const railSelected: Record<string, string> = {};
	put(railSelected, 'borderColor', value(PAYMENT_ROW.chosenEdge));
	put(railSelected, 'backgroundColor', ground);

	// and the pointer: the edge steps and the face holds, on a closed rail along the ramp and on the
	// open one along the brand. the open one is stated apart, or the plain `:hover` rule would reach
	// it and trade its primary edge for a closed rail's.
	const railHover: Record<string, string> = {};
	put(railHover, 'borderColor', value(PAYMENT_ROW.edgeHover));
	put(railHover, 'backgroundColor', ground);
	const railSelectedHover: Record<string, string> = {};
	put(railSelectedHover, 'borderColor', value(PAYMENT_ROW.chosenEdgeHover));
	put(railSelectedHover, 'backgroundColor', ground);

	// a focused rail is rung the way ./rows.css rings ours, so a Tab from a provider's rail to one of
	// ours keeps one ring: the plain ring hugging a closed rail's edge, and on the open one a band of
	// the face laid against the primary's edge first, with the ring outside it. the transparent
	// outline is what forced colours paint once every shadow is dropped, as `.head:focus-visible`
	// keeps one there.
	const railFocus: Record<string, string> = {};
	const railSelectedFocus: Record<string, string> = {};
	if (focusWidth !== undefined && focusRing !== undefined) {
		railFocus.outline = `${focusWidth} solid transparent`;
		railFocus.boxShadow = `0 0 0 ${focusWidth} ${focusRing}`;
		const outside = pxSum(borderWidth, focusWidth);
		if (ground !== undefined && outside !== undefined) {
			railSelectedFocus.boxShadow = `0 0 0 ${borderWidth} ${ground}, 0 0 0 ${outside} ${focusRing}`;
		}
	}

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

	// and the pointer: a text box's outline steps one rung along the ladder under it, as the boxes
	// beside the frame do (`[part~='field']:hover` in ./parts.css).
	const inputHover: Record<string, string> = {};
	put(inputHover, 'borderColor', value('--_n10'));
	// except on a field the provider has refused, which keeps its danger edge under the pointer as
	// the form's own do (`[part~='field'][part~='invalid']` in ./parts.css, after `:hover`). sent
	// after the rule above, whose class and pseudo-class outrank the theme's state class alone.
	const invalidHover: Record<string, string> = {};
	put(invalidHover, 'borderColor', value('--_bad'));

	// the same length the root above carries, and stated rather than left derived: the provider sizes
	// a label off the root rather than at it, and the card's own labels are that same step
	// (`[part~='label']` in ./parts.css), so a derived one would sit under every label beside it.
	const label: Record<string, string> = {};
	put(label, 'fontSize', rowSize);
	put(label, 'color', n11);
	put(label, 'fontWeight', value('--_w-bold'));

	const rules: Record<string, Record<string, string>> = {};
	for (const [selector, declarations] of [
		['.Input', frame],
		['.Input:hover', inputHover],
		['.Input--invalid:hover', invalidHover],
		['.AccordionItem', rail],
		['.AccordionItem--selected', railSelected],
		['.AccordionItem:hover', railHover],
		['.AccordionItem--selected:hover', railSelectedHover],
		['.AccordionItem:focus-visible', railFocus],
		['.AccordionItem--selected:focus-visible', railSelectedFocus],
		['.Input:focus', inputFocus],
		['.Label', label]
	] as const) {
		// a rule whose every declaration failed to resolve is left out entirely: an empty rule
		// object is a claim that the surface was styled.
		if (Object.keys(declarations).length > 0) rules[selector] = declarations;
	}

	return { theme: 'flat', variables, rules };
}
