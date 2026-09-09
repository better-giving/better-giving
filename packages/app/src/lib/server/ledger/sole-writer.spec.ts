import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "posting.ts is the only module that may INSERT into the ledger".
//
// why this test exists. that rule lives in `./posting.ts`'s header and is named in
// CLAUDE.md's ledger ban, and until this file it was enforced by nothing — a convention,
// i.e. a code review someone has to
// remember to do. every guarantee `./posting.ts` makes (sums to zero, at least two
// lines, signed minor units, one uppercase currency, business time supplied by the
// caller) lives in that module and not in the database, because sqlite cannot express a
// cross-row sum as a constraint. so a second writer is not a style problem: it is a
// second accounting system with none of the rules, producing books that do not balance
// and a database that reports no error.
//
// the tempting shortcut this exists to catch is a route handler doing one "quick"
// `db.insert(ledgerEntry)` — a correction, a backfill, a fee. every one of those is a
// posting, and posting is what `post()` is.
//
// how it works: a source scan, not a runtime hook. a runtime one would only catch the
// paths a test happens to exercise, and the writers that matter are exactly the ones
// nobody wrote a test for. it therefore reads text and can be fooled by a computed table
// name — that is accepted, because the failure mode it defends against is a shortcut
// taken in a hurry, not an adversary.
//
// what is exempt: `src/lib/server/ledger/**` (the writer and its own specs) and this
// file, which necessarily contains the patterns it searches for.

const SRC = resolve(import.meta.dirname, '../../..');
const LEDGER_DIR = resolve(import.meta.dirname);
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** every source file under `src/`, minus the ledger module itself and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (path === LEDGER_DIR) continue;
			sourceFiles(path, out);
		} else if (EXTENSIONS.some((e) => entry.name.endsWith(e)) && path !== SELF) {
			out.push(path);
		}
	}
	return out;
}

/**
 * two patterns because there are two ways to write the row, and a rule that only knew
 * one would be worth less than no rule at all:
 *
 *   - drizzle — `db.insert(ledgerEntry)`, optionally `schema.ledgerEntry`.
 *   - raw SQL — `insert into ledger_entry`, in any quoting, including `insert or ignore`
 *     / `or replace`, which is the shape a "make the retry idempotent" fix reaches for.
 */
const WRITERS: { label: string; re: RegExp }[] = [
	{
		label: 'drizzle insert',
		re: /\binsert\s*\(\s*(?:schema\.)?(?:ledgerEntry|entryGroup)\b/
	},
	{
		label: 'raw SQL insert',
		re: /insert\s+(?:or\s+\w+\s+)?into\s+[`"']?(?:ledger_entry|entry_group)\b/i
	}
];

describe('posting.ts is the only writer of the ledger', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// a guard on the guard: an empty list would make the assertion below pass
		// vacuously, and a wrong `SRC` is exactly how that happens.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('root.tsx');
		expect(names).toContain('lib/server/db/schema.ts');
		expect(names.length).toBeGreaterThan(10);
	});

	it('finds no INSERT into ledger_entry or entry_group outside src/lib/server/ledger/', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of WRITERS) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		// the message is the whole value of this test: it is read by whoever just added
		// the write.
		expect(
			offenders,
			`these modules write the ledger directly: ${offenders.join(', ')}. only src/lib/server/ledger/posting.ts may — build the entry with post() and splice postingStatements(db, posting) into the same batch() as the rest of your write. a direct insert skips sums-to-zero, which nothing in the database checks.`
		).toEqual([]);
	});

	it('matches the writer itself, so the patterns are known to work', () => {
		// without this, a typo'd regex that matches nothing anywhere would report a clean
		// tree forever. posting.ts is the one file that must match.
		const posting = readFileSync(join(LEDGER_DIR, 'posting.ts'), 'utf8');
		expect(WRITERS.some(({ re }) => re.test(posting))).toBe(true);
	});
});
