import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND_TOKENS, brandCss, UNSEEDED } from './brand';
import { generateBrandScale } from './radix-scale';

// node pool: what the element's brand sheet writes, read against the registry's files and the
// package's own sources as text.

const SRC = new URL('../', import.meta.url);
const REGISTRY = new URL('../registry/styles/', import.meta.url);
const WRITERS = ['styles/radix-scale.ts', 'styles/brand.ts'];

/** a source with its comments taken out. */
function code(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** every stylesheet and script under src/, by path relative to it, specs and the scale's writers aside. */
function sources(dir = ''): string[] {
	return readdirSync(new URL(dir, SRC), { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}${entry.name}`;
		if (entry.isDirectory()) return sources(`${path}/`);
		if (!/\.(css|ts)$/.test(entry.name) || /\.(spec|testing)\.ts$/.test(entry.name)) return [];
		return WRITERS.includes(path) ? [] : [path];
	});
}

/** the registry's default theme, light: the block every card is drawn with. */
const theme = readFileSync(new URL('themes/default.css', REGISTRY), 'utf8');
const light = code(theme).slice(0, code(theme).indexOf('}'));

/** the declarations of one block, by name. */
function declarations(block: string): Record<string, string> {
	return Object.fromEntries(
		[...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value?.trim()])
	);
}

describe('the seed’s default is the registry’s accent 9', () => {
	it('registers the literal the registry’s default theme declares, and `UNSEEDED` is it', () => {
		const tokens = readFileSync(new URL('styles/tokens.css', SRC), 'utf8');
		const registered = /@property --donate-primary \{[^}]*initial-value:\s*([^;]+);/.exec(
			code(tokens)
		)?.[1];

		expect(declarations(light)['--accent-9']).toBeDefined();
		expect(registered).toBe(declarations(light)['--accent-9']);
		expect(UNSEEDED).toBe(registered);
	});

	it('writes no scale for an unseeded card, which keeps the registry’s', () => {
		expect(brandCss(UNSEEDED)).not.toContain('--accent-');
	});
});

describe('the brand sheet sets what the card reads', () => {
	// every `--accent-*` a shadow sheet reads has to move with the seed. a read the sheet does not
	// write stays at the default accent on a seeded card, unless the theme declares it as an alias of
	// one it does — `--accent-ground: var(--accent-12)` — which follows by substitution on the same
	// node.
	const shadowSheets = [
		...['variables.css', 'colors.css', 'button-css.css', 'field-css.css', 'checkbox-css.css'].map(
			(name) => readFileSync(new URL(name, REGISTRY), 'utf8')
		),
		light,
		...sources().map((path) => readFileSync(new URL(path, SRC), 'utf8'))
	];
	const read = new Set(
		shadowSheets.flatMap((text) =>
			[...code(text).matchAll(/var\(\s*(--accent-[\w-]+)/g)].flatMap(([, name]) => name ?? [])
		)
	);
	const followed = new Set<string>(BRAND_TOKENS);
	for (const [name, value] of Object.entries(declarations(light))) {
		const alias = /^var\((--accent-[\w-]+)\)$/.exec(value ?? '')?.[1];
		if (name.startsWith('--accent-') && alias !== undefined && followed.has(alias)) {
			followed.add(name);
		}
	}

	it('writes every accent variable the card’s sheets read, or one it aliases', () => {
		expect(read.size).toBeGreaterThan(5);
		expect([...read].filter((name) => !followed.has(name))).toEqual([]);
	});

	it('writes every step the generator makes and the ink, under the registry’s names', () => {
		const scale = generateBrandScale('#0f766e');
		const written = declarations(brandCss('#0f766e').split('@supports')[0] ?? '');

		expect(Object.keys(written).sort()).toEqual([...BRAND_TOKENS].sort());
		expect(written['--accent-9']).toBe(scale?.steps[8]);
		expect(written['--accent-contrast']).toBe(scale?.contrast);
	});

	it('writes every one of them for a seed the generator cannot read, so none stays the default', () => {
		const written = declarations(brandCss('lab(50% 40 30)'));

		expect(generateBrandScale('lab(50% 40 30)')).toBeNull();
		expect(Object.keys(written).sort()).toEqual([...BRAND_TOKENS].sort());
		expect(Object.values(written).every((value) => value.includes('var(--donate-primary)'))).toBe(
			true
		);
	});

	it('writes on the card’s root, the node the registry declares its roles on', () => {
		expect(brandCss('#0f766e')).toContain(':host > [data-theme] {');
		expect(brandCss('lab(50% 40 30)')).toContain(':host > [data-theme] {');
	});
});
