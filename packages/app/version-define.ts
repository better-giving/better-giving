// the release a build was cut from, as a constant the bundle carries.
//
// `.github/workflows/publish-image.yml` passes the commit it builds as `BETTER_GIVING_VERSION`, a
// build argument of the root `Dockerfile`, and this is where that becomes a value inside the app.
// every other build leaves the variable unset and gets `null`: a checkout, and the suite.
//
// what reads it is the connector's `hello` (`connectorRelease` in
// `src/lib/server/connector/surface.ts`), which answers `0.0.0` for a build that named none.
//
// **the define and its type are stated together here on purpose.** the constant reaches the app as
// a bare global with nothing to import, so a name written out in a config and a type written out
// in a `.d.ts` would be two statements able to drift into a value nothing replaces — which is a
// `ReferenceError` at runtime rather than a type error.
//
// it is its own module because more than one config spreads it: ./vite.config.ts builds with it
// and ./vitest.config.ts defines it too, or a spec meets a name nothing declared.

declare global {
	/** the release this app was built from, or `null` where the build's environment named none. */
	const __BETTER_GIVING_VERSION__: string | null;
}

/**
 * the define every config that builds this app spreads, so the name and the reading come off one
 * statement.
 *
 * an empty variable reads as unset rather than as a version: a build that exported the name and
 * nothing else has no more to say about which release it is than one that never exported it, and
 * an empty string on the wire is a version a caller would try to compare.
 */
export const versionDefine = {
	__BETTER_GIVING_VERSION__: JSON.stringify(process.env.BETTER_GIVING_VERSION || null)
};
