import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// a fixture module (`*.testing.ts`, `*.testing.tsx`) is imported by specs and by other fixtures
// only. a screen, a route module, the server, a script the image runs or a build config importing
// one would carry a spec's sample rows into a build. a source scan of each import and export
// specifier; a computed specifier passes it.

const APP = resolve(import.meta.dirname, '..', '..', '..');
// everything the Dockerfile copies or a build runs: src, server, scripts (migrate.ts and backup.ts
// ship), vite/, and the package root's own config and source files (non-recursive, below).
const ROOTS = ['src', 'server', 'scripts', 'vite'].map((dir) => join(APP, dir));

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
const FIXTURE = /\.testing(?:\.tsx?)?$/;
const TEST_FILE = /(?:\.testing|\.spec|\.db\.spec|\.dom\.spec)\.tsx?$/;
const SOURCE = /\.(?:tsx?|[cm]?js)$/;

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return SOURCE.test(entry.name) ? [path] : [];
	});
}

function rootFiles(): string[] {
	return readdirSync(APP, { withFileTypes: true }).flatMap((entry) =>
		entry.isFile() && SOURCE.test(entry.name) ? [join(APP, entry.name)] : []
	);
}

function allSources(): string[] {
	return [...ROOTS.flatMap(sources), ...rootFiles()];
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
					(specifier) => `${relative(APP, file)} -> ${specifier}`
				)
			);

		expect(edges).toEqual([]);
	});

	describe('the scan', () => {
		const shipped = allSources()
			.filter((file) => !TEST_FILE.test(file))
			.map((file) => relative(APP, file));

		it('reaches the directories and root files a build runs, and leaves specs out', () => {
			expect(shipped.length).toBeGreaterThan(200);
			expect(shipped).toContain(join('scripts', 'migrate.ts'));
			expect(shipped).toContain(join('vite', 'route-files.ts'));
			expect(shipped).toContain('vite.config.ts');
			expect(shipped.some((file) => file.startsWith(`server${'/'}`))).toBe(true);
			expect(shipped.filter((file) => /\.(?:spec|testing)\./.test(file))).toEqual([]);
		});

		it('flags a fixture import in a spec, the shape it would take in a shipped module', () => {
			const spec = readFileSync(join(APP, 'src', 'staff-session.db.spec.ts'), 'utf8');

			expect(fixtureSpecifiers(spec)).toContain('./staff-session.testing');
			expect(fixtureSpecifiers(spec)).toContain('$lib/server/db/database.testing');
			expect(TEST_FILE.test('src/staff-session.db.spec.ts')).toBe(true);
			expect(TEST_FILE.test('src/staff-session.ts')).toBe(false);
			expect(TEST_FILE.test('src/routes/testing.tsx')).toBe(false);
		});

		it('flags each import form a module can take', () => {
			const text = [
				"import { a } from './a.testing';",
				"export { b } from './b.testing.ts';",
				"const c = await import('./c.testing.tsx');",
				"import './d.testing';",
				"import { e } from './e';"
			].join('\n');

			expect(fixtureSpecifiers(text)).toEqual([
				'./a.testing',
				'./b.testing.ts',
				'./c.testing.tsx',
				'./d.testing'
			]);
		});
	});
});
