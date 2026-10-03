import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Group } from './Layout.jsx';

// what a `Group` draws when a caller states less than everything. both of the band's parts are the
// caller's: its words, because a primitive that filled them in would print one screen's copy on
// every surface that forgot to say its own, and its level, because the level a band belongs at is
// a fact about what it is drawn under — ./Layout.jsx's `GroupProps` argues both.
//
// the two refusals are type-level: `tsc -p tsconfig.specs.json` is what fails when either
// `@ts-expect-error` stops having an error under it, and the run cannot see that at all.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

describe('the band a group names itself in', () => {
	it('draws its name at the level a caller states', () => {
		const root = render(Group, { label: 'Receipts', labelAs: 'h5' });

		const band = root.querySelector('.adm-group__label');
		expect(band?.tagName).toBe('H5');
		expect(band?.textContent).toBe('Receipts');
	});

	it('takes no level of its own where the caller stated none', () => {
		// @ts-expect-error `labelAs` is required: dropping it is what the type check exists to catch.
		const unstated: ComponentProps<typeof Group> = { label: 'Receipts' };

		expect(unstated.labelAs).toBeUndefined();
	});

	it('prints no name of its own where the caller stated none', () => {
		// @ts-expect-error `label` is required: dropping it is what the type check exists to catch.
		const root = render(Group, { labelAs: 'h3', children: <p>Sent from this address.</p> });

		expect(root.textContent).not.toContain('Payment notifications');
	});
});
