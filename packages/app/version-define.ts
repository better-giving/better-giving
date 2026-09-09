// the release a build was cut from, as a constant the bundle carries.
//
// `.github/workflows/release.yml` puts the tag in the environment of the app build, without its
// leading `v` — the spelling `cmd/pack` names the worker bundle beside it by — and this is where
// that becomes a value inside the worker. every other build leaves the variable unset and gets
// `null`: a checkout, a `pnpm run deploy` from one, and the suite.
//
// what reads it is the console surface's report (`src/lib/server/console/report.ts`), so a console
// can tell a deployment behind the release it is holding from one already on it. a deployment that
// answers `null` is one no release installed, and the console judges it by migrations alone.
//
// **the define and its type are stated together here on purpose.** the constant reaches the app as
// a bare global with nothing to import, so a name written out in a config and a type written out
// in a `.d.ts` would be two statements able to drift into a value nothing replaces — which is a
// `ReferenceError` on every console request rather than a type error.
//
// it is its own module because more than one config spreads it: ./vite.config.ts builds with it
// and ./vitest.workers.config.ts defines it too, or the report's spec meets a name nothing declared.
// the pools in ./vitest.config.ts define nothing, which holds while no spec outside the workers
// pool reads the constant.

declare global {
	/** the release this worker was built from, or `null` where the build's environment named none. */
	const __BETTER_GIVING_VERSION__: string | null;
}

/**
 * the define every config that builds this app spreads, so the name and the reading come off one
 * statement.
 *
 * an empty variable reads as unset rather than as a version: a build that exported the name and
 * nothing else has no more to say about which release it is than one that never exported it, and
 * an empty string on the wire is a version a console would try to compare.
 */
export const versionDefine = {
	__BETTER_GIVING_VERSION__: JSON.stringify(process.env.BETTER_GIVING_VERSION || null)
};
