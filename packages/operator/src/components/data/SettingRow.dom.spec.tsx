import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { SettingRow } from './SettingRow.jsx';

// a row carries one mark and it stands after the thing it is about — the fault after the label.
// that is the whole of what the row decides, and it is what a screen otherwise has to draw for
// itself.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

describe('a setting row mounted into a document', () => {
	it('puts the fault after the label, and nothing after the value', () => {
		const root = render(SettingRow, {
			label: 'Webhook secret',
			reading: 'unset',
			note: <span data-test="note">Why Webhook secret needs attention</span>
		});

		expect(root.querySelector('.adm-setting__label > [data-test]')?.getAttribute('data-test')).toBe(
			'note'
		);
		expect(root.querySelector('.adm-setting__value > [data-test]')).toBeNull();
	});

	it('holds none open on a row that carries none', () => {
		// every label in a list starts at the same x, so a row with no mark reserves nothing for one:
		// the label cell holds the words alone, and the value cell holds the reading and nothing
		// beside it.
		const root = render(SettingRow, { label: 'Currency', value: 'USD' });

		expect(root.querySelector('.adm-setting__label')?.children).toHaveLength(0);
		expect(root.querySelector('.adm-setting__value')?.children).toHaveLength(1);
		expect(root.querySelector('.adm-setting__value')?.textContent).toBe('USD');
	});
});

describe('a row that says it holds a value and holds none', () => {
	it('says so in words rather than drawing the blank', () => {
		// a blank beside a label reads as a screen that failed to load one rather than as a setting
		// nobody has set. the row already has the reading that states that in words, so a value cell
		// with nothing in it takes it instead of drawing an empty chip.
		const root = render(SettingRow, { label: 'Minimum gift' });

		expect(root.querySelector('.adm-setting__value')?.textContent).toBe('Not set');
		expect(root.querySelector('.adm-state--unset')).not.toBeNull();
	});

	it('reads an empty string the same way, which is the same blank by another door', () => {
		// a nullable column mapped to `?? ''` on the way to the screen arrives here as a string that
		// draws exactly nothing.
		const root = render(SettingRow, { label: 'Minimum gift', reading: 'value', value: '' });

		expect(root.querySelector('.adm-setting__value')?.textContent).toBe('Not set');
	});

	it('leaves the other three readings alone', () => {
		// only `value` is routed: `literal` draws the same string in the code face and is a reading
		// of its own, and the two word readings ignore `value` entirely.
		const root = render(SettingRow, { label: 'Receipt sender', reading: 'literal', value: '' });

		expect(root.querySelector('.adm-state--unset')).toBeNull();
	});
});
