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
// tokens.css is where literals belong and is the one file exempt. one file, and that is asserted
// below rather than assumed: the exemption is written as "every sheet whose name is not
// tokens.css", so a surface that split its values across four token files would turn a one-file
// exemption into a four-file allowlist without a line of this file changing. an allowlist is the
// thing that rots.

describe('no raw colour in an /admin stylesheet', () => {
	// src/lib/donate/** is swept out rather than in. the donor page draws the donation form's own
	// card, dressed from packages/form's four sheets and its token file, so an /admin colour is
	// exactly what a screen there must not carry — and the gate over those values is the form
	// package's own browser specs against that token file. its src/lib/donate/page.css is the page's
	// chrome and is gated by nothing: it is no operator screen and carries no /admin token.
	const screens = globSync('src/**/*.tsx').filter((file) => !file.startsWith('src/lib/donate/'));
	// the four sheets live in packages/operator, a sibling package this one imports from
	// (src/app.css) rather than a directory of its own — so the glob reaches out of the
	// package instead of down into it.
	const sheets = globSync('../operator/src/styles/*.css');
	// src/app.css is named rather than swept: it is where the cascade layers are declared, so
	// a colour written there would outrank the layer every other sheet is inside.
	const stylesheets = [...sheets.filter((f) => !f.endsWith('tokens.css')), 'src/app.css'];

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when the glob is wrong and nothing is read,
		// which is the failure the whole file exists to refuse. it stays here rather than moving
		// with the sweep: only the surface that wrote a glob knows what it was supposed to reach.
		expect(screens.length).toBeGreaterThan(0);
		expect(stylesheets.length).toBeGreaterThan(0);
		// the exemption is one file and has to stay one. see the header: it is written as a name
		// filtered out rather than as a list, so a second token file would be exempt the day it landed
		// and nothing here would say so.
		expect(sheets.filter((f) => f.endsWith('tokens.css'))).toEqual([
			'../operator/src/styles/tokens.css'
		]);
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
