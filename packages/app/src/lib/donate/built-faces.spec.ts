import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { appAlias, type BuiltSheet, buildSheet, facesDeclared } from './built-sheet.testing';

// the faces each surface's css carries once the build has followed every `@import`. the registry's
// own `variables.css` imports a `./fonts.css` that is red hat round, and packages/app/vite.config.ts
// aliases that import to an empty sheet so /admin and the donor pages are set in the plain red hat
// families packages/operator/src/styles/fonts.css declares. a reading of either source stays green
// when that alias stops matching, because the source never names a round face: the build is where
// one would come out. this builds with the config's own alias list, so a change to it is read here.
//
// the donation form's tokens sheet is the other half: the card loads no web font (AGENTS.md → One
// look, one source), so it builds to no `@font-face` at all, and the same alias must still empty the
// registry's face import there.

const path = (url: string) => fileURLToPath(new URL(url, import.meta.url));
const appCss = path('../../app.css');
const formTokens = path('../../../../form/src/styles/tokens.css');

describe('the faces the app build emits', () => {
	let admin: BuiltSheet;
	let form: BuiltSheet;
	beforeAll(async () => {
		const alias = await appAlias();
		[admin, form] = await Promise.all([
			buildSheet([appCss], alias),
			buildSheet([formTokens], alias)
		]);
	}, 60_000);

	it('declares plain Red Hat Text, Display and Mono for /admin and the donor pages', () => {
		expect([...new Set(facesDeclared(admin.css))].sort()).toEqual([
			'Red Hat Display',
			'Red Hat Mono',
			'Red Hat Text'
		]);
	});

	it('emits every face file the sheet names and no face of the registry', () => {
		expect(admin.diagnostics).toEqual([]);
		expect(admin.urls.filter((url) => url.includes('.woff2'))).not.toEqual([]);
		expect(admin.dangling.filter((url) => url.includes('.woff2'))).toEqual([]);
		// the registry's own `--font-*` declarations still say "Red Hat Round" in text, and
		// ./tokens.css re-points them; what must not exist is a face or a file for it.
		expect(admin.urls.filter((url) => /Round/i.test(url))).toEqual([]);
		expect(admin.assets.filter((name) => /Round/i.test(name))).toEqual([]);
	});

	it('draws the card with no @font-face of its own and none of the registry', () => {
		expect(form.css).toContain('--_font-mono');
		expect(facesDeclared(form.css)).toEqual([]);
		expect(form.diagnostics).toEqual([]);
		expect(form.assets.filter((name) => name.endsWith('.woff2'))).toEqual([]);
	});
});
