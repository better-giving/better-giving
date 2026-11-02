import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the descriptive status word is a pill everywhere on an operator surface, a table cell included:
// the gifts list at /admin/donations draws its status column as pills, a settled gift on slate 3
// under slate 11, a waiting one on amber 3 under amber 11 and a failed one on red 3 under red 11.
// ./adm.css compacts the pill's inset at `.adm-table .adm-state` and nothing more.
//
// **it exists because a table's rule is keyed on position and nothing in the markup says so.** no
// screen passes a prop for it, so the only statement of what a cell does to the word is the sheet,
// and a ground taken back off there is every status in every table on both surfaces losing its
// ground with no diff anywhere near a table to read.
//
// the second half holds the at-rest/ended split ../../../app/src/lib/admin/status-tones.ts states:
// a record at rest takes the hueless pill, and an ended one (`note`) keeps the word in the same ink
// and loses the ground, so `Completed` and `Refunded` differ by a ground and not by one ink step.
//
// it reads the sheet's text, for ./raw-values.ts's reason: what a rule draws is not observable from
// a value. ../../vitest.config.ts renders the dom pool into happy-dom, which lays nothing out, and
// no /admin screen gets a `*.browser.spec.ts` (AGENTS.md, Never).

/** the sheet's word for nothing: the two spellings ./tokens.css names, and the css keywords. */
const NOTHING = /^(?:none|transparent|var\(--admin-(?:space|radius)-0\))$/;

const css = sheet('adm.css');
const pill = ruleOf(css, '.adm-state');
const cell = ruleOf(css, '.adm-table .adm-state');
const TONED = ['done', 'attention', 'blocker'] as const;

/** every declaration of `property` stated by a rule reaching a status word in a table. */
const inACell = (property: string) =>
	rulesIn(css)
		.filter(({ selector }) => /\.adm-table\b[^,]*\.adm-state/.test(selector))
		.map(({ selector, stated }) => [selector, stated.get(property)] as const)
		.filter(([, value]) => value !== undefined);

describe('a status drawn in a table cell is still the pill', () => {
	it('finds the rules it is meant to be reading', () => {
		// without this a selector renamed in the sheet reads as empty rules agreeing with each other.
		expect([...pill.keys()]).not.toEqual([]);
		expect([...cell.keys()]).not.toEqual([]);
	});

	it('takes no ground and no corner back off the word in a cell', () => {
		expect(inACell('background')).toEqual([]);
		expect(inACell('background-color')).toEqual([]);
		expect(inACell('border-radius')).toEqual([]);
	});

	it('draws the at-rest pill as the gifts list at /admin/donations does, slate 3 under slate 11', () => {
		expect(pill.get('background')).toBe('var(--admin-tone-note-tint)');
		expect(pill.get('color')).toBe('var(--admin-ink-2)');
		expect(pill.get('border-radius')).toBe('var(--admin-radius-pill)');
	});

	it("keeps each tone's own pill: its word on its tint", () => {
		expect(
			TONED.map((tone) => [tone, ruleOf(css, `.adm-state--${tone}`).get('background')])
		).toEqual(TONED.map((tone) => [tone, `var(--admin-tone-${tone}-tint)`]));
	});

	it('compacts the inset in a cell and leaves it some', () => {
		const inset = cell.get('padding') ?? '';
		expect(inset).not.toMatch(NOTHING);
		expect(inset).not.toBe(pill.get('padding'));
	});
});

describe('an ended record is told from one at rest by more than an ink step', () => {
	const note = ruleOf(css, '.adm-state--note');

	it('draws the ended word with no ground where the at-rest word has one', () => {
		expect(note.get('background') ?? '').toMatch(NOTHING);
		expect(pill.get('background') ?? '').not.toMatch(NOTHING);
	});

	it('keeps the ended word legible on the ground it now stands on', () => {
		// an ink-11 word on the page's own 1 or 2, which radix builds step 11 to be read on.
		expect(note.get('color')).toBe('var(--admin-tone-note-ink)');
	});
});
