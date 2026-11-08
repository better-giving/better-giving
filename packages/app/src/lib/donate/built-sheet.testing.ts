import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type AliasOptions, type Logger, createLogger } from 'vite';

// what $lib/donate/hosted-faces.spec.ts and ./built-faces.spec.ts read a sheet with: the sheet
// built the way the app's build turns a `?url` css import into an asset, so every `@import` is
// followed and every `url()` is rewritten, and what is read is the output and not the source.

export type BuiltSheet = {
	/** every css file the build emitted, joined. */
	css: string;
	/** the emitted files' names under assets/, css included. */
	assets: string[];
	/** each `url()` in the css as written, quotes dropped. */
	urls: string[];
	/** the `url()`s that point at no file the build emitted. */
	dangling: string[];
	/** what vite warned or errored on while building. a silent build hides an unresolved url. */
	diagnostics: string[];
};

/** the `resolve.alias` the app's own vite.config.ts hands the build. */
export async function appAlias(): Promise<AliasOptions> {
	const { default: config } = await import('../../../vite.config');
	const alias = typeof config === 'function' ? undefined : config.resolve?.alias;
	if (!alias) throw new Error('packages/app/vite.config.ts declares no resolve.alias');
	return alias;
}

/** builds `specifiers` (each imported with `?url`) in a throwaway root and reads what came out. */
export async function buildSheet(
	specifiers: readonly string[],
	alias: AliasOptions = []
): Promise<BuiltSheet> {
	const root = await mkdtemp(join(tmpdir(), 'built-sheet-'));
	const diagnostics: string[] = [];
	const logger: Logger = createLogger('silent');
	logger.warn = (message) => void diagnostics.push(message);
	logger.error = (message) => void diagnostics.push(message);
	logger.warnOnce = logger.warn;
	try {
		// the import has to be read. an unused `?url` import is dropped, and the built sheet goes
		// with it, which would leave this reading an empty directory.
		const imports = specifiers.map(
			(specifier, at) => `import href${at} from ${JSON.stringify(`${specifier}?url`)};`
		);
		const reads = specifiers.map((_, at) => `href${at}`).join(', ');
		await writeFile(
			join(root, 'entry.js'),
			`${imports.join('\n')}\nglobalThis.__href = [${reads}];\n`
		);
		await build({
			configFile: false,
			root,
			customLogger: logger,
			logLevel: 'warn',
			publicDir: false,
			resolve: { alias },
			build: {
				outDir: 'dist',
				emptyOutDir: true,
				assetsInlineLimit: 0,
				minify: false,
				write: true,
				rollupOptions: { input: join(root, 'entry.js') }
			}
		});
		const assetsDir = join(root, 'dist', 'assets');
		const assets = await readdir(assetsDir);
		const css = (
			await Promise.all(
				assets
					.filter((name) => name.endsWith('.css'))
					.map((name) => readFile(join(assetsDir, name), 'utf8'))
			)
		).join('\n');
		const urls = [...css.matchAll(/url\(\s*([^)]+?)\s*\)/g)].map((match) =>
			(match[1] ?? '').replace(/^['"]|['"]$/g, '')
		);
		const dangling = urls.filter(
			(url) => !url.startsWith('/') || !existsSync(join(root, 'dist', url))
		);
		return { css, assets, urls, dangling, diagnostics };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** the family names the css declares an `@font-face` for. */
export function facesDeclared(css: string): string[] {
	return [...css.matchAll(/@font-face\s*\{[^}]*?font-family:\s*["']([^"']+)["']/g)].map(
		(match) => match[1] ?? ''
	);
}
