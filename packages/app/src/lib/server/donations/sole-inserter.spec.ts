import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "collect.ts is the only module that may INSERT into recurring_plan".
//
// why this test exists. CLAUDE.md states the rule under Bans → repeating gifts, and until this
// file it was enforced by nothing — a convention, which is a code review someone has to remember
// to do. it is the third of three guards written the same way: ../ledger/sole-writer.spec.ts holds
// the ledger's single writer, ../payments/sole-importer.spec.ts the single importer of the Stripe
// SDK.
//
// what the rule buys, concretely. a commitment's row is written by the first charge that settles,
// from what actually moved — ./collect.ts builds it from the settlement it just received, in the
// same batch() as the donation and the ledger entries, so the row and the money it claims either
// both land or neither does. the path that creates the subscription at the processor writes no
// commitment, because an authorization is not a collection: a plan minted there claims a
// commitment the donor's bank may still refuse, and nothing later reconciles it away.
//
// it does record the gift, and that is not the same rule bending. a `donation` with no successful
// `payment` reads as `pending` and claims no income — every figure in this app is a `SUM` over
// `ledger_entry` — so an unfinished repeating gift is a row an organisation can see and contact,
// where a `recurring_plan` row would be a standing commitment asserted about a donor who has one.
//
// the tempting shortcut this exists to catch is the subscription-creating path inserting the plan
// it just authorized, so that /admin/recurring has something to list before the first charge
// lands. that screen is supposed to be empty until then.
//
// how it works: a source scan, not a runtime hook. a runtime one would only catch the paths a test
// happens to exercise, and the writer that matters is exactly the one nobody wrote a test for. it
// therefore reads text and can be fooled by a computed table name — that is accepted, because the
// failure mode it defends against is a shortcut taken in a hurry, not an adversary.
//
// what is exempt: ./collect.ts, this file, which necessarily contains the patterns it searches
// for, and every spec. specs are out of scope because a fixture row is not a commitment — the
// workers specs that read plans back seed the table in raw SQL, and an exemption list naming each
// of them is a gate that passes because of the list.

const SRC = resolve(import.meta.dirname, '../../..');
const INSERTER = resolve(import.meta.dirname, 'collect.ts');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in either pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `src/`, minus the inserter and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== INSERTER &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

/**
 * two patterns because there are two ways to write the row, and a rule that only knew one would be
 * worth less than no rule at all:
 *
 *   - drizzle — `db.insert(recurringPlan)`, optionally `schema.recurringPlan`.
 *   - raw SQL — `insert into recurring_plan`, in any quoting, including `insert or ignore` /
 *     `or replace`, which is the shape a "make the redelivery idempotent" fix reaches for.
 */
const WRITERS: { label: string; re: RegExp }[] = [
	{ label: 'drizzle insert', re: /\binsert\s*\(\s*(?:schema\.)?recurringPlan\b/ },
	{
		label: 'raw SQL insert',
		re: /insert\s+(?:or\s+\w+\s+)?into\s+[`"']?recurring_plan\b/i
	}
];

describe('collect.ts is the only inserter of recurring_plan', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// a guard on the guard: an empty list would make the assertion below pass vacuously, and a
		// wrong `SRC` is exactly how that happens.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('root.tsx');
		expect(names).toContain('lib/server/db/schema.ts');
		expect(names).toContain('lib/server/donations/entries.ts');
		expect(names.length).toBeGreaterThan(10);
	});

	it('scans no spec, so the fixture rows the suite seeds are not read as writers', () => {
		// the scope line, asserted rather than described: `isTest` narrow enough to let a real
		// module through would report every workers spec that seeds a plan, and the gate would be
		// turned off rather than fixed.
		const names = files.map((f) => relative(SRC, f));
		expect(names).not.toContain('lib/server/donations/collect.workers.spec.ts');
		expect(names).not.toContain('lib/server/db/rejection.testing.ts');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
	});

	it('finds no INSERT into recurring_plan outside src/lib/server/donations/collect.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of WRITERS) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		// the message is the whole value of this test: it is read by whoever just added the write.
		expect(
			offenders,
			`these modules write recurring_plan directly: ${offenders.join(', ')}. only src/lib/server/donations/collect.ts may — a commitment's row is written by the first charge that settles, from what actually moved, in the same batch() as that charge. if you are minting a row where a subscription was authorized, the row is premature: the donor's bank may still refuse the gift, and nothing reconciles a plan that never collected.`
		).toEqual([]);
	});

	it('matches the inserter itself, so the patterns are known to work', () => {
		// without this, a typo'd regex that matches nothing anywhere would report a clean tree
		// forever. collect.ts is the one file that must match.
		const inserter = readFileSync(INSERTER, 'utf8');
		expect(WRITERS.some(({ re }) => re.test(inserter))).toBe(true);
	});
});
