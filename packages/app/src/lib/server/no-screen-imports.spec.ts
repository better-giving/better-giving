import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// nothing under $lib/server imports from $lib/admin. the dashboard's screen modules import the
// server half, so an edge the other way makes the two directories import each other, and a wire
// shape both read is a leaf beside them that imports nothing (../webhooks/catalog.ts,
// ../zapier/report.ts). a type-only import counts: it is the edge the next value import follows.
//
// a source scan of each import and export specifier, `$lib/admin` spelled or reached by a relative
// path; a computed specifier passes it.

const SERVER = import.meta.dirname;
const LIB = resolve(SERVER, '..');
const ADMIN = join(LIB, 'admin');

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

function reachesAdmin(file: string, specifier: string): boolean {
	const target = specifier.startsWith('$lib/')
		? join(LIB, specifier.slice('$lib/'.length))
		: specifier.startsWith('.')
			? resolve(dirname(file), specifier)
			: null;
	if (target === null) return false;
	const within = relative(ADMIN, target);
	return within === '' || !within.startsWith('..');
}

describe('$lib/server', () => {
	it('imports nothing from $lib/admin', () => {
		const edges = sources(SERVER).flatMap((file) =>
			[...readFileSync(file, 'utf8').matchAll(SPECIFIER)].flatMap(([, specifier = '']) =>
				reachesAdmin(file, specifier) ? [`${relative(LIB, file)} -> ${specifier}`] : []
			)
		);

		expect(edges).toEqual([]);
	});
});
