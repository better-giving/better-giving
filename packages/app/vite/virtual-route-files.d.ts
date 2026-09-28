// the module `./route-files.ts`'s plugin serves. src/lib/page/slug.ts is the one importer.
declare module 'virtual:route-files' {
	const routeFiles: readonly string[];
	export default routeFiles;
}
