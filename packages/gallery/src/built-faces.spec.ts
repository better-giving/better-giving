import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AliasOptions, build, createLogger } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

// the faces the gallery's css carries once the build has followed every `@import`. the registry's
// variables.css imports a `./fonts.css` that is red hat round, and ../vite.config.ts aliases that
// import to an empty sheet so the gallery is set in the plain red hat families
// packages/operator/src/styles/fonts.css declares. a reading of the sources stays green when the
// alias stops matching, because no source here names a round face: the build is where one would
// come out. this builds ./app.css with the config's own `resolve.alias`, so a change to it is read
// here. packages/app/src/lib/donate/built-faces.spec.ts is the same check for /admin; the two share
// no helper because the workspace graph (AGENTS.md → Workspace) lets neither package import the other.

const appCss = fileURLToPath(new URL('./app.css', import.meta.url));

async function galleryAlias(): Promise<AliasOptions> {
	const { default: config } = await import('../vite.config');
	const alias = typeof config === 'function' ? undefined : config.resolve?.alias;
	if (!alias) throw new Error('packages/gallery/vite.config.ts declares no resolve.alias');
	return alias;
}

type Built = { css: string; assets: string[]; diagnostics: string[] };

/** builds app.css (imported with `?url`, as the app does) in a throwaway root and reads the output. */
async function buildApp(alias: AliasOptions): Promise<Built> {
	const root = await mkdtemp(join(tmpdir(), 'gallery-built-faces-'));
	const diagnostics: string[] = [];
	const logger = createLogger('silent');
	logger.warn = (message) => void diagnostics.push(message);
	logger.warnOnce = logger.warn;
	logger.error = (message) => void diagnostics.push(message);
	try {
		// the import has to be read: an unused `?url` import is dropped, and the sheet with it.
		await writeFile(
			join(root, 'entry.js'),
			`import href from ${JSON.stringify(`${appCss}?url`)};\nglobalThis.__href = href;\n`
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
		return { css, assets, diagnostics };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** the family names the css declares an `@font-face` for. */
const facesDeclared = (css: string) =>
	[...css.matchAll(/@font-face\s*\{[^}]*?font-family:\s*["']([^"']+)["']/g)].map(
		(match) => match[1] ?? ''
	);

describe('the faces the gallery build emits', () => {
	let built: Built;
	beforeAll(async () => {
		built = await buildApp(await galleryAlias());
	}, 60_000);

	it('builds clean, with a face file for every face and none for the registry’s', () => {
		expect(built.diagnostics).toEqual([]);
		expect(built.assets.filter((name) => name.endsWith('.woff2')).length).toBeGreaterThan(0);
		expect(built.assets.filter((name) => /Round/i.test(name))).toEqual([]);
	});

	it('declares plain Red Hat Text, Display and Mono, and no Red Hat Round', () => {
		expect([...new Set(facesDeclared(built.css))].sort()).toEqual([
			'Red Hat Display',
			'Red Hat Mono',
			'Red Hat Text'
		]);
	});

	// without the alias the registry's `./fonts.css` names a file that exists nowhere (AGENTS.md → One
	// look, one source), so the build has to fail; this is what makes the cases above readable as a
	// result of the alias and not of a build that never reached the import.
	it('fails to build when the alias is absent', async () => {
		await expect(buildApp([])).rejects.toThrow();
	}, 60_000);
});
