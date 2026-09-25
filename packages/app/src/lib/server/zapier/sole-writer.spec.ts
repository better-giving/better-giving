import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "only this directory's three modules write `zapier_delivery`".
//
// written the way ../donations/sole-inserter.spec.ts is, and for the same kind of rule: a row a
// settled gift or its refund owes a Zap is minted by ./events.ts inside the posting's own batch(),
// moved along by ./deliver.ts, and dropped by ./subscriptions.ts when its subscription ends. a
// fourth writer — a correction in ../books/correct.ts announcing an edit, a screen resending by
// hand — is an event no trigger describes, or a row sent twice whose status nobody else moved.
//
// a source scan rather than a runtime hook, so it catches the writer nobody wrote a test for, and
// it reads text, so a computed table name fools it; the failure it defends against is a shortcut,
// not an adversary. specs are out of scope: a fixture row is not an event.

const SRC = resolve(import.meta.dirname, '../../..');
const WRITERS = ['events.ts', 'deliver.ts', 'subscriptions.ts'].map((name) =>
	resolve(import.meta.dirname, name)
);
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in either pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `src/`, minus the writers and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			!WRITERS.includes(path) &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

/** a write in drizzle — `db.insert(zapierDelivery)`, `.update(…)`, `.delete(…)` — or in raw SQL. */
const WRITES: { label: string; re: RegExp }[] = [
	{ label: 'drizzle write', re: /\b(?:insert|update|delete)\s*\(\s*(?:schema\.)?zapierDelivery\b/ },
	{
		label: 'raw SQL write',
		re: /\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from)\s+[`"']?zapier_delivery\b/i
	}
];

describe('zapier/ is the only writer of zapier_delivery', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// an empty list would pass the assertion below vacuously, and a wrong `SRC` is how.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/books/correct.ts');
		expect(names).toContain('lib/server/donations/settle.ts');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
	});

	it('finds no write to zapier_delivery outside events.ts, deliver.ts and subscriptions.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of WRITES) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules write zapier_delivery directly: ${offenders.join(', ')}. only src/lib/server/zapier/events.ts (a settled gift's rows, in its posting's batch), deliver.ts (a send's outcome) and subscriptions.ts (an ended subscription's rows dropped) may. a money event owes its Zaps through zapierStatements() or giftRefundedStatements(), and nowhere else.`
		).toEqual([]);
	});

	it('matches each writer itself, so the patterns are known to work', () => {
		for (const writer of WRITERS) {
			const source = readFileSync(writer, 'utf8');
			expect(
				WRITES.some(({ re }) => re.test(source)),
				relative(SRC, writer)
			).toBe(true);
		}
	});
});
