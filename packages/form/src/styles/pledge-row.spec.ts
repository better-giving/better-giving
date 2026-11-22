import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGISTRY_CLASS } from '../parts';

// node pool: the sheets read as text, as ./press-gap.spec.ts reads them. a pledge's summary row is its
// label and its value on one line (`.pledge-summary` in ../pledge-screen.ts), and the custodian is a
// value the donor types, up to `MAX_CUSTODIAN` characters in ../v1.ts. grid sizing grows an
// `auto` track to its max-content before an `fr` track gets any space, so the value's track is the
// `fr` one floored at 0 and the label's is `auto`: the label keeps its own words' width and the value
// wraps in what is left, `overflow-wrap: anywhere` breaking a name with no space in it. the same
// classes draw the gift page's summary (packages/app/src/lib/donate/pledge-block.tsx).

type Rule = { readonly selector: string; readonly stated: ReadonlyMap<string, string> };

// in the order ../element.ts adopts them, so a later rule for a selector is the one the cascade keeps.
const rules: Rule[] = ['./parts.css', './layout.css'].flatMap((path) =>
	[
		...readFileSync(new URL(path, import.meta.url), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.matchAll(/([^{};]+)\{([^{}]*)\}/g)
	].map(([, selector = '', body = '']) => ({
		selector: selector.trim().replace(/\s+/g, ' '),
		stated: new Map(
			body
				.split(';')
				.map((declaration) => declaration.split(/:(.*)/s).map((side) => side.trim()))
				.filter((pair): pair is [string, string] => pair.length >= 2 && pair[0] !== '')
				.map(([property, value]) => [property, value.replace(/\s+/g, ' ')])
		)
	}))
);

/** the last value a selector states for a property, which is the one the cascade keeps. */
const stated = (selector: string, property: string): string | undefined =>
	rules
		.filter((rule) => rule.selector === selector && rule.stated.has(property))
		.at(-1)
		?.stated.get(property);

describe('a pledge’s summary row', () => {
	it('sizes the label to its words and gives the value what is left', () => {
		expect(stated('.pledge-summary .pledge-row', 'grid-template-columns')).toBe(
			'auto minmax(0, 1fr)'
		);
	});

	it('lets the value wrap anywhere inside its track', () => {
		expect({
			floor: stated('.pledge-value', 'min-inline-size'),
			wrap: stated('.pledge-value', 'overflow-wrap')
		}).toEqual({ floor: '0', wrap: 'anywhere' });
	});
});

// `--_t-xs` is `0.75em` off the card's clamped root (./tokens.css), which is 11.25px at the bottom of
// the band; a detail's label names the value a donor copies, so it takes the floor ./parts.css's
// header lists, and its size is measured in chromium in ./parts.browser.spec.ts.
describe('a pledge’s detail labels', () => {
	it('floor the smallest step at 12px', () => {
		expect(stated('.pledge-details .pledge-label', 'font-size')).toBe('max(12px, var(--_t-xs))');
	});
});

// the pending screens are the takeovers whose details list is drawn (`pledgedScreen` in ../views.ts):
// the thank-you lists what was pledged alone and hides it, and no other takeover has one. the rules
// below are keyed on that so the thank-you, the crypto deposit and every other takeover keep theirs.
const PENDING = `.takeover:has(.pledge-details:not([hidden]))`;

describe('a pledge’s pending screen', () => {
	it('sets its heading a step under the other takeovers’', () => {
		expect(stated(`${PENDING} [part~='heading']`, 'font-size')).toBe('var(--_t-lg)');
	});

	// the registry's small-text leading (`--ds-text-sm-lh` in ../registry/styles/button-css.css).
	it('sets its lead quiet, at the small step on the registry’s small leading', () => {
		expect({
			size: stated(`${PENDING} .prose`, 'font-size'),
			ink: stated(`${PENDING} .prose`, 'color'),
			line: stated(`${PENDING} .prose`, 'line-height')
		}).toEqual({ size: 'var(--_t-sm)', ink: 'var(--_n11)', line: 'calc(1.25 / 0.875)' });
	});

	// 10px at the default root: the registry's spacing step (`--ds-spacing`, a quarter of `--ds-rem`)
	// two and a half times over.
	it('pads every row at two and a half of the registry’s spacing steps', () => {
		expect(stated(`${PENDING} .pledge-row`, 'padding-block')).toBe(
			'calc(var(--ds-rem) * 0.25 * 2.5)'
		);
	});

	it('stands a detail’s label half a registry spacing step over its value', () => {
		expect(stated('.pledge-details .pledge-row', 'row-gap')).toBe(
			'calc(var(--ds-rem) * 0.25 * 0.5)'
		);
	});

	// the registry's small and extra-small leadings (`--ds-text-sm-lh`, `--ds-text-xs-lh` in
	// ../registry/styles/button-css.css), and the drawn value's 1.4, which no scale here has.
	it('sets each row’s words at the leading drawn for them', () => {
		expect({
			summaryLabel: stated(`${PENDING} .pledge-summary .pledge-label`, 'line-height'),
			summaryValue: stated(`${PENDING} .pledge-summary .pledge-value`, 'line-height'),
			detailLabel: stated('.pledge-details .pledge-label', 'line-height'),
			detailValue: stated('.pledge-value', 'line-height')
		}).toEqual({
			summaryLabel: 'var(--_lh-body)',
			summaryValue: '1.4',
			detailLabel: 'calc(1 / 0.75)',
			detailValue: 'var(--_lh-body)'
		});
	});

	it('sets a detail checked character by character a size under its words', () => {
		expect(stated('.pledge-details .pledge-value.mono', 'font-size')).toBe('0.9375em');
	});
});

// a pledge screen's primary (`REGISTRY_CLASS.action`) and its emailed instructions, an `<a>` with
// `SECONDARY_BUTTON` in ../views.ts and packages/app/src/lib/donate/takeover.tsx, are both `.ds-btn`.
// the registry centres a button's content with flex alone, and a label that wraps fills the box, so
// its lines align by `text-align`: centred on a `<button>` by the browser's own sheet, and the card's
// `start` (./tokens.css) on the `<a>`.
describe('a pledge screen’s buttons', () => {
	it('centre a label that wraps', () => {
		expect({
			primary: REGISTRY_CLASS.action.split(' ').includes('ds-btn'),
			align: stated('.ds-btn', 'text-align')
		}).toEqual({ primary: true, align: 'center' });
	});
});
