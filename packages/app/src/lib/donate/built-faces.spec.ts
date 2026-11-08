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

type RoleDeclaration = { layers: string[]; selector: string; value: string; important: boolean };

/**
 * every declaration of `role` in built css, with the `@layer` blocks it sits in and its selector.
 * a walk over the braces rather than a match on the text, because what is asserted is where the
 * declaration sits and not only that it exists.
 */
function roleDeclarations(css: string, role: string): RoleDeclaration[] {
	const found: RoleDeclaration[] = [];
	const open: string[] = [];
	let start = 0;
	const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
	for (let at = 0; at < text.length; at += 1) {
		const char = text[at];
		if (char === '{') {
			open.push(text.slice(start, at).trim());
			start = at + 1;
		} else if (char === ';' || char === '}') {
			const declaration = /^(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(text.slice(start, at).trim());
			if (declaration?.[1] === role) {
				const value = (declaration[2] ?? '').replace(/\s+/g, ' ');
				found.push({
					layers: open.filter((prelude) => prelude.startsWith('@layer')),
					selector: open.at(-1) ?? '',
					value: value.replace(/\s*!important$/, ''),
					important: value.endsWith('!important')
				});
			}
			if (char === '}') open.pop();
			start = at + 1;
		}
	}
	return found;
}

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
		// packages/operator/src/styles/fonts.css re-points them; what must not exist is a face or a
		// file for it.
		expect(admin.urls.filter((url) => /Round/i.test(url))).toEqual([]);
		expect(admin.assets.filter((name) => /Round/i.test(name))).toEqual([]);
	});

	// the cascade half of the re-point: the registry declares each role unlayered on :root, and an
	// unlayered declaration beats any layered one unless the layered one is `!important`. so the built
	// sheet has to carry both, and the plain-face one in the first layer, or the re-point is dead text.
	it.each([
		['--font-body', 'Red Hat Text', 'Red Hat Round Text'],
		['--font-display', 'Red Hat Display', 'Red Hat Round Display'],
		['--font-mono', 'Red Hat Mono', 'Red Hat Round Mono']
	])('re-points %s at %s with !important in @layer tokens', (role, plain, registry) => {
		const declared = roleDeclarations(admin.css, role);
		const repointed = declared.filter((found) => found.important);
		expect(repointed).toHaveLength(1);
		expect(repointed[0]).toMatchObject({ layers: ['@layer tokens'], selector: ':root' });
		expect(repointed[0]?.value).toMatch(new RegExp(`^['"]${plain}['"],`));
		expect(repointed[0]?.value).not.toContain('Round');

		// the registry's own declaration is still there, unlayered and not important: it is what
		// the re-point has to outrank, and a build that dropped it would leave nothing to outrank.
		const registryOwn = declared.filter((found) => !found.important);
		expect(registryOwn).toHaveLength(1);
		expect(registryOwn[0]).toMatchObject({ layers: [], selector: ':root' });
		expect(registryOwn[0]?.value).toMatch(new RegExp(`['"]${registry}['"]`));
	});

	it('draws the card with no @font-face of its own and none of the registry', () => {
		expect(form.css).toContain('--_font-mono');
		expect(facesDeclared(form.css)).toEqual([]);
		expect(form.diagnostics).toEqual([]);
		expect(form.assets.filter((name) => name.endsWith('.woff2'))).toEqual([]);
	});
});
