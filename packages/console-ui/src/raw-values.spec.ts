import {
	rawColourViolations,
	rawLengthViolations
} from '@better-giving/operator/styles/raw-values';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the console's half of the gate that keeps a value out of a screen. every colour and every length
// comes from packages/operator/src/styles/tokens.css, which is what makes a step re-pointable in one
// place and what stops the two operator surfaces drifting apart a value at a time.
//
// this file holds only what is the console's: which files are swept, and the case that says the
// globs reaching them matched something. the sweep itself, the deny lists behind it and the
// `raw-colour-ok:` / `raw-length-ok:` bargain are packages/operator/src/styles/raw-values.ts's —
// one rule wherever a screen lives, called here with globs of this surface rather than copied.
// packages/app/src/lib/admin/styles/raw-color.spec.ts and .../conformance.spec.ts are the
// dashboard's two halves of the same arrangement.
//
// the four sheets are swept there and not here, and that is the boundary rather than an oversight:
// they live in packages/operator and one surface reading them twice proves nothing the first
// reading did not. what this surface owns is its screens and ../app.css, which is where its layer
// order is declared — a colour written there would outrank the layer every sheet's rule is inside.
//
// the length sweep is handed the screens and nothing else, for the reason written beside the
// assertion in packages/operator/src/styles/raw-values.ts: a `1px` border in a sheet is legitimate
// and everywhere, and a rule over the sheets would be mostly allowlist. what a screen here
// contributes to either sweep is its inline `style={{ }}` objects and nothing else, which is
// almost none of the file — so the case below counts the files rather than trusting the sweep to
// have found something to say.

describe('no raw value in a console screen', () => {
	const screens = globSync('src/**/*.tsx');
	// named rather than swept, so that a second sheet appearing beside it is a decision somebody
	// makes rather than one this list quietly absorbs — see the case below.
	const stylesheets = ['src/app.css'];

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when a glob is wrong and nothing is read, which is
		// the failure the whole file exists to refuse. it stays here rather than moving in with the
		// sweep: only the surface that wrote a glob knows what it was supposed to reach.
		expect(screens.length).toBeGreaterThan(0);
		// this package defines no css of its own and has one sheet, which names an order and
		// nothing else. a second .css file here would be a value defined outside
		// packages/operator/src/styles/tokens.css, so it fails this rather than joining the list
		// above unnoticed.
		expect(globSync('src/**/*.css')).toEqual(stylesheets);
	});

	it('writes no colour into a screen', () => {
		expect(rawColourViolations(screens)).toEqual([]);
	});

	it('writes no colour into the sheet that names the layer order', () => {
		expect(rawColourViolations(stylesheets)).toEqual([]);
	});

	it('writes no length into a screen', () => {
		expect(rawLengthViolations(screens)).toEqual([]);
	});
});
