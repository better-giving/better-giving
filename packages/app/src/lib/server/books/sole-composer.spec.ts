import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "a writer takes its books from ./writes.ts": no module outside this directory
// imports the statement builders a money event's batch is made of.
//
// another batch assembled by hand is the least-effort next writer — the builders are right
// there, exported — and it gets the queue row, the Zap rows or their foreign-key order wrong in a
// way no single call site's suite would notice. ./writes.ts's header says what it hides.
//
// a source scan rather than a runtime hook, written the way ../ledger/sole-writer.spec.ts is, so it
// catches the writer nobody wrote a test for; it reads text, so a namespace import or a computed
// name fools it, and the failure it defends against is a shortcut, not an adversary. the three
// modules that define the builders are exempt, and so is every spec: a spec seeding rows through a
// builder is a fixture, not a writer. that exemption reaches the `.testing.ts` helpers specs import,
// so a case below holds that no production module imports one.

const SRC = resolve(import.meta.dirname, '../../..');
const BOOKS_DIR = resolve(import.meta.dirname);
const DEFINERS = ['ledger/posting.ts', 'accounting/outbox.ts', 'zapier/events.ts'].map((path) =>
	resolve(import.meta.dirname, '..', path)
);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in any pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `dir`. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (EXTENSIONS.some((e) => entry.name.endsWith(e)) && !isTest(entry.name)) {
			out.push(path);
		}
	}
	return out;
}

/** an import or re-export's braces, across however many lines they take. */
const IMPORT_BRACES = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\b/g;

const BUILDER = /\b(postingStatements|outboxStatements|zapierStatements|giftRefundedStatements)\b/g;

/** every builder an import or re-export names, several to one pair of braces included. */
function buildersImportedBy(source: string): string[] {
	return [...source.matchAll(IMPORT_BRACES)].flatMap(([, names = '']) =>
		[...names.matchAll(BUILDER)].map((match) => match[1] ?? '')
	);
}

/** a static or dynamic import of a `.testing` module, with or without its extension. */
const IMPORTS_A_TEST_HELPER = /\b(?:from|import)\s*\(?\s*['"][^'"]*\.testing(?:\.[jt]sx?)?['"]/;

describe('books/ is the only importer of the statement builders', () => {
	const production = sourceFiles(SRC);
	const files = production.filter(
		(path) => !path.startsWith(`${BOOKS_DIR}/`) && !DEFINERS.includes(path)
	);

	it('finds source files to scan at all', () => {
		// an empty list would pass the assertion below vacuously, and a wrong `SRC` is how.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/donations/settle.ts');
		expect(names).toContain('routes/_app.admin.books.tsx');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
	});

	it('finds no import of postingStatements, outboxStatements, zapierStatements or giftRefundedStatements outside books/', () => {
		const offenders = files.flatMap((file) =>
			buildersImportedBy(readFileSync(file, 'utf8')).map(
				(builder) => `${relative(SRC, file)} (${builder})`
			)
		);
		expect(
			offenders,
			`these modules build a money event's batch by hand: ${offenders.join(', ')}. take the statements from settledGiftWrites(), correctionWrites() or reversalWrites() in src/lib/server/books/writes.ts and splice them after your payment row, in your own batch().`
		).toEqual([]);
	});

	it('matches the composer itself, so the pattern is known to work', () => {
		// a typo'd pattern matching nothing would report a clean tree forever. ./writes.ts imports
		// every builder, so it is the one file that must match each.
		const writes = readFileSync(join(BOOKS_DIR, 'writes.ts'), 'utf8');
		expect(buildersImportedBy(writes).sort()).toEqual([
			'giftRefundedStatements',
			'outboxStatements',
			'postingStatements',
			'zapierStatements'
		]);
	});

	it('finds no production module importing a .testing helper, which the scan above never reads', () => {
		const offenders = production
			.filter((file) => IMPORTS_A_TEST_HELPER.test(readFileSync(file, 'utf8')))
			.map((file) => relative(SRC, file));
		expect(
			offenders,
			`these modules import a spec helper: ${offenders.join(', ')}. a .testing module is outside this scan, so a builder imported through one reaches production ungated — move what production needs out of the .testing file.`
		).toEqual([]);
	});

	it('matches a .testing import, so the pattern is known to work', () => {
		expect(
			IMPORTS_A_TEST_HELPER.test("import { rejectionCode } from '../db/rejection.testing';")
		).toBe(true);
		expect(IMPORTS_A_TEST_HELPER.test("import { sqliteResultCode } from '../db/rejection';")).toBe(
			false
		);
	});
});
