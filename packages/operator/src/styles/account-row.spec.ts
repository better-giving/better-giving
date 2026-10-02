import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the account row in the rail's foot (../components/shell/AccountRow.jsx), as ./adm.css draws it.
//
// **the icon rail still says whose account this is.** it hides every other lead and takes the
// names off the screen, and the account's label hidden with them leaves the rail with nothing
// saying which account the console is working in, to the eye or to a reader.

const css = sheet('adm.css');

describe('the account row', () => {
	it('is never taken out of the icon rail', () => {
		const hiding = rulesIn(css).filter(
			({ selector, stated }) =>
				(selector.includes('.adm-footaccount__label') ||
					selector.includes('.adm-footaccount__name')) &&
				stated.get('display') === 'none'
		);
		expect(hiding).toEqual([]);
	});

	it('keeps its logo in the icon rail, where every other lead is hidden', () => {
		expect(
			ruleOf(css, '.adm-shell--collapsed .adm-footaccount__label > .adm-rail__lead').get('display')
		).toBe('flex');
	});

	it('takes the name off the screen in the icon rail, and leaves it to be read', () => {
		const name = rulesIn(css).find(({ selector }) =>
			selector
				.split(',')
				.some((one) => one.trim() === '.adm-shell--collapsed .adm-footaccount__name')
		);
		expect(name?.stated.get('clip-path')).toBe('inset(50%)');
	});
});
