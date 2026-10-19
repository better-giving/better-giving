import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// nothing here produces something cloudflare could run, and this file is what makes that structural
// instead of promised.
//
// **the build is why the property is stated in these words.** `react-router build` writes a client
// bundle. what a build writes is therefore an asset — and the question worth gating is not whether
// anything is built but whether anything built here could be uploaded to or served by cloudflare.
//
// the property rests on three absences, and an absence is the one kind of fact nothing reports when
// it ends. each case below is one of them:
//
//   1. **the five scripts are the whole of it, and none of them names a platform.** `build`,
//      `check`, `dev`, `prepare`, `test` — no `preview` and no `deploy` — and
//      ../react-router.config.ts lists no preset, which is what would configure a build on a
//      hosting platform's behalf, and says `ssr: false`, so what the build writes is a document and
//      the bundle under it — the module it renders that document with is a build step's own input,
//      and nothing here could serve a request with it.
//   2. **nothing here is a workers project or could serve one.** no `@cloudflare/*` and no
//      `wrangler` among the dependencies, no wrangler config under this package or beside the go
//      binary for one to read, and no `@react-router/*` beyond the vite plugin and the file-system
//      routing convention — every other one is a server or a platform's runtime. so a hand-run
//      build leaves a request handler with nothing to run it.
//   3. **no script in packages/app names this package.** packages/app's own `build` is the three
//      steps AGENTS.md names — the embed, its staging, `vite build` — none of which reaches out of
//      that package, so nothing here rides along with an upload of the app.
//
// it reads package manifests by path, and none of that is an import:
// biome.jsonc refuses a *module* from here into packages/app, because a relative import
// resolves silently where a bare specifier would already fail. reading a file the way a sweep does
// is what every gate in this repository already does across package lines —
// packages/app/src/lib/admin/styles/raw-color.spec.ts globs packages/operator's sheets the same
// way — and nothing here binds this package to the app's code.

/** where a spec runs from: `vitest` sets the cwd to the package root. */
const HERE = resolve('.');
const APP = resolve('..', 'app');

const manifest = (dir: string) =>
	JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
		scripts?: Record<string, string>;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

const here = manifest(HERE);
const app = manifest(APP);

/**
 * every file under `dir`, skipping only what nothing in this repository authors.
 *
 * **`build/` is walked rather than skipped, and it is the one that matters most.** it is the output
 * directory of the build, so it is exactly where a tool that generated a wrangler config would put
 * one, and skipping it would leave the assertion below blind at the one place the mistake lands.
 */
function tree(dir: string): string[] {
	const skipped = new Set(['node_modules', '.react-router', '__screenshots__']);
	return readdirSync(dir).flatMap((name) => {
		if (skipped.has(name)) return [];
		const path = join(dir, name);
		return statSync(path).isDirectory() ? tree(path) : [path];
	});
}

describe('nothing here produces something cloudflare could run', () => {
	it('declares the five scripts and no more, and names no preset', () => {
		// a `deploy` or a `preview` here would be the first half of a deployable console and is
		// refused as such rather than reviewed later.
		expect(Object.keys(here.scripts ?? {}).sort()).toEqual([
			'build',
			'check',
			'dev',
			'prepare',
			'test'
		]);
		// read out of the config text rather than by importing it: a preset would be a key in an
		// object literal, and what is being asserted is that nobody has written one.
		for (const file of ['vite.config.ts', 'react-router.config.ts']) {
			expect(readFileSync(join(HERE, file), 'utf8')).not.toMatch(/\bpresets?\s*[:(]/);
		}
	});

	it('renders on the client alone, so the build writes no request handler', () => {
		// `ssr: true` is the whole of what would make this package a server: react router would serve
		// every screen from a handler, and what is uploadable would be a decision away rather than
		// structurally absent.
		const config = readFileSync(join(HERE, 'react-router.config.ts'), 'utf8');
		expect(config).toMatch(/\bssr:\s*false\b/);
		expect(config).not.toMatch(/\bssr:\s*true\b/);
	});

	it('depends on nothing that serves a build, and holds no wrangler config to read', () => {
		const declared = [
			...Object.keys(here.dependencies ?? {}),
			...Object.keys(here.devDependencies ?? {})
		];
		// the two that are dev-time only: the vite plugin with the typegen, and the file-system
		// routing convention. every other `@react-router/*` is a server or a platform's runtime,
		// which is the half of this absence a package.json can carry.
		const devOnly = ['@react-router/dev', '@react-router/fs-routes'];
		const serving = declared.filter(
			(name) => name.startsWith('@react-router/') && !devOnly.includes(name)
		);
		expect(serving).toEqual([]);
		// the platform's own packages, which a workers project cannot be built or deployed without.
		expect(declared.filter((name) => name.startsWith('@cloudflare/'))).toEqual([]);
		expect(declared).not.toContain('wrangler');
		// and nothing for one to read: a wrangler config is what names a worker, its bindings and
		// what to upload, so a file of any of the three names is the whole of the mistake in one
		// place.
		const configs = tree(HERE).filter((path) => /wrangler\.(json|jsonc|toml)$/.test(path));
		expect(configs).toEqual([]);
	});

	it('is named by no script in packages/app', () => {
		// every script there, rather than only `build`: a staging step arrives as its own script and
		// is chained into one of those afterwards, so the step is what has to be caught and not the
		// chain. `console` as a whole word — any path from packages/app to this package spells it.
		const naming = Object.entries(app.scripts ?? {}).filter(([, run]) => /\bconsole\b/.test(run));
		expect(naming).toEqual([]);
	});
});
