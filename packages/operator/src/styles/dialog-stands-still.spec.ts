import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// a question the server drew stands where the lifted one will, so nothing moves when
// ../behaviour/Dialog.tsx calls `showModal()`.
//
// **a press can span the lift.** a question reached by a link or a reload is pressable before the
// script arrives, and a press that goes down on one of its controls and comes up after the lift
// has to come up on the same control. a card drawn anywhere else before the lift ends that press on
// the `::backdrop`, and the answer the reader gave is lost.
//
// the box is the registry's `ds-dialog` (../registry/styles/dialog-css.css), which places it fixed
// against all four insets and centres it by its margins on the class itself rather than on
// `:modal`, so the open element and the shown modal are one box. what is held here is that the
// registry still places it that way, and that the in-page presentation in ./adm.css restates
// nothing the box is placed or sized by.

const css = sheet('adm.css');
// resolved through `fileURLToPath`, which ./field-on-a-tight-stack.dom.spec.tsx argues.
const registry = stripComments(
	readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '../registry/styles/dialog-css.css'),
		'utf8'
	)
);
const box = ruleOf(registry, '.ds-dialog');
const inPage = ruleOf(css, '.adm-dialog--inline:not(:modal)');

/** what places and sizes the card, which the two presentations share. */
const BOX = [
	'position',
	'inset',
	'inline-size',
	'max-inline-size',
	'max-block-size',
	'block-size',
	'padding',
	'border',
	'border-width',
	'margin'
];

describe('the question the server drew stands where the lifted one will', () => {
	it('is fixed against all four insets and centred by its margins, open or shown modally', () => {
		expect([box.get('position'), box.get('inset'), box.get('margin')]).toEqual([
			'fixed',
			'0',
			'auto'
		]);
		// the placement is the class's own: a rule keyed on `:modal` or `[open]` would place one
		// presentation and not the other.
		const placing = rulesIn(registry).filter(
			({ selector, stated }) =>
				/\.ds-dialog\b(?!-)/.test(selector) &&
				/:modal|\[open\]/.test(selector) &&
				(stated.has('position') || stated.has('inset') || stated.has('margin'))
		);
		expect(placing.map(({ selector }) => selector)).toEqual([]);
	});

	it("is capped by the registry's own rule, not by the browser's", () => {
		expect(box.has('max-inline-size')).toBe(true);
		expect(box.has('max-block-size')).toBe(true);
	});

	it('restates nothing the card is placed or sized by', () => {
		expect([...inPage.keys()]).not.toEqual([]);
		expect(BOX.filter((property) => inPage.has(property))).toEqual([]);
	});

	it('stands over the bar, on the scrim the top layer draws', () => {
		expect(inPage.get('z-index')).toBe('3');
		expect(inPage.get('box-shadow')).toContain('var(--admin-scrim)');
		// the scrim is the registry's `--overlay`, the colour its `::backdrop` paints.
		expect(ruleOf(registry, '.ds-dialog::backdrop').get('background-color')).toBe('var(--overlay)');
		expect(sheet('tokens.css')).toMatch(/--admin-scrim:\s*var\(--overlay\)/);
	});
});
