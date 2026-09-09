import { globSync } from 'node:fs';
import {
	rawColourViolations,
	rawLengthViolations
} from '@better-giving/operator/styles/raw-values';
import { describe, expect, it } from 'vitest';

// this package's half of the gate CLAUDE.md's design-system section describes: no colour or length
// in a mail that is not taken from the operator token file. a mail cannot read a stylesheet, so
// every value it renders is spelled into an inline style attribute — which makes these templates
// the one surface where a raw value is not merely possible but the path of least resistance, and
// the only thing standing against it is this sweep and ./tokens.ts above it.
//
// what the sweep reads is the `CSSProperties` objects each file hoists out of its markup. a mail's
// styling is named objects rather than inline `style={{ }}` attributes, and the shared extractor
// reads both shapes for that reason (packages/operator/src/styles/raw-values.ts says so at
// `styleObjectsIn`); a sweep that read only the attribute shape would report every file here clean
// no matter what was in it.
//
// this is one of five callers, each its own surface's: packages/app/src/lib/admin/styles/raw-color.spec.ts
// and .../conformance.spec.ts are the dashboard's two, packages/operator/src/components/raw-values.spec.ts
// is the shared components', packages/console-ui/src/raw-values.spec.ts is the console's, and this
// file is the mail templates'. each glob is its own caller's, for the reason that shared file states
// about every caller's: a glob that quietly stops matching reads as a passing gate forever, and only
// the surface that wrote it knows what it was meant to reach.
//
// the specs beside the templates are left out. what they name is the string a template rendered —
// a `style="..."` a client will receive — rather than a value chosen in the file, and a rendered
// string is what a spec exists to hold.

describe('no raw colour or length in a mail', () => {
	const shell = globSync('src/components/*.tsx').filter((file) => !file.includes('.spec.'));
	const templates = globSync('src/templates/*.tsx').filter((file) => !file.includes('.spec.'));
	const mails = [...shell, ...templates];

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when a glob is wrong and nothing is read, which is
		// the failure the whole file exists to refuse. each glob is counted on its own: summed, a
		// tree that stopped matching hides behind the other one still matching.
		expect(shell.length).toBeGreaterThan(0);
		expect(templates.length).toBeGreaterThan(3);
	});

	it('writes no raw colour into a mail', () => {
		expect(rawColourViolations(mails)).toEqual([]);
	});

	it('writes no raw length into a mail', () => {
		expect(rawLengthViolations(mails)).toEqual([]);
	});
});
