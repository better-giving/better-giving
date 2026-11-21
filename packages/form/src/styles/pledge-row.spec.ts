import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
