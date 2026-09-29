import { describe, expect, it } from 'vitest';
import { rulesIn, sheet } from './sheet-rule.testing';

// a quiet small control at the start of any line of a page header's or a group's actions row
// aligns by its word, which ./adm.css does by pulling the row or its first control out by the
// padding and border the control keeps.
//
// **the row wraps at the 375px floor, and a wrapped control starts a line too.** a pull on the
// first control alone leaves every later line's word a padding in from the column's edge — the API
// page's "Open agent prompt" under a flush "API reference". a row of nothing but quiet small
// controls is pulled as one; a row holding anything else keeps the pull on its first control.
//
// what is asked is which element each rule stating the pull matches, in a row built here: the
// pull counted twice on one line is as wrong as none, so the row and its first control are never
// both pulled.

const css = sheet('adm.css');
const PULL = 'calc(-1 * (var(--admin-space-4) + var(--admin-border-width)))';
const pulls = rulesIn(css)
	.filter(({ stated }) => stated.get('margin-inline-start') === PULL)
	.map(({ selector }) => selector);

function quiet(tag: 'a' | 'button') {
	const control = document.createElement(tag);
	control.className = 'adm-btn adm-btn--quiet adm-btn--sm';
	return control;
}

/** a row standing where the pull applies, holding the items handed in. */
function row(where: 'grouped' | 'header', items: readonly Element[]) {
	const outer = document.createElement('div');
	outer.className = where === 'grouped' ? 'adm-grouped' : 'adm-pageheader__row';
	const actions = document.createElement('div');
	actions.className = 'adm-actions';
	actions.append(...items);
	outer.append(actions);
	document.body.replaceChildren(outer);
	return actions;
}

const pulled = (element: Element) => pulls.some((selector) => element.matches(selector));

describe("an actions row's lines start on the column's edge by their word", () => {
	it('finds the pull in the sheet', () => {
		expect(pulls).not.toEqual([]);
	});

	it.each(['grouped', 'header'] as const)(
		'pulls a %s row of quiet small controls as one, beside a live region',
		(where) => {
			const live = document.createElement('span');
			live.className = 'adm-vh';
			const items = [quiet('a'), quiet('button'), live, quiet('a')];
			const actions = row(where, items);

			expect(pulled(actions)).toBe(true);
			expect(items.filter(pulled)).toEqual([]);
		}
	);

	it.each(['grouped', 'header'] as const)(
		'pulls the first control of a %s row that holds a control with a ground',
		(where) => {
			const first = quiet('a');
			const grounded = document.createElement('button');
			grounded.className = 'adm-btn';
			const actions = row(where, [first, grounded, quiet('a')]);

			expect(pulled(actions)).toBe(false);
			expect([first, grounded].map(pulled)).toEqual([true, false]);
		}
	);
});
