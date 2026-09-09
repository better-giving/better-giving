// the two string-to-string steps the embed build is made of, kept out of the build script so
// they can be asserted without running one.
//
// the suite runs in lefthook.yml's pre-commit hook, with no build ordered ahead of it anywhere, so
// at the moment it runs there may well be no bundle on disk — a spec that shelled out to a build
// would either be asserting nothing or putting a full build inside every commit. ./stamp.spec.ts
// asserts these instead, and vite.embed.config.ts calls them.
//
// no node, no dom, no filesystem: both take what they are given.

// the `.ts` is required and is the only extensioned relative import in this package. scripts/
// stage-embed.js is plain node running this module's source through `@better-giving/form/embed/
// stamp`, and node's type stripping resolves a specifier literally — it does no extension probing,
// so `./loader` is a module-not-found at `pnpm run build`. vite and tsc both accept the extension
// (`rewriteRelativeImportExtensions` is on in tsconfig.base.json), so nothing else has to change;
// normalising it away restores the failure.
import { RUNTIME_PATH_PLACEHOLDER, RUNTIME_PATH_PREFIX } from './loader.ts';

/**
 * the only shape a stamped path may take.
 *
 * a shape rather than a list of characters to escape, and the difference is what the guard is
 * worth. the path is written into a string literal in already-minified output, and which quoting
 * that literal uses is the minifier's choice — vite emits template literals, so a guard that
 * enumerated `"` and `'` would be watching the two characters that cannot end it while leaving a
 * backtick and `${` free. a hash is `[A-Za-z0-9_-]` and nothing else, so saying what is allowed
 * covers every quoting the build could ever emit.
 */
const RUNTIME_PATH_SHAPE = new RegExp(`^${RUNTIME_PATH_PREFIX}[A-Za-z0-9_-]+\\.js$`);

/**
 * re-exported so the build reads the placeholder and the paths from one import.
 *
 * this module is the package's only export the app's build reaches — `./embed/stamp` in
 * package.json — so scripts/stage-embed.js and scripts/embed-headers.spec.ts read the two path
 * constants through here rather than the package widening its exports to `./embed/loader`, which
 * is the loader's own implementation and nothing outside the element has business importing.
 */
export { LOADER_PATH, RUNTIME_PATH_PLACEHOLDER, RUNTIME_PATH_PREFIX } from './loader.ts';

/** where the hashed runtime is served from, given what the runtime build emitted. */
export function runtimeAssetPath(fileNames: readonly string[]): string {
	const scripts = fileNames.filter((name) => name.endsWith('.js'));
	const only = scripts.length === 1 ? scripts[0] : undefined;
	if (only === undefined) {
		throw new Error(
			`the embed runtime build must leave exactly one .js file behind, and it left ${scripts.length}: ${scripts.join(', ') || '(none)'}`
		);
	}
	return `${RUNTIME_PATH_PREFIX}${only}`;
}

/**
 * the loader with the runtime's path written into it.
 *
 * this is what makes the loader safe to serve short and the runtime safe to serve forever: the
 * loader is re-fetched every few minutes and arrives already carrying the current hash, so an
 * upgrade reaches a site that pasted the snippet once and never touched it again. nothing is
 * fetched at runtime to find that out.
 *
 * every occurrence is replaced rather than the first, because a minifier is free to inline the
 * constant at each use site. a source the placeholder is missing from is a build that would ship
 * a loader asking for a file named after the placeholder, so it stops here instead.
 */
export function stampLoader(source: string, runtimePath: string): string {
	// the path lands inside a string literal in output that has already been minified, so anything
	// that could end that literal early emits a loader which does not parse. it is checked against
	// the one shape it may have rather than against a list of characters it may not; see
	// `RUNTIME_PATH_SHAPE`.
	if (!RUNTIME_PATH_SHAPE.test(runtimePath)) {
		throw new Error(
			`the embed runtime path must be ${RUNTIME_PATH_PREFIX}<hash>.js, and it was: ${runtimePath}`
		);
	}
	if (!source.includes(RUNTIME_PATH_PLACEHOLDER)) {
		throw new Error(
			`the built embed loader carries no ${RUNTIME_PATH_PLACEHOLDER} placeholder, so there is nowhere to write the runtime path. packages/form/src/embed/loader.entry.ts is what puts it there.`
		);
	}
	return source.split(RUNTIME_PATH_PLACEHOLDER).join(runtimePath);
}
