import { describe, expect, it } from 'vitest';
import { rulesIn, sheet } from './sheet-rule.testing';

// what ./adm.css adds to page-state-css (../components/shell/PageState.jsx).

const css = sheet('adm.css');

// the title takes focus from script when a navigation lands on the state, which is how a screen
// reader finds it, and it is no control: page-state-css draws it no ring then
// (../registry/styles/page-state-css.usage.md). that sheet takes the outline off, and ./base.css's
// ring is a box-shadow it does not name, so this sheet takes the shadow off too — on the pinned
// twin as well, so the gallery's forced focus shows what a reader sees.
describe('a page state’s title taking focus', () => {
	const rule = rulesIn(css).find(
		({ selector }) =>
			selector === '.adm-pagestate__title:focus-visible, .adm-pagestate__title.is-focus'
	);

	it('draws no ring', () => {
		expect(rule?.stated.get('box-shadow')).toBe('none');
	});
});
