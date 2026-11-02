// the brand scale on one element's shadow host: radix's custom-palette generator
// (./radix-scale.ts) run on the seed and the shade the host computes, written as a constructed sheet
// the shadow root adopts after the shared four (`sheetsFor` in ../element.ts). a `:host` rule there
// outranks ./tokens.css's own `:host` block by order alone, so the stylesheet's derived scale stays
// standing underneath, and shows only for a seed in a notation the generator does not read: the
// element adopts this sheet before its first card goes up (`#mount` in ../element.ts).
//
// a sheet rather than the host's `style` attribute keeps the scale out of that attribute, which is
// the host page's markup, and below any rule of the host's on the element, which a `style` attribute
// would outrank. it hides nothing: a `:host` declaration is as readable from the page through
// `getComputedStyle` as an attribute is, and light-DOM content slotted into the card inherits it.

import { type BrandGray, brandScaleCss, generateBrandScale } from './radix-scale';

/**
 * the private names the element sets from the scale: the ones its sheets and scripts read, which are
 * the ones ./tokens.css declares a fallback for. "the brand sheet sets what the card reads" in
 * ./brand.spec.ts holds the list to every read in packages/form.
 */
export const BRAND_TOKENS = ['--_a8', '--_a11', '--_a12', '--_p', '--_p-hover', '--_on-p'] as const;

/** what the generator is run on: the seed, and the grey the host's shade draws the card in. */
export type BrandInputs = { readonly seed: string; readonly gray: BrandGray };

/**
 * the seed and the shade as the host computes them.
 *
 * `--donate-primary` is registered (./tokens.css), so the computed value is a colour an engine has
 * already serialized — `rgb()` for any legacy sRGB form or keyword, the function as written for the
 * rest — or the registered initial value where nothing above the element sets one. `--donate-shade`
 * is registered too, so it is one of its three keywords; `warm` draws the greys in sand.
 */
export function brandInputsOf(host: Element): BrandInputs {
	const view = host.ownerDocument.defaultView;
	if (view === null) return { seed: '', gray: 'slate' };
	const style = view.getComputedStyle(host);
	return {
		seed: style.getPropertyValue('--donate-primary').trim(),
		gray: style.getPropertyValue('--donate-shade').trim() === 'warm' ? 'sand' : 'slate'
	};
}

/** the keyframes `seedWatch` below runs, which change nothing; only the run is wanted. */
const WATCH_KEYFRAMES = '@keyframes donate-seed-watch { to { visibility: hidden; } }';

/**
 * the css the brand sheet holds: the watch's keyframes, and the scale set on `:host`, or no scale for
 * a seed the generator does not read.
 */
export function brandCss({ seed, gray }: BrandInputs): string {
	const scale = generateBrandScale(seed, gray);
	return scale === null
		? WATCH_KEYFRAMES
		: `${WATCH_KEYFRAMES}\n${brandScaleCss(':host', scale, BRAND_TOKENS)}`;
}

/**
 * a node for the shadow root that calls `onChange` when the seed or the shade it inherits may have
 * moved.
 *
 * nothing on the platform reports a computed value changing, but a registered custom property
 * transitions, and a transition reports itself as it is created. both reach this node by
 * inheritance, so a host's stylesheet, a class on an ancestor and the element's own `style`
 * attribute all arrive here alike. the shade is a keyword, which only transitions discretely, hence
 * `allow-discrete` for it; an engine without `transition-behavior` drops that longhand alone and
 * still watches the seed. `step-start` puts the node at the new value at once, so the length only has
 * to be above zero, and `--_dur-spin` is the one duration ./tokens.css keeps above zero under
 * `prefers-reduced-motion: reduce` too.
 *
 * a node that is not rendered starts no transition — under a closed `<dialog>` or a hidden tab panel
 * a change reports nothing, then or when the panel opens. an animation starts each time a node is
 * rendered again, so the watch also runs `WATCH_KEYFRAMES` once and reports its `animationstart`,
 * which catches up whatever moved out of sight. the node paints nothing; it is rendered — hidden,
 * sized to nothing and out of flow — for both.
 */
export function seedWatch(doc: Document, onChange: () => void): HTMLElement {
	const node = doc.createElement('div');
	node.setAttribute('aria-hidden', 'true');
	node.style.cssText =
		'position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;' +
		'pointer-events:none;transition-property:--donate-primary,--donate-shade;' +
		'transition-duration:var(--_dur-spin);transition-timing-function:step-start;' +
		'transition-behavior:normal,allow-discrete;animation:donate-seed-watch var(--_dur-spin);';
	node.addEventListener('transitionrun', onChange);
	node.addEventListener('animationstart', onChange);
	return node;
}
