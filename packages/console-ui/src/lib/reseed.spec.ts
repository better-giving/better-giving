import { describe, expect, it } from 'vitest';
import { reseeded } from './reseed';

// when a form seeded from the deployment's own reading puts its boxes back.
//
// the readings are what a fold hands in, not what react does with them: this package has no DOM
// pool (../../vite.config.ts), and the emptying itself — a form really reset, and what a box holds
// afterwards — is packages/operator/src/saved-form-state.react.dom.spec.ts.

/** two readings of the same deployment, told apart the way a fold tells them apart. */
const before = { mail: {} };
const after = { mail: {} };

describe('when a landed write puts the boxes back', () => {
	it('does not, while the only reading on the screen is the one the press was made against', () => {
		expect(reseeded({ landed: true, reading: before, pressedWith: before })).toBe(false);
	});

	it('does, on the reading that landed after it', () => {
		expect(reseeded({ landed: true, reading: after, pressedWith: before })).toBe(true);
	});

	// a press turned down leaves the boxes holding what was typed: what has to change is one of
	// them, and the operator is standing in it.
	it('leaves them alone where nothing was written, however many readings land', () => {
		expect(reseeded({ landed: false, reading: after, pressedWith: before })).toBe(false);
	});

	/**
	 * two readings holding the same values are still two readings. a press that stores a credential
	 * changes no seed on the form — the mark over a stored one is the mark either way — so the boxes
	 * would never be put back if what was compared were what the readings hold.
	 */
	it('tells two readings apart by which reading they are, not by what they hold', () => {
		expect(before).toEqual(after);
		expect(reseeded({ landed: true, reading: after, pressedWith: before })).toBe(true);
	});
});
