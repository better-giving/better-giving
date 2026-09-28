import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "./bytes.ts is the only module that reads or writes `image_bytes`".
//
// written the way ../pages/sole-deleter.spec.ts is. the port in ./bytes.ts is what an object store
// replaces, and it replaces only what goes through it: a second module selecting or inserting
// bytes is a second place a move to R2 has to find, and one that goes on reading an emptied table.
// ../db/schema.ts declares the table and is the other name allowed.
//
// a source scan rather than a runtime hook, so it catches the reader nobody wrote a test for, and
// it reads text, so a computed table name fools it; the failure it defends against is a shortcut,
// not an adversary. specs are out of scope: a fixture is not a reader.

const SRC = resolve(import.meta.dirname, '../../..');
const PORT = resolve(import.meta.dirname, 'bytes.ts');
const SCHEMA = resolve(import.meta.dirname, '../db/schema.ts');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in either pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `src/`, minus the port, the schema and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			![PORT, SCHEMA, SELF].includes(path)
		) {
			out.push(path);
		}
	}
	return out;
}

/** the table by its drizzle export or by its SQL name. */
const TOUCHES: { label: string; re: RegExp }[] = [
	{ label: 'drizzle table', re: /\bimageBytes\b/ },
	{ label: 'raw SQL', re: /\bimage_bytes\b/ }
];

describe('images/bytes.ts is the only module that touches image_bytes', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// a guard on the guard: an empty list would make the assertion below pass vacuously.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('root.tsx');
		expect(names).toContain('lib/server/images/queries.ts');
		expect(names.length).toBeGreaterThan(10);
	});

	it('finds no reference to image_bytes outside src/lib/server/images/bytes.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of TOUCHES) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules touch image_bytes: ${offenders.join(', ')}. only src/lib/server/images/bytes.ts may — read and write an image's bytes through its BytesPort, or put its \`putBytes\` statement in your batch.`
		).toEqual([]);
	});

	it('matches both spellings in the port itself, so the patterns are known to work', () => {
		const port = readFileSync(PORT, 'utf8');
		expect(TOUCHES.map(({ re }) => re.test(port))).toEqual([true, true]);
	});
});
