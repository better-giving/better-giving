// the brand scale on one element's shadow host: radix's custom-palette generator
// (./radix-scale.ts) run on the seed the host computes, written as a constructed sheet the shadow
// root adopts after the shared four (`sheetsFor` in ../element.ts). a `:host` rule there outranks
// ./tokens.css's own `:host` block by order alone, so the stylesheet's derived scale stays standing
// as the fallback underneath: before the script runs, and for a seed the generator does not read.
//
// the steps go on a sheet inside the shadow root rather than on the host's `style` attribute: the
// attribute is in the host page's tree, where a host could read the private layer and where any
// rule of theirs on the element would outrank the card's own `:host` rules.

import { brandScaleCss, generateBrandScale } from './radix-scale';

/**
 * the seed as the host computes it.
 *
 * `--donate-primary` is registered (./tokens.css), so the computed value is a colour an engine has
 * already serialized — `rgb()` for any legacy sRGB form or keyword, the function as written for the
 * rest — or the registered initial value where nothing above the element sets one.
 */
export function seedOf(host: Element): string {
	const view = host.ownerDocument.defaultView;
	return view === null
		? ''
		: view.getComputedStyle(host).getPropertyValue('--donate-primary').trim();
}

/** the css a seed's scale is set with on `:host`, or nothing for a seed the generator does not read. */
export function brandCss(seed: string): string {
	const scale = generateBrandScale(seed);
	return scale === null ? '' : brandScaleCss(':host', scale);
}

/**
 * a node for the shadow root that calls `onChange` when the seed it inherits moves.
 *
 * nothing on the platform reports a computed value changing, but a registered custom property
 * transitions, and a transition reports itself as it is created. the seed reaches this node by
 * inheritance, so a host's stylesheet, a class on an ancestor and the element's own `style`
 * attribute all arrive here alike. `step-start` puts the node at the new value at once, so the
 * length only has to be above zero, and `--_dur-spin` is the one duration ./tokens.css keeps above
 * zero under `prefers-reduced-motion: reduce` too. the node paints nothing; it is rendered — hidden,
 * sized to nothing and out of flow — because a node that is not rendered starts no transition.
 */
export function seedWatch(doc: Document, onChange: () => void): HTMLElement {
	const node = doc.createElement('div');
	node.setAttribute('aria-hidden', 'true');
	node.style.cssText =
		'position:absolute;inline-size:0;block-size:0;overflow:hidden;visibility:hidden;' +
		'pointer-events:none;transition:--donate-primary var(--_dur-spin) step-start;';
	node.addEventListener('transitionrun', onChange);
	return node;
}
