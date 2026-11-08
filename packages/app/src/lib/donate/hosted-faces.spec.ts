import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSheet } from './built-sheet.testing';

// the sheet /donate and a campaign link is the built one, not the source.
//
// donorPageLinks() in ./plain-page.tsx imports packages/operator/src/styles/fonts.css with `?url`,
// and the build rewrites each `url()` into the origin's own assets. a reading of the source stays
// green when that rewrite points at another host, so this builds the sheet and reads the urls that
// came out.

const require = createRequire(import.meta.url);
const fontsCss = require.resolve('@better-giving/operator/styles/fonts.css');

/** a font url the page can fetch from the deployment it is already on. */
function sameOrigin(url: string): boolean {
	const bare = url.trim().replace(/^['"]|['"]$/g, '');
	if (/^(?:https?:)?\/\//i.test(bare)) return false;
	if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return false;
	return bare.startsWith('/') || bare.startsWith('./') || bare.startsWith('../');
}

/** the woff2 files the source sheet declares, by the name they have beside it. */
const declaredFiles = [
	...readFileSync(fontsCss, 'utf8').matchAll(/url\(\s*['"]?\.\/fonts\/([^'")]+\.woff2)/g)
]
	.map((match) => match[1] ?? '')
	.sort();

describe('the built face sheet', () => {
	it('points every font file at this origin', async () => {
		expect(sameOrigin('/assets/RedHatMono-Regular.woff2')).toBe(true);
		expect(sameOrigin('https://fonts.gstatic.com/x.woff2')).toBe(false);
		expect(sameOrigin('//cdn.example/x.woff2')).toBe(false);

		const { css, urls, assets, dangling, diagnostics } = await buildSheet([fontsCss]);
		expect(css).toContain('@font-face');
		for (const family of ['Display', 'Text', 'Mono']) {
			expect(css).toMatch(new RegExp(`font-family:\\s*["']Red Hat ${family}["']`));
		}
		expect(css).not.toContain('Red Hat Round');
		expect(urls.length).toBeGreaterThan(0);
		expect(urls.every((url) => sameOrigin(url))).toBe(true);
		expect(urls.some((url) => url.includes('.woff2'))).toBe(true);

		// a url that names no emitted file is a face that falls back without a word: vite leaves an
		// unresolved `./fonts/X.woff2` as written, which `sameOrigin` alone accepts.
		expect(diagnostics).toEqual([]);
		expect(dangling).toEqual([]);

		// and the emitted set is the declared set: vite hashes each name, `Stem-<hash>.woff2`.
		expect(declaredFiles.length).toBeGreaterThan(0);
		const emitted = assets.filter((name) => name.endsWith('.woff2')).sort();
		expect(emitted.map((name) => name.replace(/-[\w-]{8}\.woff2$/, '.woff2'))).toEqual(
			declaredFiles
		);
		expect(
			readdirSync(join(dirname(fontsCss), 'fonts'))
				.filter((n) => n.endsWith('.woff2'))
				.sort()
		).toEqual(declaredFiles);
	}, 60_000);
});
