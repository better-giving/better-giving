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
// the registry draws no groundless chip, and `.adm-state--note` in ./adm.css takes the ground off.
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
const TONED = ['success', 'warning', 'destructive', 'primary'] as const;

/** the classes ../components/status/StatusWord.jsx writes on a descriptive word: the badge and the note modifier. */
const WORD = /\.(?:ds-badge\b|adm-state--note\b)/;
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
		expect(rulesIn(css).length).toBeGreaterThan(100);
	});

	it('takes no ground and no corner back off the word in a cell', () => {
		// the set is not empty: the note modifier is a rule naming the word, and a class renamed in
		// StatusWord.jsx and not here would leave nothing for the cell check to look at.
		expect(wordRules(css).map(({ selector }) => selector)).toContain('.adm-state--note');
		expect(inACell(css)).toEqual([]);
	});

	it('would catch a rule that did take the ground off a word in a cell', () => {
		// the control for the case above: the filter finds a table-keyed rule on each class the word
		// is written with, so an empty result there is the sheet's and not the filter's.
		for (const selector of [
			'.adm-table td .ds-badge',
			'.adm-table .adm-state--note',
			'td .ds-badge-neutral'
		]) {
			expect(inACell(`${selector} { background: none; }`).map((rule) => rule.selector)).toEqual([
				selector
			]);
		}
		expect(inACell('.adm-table td .adm-other { background: none; }')).toEqual([]);
	});

	it('states a ground on the word only in the note modifier', () => {
		expect(
			wordRules(css)
				.filter(({ drawn }) => drawn.length > 0)
				.map(({ selector }) => selector)
		).toEqual(['.adm-state--note']);
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
	const note = ruleOf(css, '.adm-state--note');

	it('draws the ended word with no ground where the at-rest word has one', () => {
		expect(note.get('background') ?? '').toMatch(NOTHING);
		expect(atRest.get('background-color') ?? '').not.toMatch(NOTHING);
	});

	it('keeps the ended word legible on the ground it now stands on', () => {
		// an ink-11 word on the page's own 1 or 2, which radix builds step 11 to be read on.
		expect(note.get('color')).toBe('var(--admin-tone-note-ink)');
	});

	it('is drawn in a layer after the registry layer the neutral badge is in, so its ground wins', () => {
		// the note rule names a class and the badge rule names a class: equal specificity, so what
		// settles it is the layer. a later layer beats an earlier one whatever the selectors, and
		// `background` is the shorthand that resets the `background-color` the badge sets.
		const app = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), '../../../app/src/app.css'),
			'utf8'
		);
		const order = (app.replace(/\/\*[\s\S]*?\*\//g, '').match(/@layer\s+([^;{]+);/)?.[1] ?? '')
			.split(',')
			.map((name) => name.trim());
		const noteAt = css.indexOf('.adm-state--note {');
		const layerOfNote = [...css.slice(0, noteAt).matchAll(/@layer\s+(\w+)\s*\{/g)].at(-1)?.[1];

		expect(noteAt).toBeGreaterThan(-1);
		expect(order.indexOf('registry')).toBeGreaterThan(-1);
		expect(order.indexOf(layerOfNote ?? '')).toBeGreaterThan(order.indexOf('registry'));
		// the registry sheet is read into that layer, from the entry sheet.
		expect(app).toMatch(/registry\/styles\/badge-css\.css'\s+layer\(registry\)/);
		// and the layer is the whole of the ordering: an `!important` in the badge's ground would
		// outrank every later layer, and a layer the sheet declares itself would sit outside it.
		expect(registry).not.toMatch(/!important/);
		expect(registry).not.toMatch(/@layer/);
		expect([...note.keys()].filter((property) => /^background/.test(property))).toEqual([
			'background'
		]);
		expect(atRest.has('background-color')).toBe(true);
	});
});
