import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "./queries.ts is the only module that deletes a page".
//
// written the way ../donations/sole-inserter.spec.ts is. a page that has been live may have gifts
// pointing at its owned settings row, and the Donation page is never deleted at all, so the one
// delete is `deleteNeverPublishedCampaign`, whose every statement carries the never-published
// guard. a second delete — a tidy-up of ended campaigns, a reset that drops and remakes the
// Donation page — is a delete with no such guard.
//
// a source scan rather than a runtime hook, so it catches the writer nobody wrote a test for, and
// it reads text, so a computed table name fools it; the failure it defends against is a shortcut,
// not an adversary. specs are out of scope: a fixture row is not a page.

const SRC = resolve(import.meta.dirname, '../../..');
const DELETER = resolve(import.meta.dirname, 'queries.ts');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in either pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `src/`, minus the deleter and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== DELETER &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

/** a delete in drizzle — `db.delete(page)` — or in raw SQL. */
const DELETES: { label: string; re: RegExp }[] = [
	{ label: 'drizzle delete', re: /\bdelete\s*\(\s*(?:schema\.)?page\b/ },
	{ label: 'raw SQL delete', re: /\bdelete\s+from\s+[`"']?page\b/i }
];

describe('pages/queries.ts is the only deleter of page', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// a guard on the guard: an empty list would make the assertion below pass vacuously.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('root.tsx');
		expect(names).toContain('lib/server/db/schema.ts');
		expect(names.length).toBeGreaterThan(10);
	});

	it('finds no delete of page outside src/lib/server/pages/queries.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of DELETES) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules delete from page: ${offenders.join(', ')}. only src/lib/server/pages/queries.ts may, and only a campaign that has never been live — once a page has been live, gifts may point at its settings row, and the Donation page is never deleted. end a campaign instead of deleting it.`
		).toEqual([]);
	});

	it('matches the deleter itself, so the patterns are known to work', () => {
		const deleter = readFileSync(DELETER, 'utf8');
		expect(DELETES.some(({ re }) => re.test(deleter))).toBe(true);
	});
});
