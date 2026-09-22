// what the card's zag machines (./select.ts, ./coin-picker.ts, driven through `@zag-js/vanilla`)
// share about the page they land on: where the machine looks its nodes up, how its props reach a
// node, and how its open list is shown.
//
// the list is shown in the top layer (`popover="manual"`, https://html.spec.whatwg.org/multipage/popover.html)
// and positioned against the viewport (`strategy: 'fixed'`). the card clips its own overflow
// (`[part~='card']` in ./styles/parts.css) and a host may stand it in any box with `overflow: hidden`,
// a `transform` or a stacking context of its own; the top layer is above all of them by construction,
// which is what lets the list float over the bottom of the card rather than open in flow. `manual`
// because the machine is the one dismissing it — an `auto` popover would close itself on a press the
// machine is also answering.
//
// the machine's positioner style is written property by property rather than as a `style`
// attribute. `normalizeProps` hands it over as one string and `spreadProps` would set it with
// `setAttribute('style', …)`, which a host's `style-src` without `'unsafe-inline'` refuses — and
// replacing the whole attribute would also wipe the `--x`/`--y`/`--reference-width` the positioning
// writes onto the same node between renders. `style.setProperty` is never refused and touches only
// the property it names.
//
// two things the machines write outside the card, which no zag prop scopes and no `stop()`
// takes back. the first list to open on a page runs `@zag-js/focus-visible`'s global setup: it
// wraps the host window's `HTMLElement.prototype.focus`, and adds keydown, keyup, click and pointer
// capture listeners on the host document and focus and blur listeners on its window. it runs once
// per window, and zag undoes it only on `beforeunload`. and while the coin list is open on an Apple
// platform, `@zag-js/combobox` announces each highlighted row through
// `<span id="__live-region__" role="alert">` appended to the host's `document.body`; on close, on
// any platform, it removes whatever element in that document carries the id.

import { spreadProps } from '@zag-js/vanilla';

export type Props = Record<string, unknown>;

/** which style properties were last written onto a node, so the next render can take back the rest. */
const written = new WeakMap<Element, ReadonlySet<string>>();

/**
 * `normalizeProps` writes a style object as `name:value;` pairs, and none of the machine's values
 * carries a `;`, so the split is the inverse of that writing.
 */
function writeStyle(node: HTMLElement | SVGElement, css: string): void {
	const names = new Set<string>();
	for (const declaration of css.split(';')) {
		const at = declaration.indexOf(':');
		if (at < 0) continue;
		const name = declaration.slice(0, at);
		const value = declaration.slice(at + 1);
		names.add(name);
		if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
	}
	for (const name of written.get(node) ?? []) if (!names.has(name)) node.style.removeProperty(name);
	written.set(node, names);
}

/** a machine's props onto `node`, its style by property. `scope` is the machine's id. */
export function spread(node: HTMLElement | SVGElement, props: Props, scope: string): void {
	const { style, ...rest } = props;
	if (typeof style === 'string') writeStyle(node, style);
	spreadProps(node, rest, scope);
}

/**
 * the node a machine looks its parts up in and tests an outside press against: the root `anchor`
 * stands in — the card's shadow root, or the coin list's own — rather than the host's document.
 *
 * a control not yet on a page has an element for its root, which has no `getElementById`; the
 * document stands in until the control is placed.
 */
export function rootNodeOf(anchor: Node, doc: Document): () => ShadowRoot | Document {
	return () => {
		const root = anchor.getRootNode();
		return 'getElementById' in root ? (root as ShadowRoot | Document) : doc;
	};
}

/**
 * the list's popover shown while the machine is open and hidden while it is not.
 *
 * a card taken off the page with its list open closes the popover under the machine, which is still
 * open until the card's own stop lands a task later (`#leaving` in ./element.ts); a popover that is
 * not connected cannot be shown.
 */
export function showWhile(list: HTMLElement, open: boolean): void {
	const shown = list.matches(':popover-open');
	if (open && !shown && list.isConnected) list.showPopover();
	else if (!open && shown) list.hidePopover();
}

/**
 * whether the machine holds a list open that is no longer on screen.
 *
 * a move takes a showing popover out of the top layer and tells the machine nothing, so the box goes
 * on saying `aria-expanded="true"` over no list. the card asks after a move (`reattached` on
 * `CardView` in ./views.ts), and a machine found this way is closed rather than re-shown: the donor
 * did not ask for the list on the page the element now stands in.
 */
export function lostWhileOpen(list: HTMLElement, open: boolean): boolean {
	return open && list.isConnected && !list.matches(':popover-open');
}
