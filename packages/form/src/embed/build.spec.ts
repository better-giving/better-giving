import { describe, expect, it } from 'vitest';
import { embedConfig, importAllowed } from '../../vite.embed.config';
import { RUNTIME_PATH_PREFIX } from './loader';

// the embed build's two halves, asserted as configuration rather than by running one.
//
// `test` runs at commit time with no build ordered ahead of it, so nothing here may look at build
// output. what it can look at is the function that decides what the build does, which is why
// vite.embed.config.ts hands one out by name.
//
// type-checking that config is not this file's job and has not been since the form became a
// package: ../../vite.embed.config.ts is named directly in ../../tsconfig.json's `include`, so a
// signature change in ./stamp.ts fails `pnpm --filter @better-giving/form check` — which the root
// `check` script runs first and lefthook.yml runs at commit time. what is left here is the half a
// type is blind to: which directory each mode writes into, and that an unrecognised mode is
// refused rather than defaulted. both of those are strings, and getting one wrong still type-checks
// and still fails inside `build` — which `deploy` runs first, so nothing irreversible has happened,
// but it fails on whoever is deploying rather than on whoever made the change, and a deployer has
// no business debugging a build.

describe('the runtime half', () => {
	const config = embedConfig({ mode: 'runtime' });

	it('writes the content-hashed runtime where it is served from', () => {
		expect(config.build?.outDir).toBe(`dist${RUNTIME_PATH_PREFIX}`);
		expect(config.build?.rollupOptions?.output).toMatchObject({ entryFileNames: '[hash].js' });
	});

	// the directory holds one runtime and the loader points at it by name, so a build that left the
	// previous hash behind would ship two and stamp whichever was listed first.
	it('empties its own directory first', () => {
		expect(config.build?.emptyOutDir).toBe(true);
	});

	// the snippet loads a bare classic script, so an emitted `import` is a form that never runs.
	it('emits a self-executing classic script', () => {
		expect(config.build?.lib).toMatchObject({ formats: ['iife'] });
	});
});

describe('the loader half', () => {
	const config = embedConfig({ mode: 'loader' });

	it('writes the loader at the path the snippet names', () => {
		expect(config.build?.outDir).toBe('dist');
		expect(config.build?.rollupOptions?.output).toMatchObject({ entryFileNames: 'embed.js' });
	});

	// dist/ holds the runtime the previous build just wrote, and emptying it on the way out would
	// take that with it.
	it('never empties the directory it shares', () => {
		expect(config.build?.emptyOutDir).toBe(false);
	});

	it('emits a self-executing classic script', () => {
		expect(config.build?.lib).toMatchObject({ formats: ['iife'] });
	});

	it('stamps the runtime path as it writes', () => {
		const names = (config.plugins ?? []).map((plugin) =>
			typeof plugin === 'object' && plugin !== null && 'name' in plugin ? plugin.name : null
		);
		expect(names).toContain('bg-donate-stamp-runtime-path');
	});
});

// biome.jsonc states the same boundary and covers app source too, but it runs at commit time
// through lefthook.yml and neither `build` nor `deploy` runs `lint`. what is asserted here is the
// half the shipping build enforces on its own: an undeclared import bundled into an `iife` is
// minified into the script served to every site that pasted the snippet.
describe('the boundary the build enforces', () => {
	const declared = ['xstate', '@stripe/stripe-js'];

	it('gates both halves, not just the one that stamps', () => {
		for (const mode of ['runtime', 'loader'] as const) {
			const names = (embedConfig({ mode }).plugins ?? []).map((plugin) =>
				typeof plugin === 'object' && plugin !== null && 'name' in plugin ? plugin.name : null
			);
			expect(names).toContain('bg-donate-refuse-undeclared-imports');
		}
	});

	it('admits what the package declares, subpaths included', () => {
		expect(importAllowed('xstate', declared)).toBe(true);
		expect(importAllowed('@stripe/stripe-js', declared)).toBe(true);
		expect(importAllowed('@stripe/stripe-js/pure', declared)).toBe(true);
	});

	// the failure this whole gate exists for: node resolution walks up to the workspace root's
	// node_modules, so every root dependency resolves from inside this package whether it is
	// declared or not.
	it('refuses a root dependency it never declared', () => {
		for (const source of ['zod', 'drizzle-orm', 'stripe']) {
			expect(importAllowed(source, declared)).toBe(false);
		}
	});

	// a prefix match on the name alone would take a stranger's package whose name merely starts
	// with a declared one.
	it('refuses a package whose name only begins with a declared one', () => {
		expect(importAllowed('xstate-evil', declared)).toBe(false);
		expect(importAllowed('@stripe/stripe-js-evil', declared)).toBe(false);
	});

	// both halves run in a browser on a page this project does not own, so a builtin reaching the
	// graph is a module the bundle cannot have.
	it('refuses a node builtin', () => {
		expect(importAllowed('node:fs', declared)).toBe(false);
		expect(importAllowed('fs', declared)).toBe(false);
	});

	it("has nothing to say about this package's own source", () => {
		expect(importAllowed('./loader.ts', declared)).toBe(true);
		expect(importAllowed('../v1', declared)).toBe(true);
		expect(importAllowed('/abs/path/to/entry.ts', declared)).toBe(true);
	});

	// another plugin's virtual module, which is not a specifier this has any business judging.
	it('lets a virtual module through', () => {
		expect(importAllowed('\0vite/preload-helper', declared)).toBe(true);
	});
});

// vite's default mode is `production`, so a bare `vite build` in this package would otherwise fall
// through to whichever half the switch treats as its else: it would write into dist/ without
// emptying it and stamp whatever hash was lying around, shipping an older runtime with nothing on
// any output saying so.
describe('a mode that is neither half', () => {
	it('is refused rather than defaulted', () => {
		expect(() => embedConfig({ mode: 'production' })).toThrow(/--mode runtime or --mode loader/);
	});

	it('names the script that runs both', () => {
		expect(() => embedConfig({ mode: '' })).toThrow(/build:embed/);
	});
});
