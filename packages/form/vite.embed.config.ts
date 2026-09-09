import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { RUNTIME_PATH_PREFIX } from './src/embed/loader';
import { runtimeAssetPath, stampLoader } from './src/embed/stamp';

// the embed's own build: two classic scripts, run once each by `pnpm run build:embed`.
//
// separate from packages/app/vite.config.ts and deliberately without the reactRouter plugin,
// because what these two files are is not what the app is. the snippet an org pastes loads a bare
// `<script src>` with no `type="module"`, so the output has to be a self-executing classic script
// — no `import` statement anywhere in it, on a page whose browser support is not ours to choose.
//
// two builds rather than one because a rollup bundle in `iife` format takes a single entry, and
// these two must not be one bundle: the loader is re-fetched every few minutes and the runtime is
// kept for a year, which is the whole reason the runtime carries a content hash in its name. the
// runtime build runs first and empties its own directory, so a hash from an earlier build cannot
// ship beside the current one; the loader build then reads the name that was left there and writes
// it into the loader as it is emitted.
//
// both land in this package's dist/, and scripts/stage-embed.js copies that directory into the
// app's static/ before `vite build` runs — so `/embed.js` and `/embed/<hash>.js` end up in the
// worker's assets and are served ahead of the worker, never running packages/app/src/worker.ts at
// all. that matters: the loader is fetched by every page load on every site that has pasted the
// snippet, and none of those fetches costs this deployment a worker invocation.
//
// `embedConfig` is exported by name as well as by default, and packages/form/src/embed/build.spec.ts
// imports it — with `importAllowed` beside it — to assert the mode switch, the two output
// directories and which specifiers may enter the bundle. type-checking is not that import's job: this file is named in packages/form/tsconfig.json's `include`, so a signature change
// in packages/form/src/embed/stamp.ts fails `pnpm --filter @better-giving/form check` — which the
// root `check` script runs first, and which lefthook.yml runs at commit time. what the spec catches
// is a change that still type-checks and would die inside `build`, which is `deploy`'s first step:
// in front of the remote migration rather than behind it, but on the deployer's machine rather than
// the contributor's.

const ROOT = import.meta.dirname;

/** where the hashed runtime is written, mirroring the path it is served under. */
const RUNTIME_DIR = `dist${RUNTIME_PATH_PREFIX}`;

const ENTRIES = {
	loader: 'src/embed/loader.entry.ts',
	runtime: 'src/embed/runtime.entry.ts'
} as const;

/** what this package declares it may import, read rather than restated so the two cannot drift. */
function declaredDependencies(): readonly string[] {
	const manifest: unknown = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
	const dependencies =
		typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
			? manifest.dependencies
			: undefined;
	return typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : [];
}

/**
 * whether a specifier may enter the bundle, given what this package declares.
 *
 * a bare specifier and nothing else. relative and rooted paths are this package's own source and a
 * `\0` prefix is another plugin's virtual module, neither of which this has anything to say about.
 *
 * a `node:` builtin is refused along with everything undeclared, and that is not an oversight: both
 * halves of this build run in a browser on a page this project does not own, so a builtin reaching
 * the graph is a module the bundle cannot have. packages/form/src/embed/stamp.ts is the shape the
 * source keeps to — it takes what it is given and touches no filesystem — and this is what holds
 * the rest of the package to it.
 */
export function importAllowed(source: string, allowed: readonly string[]): boolean {
	if (source.startsWith('\0') || source.startsWith('.') || source.startsWith('/')) return true;
	// an already-resolved absolute path on windows, which a fork may well be building on — see
	// scripts/stage-embed.js for why nothing here assumes darwin.
	if (/^[a-zA-Z]:[\\/]/.test(source)) return true;
	return allowed.some((name) => source === name || source.startsWith(`${name}/`));
}

/**
 * refuses an import this package does not declare, at the moment it would enter the bundle.
 *
 * biome.jsonc states the same boundary and is the gate that covers app source as well as this
 * package, but it runs at commit time through lefthook.yml and neither `build` nor `deploy` runs
 * `lint`. this is the half of that rule the shipping build enforces on its own, and the failure it
 * exists for is the worst one available here: node resolution walks up to the workspace root's
 * node_modules, so `zod`, `drizzle-orm` and every other root dependency resolve from inside this
 * package whether it declares them or not — and an `iife` is a self-contained bundle, so one that
 * resolved would be minified into the script served to every third-party page that pasted the
 * snippet, with nothing on any output saying so.
 *
 * `enforce: 'pre'` is load-bearing. vite's own resolver runs ahead of a plugin that does not ask
 * for it, and a specifier it has already resolved never reaches this hook — the gate would be
 * green because it never ran.
 */
function refuseUndeclaredImports(): Plugin {
	const allowed = declaredDependencies();
	return {
		name: 'bg-donate-refuse-undeclared-imports',
		enforce: 'pre',
		resolveId(source, importer) {
			if (importer === undefined || importAllowed(source, allowed)) return null;
			throw new Error(
				`packages/form/src imports "${source}", which packages/form/package.json does not declare — it was reached through the workspace root's node_modules, and this build would bundle it into the script served to every site that pasted the snippet. Imported by ${importer}. Either drop the import or widen this package's \`dependencies\` deliberately; the same boundary is stated for app source in biome.jsonc.`
			);
		}
	};
}

/**
 * writes the runtime's path into the loader as the loader is emitted.
 *
 * reads the name off disk rather than being told it, because the two builds are separate
 * invocations and the hash is rollup's answer to what the runtime's bytes turned out to be. the
 * directory holding anything but exactly one script is refused by `runtimeAssetPath`, which is what
 * catches a runtime build that was skipped or that failed to clean up after itself.
 */
function stampRuntimePath(): Plugin {
	return {
		name: 'bg-donate-stamp-runtime-path',
		generateBundle(_options, bundle) {
			const dir = resolve(ROOT, RUNTIME_DIR);
			if (!existsSync(dir)) {
				throw new Error(
					`${RUNTIME_DIR} does not exist, so there is no runtime for the loader to point at. Run the runtime build first — \`pnpm run build:embed\` runs both in order.`
				);
			}
			const path = runtimeAssetPath(readdirSync(dir));
			for (const output of Object.values(bundle)) {
				if (output.type === 'chunk') output.code = stampLoader(output.code, path);
			}
		}
	};
}

/**
 * one of the two builds, chosen by `--mode`.
 *
 * an unrecognised mode is refused rather than defaulted. vite's own default is `production`, and
 * falling through to the loader half on it would write into static/ without emptying it and stamp
 * whichever hash happened to be lying there — a deploy carrying an older runtime, with nothing on
 * any output saying so.
 */
export function embedConfig({ mode }: { readonly mode: string }): UserConfig {
	if (mode !== 'runtime' && mode !== 'loader') {
		throw new Error(
			`vite.embed.config.ts builds one half at a time and must be given --mode runtime or --mode loader; it was given "${mode}". \`pnpm run build:embed\` runs both, in that order.`
		);
	}
	const runtime = mode === 'runtime';
	return {
		root: ROOT,
		// nothing is copied alongside these two files. this package has no `public/` for vite to
		// find, so the setting changes nothing today and is kept as a statement about what dist/ is
		// allowed to contain: scripts/stage-embed.js copies the whole of it into the app's static/,
		// so anything that appeared here would be served from the deployment without being asked for.
		publicDir: false,
		// the boundary gate is on both halves. the loader imports nothing but its own source today,
		// and that is the state it is being held in rather than a reason to leave it ungated.
		plugins: runtime
			? [refuseUndeclaredImports()]
			: [refuseUndeclaredImports(), stampRuntimePath()],
		build: {
			outDir: runtime ? RUNTIME_DIR : 'dist',
			// the runtime build owns its directory and clears it, so the previous build's hash cannot
			// be served beside the current one. the loader build must not: it writes into dist/, and
			// emptying that on its way out would take the hashed runtime the runtime pass just wrote
			// with it — the two passes share this directory, and only one of them may clear it.
			emptyOutDir: runtime,
			target: 'es2022',
			minify: true,
			sourcemap: false,
			lib: {
				entry: resolve(ROOT, runtime ? ENTRIES.runtime : ENTRIES.loader),
				formats: ['iife'],
				name: runtime ? 'bgDonateRuntime' : 'bgDonateLoader'
			},
			rollupOptions: {
				// the runtime is named by the hash of its own contents, which is what makes it safe to
				// serve with `immutable`: a new build is a new url and nothing has to expire.
				output: { entryFileNames: runtime ? '[hash].js' : 'embed.js' }
			}
		}
	};
}

export default defineConfig(embedConfig);
