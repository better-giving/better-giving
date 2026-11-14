import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './raw-values';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the descriptive status word is the registry's badge everywhere on an operator surface, a table
// cell included: the gifts list at /admin/donations draws its status column as badges, a settled
// gift on the neutral chip, a waiting one on the warning chip and a failed one on the destructive
// chip (../registry/styles/badge-css.css, through ../components/status/StatusWord.jsx).
//
// **it exists because a table's rule is keyed on position and nothing in the markup says so.** no
// screen passes a prop for it, so a rule in ./adm.css reaching the word in a cell would be every
// status in every table on both surfaces losing its ground with no diff anywhere near a table to
// read. the registry's badge is already the compact chip, so no rule here reaches one in a cell.
//
// the second half holds the at-rest/ended split ../../../app/src/lib/admin/status-tones.ts states:
// a record at rest takes the neutral badge, and an ended one (`note`) keeps a word in the quiet ink
// and loses the ground, so `Completed` and `Refunded` differ by a ground and not by one ink step.
// the registry's outline chip (`ds-badge-outline`) is that word, and ./adm.css draws nothing over
// it.
//
// it reads the sheets' text, for ./raw-values.ts's reason: what a rule draws is not observable from
// a value. ../../vitest.config.ts renders the dom pool into happy-dom, which lays nothing out, and
// no /admin screen gets a `*.browser.spec.ts` (AGENTS.md, Never).

/** the sheet's word for nothing: the two spellings ./tokens.css names, and the css keywords. */
const NOTHING = /^(?:none|transparent|var\(--admin-(?:space|radius)-0\))$/;

const css = sheet('adm.css');
// resolved through `fileURLToPath`, which ./field-on-a-tight-stack.dom.spec.tsx argues.
const registry = stripComments(
	readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '../registry/styles/badge-css.css'),
		'utf8'
	)
);
const atRest = ruleOf(registry, '.ds-badge-neutral');
const ended = ruleOf(registry, '.ds-badge-outline');
const TONED = ['success', 'warning', 'destructive', 'primary'] as const;

/** the class ../components/status/StatusWord.jsx writes on a descriptive word. */
const WORD = /\.ds-badge\b/;
/** a selector keyed on a table's position: the class, a bare table, or a cell. */
const KEYED_ON_A_TABLE = /\.adm-table\b|\btable\b|\bt[dh]\b/;
const GROUND = ['background', 'background-color', 'border-radius'] as const;

/** every rule of `sheetText` naming the word, with the grounds and corner it states. */
const wordRules = (sheetText: string) =>
	rulesIn(sheetText)
		.filter(({ selector }) => WORD.test(selector))
		.map(({ selector, stated }) => ({
			selector,
			drawn: GROUND.filter((property) => stated.has(property))
		}));

/** the word's rules that reach it through a table, and state a ground or a corner. */
const inACell = (sheetText: string) =>
	wordRules(sheetText).filter(
		({ selector, drawn }) => KEYED_ON_A_TABLE.test(selector) && drawn.length > 0
	);

describe('a status drawn in a table cell is still the badge', () => {
	it('finds the rules it is meant to be reading', () => {
		// without this a selector renamed in the sheet reads as empty rules agreeing with each other.
		expect([...atRest.keys()]).not.toEqual([]);
		expect([...ended.keys()]).not.toEqual([]);
		expect(rulesIn(css).length).toBeGreaterThan(100);
	});

	it('takes no ground and no corner back off the word in a cell', () => {
		expect(inACell(css)).toEqual([]);
	});

	it('would catch a rule that did take the ground off a word in a cell', () => {
		// the control for the case above: the filter finds a table-keyed rule on the class the word
		// is written with, so an empty result there is the sheet's and not the filter's.
		for (const selector of [
			'.adm-table td .ds-badge',
			'.adm-table .ds-badge-outline',
			'td .ds-badge-neutral'
		]) {
			expect(inACell(`${selector} { background: none; }`).map((rule) => rule.selector)).toEqual([
				selector
			]);
		}
		expect(inACell('.adm-table td .adm-other { background: none; }')).toEqual([]);
	});

	it('states no ground on the word anywhere in the operator sheet', () => {
		expect(
			wordRules(css)
				.filter(({ drawn }) => drawn.length > 0)
				.map(({ selector }) => selector)
		).toEqual([]);
	});

	it('draws the at-rest word on a ground', () => {
		expect(atRest.get('background-color') ?? '').not.toMatch(NOTHING);
	});

	it("keeps each tone's own chip: a ground of its own", () => {
		const grounds = TONED.map((variant) =>
			ruleOf(registry, `.ds-badge-${variant}`).get('background-color')
		);
		expect(grounds.filter((ground) => ground === undefined || NOTHING.test(ground))).toEqual([]);
		expect(new Set(grounds).size).toBe(TONED.length);
	});
});

describe('an ended record is told from one at rest by more than an ink step', () => {
	it('draws the ended word with no ground where the at-rest word has one', () => {
		expect(ended.get('background-color') ?? '').toMatch(NOTHING);
		expect(atRest.get('background-color') ?? '').not.toMatch(NOTHING);
	});

	it('keeps the ended word in the step-11 ink radix builds to be read on the page', () => {
		expect(ended.get('color')).toBe('var(--gray-11)');
	});

	it('is the registry’s alone: no rule of the operator sheet names the outline chip', () => {
		expect(rulesIn(css).filter(({ selector }) => /\.ds-badge-outline\b/.test(selector))).toEqual(
			[]
		);
	});
});
