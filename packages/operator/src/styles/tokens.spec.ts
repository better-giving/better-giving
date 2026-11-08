import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { ADMIN_TOKENS } from './tokens';

// what holds ./tokens.ts to ./tokens.css. the mirror is a second statement of values the css
// already decides, and a second statement with nothing reading both is one that goes wrong in
// silence: the css moves, every screen moves with it, and the mail keeps sending last month's
// colour with no test failing and nothing on the page to say so.
//
// the css is the source in both directions here. a copy of a name the css does not define fails,
// and so does a copy whose value the css disagrees with, so the only way to change a value a mail
// reads is to change ./tokens.css, or the registry file it aliases, and bring the copy after it.
//
// ./tokens.css holds aliases, so a chain ends in the design registry's copied files
// (../registry/styles, recorded in bg-design.json): a colour there is an `oklch()` with its sRGB hex
// in the comment beside it, and the hex is what a mail client can render, so it is what the chain
// resolves to. only the default theme's light block is read, because a mail has no dark. the three
// face roles are the exception: ./fonts.css re-points them, and that is where their chain ends.
//
// this reads the files on disk rather than importing them, for the reason ./raw-values.ts states
// about its own sweeps: what is asserted is what is in the file, not what a build step made of it.

const CSS = new URL('./tokens.css', import.meta.url).pathname;
const FONTS = new URL('./fonts.css', import.meta.url).pathname;
const REGISTRY = (name: string) => new URL(`../registry/styles/${name}`, import.meta.url).pathname;

// a custom property declaration. the value runs to the `;`, which is what lets a multi-line one
// through: `--admin-transition-state` is three declarations' worth of text with commas in it.
const DECLARATION = /(--admin-[\w-]+)\s*:\s*([^;]+);/g;

/** a `var(--x)` that is the whole value, which is the only reference shape these files use. */
const REFERENCE = /^var\((--[\w-]+)\)$/;

/**
 * every `--admin-*` declaration in the sheet, by name, in the order it was written.
 *
 * a name can hold more than one: `--admin-field-size` and the durations are declared again inside a
 * media block, and a copy of one of those would be a copy of whichever branch this parser happened
 * to keep. so they are collected rather than overwritten, and the case below refuses to mirror a
 * name that has two.
 */
function declarations() {
	const found = new Map<string, string[]>();
	for (const [, name = '', value = ''] of stripComments(readFileSync(CSS, 'utf8')).matchAll(
		DECLARATION
	)) {
		found.set(name, [...(found.get(name) ?? []), value.trim().replace(/\s+/g, ' ')]);
	}
	return found;
}

const css = declarations();

/**
 * every registry name a sheet declares rather than reads, by name: in ./fonts.css, the three face
 * roles it re-points at plain red hat. each is written `!important`, and `important` says whether
 * it was, because the registry declares them unlayered and without it the re-point loses (the
 * header of ./fonts.css).
 */
function repointedDeclarations(file: string) {
	const found = new Map<string, { value: string; important: boolean }>();
	for (const [, name = '', value = ''] of stripComments(readFileSync(file, 'utf8')).matchAll(
		/(?<![\w-])(--(?!admin-)[\w-]+)\s*:\s*([^;]+);/g
	)) {
		const flat = value.trim().replace(/\s+/g, ' ');
		const important = flat.endsWith('!important');
		found.set(name, { value: flat.replace(/\s*!important$/, ''), important });
	}
	return found;
}

const repointed = repointedDeclarations(FONTS);

/** a font stack as its family names, unquoted: `'SFMono-Regular'` and `SFMono-Regular` are one. */
const families = (stack: string) =>
	stack.split(',').map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'));

/**
 * every custom property the registry's variables, roles and default light theme declare, by name.
 * a value with an sRGB hex in the comment beside it is that hex.
 */
function registryDeclarations() {
	const found = new Map<string, string>();
	const theme = readFileSync(REGISTRY('themes/default.css'), 'utf8');
	// the light block opens the file and the dark block opens at the first `:root.dark`. a file
	// without that marker would slice(0, -1) and read the dark block as light, so it fails here.
	const darkAt = theme.indexOf(':root.dark');
	if (darkAt < 0) throw new Error('registry themes/default.css has no :root.dark block to cut at');
	const light = theme.slice(0, darkAt);
	const sources = [
		light,
		readFileSync(REGISTRY('colors.css'), 'utf8'),
		readFileSync(REGISTRY('variables.css'), 'utf8')
	];
	for (const source of sources) {
		for (const [, name = '', value = '', hex] of source.matchAll(
			/(--[\w-]+)\s*:\s*([^;]+);(?:\s*\/\*\s*(#[0-9a-f]{6})\s*\*\/)?/g
		)) {
			if (!found.has(name)) found.set(name, hex ?? value.trim().replace(/\s+/g, ' '));
		}
	}
	return found;
}

const registry = registryDeclarations();

/** a declared value with its `var()` chain followed to the literal the browser would resolve to. */
function resolve(name: string, seen: string[] = []): string {
	const value = css.get(name)?.[0] ?? repointed.get(name)?.value ?? registry.get(name);
	if (value === undefined) return `<undeclared: ${name}>`;
	if (seen.includes(name)) return `<circular: ${[...seen, name].join(' -> ')}>`;
	const reference = REFERENCE.exec(value);
	return reference?.[1] ? resolve(reference[1], [...seen, name]) : value;
}

describe('the mail token mirror still says what tokens.css says', () => {
	it('finds the file it is meant to be reading', () => {
		// a tokens.css this file failed to parse would declare nothing, and "every copy matches
		// nothing" is a sentence that passes. both floors are floors rather than the number today.
		expect(css.size).toBeGreaterThan(150);
		expect(registry.size).toBeGreaterThan(100);
		expect(Object.keys(ADMIN_TOKENS).length).toBeGreaterThan(20);
	});

	it('copies only names tokens.css declares, and declares once', () => {
		// a name declared twice is declared under a condition, and a copy of it is a copy of one
		// branch — which reads as the value on every mail regardless of the branch.
		const wrong = Object.keys(ADMIN_TOKENS).filter((name) => css.get(name)?.length !== 1);
		expect(wrong).toEqual([]);
	});

	it('copies the value tokens.css resolves to', () => {
		const drifted = Object.entries(ADMIN_TOKENS)
			.filter(([name, copy]) => resolve(name) !== copy)
			.map(([name, copy]) => `${name}: ${copy} — tokens.css resolves it to ${resolve(name)}`);
		expect(drifted).toEqual([]);
	});

	it('reads only registry names for every var() that is not an --admin name', () => {
		// resolve() reports an undeclared name only for tokens that reach ADMIN_TOKENS; a registry
		// rename of --overlay or --link-hover would leave the other aliases drawing nothing.
		const source = stripComments(readFileSync(CSS, 'utf8'));
		const read = new Set(
			[...source.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? '')
		);
		const external = [...read].filter((name) => !name.startsWith('--admin-'));
		expect(external.length).toBeGreaterThan(10);
		const missing = external.filter((name) => !registry.has(name) && !css.has(name));
		expect(missing).toEqual([]);
	});

	it('reads the registry font roles through the --admin-font aliases', () => {
		expect({
			sans: css.get('--admin-font-sans'),
			display: css.get('--admin-font-display'),
			mono: css.get('--admin-font-mono')
		}).toEqual({
			sans: ['var(--font-body)'],
			display: ['var(--font-display)'],
			mono: ['var(--font-mono)']
		});
	});

	it('re-points the three registry font roles at plain red hat in ./fonts.css alone', () => {
		// the registry's own stacks are red hat round; the re-point is what sets these surfaces in
		// the faces ./fonts.css declares, and losing the `!important` loses it in every browser.
		// ./fonts.css is the sheet the donor pages link as well, so a role re-pointed in ./tokens.css
		// instead would reach /admin and miss them.
		expect(registry.get('--font-body')).toMatch(/^"Red Hat Round Text"/);
		expect([...repointedDeclarations(CSS).keys()]).toEqual([]);
		expect(Object.fromEntries(repointed)).toEqual({
			'--font-body': {
				value: "'Red Hat Text', ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
				important: true
			},
			'--font-display': {
				value: "'Red Hat Display', ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
				important: true
			},
			'--font-mono': {
				value:
					"'Red Hat Mono', ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
				important: true
			}
		});
	});

	it('keeps the registry’s mono fallbacks, in its order, behind plain red hat', () => {
		// read off the copied file rather than written here, so a registry update that changes the
		// fallbacks fails this case instead of leaving the two stacks to drift apart.
		const declared = /(?<![\w-])--font-mono\s*:\s*([^;]+);/.exec(
			stripComments(readFileSync(REGISTRY('variables.css'), 'utf8'))
		)?.[1];
		if (declared === undefined) throw new Error('registry variables.css declares no --font-mono');
		const theirs = families(declared.replace(/\s+/g, ' '));
		const ours = families(repointed.get('--font-mono')?.value ?? '');
		expect(theirs[0]).toBe('Red Hat Round Mono');
		expect(ours[0]).toBe('Red Hat Mono');
		expect(theirs.length).toBeGreaterThan(1);
		expect(ours.slice(1)).toEqual(theirs.slice(1));
	});

	it('declares a face in ./fonts.css for the lead family of every re-pointed role', () => {
		const faces = new Set(
			[
				...readFileSync(new URL('./fonts.css', import.meta.url).pathname, 'utf8').matchAll(
					/font-family:\s*'([^']+)'/g
				)
			].map((match) => match[1])
		);
		const leads = [...repointed.values()].map(({ value }) => /^'([^']+)'/.exec(value)?.[1]);
		expect(leads).toEqual(['Red Hat Text', 'Red Hat Display', 'Red Hat Mono']);
		expect(leads.filter((lead) => !faces.has(lead ?? ''))).toEqual([]);
	});

	it('reads the registry’s control radius and card radius through the --admin-radius pair', () => {
		expect({
			control: css.get('--admin-radius'),
			plane: css.get('--admin-radius-plane')
		}).toEqual({
			control: ['var(--radius-control)'],
			plane: ['var(--radius-card)']
		});
	});
});
