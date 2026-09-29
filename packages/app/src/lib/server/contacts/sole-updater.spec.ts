import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "./changes.ts is the only module that may UPDATE contact".
//
// a change to a donor that lands is a change the read API's donors list shows
// (../integrations/donor.ts), and it owes a webhook destination its `donor.updated`:
// `consentChangeStatements` in ./changes.ts is what puts that event in front of the update, under
// the update's own condition, in one batch(). an update written anywhere else is a change no
// destination hears of.
//
// written the way ../donations/sole-inserter.spec.ts is: a source scan rather than a runtime hook,
// so it catches the writer nobody wrote a test for. it reads text, so a computed table name fools
// it; the failure it defends against is a shortcut, not an adversary. specs are out of scope, since
// a fixture row is not a change, and so are the `.testing.ts` modules specs import.

const SRC = resolve(import.meta.dirname, '../../..');
const UPDATER = resolve(import.meta.dirname, 'changes.ts');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in any pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every source file under `dir` that is not a test (`isTest`), minus this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

/** the two ways to write the change: drizzle's `db.update(contact)` and raw SQL. */
const UPDATES: { label: string; re: RegExp }[] = [
	{ label: 'drizzle update', re: /\bupdate\s*\(\s*(?:schema\.)?contact\s*\)/ },
	{ label: 'raw SQL update', re: /\bupdate\s+(?:or\s+\w+\s+)?[`"']?contact[`"']?\s+set\b/i }
];

describe('contacts/changes.ts is the only updater of contact', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// an empty list would pass the assertion below vacuously, and a wrong `SRC` is how.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/donations/donor.ts');
		expect(names).toContain('lib/server/contacts/queries.ts');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
	});

	it('finds no UPDATE of contact outside src/lib/server/contacts/changes.ts', () => {
		const offenders = files
			.filter((file) => file !== UPDATER)
			.flatMap((file) => {
				const source = readFileSync(file, 'utf8');
				return UPDATES.filter(({ re }) => re.test(source)).map(
					({ label }) => `${relative(SRC, file)} (${label})`
				);
			});
		expect(
			offenders,
			`these modules change contact directly: ${offenders.join(', ')}. take the statements from consentChangeStatements() in src/lib/server/contacts/changes.ts, or add the change there beside the event it owes, written in the same batch().`
		).toEqual([]);
	});

	it('matches the updater itself, so the patterns are known to work', () => {
		const updater = readFileSync(UPDATER, 'utf8');
		expect(UPDATES.some(({ re }) => re.test(updater))).toBe(true);
	});
});
