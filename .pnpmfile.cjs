// better-auth peers `vitest` and `drizzle-kit` as optional, and only its `better-auth/test` export
// imports them. packages/app holds both as devDependencies, so pnpm resolves the peers into
// better-auth's lockfile snapshot, and `pnpm install --prod` keeps that snapshot's edges: vitest,
// vite, playwright and happy-dom would ship in the image. neither `overrides` nor
// `peerDependencyRules` can remove a peer an importer holds; `readPackage` runs before resolution
// (https://pnpm.io/10.x/pnpmfile). the lockfile records this file's checksum, so the Dockerfile's
// prod-deps stage must copy it beside `pnpm-lock.yaml`.
function readPackage(pkg) {
	if (pkg.name === 'better-auth') {
		for (const peer of ['vitest', 'drizzle-kit']) {
			delete pkg.peerDependencies?.[peer];
			delete pkg.peerDependenciesMeta?.[peer];
		}
	}
	return pkg;
}

module.exports = { hooks: { readPackage } };
