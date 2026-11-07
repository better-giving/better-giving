import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the registry's variables sheet is what every alias in ./tokens.css points at. an alias whose
// target is not loaded resolves to nothing and a browser drops the declaration without a warning,
// so a surface that stops importing the registry sheet, or imports it after ./tokens.css, still
// builds and still passes every spec that reads css as text. this reads the two entry sheets, which
// are the only places the import order is written (packages/app/src/app.css, packages/gallery/src/app.css).

const REGISTRY = '@better-giving/operator/registry/styles/variables.css';
const TOKENS = '@better-giving/operator/styles/tokens.css';

const entrySheets = {
	app: new URL('../../../app/src/app.css', import.meta.url),
	gallery: new URL('../../../gallery/src/app.css', import.meta.url)
};

/** the specifiers a sheet `@import`s, in the order it reads them. */
const importsOf = (css: string) =>
	[...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)].map(
		(m) => m[1]
	);

describe('the registry variables sheet', () => {
	it('is read from a literal @import, in the shape importsOf reads', () => {
		expect(importsOf(`/* @import 'a.css'; */\n@import 'b.css';\n@import url("c.css");`)).toEqual([
			'b.css',
			'c.css'
		]);
	});

	for (const [surface, url] of Object.entries(entrySheets)) {
		it(`is imported by the ${surface} entry sheet before the operator tokens`, () => {
			const imports = importsOf(readFileSync(url, 'utf8'));
			expect(imports).toContain(REGISTRY);
			expect(imports).toContain(TOKENS);
			expect(imports.indexOf(REGISTRY)).toBeLessThan(imports.indexOf(TOKENS));
		});
	}
});
