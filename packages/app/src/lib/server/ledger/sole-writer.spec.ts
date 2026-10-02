import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "posting.ts is the only module that writes the ledger": the only INSERT, and no
// UPDATE or DELETE of a ledger row from anywhere.
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
// what is exempt: `./posting.ts`, every `*.spec.ts(x)` (they seed and tear down rows in a test
// database — `delete from ledger_entry` between cases), and this file, which necessarily contains
// the patterns it searches for. the rest of the ledger directory — `./queries.ts`,
// `./journal-file.ts` — is swept like any other module, because a read-side module is exactly where
// a "quick" correction lands.
//
// the ledger's rows are `entry_group` and `ledger_entry` (../db/schema.ts). an UPDATE or DELETE of
// either is swept as well as an INSERT: the ledger is append-only (./posting.ts's header), a
// mistake is settled by a correcting entry, and a row edited or removed in place leaves books that
// balance and are wrong. `account` is not a ledger row — it is the chart, and is edited.

const SRC = resolve(import.meta.dirname, '../../..');
const LEDGER_DIR = resolve(import.meta.dirname);
const SELF = resolve(import.meta.filename);
const POSTING = join(LEDGER_DIR, 'posting.ts');

const EXTENSIONS = ['.ts', '.tsx', '.js'];

function isExempt(path: string): boolean {
	if (path === SELF || path === POSTING) return true;
	return /\.spec\.tsx?$/.test(path);
}

/** every source file under `src/`, minus `posting.ts`, every spec and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (EXTENSIONS.some((e) => entry.name.endsWith(e)) && !isExempt(path)) {
			out.push(path);
		}
	}
	return out;
}

/**
 * the ways to write a ledger row, because a rule that only knew one would be worth less than no
 * rule at all. each verb has a drizzle spelling and a raw SQL one:
 *
 *   - drizzle — `db.insert(ledgerEntry)`, `db.update(ledgerEntry)`, `db.delete(entryGroup)`,
 *     optionally `schema.ledgerEntry`.
 *   - raw SQL — `insert into ledger_entry`, in any quoting, including `insert or ignore` /
 *     `or replace`, which is the shape a "make the retry idempotent" fix reaches for; `update
 *     ledger_entry` with the same `or` forms; `delete from entry_group`.
 */
const TABLES_DRIZZLE = '(?:schema\\.)?(?:ledgerEntry|entryGroup)\\b';
const TABLES_SQL = '[`"\']?(?:ledger_entry|entry_group)\\b';
const WRITERS: { label: string; re: RegExp }[] = [
	{ label: 'drizzle insert', re: new RegExp(`\\binsert\\s*\\(\\s*${TABLES_DRIZZLE}`) },
	{ label: 'drizzle update', re: new RegExp(`\\bupdate\\s*\\(\\s*${TABLES_DRIZZLE}`) },
	{ label: 'drizzle delete', re: new RegExp(`\\bdelete\\s*\\(\\s*${TABLES_DRIZZLE}`) },
	{
		label: 'raw SQL insert',
		re: new RegExp(`insert\\s+(?:or\\s+\\w+\\s+)?into\\s+${TABLES_SQL}`, 'i')
	},
	{
		label: 'raw SQL update',
		re: new RegExp(`\\bupdate\\s+(?:or\\s+\\w+\\s+)?${TABLES_SQL}`, 'i')
	},
	{ label: 'raw SQL delete', re: new RegExp(`\\bdelete\\s+from\\s+${TABLES_SQL}`, 'i') }
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

	it('finds no INSERT, UPDATE or DELETE of ledger_entry or entry_group outside ledger/posting.ts', () => {
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
			`these modules write the ledger directly: ${offenders.join(', ')}. only src/lib/server/ledger/posting.ts may insert — build the entry with post() and splice postingStatements(db, posting) into the same batch() as the rest of your write; a direct insert skips sums-to-zero, which nothing in the database checks. no module may update or delete a ledger row: the ledger is append-only, so post a correcting entry instead.`
		).toEqual([]);
	});

	it('matches the writer itself, so the patterns are known to work', () => {
		// without this, a typo'd regex that matches nothing anywhere would report a clean
		// tree forever. posting.ts is the one file that must match.
		const posting = readFileSync(POSTING, 'utf8');
		expect(WRITERS.some(({ re }) => re.test(posting))).toBe(true);
	});

	it.each([
		['drizzle insert', 'await db.insert(ledgerEntry).values(rows);'],
		['drizzle update', 'await db.update(schema.ledgerEntry).set({ amount: 1 });'],
		['drizzle delete', 'await db.delete(entryGroup).where(eq(entryGroup.id, id));'],
		['raw SQL insert', 'INSERT OR IGNORE INTO "ledger_entry" (id) VALUES (1)'],
		['raw SQL update', 'UPDATE ledger_entry SET amount = 1'],
		['raw SQL delete', 'delete from `entry_group` where id = 1']
	])('matches a %s as written', (label, line) => {
		// the real tree holds none of the update or delete spellings, so nothing real exercises them.
		expect(WRITERS.find((w) => w.label === label)?.re.test(line)).toBe(true);
	});

	it('reads neither a read of the tables nor an edit of another table as a write', () => {
		for (const line of [
			'await db.select().from(ledgerEntry);',
			'await db.update(account).set({ name });',
			'db.delete(donation)',
			'select * from ledger_entry',
			'update account set name = 1'
		]) {
			expect(
				WRITERS.some(({ re }) => re.test(line)),
				line
			).toBe(false);
		}
	});

	it('exempts posting.ts and specs, and nothing else in the ledger directory', () => {
		const names = files.map((f) => relative(SRC, f));
		expect(names).not.toContain('lib/server/ledger/posting.ts');
		expect(names).not.toContain('lib/server/ledger/posting.workers.spec.ts');
		expect(names).toContain('lib/server/ledger/queries.ts');
		expect(names).toContain('lib/server/ledger/journal-file.ts');
	});
});
