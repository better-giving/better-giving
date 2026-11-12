import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { classesDrawnIn } from './vocabulary';

// the registry's variables sheet is what every alias in ./tokens.css points at. an alias whose
// target is not loaded resolves to nothing and a browser drops the declaration without a warning,
// so a surface that stops importing the registry sheet still builds and still passes every spec
// that reads css as text. a `var()` resolves at computed-value time, so importing the registry after
// ./tokens.css would still resolve; the order check holds the convention that a sheet is imported
// after what it reads. this reads the two entry sheets, which are the only places the import order
// is written (packages/app/src/app.css, packages/gallery/src/app.css).

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

// the registry's component sheets are what the `ds-*` classes the components write are drawn by. a
// class whose sheet is not loaded paints nothing and errors nowhere, and so does a class no sheet
// draws at all: both look like a control that lost its look only in a browser, which no spec in
// this package opens. so each entry sheet must import every one of them into the `registry` layer
// packages/app/src/app.css orders, and every `ds-*` class a component spells must be one of theirs.

const COMPONENT_SHEETS = [
	'button-css',
	'badge-css',
	'card-css',
	'field-css',
	'switch-css',
	'state-card-css'
];

/** the specifiers a sheet `@import`s into the `registry` layer. */
const layeredImportsOf = (css: string) =>
	[
		...css
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s+layer\(registry\)/g)
	].map((m) => m[1]);

describe('the registry component sheets', () => {
	for (const [surface, url] of Object.entries(entrySheets)) {
		it(`are imported by the ${surface} entry sheet into the registry layer, after the variables`, () => {
			const css = readFileSync(url, 'utf8');
			const layered = layeredImportsOf(css);
			const imports = importsOf(css);

			expect(layered).toEqual(
				COMPONENT_SHEETS.map((item) => `@better-giving/operator/registry/styles/${item}.css`)
			);
			for (const specifier of layered) {
				expect(imports.indexOf(specifier ?? '')).toBeGreaterThan(imports.indexOf(REGISTRY));
			}
		});
	}

	it('draw every ds- class a component or a screen spells', () => {
		const drawn = classesDrawnIn(COMPONENT_SHEETS.map((item) => `src/registry/styles/${item}.css`));
		const components = globSync('src/components/*/*.jsx');
		// the screens that spell one by hand, beside the components that draw it: /admin's and the
		// gallery's previews. the donor chain's supporter screens also link some of these sheets
		// (../app/src/lib/supporter/area/links.ts, ../app/src/lib/supporter/public/fundraiser-page.tsx),
		// and this case does not sweep the names they spell.
		const screens = [
			...globSync('../app/src/routes/_app.admin*.tsx'),
			...globSync('../app/src/lib/admin/**/*.tsx'),
			...globSync('../gallery/src/previews/*.tsx')
		].filter((file) => !file.includes('.spec.'));
		const spelled = [...components, ...screens].flatMap((file) =>
			[...stripComments(readFileSync(file, 'utf8')).matchAll(/\bds-[a-z][\w-]*/g)].map(
				([name]) => ({ file, name })
			)
		);

		// the non-empty guards: a glob or a sheet this stopped reading reports every class drawn.
		expect(components.length).toBeGreaterThan(20);
		expect(screens.length).toBeGreaterThan(20);
		expect(spelled.length).toBeGreaterThan(10);
		expect(drawn.has('ds-btn')).toBe(true);
		expect(
			spelled.filter(({ name }) => !drawn.has(name)).map(({ file, name }) => `${file} ${name}`)
		).toEqual([]);
	});
});
