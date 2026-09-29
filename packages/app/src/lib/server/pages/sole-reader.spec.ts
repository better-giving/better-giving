import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "./document.ts is the only module that reads a page row's stored documents".
//
// written the way ./sole-deleter.spec.ts is. a stored document is read under today's page rule, so
// one written before the rule narrowed comes back refused, and ./document.ts is where the policy for
// that lives: logged, handed back, never thrown. a reader parsing the column itself has a policy of
// its own, and one that throws on such a draft leaves the editor that could repair it unopenable.
//
// a source scan, so it reads text: the rule applied to a stored column's parsed text, and the column
// handed straight to `JSON.parse`. the page rule run over a document a write has just built is not a
// read and is not matched.
//
// ../../page/ended.ts is let through: it reads the live page's end by its one key and no rule, so
// a campaign whose end has passed reads as ended whether or not the rest of its page still reads.

const SRC = resolve(import.meta.dirname, '../../..');
const READER = resolve(import.meta.dirname, 'document.ts');
const END_KEY_READER = resolve(SRC, 'lib/page/ended.ts');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== READER &&
			path !== END_KEY_READER &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

const READS: { label: string; re: RegExp }[] = [
	{ label: 'the page rule over parsed text', re: /\bparsePage\s*\([^()]*,\s*JSON\.parse\s*\(/ },
	{
		label: 'a document column parsed',
		re: /\bJSON\.parse\s*\(\s*[\w.]*\.(?:published|lastPublished|document)\s*\)/
	}
];

describe('pages/document.ts is the only reader of a page’s stored documents', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/pages/publish.ts');
		expect(names.length).toBeGreaterThan(10);
	});

	it('finds no read of a stored document outside src/lib/server/pages/document.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of READS) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules read a page's stored document themselves: ${offenders.join(', ')}. read it through \`readDocument\` or \`readableDraft\` in src/lib/server/pages/document.ts, whose policy is that a document the rule now refuses is handed back rather than thrown.`
		).toEqual([]);
	});

	it('matches both shapes a reader takes', () => {
		expect(READS[0]?.re.test('parsePage(row.type, JSON.parse(row.draft))')).toBe(true);
		expect(READS[1]?.re.test('JSON.parse(row.published)')).toBe(true);
	});
});
