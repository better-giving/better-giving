// `virtual:route-files` — the route file names under `src/routes/`, read once with `fs.readdirSync`
// rather than `import.meta.glob`.
//
// src/lib/page/slug.ts wants only the names: it walks each one apart with its own tokenizer and
// never calls the module a route file names. `import.meta.glob` has no names-only mode — every key
// it returns is a lazy `import()` — so the only way to read the names through it is to build 45
// dynamic-import edges nothing ever calls. vite warns INEFFECTIVE_DYNAMIC_IMPORT once per
// environment for each one, and every route module gains an import edge into a rule about URL
// segments. this plugin is the fix: the names, and nothing that imports them.
//
// `IGNORED_ROUTE_FILE_GLOBS` is exported so src/routes.ts's `ignoredRouteFiles` can pass the same
// array to `flatRoutes` — a spec beside its subject is a test and not an address in both places,
// and restating the pattern is how the two come to disagree about which file that is.

import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_MODULE_ID = 'virtual:route-files';
// a leading `\0` is the convention a vite plugin's `resolveId` uses to mark a resolved id as its
// own, so no other plugin tries to load or transform it.
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

/** the glob `src/routes.ts` hands `flatRoutes`, and the one this module reads route names by. */
export const IGNORED_ROUTE_FILE_GLOBS: readonly string[] = ['**/*.spec.*'];

// a basename check built from IGNORED_ROUTE_FILE_GLOBS rather than a second, hand-written pattern:
// each glob here is `**/<rest>`, and a directory walk only ever offers a basename, so the check
// drops that prefix and turns what is left into a regular expression.
function matchesIgnoredGlob(basename: string): boolean {
	return IGNORED_ROUTE_FILE_GLOBS.some((glob) => {
		const rest = glob.replace(/^\*\*\//, '');
		const pattern = rest.replace(/[.]/g, '\\.').replace(/\*/g, '.*');
		return new RegExp(`^${pattern}$`).test(basename);
	});
}

function collectRouteFiles(dir: string, root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectRouteFiles(full, root));
			continue;
		}
		if (matchesIgnoredGlob(entry.name)) continue;
		files.push(relative(root, full).split(sep).join('/'));
	}
	return files;
}

/**
 * the plugin that answers `virtual:route-files` with the file paths under `routesDir`, relative to
 * it and forward-slashed, a spec's own file left out.
 *
 * in dev, adding or removing a file under `routesDir` invalidates the module and asks the client
 * for a full reload — the list is read once per request for it, not watched value by value, since
 * nothing but a server start or a page load ever reads it again.
 */
export function routeFiles(routesDir: string): Plugin {
	return {
		name: 'route-files',
		resolveId(id) {
			return id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : undefined;
		},
		load(id) {
			if (id !== RESOLVED_VIRTUAL_MODULE_ID) return undefined;
			const files = collectRouteFiles(routesDir, routesDir);
			return `export default ${JSON.stringify(files)};\n`;
		},
		configureServer(server) {
			server.watcher.add(routesDir);
			const invalidate = (file: string) => {
				if (!file.startsWith(routesDir)) return;
				const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
				if (!mod) return;
				server.moduleGraph.invalidateModule(mod);
				server.ws.send({ type: 'full-reload' });
			};
			server.watcher.on('add', invalidate);
			server.watcher.on('unlink', invalidate);
		}
	};
}
