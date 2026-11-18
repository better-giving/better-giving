import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

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

// page-state-css centres the state in what `<main>` gives it by `flex: 1` (app-shell-css's
// `.ds-shell-main` is a flex column), and a screen whose state stands under its own header in the
// measured column (`Column` in ../components/shell/Layout.jsx) puts it one box further in, where
// nothing grows: the state then sits at the top. a column holding one fills what main gives it and
// becomes a flex column, so the header keeps its own height above and the state takes the rest.
describe('a column holding a page state', () => {
	const column = ruleOf(css, '.adm-column:has(> .adm-pagestate)');

	it('fills what main gives it', () => {
		expect(column.get('flex')).toBe('1 1 auto');
	});

	it('lets the state grow into the rest, under the header', () => {
		expect(column.get('display')).toBe('flex');
		expect(column.get('flex-direction')).toBe('column');
	});
});
