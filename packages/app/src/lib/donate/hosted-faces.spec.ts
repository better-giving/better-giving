import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

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

describe('the built face sheet', () => {
	it('points every font file at this origin', async () => {
		expect(sameOrigin('/assets/RedHatMono-Regular.woff2')).toBe(true);
		expect(sameOrigin('https://fonts.gstatic.com/x.woff2')).toBe(false);
		expect(sameOrigin('//cdn.example/x.woff2')).toBe(false);

		const root = await mkdtemp(join(tmpdir(), 'hosted-faces-'));
		try {
			// the import has to be read. an unused `?url` import is dropped, and the built sheet
			// goes with it, which would leave this test looking at an empty directory.
			await writeFile(
				join(root, 'entry.js'),
				`import href from ${JSON.stringify(`${fontsCss}?url`)};\nglobalThis.__href = href;\n`
			);
			await build({
				configFile: false,
				root,
				logLevel: 'silent',
				publicDir: false,
				build: {
					outDir: 'dist',
					emptyOutDir: true,
					assetsInlineLimit: 0,
					minify: false,
					write: true,
					rollupOptions: { input: join(root, 'entry.js') }
				}
			});
			const assets = join(root, 'dist', 'assets');
			const cssFiles = (await readdir(assets)).filter((name) => name.endsWith('.css'));
			expect(cssFiles.length).toBeGreaterThan(0);
			const css = (
				await Promise.all(cssFiles.map((name) => readFile(join(assets, name), 'utf8')))
			).join('\n');
			expect(css).toContain('@font-face');
			expect(css).toContain('Red Hat Mono');
			const urls = [...css.matchAll(/url\(\s*([^)]+?)\s*\)/g)].map((match) => match[1] ?? '');
			expect(urls.length).toBeGreaterThan(0);
			expect(urls.every((url) => sameOrigin(url))).toBe(true);
			expect(urls.some((url) => url.includes('.woff2'))).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 60_000);
});
