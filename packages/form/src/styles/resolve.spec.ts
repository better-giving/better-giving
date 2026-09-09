import { describe, expect, it } from 'vitest';
import { APPEARANCE_INPUTS } from './appearance';
import { CLASSIFIED_TOKENS } from './resolve';

// node pool, and that is the point: ./resolve.browser.spec.ts asserts the same partition from a
// real cascade, but the browser pool runs out of band from `pnpm test` and from the commit gate
// (CONTRIBUTING.md → Tests), so a drift there is a drift nothing stops. the partition is a list
// of strings either way, so the question is decidable here.

describe('the partition ./resolve.ts resolves through', () => {
	// a token in the map and not in a kind arrives as an unresolved string rather than as a
	// failure; a token in a kind and not in the map is a read of something nothing asks for, and
	// a misspelling is both at once.
	it('classifies every token the map asks for, and nothing it does not', () => {
		const asked = APPEARANCE_INPUTS.filter((property) => property.startsWith('--'));

		expect([...CLASSIFIED_TOKENS].sort()).toEqual([...asked].sort());
	});

	// the two standard properties are the rest of the map, and they are deliberately unclassified:
	// they are declared on `:host` and reach the probe already resolved, so a carrier would be a
	// custom property assigned to itself.
	it('leaves the properties the cascade resolves on its own out of every kind', () => {
		const standard = APPEARANCE_INPUTS.filter((property) => !property.startsWith('--'));

		expect(standard).toEqual(['font-family', 'font-size']);
		for (const property of standard) expect(CLASSIFIED_TOKENS).not.toContain(property);
	});
});
