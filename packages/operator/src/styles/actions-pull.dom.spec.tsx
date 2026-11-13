import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// a quiet small control at the start of any line of a page header's or a group's actions row
// aligns by its word, which ./adm.css does by pulling the row or its first control out by the
// padding the registry's small ghost press keeps and the transparent edge every registry rank draws
// (../registry/styles/button-css.css). the edge is declared on the press, so a pulled row takes the
// padding and sets each of its controls back by its own edge.
//
// **the row wraps at the 375px floor, and a wrapped control starts a line too.** a pull on the
// first control alone leaves every later line's word a padding in from the column's edge — the API
// page's "Open agent prompt" under a flush "API reference". a row of nothing but quiet small
// controls is pulled as one; a row holding anything else keeps the pull on its first control.
//
// what is asked is which element each rule stating a pull matches, in a row built here: the
// pull counted twice on one line is as wrong as none, so the row and its first control are never
// both pulled, and a control is set back by its edge only inside a row pulled by the padding alone.

const css = sheet('adm.css');
const PADDING = 'calc(-1 * var(--admin-space-5))';
const PADDING_AND_EDGE = 'calc(-1 * (var(--admin-space-5) + var(--ds-btn-edge)))';
const EDGE = 'calc(-1 * var(--ds-btn-edge))';
const stating = (property: string, value: string) =>
	rulesIn(css)
		.filter(({ stated }) => stated.get(property) === value)
		.map(({ selector }) => selector);
const byPadding = stating('margin-inline-start', PADDING);
const byPaddingAndEdge = stating('margin-inline-start', PADDING_AND_EDGE);
const byEdge = stating('inset-inline-start', EDGE);

function quiet(tag: 'a' | 'button') {
	const control = document.createElement(tag);
	// what ../components/controls/Button.jsx writes for `variant="quiet" size="sm"`.
	control.className = 'ds-btn ds-btn-ghost ds-btn-sm adm-btn adm-btn--quiet adm-btn--sm';
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

/** what each rule moves an element by: the padding, the padding and the edge, the edge alone. */
const moved = (element: Element) =>
	[
		byPadding.some((selector) => element.matches(selector)) ? 'padding' : '',
		byPaddingAndEdge.some((selector) => element.matches(selector)) ? 'padding and edge' : '',
		byEdge.some((selector) => element.matches(selector)) ? 'edge' : ''
	]
		.filter(Boolean)
		.join(', ');

describe("an actions row's lines start on the column's edge by their word", () => {
	it('finds every pull in the sheet', () => {
		expect([byPadding, byPaddingAndEdge, byEdge].map((rules) => rules.length > 0)).toEqual([
			true,
			true,
			true
		]);
	});

	it('pulls by exactly the padding and the edge the registry gives a small ghost press', () => {
		// the registry's step and the tier's multiple of it, against the token the pull spends.
		// resolved through `fileURLToPath`, which ./field-on-a-tight-stack.dom.spec.tsx argues.
		const registry = stripComments(
			readFileSync(
				join(dirname(fileURLToPath(import.meta.url)), '../registry/styles/button-css.css'),
				'utf8'
			)
		);
		const step = ruleOf(registry, '.ds-btn').get('--ds-spacing');
		const padding = ruleOf(registry, '.ds-btn-sm').get('padding-inline');
		const press = ruleOf(registry, '.ds-btn');
		const ghost = ruleOf(registry, '.ds-btn-ghost');
		const token = ruleOf(sheet('tokens.css'), ':root').get('--admin-space-5');

		expect([
			step,
			padding,
			press.get('--ds-btn-edge'),
			press.get('border'),
			ghost.get('--ds-btn-edge'),
			ghost.get('border'),
			token
		]).toEqual([
			'0.25rem',
			'calc(var(--ds-spacing) * 3)',
			'1px',
			'var(--ds-btn-edge) solid transparent',
			undefined,
			undefined,
			'0.75rem'
		]);
	});

	it.each(['grouped', 'header'] as const)(
		'pulls a %s row of quiet small controls as one, beside a live region',
		(where) => {
			const live = document.createElement('span');
			live.className = 'adm-vh';
			const items = [quiet('a'), quiet('button'), live, quiet('a')];
			const actions = row(where, items);

			expect(moved(actions)).toBe('padding');
			expect(items.map(moved)).toEqual(['edge', 'edge', '', 'edge']);
		}
	);

	it.each(['grouped', 'header'] as const)(
		'pulls the first control of a %s row that holds a control with a ground',
		(where) => {
			const first = quiet('a');
			const grounded = document.createElement('button');
			grounded.className = 'ds-btn ds-btn-secondary adm-btn';
			const last = quiet('a');
			const actions = row(where, [first, grounded, last]);

			expect(moved(actions)).toBe('');
			expect([first, grounded, last].map(moved)).toEqual(['padding and edge', '', '']);
		}
	);
});
