import { describe, expect, it } from 'vitest';
import { stripeAppearance, type TokenReader } from '../styles/appearance';
import tokenStyles from '../styles/tokens.css?inline';
import { createRows } from './rows';

// what makes the rows this module draws one list with the ones the provider paints inside its own
// frame, held where a commit can see it.
//
// the two halves are drawn by code that cannot see each other: ../styles/rows.css draws ours in a
// shadow root on this page, and ../styles/appearance.ts sends the provider a set of lengths its own
// stylesheet spends inside an iframe on its origin. so the tie between them is arithmetic over the
// values we send, and this is where that arithmetic is written down. the browser pool measures the
// drawn row (`a payment row drawn beside the provider's frame` in ../styles/parts.browser.spec.ts);
// nothing anywhere can measure the provider's, which is why the figure it is held to is derived.
//
// the provider's side of the derivation, and the whole of what this file takes on faith:
//
//  - the frame's root is the `fontSizeBase` we send, which is `--_t-sm` (`html { font-size:
//    var(--fontSizeBase) }` in the Payment Element's own stylesheet, the one https://js.stripe.com/v3/
//    names for that element).
//  - a rail's name starts about 37px from the rail's padding edge at the default root, read off a
//    rendered frame to a pixel either way: the frame is cross-origin, so no script of ours can
//    query it, and this is the one length here that is measured rather than derived.
//  - that column is the provider's own and no appearance variable reaches it
//    (https://docs.stripe.com/elements/appearance-api lists what an integrator may set: the label's
//    colour, size and weight, and the item's box — never the icon).
//
// the rail's padding edge is ours, because `.AccordionItem` in ../styles/appearance.ts pays it
// `--_inset` and `[part~='payment']` in ../styles/parts.css pulls the box out by the same length.

/** the `em` factor one token in ../styles/tokens.css is declared at. */
function em(name: string): number {
	const found = [...tokenStyles.matchAll(new RegExp(`${name}:\\s*([0-9.]+)em;`, 'g'))];
	if (found.length !== 1) throw new Error(`${name} is declared ${found.length} times as an em`);
	return Number(found[0]?.[1]);
}

/** a cascade that resolved, at the root the card clamps to by default. */
const ROOT_PX = 16;
const RESOLVED: Record<string, string> = {
	'--_bad': 'oklch(0.495 0.19 27)',
	'--_border': '1px',
	'--_edge-control': 'oklch(0.855 0.001 264)',
	'--_focus-ring': 'oklch(0.27 0.002 264)',
	'--_focus-width': '1px',
	'--_inset': '20px',
	'--_n1': 'oklch(0.995 0.001 264)',
	'--_n11': 'oklch(0.49 0.002 264)',
	'--_n12': 'oklch(0.27 0.002 264)',
	'--_n3': 'oklch(0.965 0.001 264)',
	'--_p': 'oklch(0.45 0.13 264)',
	'--_r': '8px',
	'--_sp1': '0.25em',
	'--_sp3': '0.75em',
	'--_t-sm': '0.875em',
	'--_w-bold': '600',
	'font-family': 'system-ui, sans-serif',
	'font-size': `${ROOT_PX}px`
};

const read: TokenReader = (property) => RESOLVED[property] ?? '';

/**
 * the sheet one drawn row carries, read off the row rather than off the import — which is what
 * makes it the sheet ./rows.ts adopts rather than a file this spec went and read.
 *
 * the mount is never put on the page: a row is drawn into whatever node it is handed and adopts its
 * sheet as it is built, so nothing here needs a layout and nothing is left behind.
 */
function rowSheet(): CSSStyleSheet {
	const mount = document.createElement('div');
	const content = document.createElement('div');
	createRows(mount).draw('PayPal', 'paypal', content);
	const root = mount.firstElementChild?.shadowRoot;
	const sheet = root?.adoptedStyleSheets[0];
	if (sheet === undefined) throw new Error('the row adopted no sheet');
	return sheet;
}

function styleRules(sheet: CSSStyleSheet): { selector: string; style: CSSStyleDeclaration }[] {
	return [...sheet.cssRules].flatMap((rule) =>
		'selectorText' in rule
			? [{ selector: (rule as CSSStyleRule).selectorText, style: (rule as CSSStyleRule).style }]
			: []
	);
}

describe('the payment rows drawn beside the provider’s frame', () => {
	// the provider draws nothing between one rail and the next — the open one is told by its fill
	// alone — so a line anywhere on a row of ours cuts across a list that is one object. read off the
	// sheet the row adopted, which is the one thing that can say the absence is still there: a rule
	// that paints no line is indistinguishable from a rule nobody wrote until one is added.
	it('paints no line above, between or below a row', () => {
		const edges = ['border', 'border-block-start', 'border-block-end', 'box-shadow', 'outline'];

		const drawn = styleRules(rowSheet())
			// the caret's own ring is the one edge a row draws, and a press is the only thing it is
			// drawn on.
			.filter(({ selector }) => !selector.includes(':focus-visible'))
			.flatMap(({ selector, style }) =>
				edges
					.map((property) => ({ selector, property, value: style.getPropertyValue(property) }))
					// a zeroed border is the host page's own `button { … }` held off, not a line.
					.filter(({ value }) => value !== '' && !/^0(px)?$/.test(value))
			);

		expect(drawn).toEqual([]);
	});

	// the seam every control on the card stands on, paid by both kinds of row out of the same token:
	// ours in the sheet above, the provider's in the appearance object it is sent.
	it('pays the rail’s own padding on both sides of the frame', () => {
		const head = styleRules(rowSheet()).find(({ selector }) => selector === '.head');
		const rail = stripeAppearance(read).rules['.AccordionItem'];

		expect(head?.style.getPropertyValue('padding')).toBe('var(--_sp3) var(--_inset)');
		expect(rail?.paddingLeft).toBe(RESOLVED['--_inset']);
		expect(rail?.paddingRight).toBe(RESOLVED['--_inset']);
	});

	// and the name lands where the provider lands its rails', which is the measured figure at the
	// head of this file: about 37px, against our own mark plus the head's gap. the mark is at the
	// name's size and the gap at the head's own, the card's root — built out of different tokens at
	// different sizes, and held to the pixel the measurement carries.
	it('stands the name where a rail stands its own', () => {
		const rowPx = em('--_t-sm') * ROOT_PX;
		const rules = styleRules(rowSheet());
		const spent = (selector: string, property: string) => {
			const value = rules
				.find((rule) => rule.selector === selector)
				?.style.getPropertyValue(property);
			const token = value?.match(/^var\((--_[\w-]+)\)$/)?.[1];
			return token === undefined ? 0 : em(token);
		};
		const ours =
			(em('--_glyph-beside') + spent('.mark', 'margin-inline-end')) * rowPx +
			spent('.head', 'gap') * ROOT_PX;
		const rail = 37;

		expect(stripeAppearance(read).variables.fontSizeBase).toBe(`${rowPx}px`);
		expect(Math.abs(ours - rail)).toBeLessThanOrEqual(1);
	});
});
