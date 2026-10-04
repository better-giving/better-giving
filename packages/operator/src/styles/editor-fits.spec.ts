import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from './sheet-rule.testing';

// a page editor at a phone's width holds whatever a campaign is named, and what an operator typed
// into the AI's questions, within the screen.
//
// `.adm-editor` is a grid, and an implicit `auto` column grows to the min-content width of what it
// holds: the publish bar's, which takes the name's whole length where the name does not wrap. on a
// 375px screen any name past about thirty characters would push the bar's presses and the
// preview's end past the edge, where nothing scrolls to them. a `minmax(0, 1fr)` track is as wide
// as the editor and no wider, and the name gives way inside it.

const css = sheet('adm.css');

describe('the page editor at a phone’s width', () => {
	it('lays everything in one track the width of the editor, whatever it holds', () => {
		expect(ruleOf(css, '.adm-editor').get('grid-template-columns')).toBe('minmax(0, 1fr)');
	});

	it('lets the name give way inside the bar, cut short rather than wrapped', () => {
		expect(ruleOf(css, '.adm-publishbar__who').get('min-inline-size')).toBe('0');
		for (const name of ['.adm-publishbar__name', '.adm-inplace']) {
			const rule = ruleOf(css, name);
			expect(rule.get('min-inline-size')).toBe('0');
			expect(rule.get('overflow')).toBe('hidden');
			expect(rule.get('text-overflow')).toBe('ellipsis');
		}
	});

	it('breaks a long word or address in an answer rather than running out of the summary', () => {
		expect(ruleOf(css, '.adm-answers__list > dd').get('overflow-wrap')).toBe('anywhere');
	});
});
