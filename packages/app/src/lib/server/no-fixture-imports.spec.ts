import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// a fixture module (`*.testing.ts`, `*.testing.tsx`, `*.testing.json`) is imported by specs and by
// other fixtures only. a screen, a route module, the server, a script the image runs or a build
// config importing one would carry a spec's sample rows into a build. a source scan of each import,
// export and `import.meta.glob` specifier in the trees and config files listed below, which
// `pnpm build` compiles or the image runs; a computed specifier passes it.

const PACKAGES = resolve(import.meta.dirname, '..', '..', '..', '..');
const APP = join(PACKAGES, 'app');
// read recursively: the app's src, server, scripts (migrate.ts and backup.ts ship) and vite/, and
// the src of each package whose `exports` map points the app's vite build at source.
const TREES = [
	...['src', 'server', 'scripts', 'vite'].map((dir) => join(APP, dir)),
	...['operator', 'emails', 'form'].map((pkg) => join(PACKAGES, pkg, 'src'))
];
// read non-recursively for their config files: the app's vite.config.ts, and form's
// vite.embed.config.ts, which its `build` script runs.
const PACKAGE_ROOTS = [APP, join(PACKAGES, 'form')];

const SPECIFIER = /(?:\bfrom|\bimport(?:\.meta\.glob)?)\s*\(?\s*\[?\s*['"]([^'"]+)['"]/g;
const FIXTURE = /\.testing(?:\.(?:[cm]?[jt]sx?|json))?$/;
const TEST_FILE = /\.(?:testing|test|spec)\.[cm]?[jt]sx?$/;
const SOURCE = /\.[cm]?[jt]sx?$/;

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return SOURCE.test(entry.name) ? [path] : [];
	});
}

function rootFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isFile() && SOURCE.test(entry.name) ? [join(dir, entry.name)] : []
	);
}

function allSources(): string[] {
	return [...TREES.flatMap(sources), ...PACKAGE_ROOTS.flatMap(rootFiles)];
}

function fixtureSpecifiers(text: string): string[] {
	return [...text.matchAll(SPECIFIER)].flatMap(([, specifier = '']) =>
		FIXTURE.test(specifier) ? [specifier] : []
	);
}

describe('fixture modules', () => {
	it('are imported by no module a build ships', () => {
		const edges = allSources()
			.filter((file) => !TEST_FILE.test(file))
			.flatMap((file) =>
				fixtureSpecifiers(readFileSync(file, 'utf8')).map(
					(specifier) => `${relative(PACKAGES, file)} -> ${specifier}`
				)
			);

		expect(edges).toEqual([]);
	});

	describe('the scan', () => {
		const shipped = allSources()
			.filter((file) => !TEST_FILE.test(file))
			.map((file) => relative(PACKAGES, file));

		it('reaches the directories and root files a build compiles', () => {
			expect(shipped.length).toBeGreaterThan(200);
			expect(shipped).toContain(join('app', 'scripts', 'migrate.ts'));
			expect(shipped).toContain(join('app', 'vite', 'route-files.ts'));
			expect(shipped).toContain(join('app', 'vite.config.ts'));
			expect(shipped.some((file) => file.startsWith(`${join('app', 'server')}${sep}`))).toBe(true);
			expect(shipped).toContain(join('operator', 'src', 'components', 'data', 'CreateCard.jsx'));
			expect(shipped).toContain(join('emails', 'src', 'render.ts'));
			expect(shipped).toContain(join('form', 'vite.embed.config.ts'));
		});

		it('leaves out each spec and fixture name a vitest config includes', () => {
			for (const name of [
				'src/staff-session.db.spec.ts',
				'src/lib/donate/card.dom.spec.tsx',
				'src/save-state.react.dom.spec.ts',
				'src/a.test.ts',
				'src/b.spec.js',
				'src/c.testing.tsx'
			]) {
				expect(TEST_FILE.test(name), name).toBe(true);
			}
			for (const name of [
				'src/staff-session.ts',
				'src/routes/testing.tsx',
				'src/marked-text.react.tsx'
			]) {
				expect(TEST_FILE.test(name), name).toBe(false);
			}
		});

		it('flags each import form a module can take', () => {
			const text = [
				"import { a } from './a.testing';",
				"export { b } from './b.testing.ts';",
				"const c = await import('./c.testing.tsx');",
				"import './d.testing';",
				"import schema from './f.testing.json';",
				"const g = import.meta.glob('./**/*.testing.ts');",
				"const h = import.meta.glob(['./h/*.testing.tsx'], { eager: true });",
				"import { e } from './e';"
			].join('\n');

			expect(fixtureSpecifiers(text)).toEqual([
				'./a.testing',
				'./b.testing.ts',
				'./c.testing.tsx',
				'./d.testing',
				'./f.testing.json',
				'./**/*.testing.ts',
				'./h/*.testing.tsx'
			]);
		});
	});
});
