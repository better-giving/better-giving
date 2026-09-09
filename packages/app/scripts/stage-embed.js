/**
 * `pnpm run build`'s middle step — copies `packages/form/dist/` into `static/`, so `vite build`
 * (the step after this one) finds the embed there and folds it into the worker's assets the same
 * way it always has.
 *
 * why staging exists at all. `@better-giving/form` builds without knowing where its output is
 * served from — `packages/form/vite.embed.config.ts` writes both halves into its own `dist/`,
 * never into this app's `static/` directly, because a package that reached out of its own
 * directory would be a dependency running the other way. this script is the one place that
 * decision is made, and it is the one thing standing between `pnpm run build:embed` and
 * `vite build` in `pnpm run build`.
 *
 * `fs.cpSync` rather than a shell `cp`, so this runs the same way on every fork's machine —
 * CLAUDE.md's own reason for D1 migrations running through wrangler rather than a shell script
 * applies here too: a fork is not guaranteed to be on darwin.
 *
 * `static/embed/` is cleared before the copy, and only that subdirectory — never `static/`
 * itself, which holds committed files (`_headers`, `robots.txt`). `cpSync` is additive: the
 * runtime carries a content hash in its filename, so an older build's file is a different name
 * from the current one and a plain copy leaves both sitting there. left uncleared, that failure
 * is permanent — every later `pnpm run build` finds the same two files and fails the same way,
 * even after whatever changed the hash is reverted, until someone manually removes the stale one.
 */

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_PATH_PREFIX, runtimeAssetPath } from '@better-giving/form/embed/stamp';

/** where the form's own build leaves its two halves, reached from this package's own directory. */
const DIST = join('..', 'form', 'dist');

/** where the app's build expects them, ready for `vite build` to pick up. */
const STATIC = 'static';

/**
 * asserts `dir` holds exactly one runtime, blaming whichever stage left it wrong.
 *
 * `runtimeAssetPath` already carries the "exactly one" rule — packages/form/vite.embed.config.ts's
 * own loader pass relies on the same function — so it is read here rather than re-derived, and
 * only the blame is added: the message says whether the form build emitted the wrong thing or
 * whether staging is the one that got it wrong, which is what tells the reader which script to go
 * looking in.
 */
function assertOneRuntime(dir, blame) {
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		names = [];
	}
	try {
		runtimeAssetPath(names);
	} catch (error) {
		throw new Error(`${blame} — ${error.message}`, { cause: error });
	}
}

export function main(root = process.cwd()) {
	const dist = join(root, DIST);
	if (!existsSync(dist)) {
		throw new Error(
			`${DIST} does not exist, so there is nothing to stage into ${STATIC}. Run the form's own ` +
				'build first — `pnpm run build:embed` (which `pnpm run build` already does before this ' +
				'step) — and check what it printed rather than what this script says.'
		);
	}

	// checked before anything here is cleared or copied — a count taken after either would already
	// be answering about the wrong tree, and this is what tells a broken form build apart from a
	// broken staging step.
	assertOneRuntime(join(dist, 'embed'), 'the form build');

	const runtimeDir = join(root, STATIC, RUNTIME_PATH_PREFIX);
	rmSync(runtimeDir, { recursive: true, force: true });

	cpSync(dist, join(root, STATIC), { recursive: true });

	assertOneRuntime(runtimeDir, 'staging');
}

// `pnpm run build` runs this file and the spec beside it imports `main`, so the run is guarded —
// see scripts/preflight-deploy.js for why an unconditional one would take the test process with it.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
