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

/** every declaration of `property` stated by a rule reaching a status word in a table. */
const inACell = (property: string) =>
	rulesIn(css)
		.filter(({ selector }) => /\.adm-table\b[^,]*\.adm-state/.test(selector))
		.map(({ selector, stated }) => [selector, stated.get(property)] as const)
		.filter(([, value]) => value !== undefined);

describe('a status drawn in a table cell is still the badge', () => {
	it('finds the rules it is meant to be reading', () => {
		// without this a selector renamed in the sheet reads as empty rules agreeing with each other.
		expect([...atRest.keys()]).not.toEqual([]);
		expect(rulesIn(css).length).toBeGreaterThan(100);
	});

	it('takes no ground and no corner back off the word in a cell', () => {
		expect(inACell('background')).toEqual([]);
		expect(inACell('background-color')).toEqual([]);
		expect(inACell('border-radius')).toEqual([]);
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
});
