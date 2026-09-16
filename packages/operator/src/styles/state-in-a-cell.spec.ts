import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';

// the descriptive status word is a pill everywhere on an operator surface except inside a table,
// where ./adm.css takes the pill off at `.adm-table .adm-state` and leaves the word standing in its
// tone. this holds that rule to what it is for.
//
// **it exists because the exception is keyed on position and nothing in the markup says so.** no
// screen passes a prop for it and no component writes a class for it, which is the decision — a
// table added later cannot forget a rule it never states. the cost of that decision is that the
// only statement of the rule is the sheet, so a declaration put back on `.adm-state` is a ground
// back in every cell of every table on both surfaces, with no diff anywhere near a table to read.
//
// **what it sweeps is derived from the pill rather than listed.** every property `.adm-state` sets
// that draws something around the word has to be answered in the cell, so a fourth one added to the
// pill — a border, a shadow — fails here until the cell says what becomes of it. the two sets below
// are the only thing this file spells: the properties that are the word itself, and the sheet's own
// spellings for nothing.
//
// it reads the sheet's text, for ./raw-values.ts's reason: what a rule draws is not observable from
// a value. ../../vitest.config.ts renders the dom pool into happy-dom, which lays nothing out, and
// no /admin screen gets a `*.browser.spec.ts` (CLAUDE.md) — so a computed ground is not something
// any pool that renders one of these components can see.

const SHEET = new URL('./adm.css', import.meta.url).pathname;

/** the properties that are the word and not the shape around it, which a cell keeps as they are. */
const WORD = new Set([
	'color',
	'display',
	'font-size',
	'font-style',
	'font-weight',
	'line-height',
	'white-space'
]);

/** the sheet's word for nothing, in the two spellings ./tokens.css names and the css keyword. */
const NOTHING = /^(?:none|var\(--admin-(?:space|radius)-0\))$/;

/**
 * the declarations one rule states, by property, last one wins as css itself resolves them.
 *
 * the selector is matched from the start of its own line, which is what keeps `.adm-state` from
 * also matching the `.adm-table .adm-state` further down the sheet.
 */
function ruleOf(css: string, selector: string) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const found = css.match(new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`));
	const stated = new Map<string, string>();
	for (const declaration of (found?.[1] ?? '').split(';')) {
		const colon = declaration.indexOf(':');
		if (colon === -1) continue;
		stated.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
	}
	return stated;
}

const css = stripComments(readFileSync(SHEET, 'utf8'));
const pill = ruleOf(css, '.adm-state');
const cell = ruleOf(css, '.adm-table .adm-state');

/** the pill's own drawing: what it puts around the word rather than what it makes of the word. */
const around = [...pill.keys()].filter((property) => !WORD.has(property));

describe('a status drawn in a table cell is the word and nothing else', () => {
	it('finds the two rules it is meant to be reading', () => {
		// without this a selector renamed in the sheet reads as two empty rules agreeing with each
		// other, which is this whole file passing at its loudest while drawing a pill in every cell.
		expect(around).not.toEqual([]);
		expect([...cell.keys()]).not.toEqual([]);
	});

	it('answers every part of the pill the sheet draws around the word', () => {
		expect(around.filter((property) => !cell.has(property))).toEqual([]);
	});

	it('draws no ground, no padding and no corner there', () => {
		expect(
			around
				.map((property) => [property, cell.get(property)] as const)
				.filter(([, value]) => value === undefined || !NOTHING.test(value))
		).toEqual([]);
	});

	it("takes the plane's size rather than the body's", () => {
		// the older half of the rule, and the half that survives the pill coming off: a word set a
		// step above every other cell reads as the row pointing at itself.
		expect(cell.get('font-size')).toBe('var(--admin-table-size)');
	});
});
