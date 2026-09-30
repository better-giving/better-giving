import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the account row in the rail's foot (../components/shell/AccountRow.jsx), as ./adm.css draws it.
//
// **its ink is one ink.** the row's address is the page it was opened over plus a parameter, so it
// differs per page, and a link left in the link's own ink takes `a:visited` from ./base.css — the
// account's name a different shade on each page, by which pages the panel was once opened over. the
// sheets are layered (packages/console-ui/src/app.css names the order), so a colour stated on the
// link in `layout` holds over `base`'s visited ink whatever that rule's specificity.
//
// **the icon rail keeps a way in.** it takes the name off the screen and hides every other lead, and
// a row hidden with them leaves the panel, and the paid-plan switch in it, with no press at all until
// the rail is expanded.

const css = sheet('adm.css');

describe('the account row', () => {
	it('draws its link in the ink the name is in, visited or not', () => {
		expect(ruleOf(css, '.adm-footaccount__open').get('color')).toBe('var(--admin-ink)');
		const layers = [...css.matchAll(/@layer (\w+) \{/g)];
		const layer = layers.filter((found) => found.index < css.indexOf('.adm-footaccount__open {'));
		expect(layer.at(-1)?.[1]).toBe('layout');
	});

	it('is never taken out of the icon rail', () => {
		const hiding = rulesIn(css).filter(
			({ selector, stated }) =>
				selector.includes('.adm-footaccount__open') && stated.get('display') === 'none'
		);
		expect(hiding).toEqual([]);
	});

	it('keeps its logo in the icon rail, where every other lead is hidden', () => {
		expect(
			ruleOf(css, '.adm-shell--collapsed .adm-footaccount__open > .adm-rail__lead').get('display')
		).toBe('flex');
	});
});
