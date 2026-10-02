import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// nothing under ./ imports from ../donations. that directory reaches this one through
// ../books/writes.ts, which splices `outboxStatements` from ./outbox.ts into every settled gift's
// batch, so an edge the other way makes the two import each other. what both need sits beside them:
// the operator alert in ../email/alert.ts, a payment's donor in ../contacts/queries.ts.
//
// the same source scan ../no-screen-imports.spec.ts makes, over this directory's modules alone.
// a spec is exempt: it drives the money path through ../donations to have something to send, and
// no module imports a spec. a type-only import counts, and a computed specifier passes.

const ACCOUNTING = import.meta.dirname;
const DONATIONS = resolve(ACCOUNTING, '../donations');
const LIB = resolve(ACCOUNTING, '../..');

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

function modules(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return modules(path);
		return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

function reachesDonations(file: string, specifier: string): boolean {
	const target = specifier.startsWith('$lib/')
		? join(LIB, specifier.slice('$lib/'.length))
		: specifier.startsWith('.')
			? resolve(dirname(file), specifier)
			: null;
	if (target === null) return false;
	const within = relative(DONATIONS, target);
	return within === '' || !within.startsWith('..');
}

describe('$lib/server/accounting', () => {
	it('imports nothing from $lib/server/donations', () => {
		const files = modules(ACCOUNTING);
		// a wrong root reads no file and passes vacuously.
		expect(files.map((f) => relative(ACCOUNTING, f))).toContain('deliver.ts');

		const edges = files.flatMap((file) =>
			[...readFileSync(file, 'utf8').matchAll(SPECIFIER)].flatMap(([, specifier = '']) =>
				reachesDonations(file, specifier) ? [`${relative(LIB, file)} -> ${specifier}`] : []
			)
		);

		expect(edges).toEqual([]);
	});
});
