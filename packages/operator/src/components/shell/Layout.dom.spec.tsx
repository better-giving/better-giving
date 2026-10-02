import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Group } from './Layout.jsx';

// what a `Group` draws when a caller states less than everything: the band's element is the one
// part with a default of its own, and the band's words are the caller's alone. a primitive that
// filled them in would print one screen's copy on every surface that forgot to say its own.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

describe('the band a group names itself in', () => {
	it('draws its name as an h3 where no level is stated', () => {
		const root = render(Group, { label: 'Receipts', children: <p>Sent from this address.</p> });

		const band = root.querySelector('.adm-group__label');
		expect(band?.tagName).toBe('H3');
		expect(band?.textContent).toBe('Receipts');
	});

	it('draws the level a caller states', () => {
		const root = render(Group, { label: 'Receipts', labelAs: 'h5' });

		expect(root.querySelector('.adm-group__label')?.tagName).toBe('H5');
	});

	it('prints no name of its own where the caller stated none', () => {
		// @ts-expect-error `label` is required: dropping it is what the type check exists to catch.
		const root = render(Group, { labelAs: 'h3', children: <p>Sent from this address.</p> });

		expect(root.textContent).not.toContain('Payment notifications');
	});
});
