import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rawColourViolations, rawLengthViolations } from '../styles/raw-values';

// this package's half of the gate CLAUDE.md's design-system section describes: no colour or length
// in a component that is not taken from ../styles/tokens.css. the five component groups beside this
// file draw ../styles/adm.css's classes and almost nothing on their own terms, so what this sweeps
// is the one place a raw value could still slip through: an inline `style={{ }}` object, which
// ../styles/raw-values.ts extracts from a .jsx or .tsx file.
//
// ../behaviour/ is swept by the same pass and is a second glob rather than a widened one, because
// it is a second tree with a second extension: the shells there are `.tsx` and the components are
// `.jsx`. a gate that reached the components and silently stopped reaching the shells would read
// exactly like this one passing.
//
// this is one of five callers, each its own surface's: packages/app/src/lib/admin/styles/raw-color.spec.ts
// and .../conformance.spec.ts are the dashboard's two, packages/console-ui/src/raw-values.spec.ts is
// the console's, packages/emails/src/raw-values.spec.ts is the mail templates', and this file is
// operator's own, over the components beside it. each glob is its own caller's, for the reason
// ../styles/raw-values.spec.ts states about every caller's: a glob that quietly stops matching
// reads as a passing gate forever, and only the surface that wrote it knows what it was meant to
// reach. each threshold below counts one of this file's own two trees.

describe('no raw colour or length in an operator component', () => {
	const groups = globSync('src/components/*/*.jsx');
	const shells = globSync('src/behaviour/*.tsx').filter((file) => !file.includes('.spec.'));
	const components = [...groups, ...shells];

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when a glob is wrong and nothing is read, which is
		// the failure the whole file exists to refuse. each glob is counted on its own: summed, a
		// tree that stopped matching hides behind the other one still matching.
		expect(groups.length).toBeGreaterThan(20);
		expect(shells.length).toBeGreaterThan(0);
	});

	it('writes no raw colour into a component', () => {
		expect(rawColourViolations(components)).toEqual([]);
	});

	it('writes no raw length into a component', () => {
		expect(rawLengthViolations(components)).toEqual([]);
	});
});
