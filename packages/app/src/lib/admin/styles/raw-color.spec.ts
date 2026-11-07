import { rawColourViolations } from '@better-giving/operator/styles/raw-values';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// no raw colour may be written into an /admin component. every colour comes from the semantic
// layer in packages/operator/src/styles/tokens.css, which is what makes a step re-pointable in one
// place and what keeps the no-green rule enforceable rather than merely stated.
//
// this file is the dashboard's half of that gate and holds only what is the dashboard's: which
// files are swept, and the case that says the globs reaching them matched something. the sweep
// itself, the deny lists behind it and the `raw-colour-ok:` bargain are
// packages/operator/src/styles/raw-values.ts's — that is one rule wherever a screen lives, and a
// second surface calls the same function with globs of its own rather than copying it.
//
// it gates colour and not length: ./conformance.spec.ts hands the length sweep this surface's
// screens, and packages/operator/src/styles/raw-values.ts says why the two are not symmetric.
//
// tokens.css is swept like every other sheet. it holds aliases of the registry's variables and
// states no colour of its own, so a literal written there is a colour taken from nowhere in the
// registry. the exemption it once had is gone, and the case below asserts the sheet is in the list
// rather than assuming it.

describe('no raw colour in an /admin stylesheet', () => {
	// src/lib/donate/** is swept out rather than in. the donor page draws the donation form's own
	// card, dressed from packages/form's four sheets and its token file, so an /admin colour is
	// exactly what a screen there must not carry — and the gate over those values is the form
	// package's own browser specs against that token file. its src/lib/donate/page.css is the page's
	// token layer, dressed from that same file, and src/lib/donate/page.spec.ts is its gate.
	const screens = globSync('src/**/*.tsx').filter((file) => !file.startsWith('src/lib/donate/'));
	// the four sheets live in packages/operator, a sibling package this one imports from
	// (src/app.css) rather than a directory of its own — so the glob reaches out of the
	// package instead of down into it.
	const sheets = globSync('../operator/src/styles/*.css');
	// src/app.css is named rather than swept: it is where the cascade layers are declared, so
	// a colour written there would outrank the layer every other sheet is inside.
	const stylesheets = [...sheets, 'src/app.css'];

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when the glob is wrong and nothing is read,
		// which is the failure the whole file exists to refuse. it stays here rather than moving
		// with the sweep: only the surface that wrote a glob knows what it was supposed to reach.
		expect(screens.length).toBeGreaterThan(0);
		expect(stylesheets.length).toBeGreaterThan(0);
		// tokens.css is the sheet that aliases the registry's colours, so it is the one a stray literal
		// would most plausibly land in. it is named rather than merely counted, so an exemption
		// written back into the filter above fails here instead of passing silently.
		expect(stylesheets).toContain('../operator/src/styles/tokens.css');
		// adm.css is named rather than merely counted, because it is the element sheet and the
		// layout sheet both — every colour a component wears and every colour a screen's arrangement
		// paints lives in that one file. the components carry its classes instead of restating its
		// rules, so a glob that stopped reaching it would leave the gate reading every file that no
		// longer holds a colour and none of the one that does.
		expect(stylesheets.some((f) => f.endsWith('adm.css'))).toBe(true);
		expect(stylesheets).toContain('src/app.css');
	});

	it('writes none into a screen', () => {
		expect(rawColourViolations(screens)).toEqual([]);
	});

	it('writes none into a sheet', () => {
		expect(rawColourViolations(stylesheets)).toEqual([]);
	});
});
