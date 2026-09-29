import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from './sheet-rule.testing';

// a question the server drew stands where the lifted one will, so nothing moves when
// ../behaviour/Dialog.tsx calls `showModal()`.
//
// **a press can span the lift.** a question reached by a link or a reload is pressable before the
// script arrives, and a press that goes down on one of its controls and comes up after the lift
// has to come up on the same control. a card drawn anywhere else before the lift ends that press on
// the `::backdrop`, and the answer the reader gave is lost.
//
// a shown modal is `position: fixed` against all four insets in the browser's own sheet, and
// `margin: auto` in ./adm.css is what centres it; its caps are this sheet's too, because the
// browser caps a shown modal and leaves an open, never-lifted element uncapped. so what is held
// here is the in-page presentation stating the same position, insets and margin, and restating
// nothing the one box is drawn with.

const css = sheet('adm.css');
const card = ruleOf(css, '.adm-dialog');
const inPage = ruleOf(css, '.adm-dialog--inline:not(:modal)');

/** what sizes and places the card, which the two presentations share. */
const BOX = [
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
	it('is fixed against all four insets, as a shown modal is', () => {
		expect(inPage.get('position')).toBe('fixed');
		expect(inPage.get('inset')).toBe('0');
	});

	it('is centred by the margin a shown modal is centred by', () => {
		expect(ruleOf(css, '.adm-dialog--inline').get('margin')).toBe('auto');
	});

	it("is capped by the card's own rule in both presentations, not by the browser's", () => {
		expect(card.has('max-inline-size')).toBe(true);
		expect(card.has('max-block-size')).toBe(true);
	});

	it('restates nothing the card is sized or placed by', () => {
		expect(BOX.filter((property) => inPage.has(property))).toEqual([]);
	});

	it('stands over the bar, on the scrim the top layer draws', () => {
		expect(inPage.get('z-index')).toBe('3');
		expect(inPage.get('box-shadow')).toContain('var(--admin-scrim)');
	});
});
