import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// nothing here produces something cloudflare could run, and this file is what makes that structural
// instead of promised.
//
// **the build is why the property is stated in these words.** `react-router build` writes a client
// bundle, and packages/console/ui/embed.go carries that bundle into a go binary an operator runs on
// their own machine. what a build writes is therefore an asset — and the question worth gating is
// not whether anything is built but whether anything built here could be uploaded to or served by
// cloudflare.
//
// the property rests on four absences, and an absence is the one kind of fact nothing reports when
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
//   3. **the deployment uploads two paths and both are inside packages/app.** `main` in
//      packages/app/wrangler.jsonc and `publicDir` in its vite config are what `wrangler deploy`
//      sends, and a file outside them cannot ride along whatever is built here.
//   4. **no script names this package on the way to the door.** the root `deploy` forwards into
//      packages/app alone, and packages/app's own `build` is the three steps CLAUDE.md names — the
//      embed, its staging, `vite build` — none of which reaches out of that package. the same case
//      reads the go package's embed.go, because its one embed directive is the counterpart staging
//      step and it must stay the one: `/embed.js` reaches the worker only because
//      `scripts/stage-embed.js` copies it into packages/app/static/, and CLAUDE.md records that as
//      the precedent for how quietly a staging step becomes load-bearing.
//
// it reads three package manifests and one wrangler config by path, and none of that is an import:
// biome.jsonc refuses a *module* from here into packages/app, because a relative import
// resolves silently where a bare specifier would already fail. reading a file the way a sweep does
// is what every gate in this repository already does across package lines —
// packages/app/src/lib/admin/styles/raw-color.spec.ts globs packages/operator's sheets the same
// way — and nothing here binds this package to the app's code.

/** where a spec runs from: `vitest` sets the cwd to the package root. */
const HERE = resolve('.');
const APP = resolve('..', 'app');
const ROOT = resolve('..', '..');
/** the go binary these screens are built into, which is a package of its own and not on the workspace. */
const CONSOLE = resolve('..', 'console');

const manifest = (dir: string) =>
	JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
		scripts?: Record<string, string>;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

const here = manifest(HERE);
const app = manifest(APP);
const root = manifest(ROOT);

/**
 * every file under `dir`, skipping only what nothing in this repository authors.
 *
 * **`build/` and the binary's `ui/dist/` are walked rather than skipped, and they are the two that
 * matter most.** they are the output directories either side of the build — `ui/dist` is even
 * partly committed — so they are exactly where a tool that generated a wrangler config would put
 * one, and skipping them would leave the assertion below blind at the one place the mistake lands.
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
		// refused as such rather than reviewed later. the go half of `pnpm run console` is a root
		// script and runs a binary on this machine.
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
		// structurally absent. every read and every press here is a call to the go binary on the
		// loopback address, so there is nothing for a server to do either.
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
		// place. the go package is swept beside this one because the built bundle lands there and a
		// tool that generated a config would put it wherever it wrote the bundle.
		const configs = [...tree(HERE), ...tree(CONSOLE)].filter((path) =>
			/wrangler\.(json|jsonc|toml)$/.test(path)
		);
		expect(configs).toEqual([]);
	});

	it('is outside both paths a deploy uploads', () => {
		// the two paths are read off the two files that name them, as text. wrangler.jsonc carries
		// comments so it is not JSON, and vite.config.ts is a module; a parser for either here would
		// be a second answer to what that file says, and both keys are unambiguous enough to read
		// directly. the counts below are what say so.
		//
		// the worker entry is wrangler.jsonc's `main`, which packages/app's build compiles. the
		// assets are the public directory, which vite copies whole into the client build — that
		// build is what packages/app/scripts/preflight-deploy.js counts the embed in and what the
		// generated config uploads, and no path to it is spelled in wrangler.jsonc at all.
		const config = readFileSync(join(APP, 'wrangler.jsonc'), 'utf8');
		const main = [...config.matchAll(/"main"\s*:\s*"([^"]*)"/g)].map((m) => m[1] ?? '');
		const vite = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
		const assets = [...vite.matchAll(/publicDir\s*:\s*'([^']*)'/g)].map((m) => m[1] ?? '');
		// one of each, which is what makes reading the first one of each honest. a named
		// environment declaring a second `main` would fail here rather than go unread.
		expect(main.length).toBe(1);
		expect(assets.length).toBe(1);
		for (const path of [...main, ...assets]) {
			expect(resolve(APP, path).startsWith(APP + sep)).toBe(true);
		}
		expect(HERE.startsWith(APP + sep)).toBe(false);
	});

	it('is named by no script in packages/app, and carries one staging step of its own', () => {
		// every script there, rather than only `build` and `deploy`: a staging step arrives as its
		// own script and is chained into one of those afterwards, so the step is what has to be
		// caught and not the chain. `console` as a whole word — any path from packages/app to this
		// package spells it, and a script legitimately mentioning a terminal does not.
		const naming = Object.entries(app.scripts ?? {}).filter(([, run]) => /\bconsole\b/.test(run));
		expect(naming).toEqual([]);
		// the counterpart on this side: the binary's ui arrives by one embed directive, and a second
		// one would be a second directory quietly becoming load-bearing. `all:` is what includes the
		// files vite writes whose names begin with `_` or `.`, and a bundle missing one of those is a
		// page that loads and draws nothing.
		const embed = readFileSync(join(CONSOLE, 'ui', 'embed.go'), 'utf8');
		const directives = [...embed.matchAll(/^\/\/go:embed\s+(.*)$/gm)].map((m) => m[1]?.trim());
		expect(directives).toEqual(['all:dist']);
	});

	it('is reached by no root script that deploys', () => {
		// the root forwards every operator command into packages/app (CLAUDE.md), and `deploy` is
		// the one that reaches the one-way door.
		expect(root.scripts?.deploy).toContain('@better-giving/app');
		expect(root.scripts?.deploy).not.toMatch(/\bconsole\b/);
	});
});
