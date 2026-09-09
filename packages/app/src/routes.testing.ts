import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path/posix';
import {
	createStaticHandler,
	isRouteErrorResponse,
	matchRoutes,
	type RouteObject
} from 'react-router';
import ts from 'typescript';

// what ./routes.spec.ts needs to ask questions of the route tree, kept out of the spec so the
// rules there read as rules. the `.testing.ts` suffix matches no pool's `include` glob
// (CONTRIBUTING.md → Tests), so this is a module one spec imports rather than a second file of
// tests — and it sits beside ./routes.ts, which is its subject, rather than under ./routes/, where
// every file is an address.

/** the app directory, which every path in this module is relative to. `react-router.config.ts`. */
export const APP_DIRECTORY = resolve(import.meta.dirname);

/** one route in the app, as react router resolved it. */
export interface RouteRecord {
	/** the module, relative to the app directory: `routes/_app.tsx`. */
	readonly file: string;
	/** the URL it is served at. a pathless layout is served at its parent's path. */
	readonly path: string;
	/** every route module between the root and this one, outermost first. */
	readonly ancestors: readonly string[];
}

/**
 * the app's own route tree, resolved by the app's own config.
 *
 * ./routes.ts is imported and run rather than re-derived: the file-system convention is the
 * framework's, and a spec that reimplemented it would be asserting against its own idea of which
 * files are addresses.
 */
export async function routeManifest(): Promise<RouteRecord[]> {
	const records: RouteRecord[] = [];
	collect(await routeConfig(), '', [], records);
	return records;
}

/**
 * the entries ./routes.ts resolves to, nested as react router nests them.
 *
 * `flatRoutes` reads the app directory off a global that the dev server normally sets
 * (`getAppDirectory` in `@react-router/dev`), so this sets it first.
 */
async function routeConfig(): Promise<readonly RouteConfigEntry[]> {
	(globalThis as Record<string, unknown>).__reactRouterAppDirectory = APP_DIRECTORY;
	const config = (await import('./routes')) as { default: Promise<RouteConfigEntry[]> };
	return await config.default;
}

/**
 * the status this app answers one address with, decided by react router's own matcher over the
 * app's own route config.
 *
 * it exists for the addresses this app is asserted **not** to serve, and a manifest sweep cannot
 * answer that: a sweep compares paths a spec wrote against paths a spec read, while what a caller
 * gets is whatever `matchRoutes` does with the tree. so the tree is mounted and asked, and the
 * unmatched answer that comes back — 404, not 500 and not a promise that never settles — is the
 * claim.
 *
 * no handlers are mounted, because none are needed for that: a route module's `loader` cannot run
 * in this pool at all (`cloudflare:test`, D1, the deploy-time env), and a match with no loader is
 * already distinguishable from no match — the framework answers the first 400 and the second 404.
 * ./route-request.testing.ts is where a route's own handlers are run, inside workerd.
 */
export async function statusAt(pathname: string): Promise<number> {
	const handler = createStaticHandler(asRouteObjects(await routeConfig()));
	try {
		const answer = await handler.queryRoute(
			new Request(`https://give.example.workers.dev${pathname}`)
		);
		return answer instanceof Response ? answer.status : 200;
	} catch (thrown) {
		// a short-circuit rather than a fault: the framework throws its own 4xx, and a handler that
		// threw a `Response` would be answering with it.
		if (thrown instanceof Response) return thrown.status;
		if (isRouteErrorResponse(thrown)) return thrown.status;
		throw thrown;
	}
}

/**
 * the route file react router's own matcher chooses for an address, or `null` where nothing
 * matches.
 *
 * `statusAt` above answers what a caller gets; this answers *which route* answered, which is the
 * only way to state a precedence claim. a dynamic top-level segment matches every address a static
 * top-level route matches, and react router ranks the static one higher — so "`/login` still
 * reaches the sign-in screen" is a fact about the matcher rather than about either file, and a
 * manifest sweep cannot see it.
 */
export async function matchedFileAt(pathname: string): Promise<string | null> {
	const matches = matchRoutes(asRouteObjects(await routeConfig()), pathname);
	return matches?.[matches.length - 1]?.route.id ?? null;
}

/**
 * the config as react router's own route objects, carrying the shape of the tree and nothing else.
 *
 * the file is the `id`, so a match hands back the module that answered rather than a position.
 */
function asRouteObjects(entries: readonly RouteConfigEntry[]): RouteObject[] {
	return entries.map(
		(entry) =>
			({
				id: entry.file,
				path: entry.path,
				index: entry.index,
				...(entry.children ? { children: asRouteObjects(entry.children) } : {})
			}) as RouteObject
	);
}

/** the shape `@react-router/dev` resolves a route config into. only what this module reads. */
interface RouteConfigEntry {
	readonly file: string;
	readonly path?: string | undefined;
	readonly index?: boolean | undefined;
	readonly children?: readonly RouteConfigEntry[] | undefined;
}

function collect(
	entries: readonly RouteConfigEntry[],
	parentPath: string,
	ancestors: readonly string[],
	out: RouteRecord[]
): void {
	for (const entry of entries) {
		const path = entry.path ? `${parentPath}/${entry.path}` : parentPath;
		out.push({ file: entry.file, path: path || '/', ancestors });
		if (entry.children) collect(entry.children, path, [...ancestors, entry.file], out);
	}
}

/** whether a route sits under a layout — the layout itself counts, its middleware runs for it. */
export function under(route: RouteRecord, layout: string): boolean {
	return route.file === layout || route.ancestors.includes(layout);
}

/**
 * the route exports react router strips from the client build, and the whole basis of the gate
 * below.
 *
 * everything a route module exports under any other name is rendered or run in the browser, this
 * list included in reverse: a name react router adds to it later makes this gate stricter than it
 * needs to be, which is the direction to be wrong in. the framework's own copy is the list its
 * build error quotes — https://reactrouter.com/explanation/code-splitting.
 */
export const SERVER_ONLY_ROUTE_EXPORTS = ['loader', 'action', 'middleware', 'headers'] as const;

/** reads one module's source, by path relative to the app directory, or `null` if there is none. */
export type ReadModule = (file: string) => string | null;

/** the real one. */
export const readFromDisk: ReadModule = (file) => {
	try {
		return readFileSync(join(APP_DIRECTORY, file), 'utf8');
	} catch {
		return null;
	}
};

/**
 * the path from a route module's client-side exports to the server tree, or `[]` when there is
 * none.
 *
 * why this exists: react router removes `loader`, `action`, `middleware` and `headers` from the
 * client build and tree-shakes what only they used, so a route module may import `$lib/server/**`
 * for its loader and ship nothing of it to the browser. what the build does *not* do is tell
 * anyone when that stops being true — a component that reaches for a server module compiles, and
 * on this app's server tree that means D1, the stripe client and the deploy-time secrets in the
 * bundle a browser downloads.
 *
 * how it decides. every top-level statement in the route module is a root except the exported
 * declarations named above: a bare `const` at module scope is not dropped from a bundle just
 * because the export that used it was, so it is reachable too. from those roots it follows every
 * identifier that resolves to a top-level declaration or to an imported binding, and every local
 * module so reached is followed whole — a module that is not a route has no export the framework
 * strips, so all of it ships.
 *
 * and a route module with no client-side export at all is passed over whole, which is where that
 * module-scope reading stops. it stops because its premise does: a bundler keeps a module-scope
 * binding after dropping the export that used it, but only in a module the client build still
 * emits, and a route whose every export is on the list above leaves nothing for it to emit. the
 * two endpoints on `/api/v1` are that shape — a `loader` and an `action` and no component — and
 * under the strict reading every helper beside them counted as browser code, so the gate was
 * pushing server-only files into one-function-per-export while protecting a bundle that does not
 * exist. any export react router does ship puts the module back in the browser build and the
 * strict reading applies to all of it again; `clientLoader` on a route with no component is that
 * case, and it is why the test is for a client-side export rather than for a component by name.
 *
 * `import type` is not followed, and does not need to be: this package sets
 * `verbatimModuleSyntax`, so a type-only import is erased with the text it was written as.
 */
export function reachesServerTree(entry: string, read: ReadModule = readFromDisk): string[] {
	const source = read(entry);
	if (source === null) throw new Error(`no module to read at ${entry}`);

	const seen = new Set<string>([entry]);
	const queue: { file: string; source: string; specifiers: string[] }[] = [
		{ file: entry, source, specifiers: clientSpecifiers(entry, source) }
	];
	const chains = new Map<string, string[]>([[entry, [entry]]]);

	while (queue.length > 0) {
		const module = queue.shift();
		if (!module) break;
		const chain = chains.get(module.file) ?? [module.file];

		for (const specifier of module.specifiers) {
			const target = resolveModule(module.file, specifier, read);
			if (!target) continue;
			if (seen.has(target.file)) continue;
			seen.add(target.file);
			chains.set(target.file, [...chain, target.file]);

			if (target.file.startsWith('lib/server/')) return [...chain, target.file];
			queue.push({
				file: target.file,
				source: target.source,
				// not a route, so nothing about it is stripped: every import it has ships with it.
				specifiers: allSpecifiers(target.file, target.source)
			});
		}
	}

	return [];
}

/** every module specifier a non-route module imports for a value. */
function allSpecifiers(file: string, source: string): string[] {
	const sourceFile = parse(file, source);
	const specifiers: string[] = [];
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
			specifiers.push(literal(statement.moduleSpecifier));
		}
		if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
			specifiers.push(literal(statement.moduleSpecifier));
		}
	}
	return specifiers.filter((value) => value.length > 0);
}

/** every module specifier a route module's client-side half imports for a value. */
function clientSpecifiers(file: string, source: string): string[] {
	const sourceFile = parse(file, source);
	if (!shipsToBrowser(sourceFile)) return [];

	/** local binding name -> the module it came from. type-only bindings are left out. */
	const imported = new Map<string, string>();
	/** top-level declaration name -> the statements that declare it. */
	const declared = new Map<string, ts.Node[]>();
	const roots: ts.Node[] = [];
	const reached = new Set<string>();

	const declare = (name: string, node: ts.Node) => {
		declared.set(name, [...(declared.get(name) ?? []), node]);
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			const clause = statement.importClause;
			if (!clause || clause.isTypeOnly) continue;
			const from = literal(statement.moduleSpecifier);
			if (clause.name) imported.set(clause.name.text, from);
			const bindings = clause.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) imported.set(bindings.name.text, from);
			if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					if (!element.isTypeOnly) imported.set(element.name.text, from);
				}
			}
			continue;
		}

		if (ts.isExportDeclaration(statement)) {
			// `export { a as loader }` hides a server-only export behind a local name, and
			// `export … from` re-exports one; both are read by the name they are exported under.
			if (statement.isTypeOnly) continue;
			const clause = statement.exportClause;
			if (!clause || !ts.isNamedExports(clause)) continue;
			for (const element of clause.elements) {
				if (element.isTypeOnly) continue;
				if (isServerOnly(element.name.text)) continue;
				if (statement.moduleSpecifier) roots.push(statement);
				else reached.add((element.propertyName ?? element.name).text);
			}
			continue;
		}

		const names = declaredNames(statement);
		for (const name of names) declare(name, statement);
		// the exported declarations react router strips, and nothing else is passed over: a
		// module-scope `const` survives a bundler that dropped the export which used it.
		if (names.length > 0 && names.every(isServerOnly) && isExported(statement)) continue;
		roots.push(statement);
	}

	for (const root of roots) collectIdentifiers(root, reached);

	const specifiers = new Set<string>();
	const pending = [...reached];
	const walked = new Set<string>();
	while (pending.length > 0) {
		const name = pending.pop();
		if (name === undefined || walked.has(name)) continue;
		walked.add(name);

		const from = imported.get(name);
		if (from) specifiers.add(from);

		for (const node of declared.get(name) ?? []) {
			const identifiers = new Set<string>();
			collectIdentifiers(node, identifiers);
			for (const next of identifiers) if (!walked.has(next)) pending.push(next);
		}
	}

	// a side-effect import runs whatever it names, so nothing is stripped from it.
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && !statement.importClause) {
			specifiers.add(literal(statement.moduleSpecifier));
		}
	}

	return [...specifiers].filter((value) => value.length > 0);
}

function parse(file: string, source: string): ts.SourceFile {
	return ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
}

function literal(node: ts.Expression): string {
	return ts.isStringLiteral(node) ? node.text : '';
}

function isServerOnly(name: string): boolean {
	return (SERVER_ONLY_ROUTE_EXPORTS as readonly string[]).includes(name);
}

/**
 * whether react router emits anything of this route module into the client build: it does when the
 * module exports a name that is not on `SERVER_ONLY_ROUTE_EXPORTS`.
 *
 * a component is the usual one, and `default` is only the usual spelling of it —
 * `ErrorBoundary`, `HydrateFallback`, `Layout`, `links`, `meta`, `clientLoader` and the rest are
 * shipped just as much, so the question asked here is which exports are *stripped* rather than
 * which are components. that keeps this the inverse of the same list the stripping is read from,
 * with no second list to keep true.
 *
 * `export * from …` re-exports names this cannot see, so it counts as shipping.
 */
function shipsToBrowser(sourceFile: ts.SourceFile): boolean {
	for (const statement of sourceFile.statements) {
		if (ts.isExportAssignment(statement)) return true;
		if (ts.isExportDeclaration(statement)) {
			if (statement.isTypeOnly) continue;
			const clause = statement.exportClause;
			// `export * from …`, whose names are in another file.
			if (!clause) return true;
			if (!ts.isNamedExports(clause)) return true;
			for (const element of clause.elements) {
				if (element.isTypeOnly) continue;
				if (!isServerOnly(element.name.text)) return true;
			}
			continue;
		}
		if (!isExported(statement)) continue;
		if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
		if (ts.isVariableStatement(statement) && isTypeOnlyVariable(statement)) continue;
		const names = declaredNames(statement);
		if (names.length === 0) return true;
		if (!names.every(isServerOnly)) return true;
	}
	return false;
}

/** `declare const`, which emits nothing. */
function isTypeOnlyVariable(statement: ts.VariableStatement): boolean {
	return (
		ts
			.getModifiers(statement)
			?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false
	);
}

function isExported(statement: ts.Statement): boolean {
	return ts.canHaveModifiers(statement)
		? (ts
				.getModifiers(statement)
				?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
		: false;
}

/** the names a top-level statement declares, if any. */
function declaredNames(statement: ts.Statement): string[] {
	if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
		return statement.name ? [statement.name.text] : [];
	}
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap((declaration) =>
			ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
		);
	}
	return [];
}

function collectIdentifiers(node: ts.Node, out: Set<string>): void {
	node.forEachChild((child) => {
		if (ts.isIdentifier(child)) out.add(child.text);
		collectIdentifiers(child, out);
	});
}

/**
 * a module specifier as a file this package holds, or `null` for a package.
 *
 * `$lib` is the alias most of src/ imports through — ./tsconfig.json declares it for the type
 * check and ./vite.config.ts for the bundler, and this is the third reader of the same name.
 */
function resolveModule(
	from: string,
	specifier: string,
	read: ReadModule
): { file: string; source: string } | null {
	let base: string;
	if (specifier.startsWith('$lib/')) base = `lib/${specifier.slice('$lib/'.length)}`;
	else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
	else return null;

	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
		const source = read(candidate);
		if (source !== null) return { file: candidate, source };
	}
	return null;
}
