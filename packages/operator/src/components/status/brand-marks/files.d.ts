// what ../BrandMark.jsx imports a mark's file as: the url each surface's bundler resolves it to.
// this package declares no bundler of its own, so its own `check` reads the two shapes here; a
// surface checking the same import reads them off its own `vite/client` types.

declare module '*.svg' {
	const url: string;
	export default url;
}

declare module '*.png' {
	const url: string;
	export default url;
}
