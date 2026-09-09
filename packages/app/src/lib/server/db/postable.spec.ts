import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "two ways in and no third" — the claim ./postable.ts's header makes about
// `PostableAccountId`.
//
// why this test exists. that header enumerates exactly two files that mint the brand
// (`postableId` in ./accounts.ts, `postableFromAccount` in ./postable.ts) and says the brand
// is unforgeable outside them. until this file, nothing enforced it: a brand is a
// compile-time fiction, and
// `x as PostableAccountId` anywhere in the tree mints one with no check at all, passing
// `check`, `lint` and `build` in silence. so the sentence was a convention — a code review
// someone has to remember to do — dressed as a type-level fact.
//
// what it protects. `account` carries reporting rollups (`4100 Donations`, `is_postable = 0`)
// whose children already sum into them. one ledger entry naming a rollup makes every report
// over that subtree double-count, silently and permanently, because the ledger is
// append-only. the database refuses it — the composite `(id, is_postable)` FK on
// `ledger_entry`, `form` and `line_item` — and the brand is the same guard one layer up,
// where the failure is a compile error at the call site instead of an FK rejection at insert
// time on a fork nobody can reach. an inline cast throws away the upper layer and leaves only
// the lower one, which is the layer that fails late.
//
// the shortcut it exists to catch: a `where id = ?` read of
// `account` whose row has to be handed to `post()`, cast on the spot. the right fix is to hand
// the row to `postableFromAccount` — door (2) — which is the only thing a file outside the
// allowlist below can do, because a file outside the list cannot cast at all. that is what
// makes a third door built on door two a mechanically checked fact rather than a sentence: any
// module that adds one has to reach the brand through (2) or appear in this diff.
//
// how it works: a source scan, not a runtime hook — ../ledger/sole-writer.spec.ts is the
// precedent and argues the choice at length. a runtime hook would only cover the paths a test
// happens to exercise, and the casts that matter are exactly the ones nobody wrote a test for.
// it reads text and can be fooled by an alias or a computed type name; that is accepted,
// because the failure mode it defends against is a shortcut taken in a hurry, not an
// adversary.

const SRC = resolve(import.meta.dirname, '../../..');
const SELF = resolve(import.meta.filename);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/**
 * the two modules that may cast, and no others — one per door. they are allowlisted by path
 * rather than by a per-file pragma so that a third minting file is a diff in this list, which
 * is the review a reviewer actually sees.
 */
const MINTS = ['lib/server/db/accounts.ts', 'lib/server/db/postable.ts'];

/**
 * spec files are excluded, deliberately and not incidentally. a negative test has to be able
 * to mint a bad value: ../ledger/posting.workers.spec.ts casts the literal `'no-such-account'`
 * to prove the composite FK rejects an id no `account` row carries, and that probe is only
 * writable through a cast. a spec cannot post to the real ledger — sole-writer.spec.ts pins
 * `posting.ts` as the only writer — so a cast inside one reaches the database only through a
 * probe whose whole point is to be rejected.
 */
const isSpec = (name: string) => /\.(test|spec)\.[jt]s$/.test(name);

/** every non-spec source file under `src/`, minus this file. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isSpec(entry.name) &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

/**
 * `as PostableAccountId`, in the shapes a cast is actually written in — with or without a
 * leading `<`-style generic is not covered, because TS's angle-bracket assertion is illegal
 * in `.tsx` and unused everywhere in this tree. `satisfies` is not a cast and cannot mint the
 * brand, so it is not matched.
 */
const CAST = /\bas\s+PostableAccountId\b/;

describe('PostableAccountId is minted in exactly two files', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// a guard on the guard: an empty list would make the assertion below pass vacuously,
		// and a wrong `SRC` is exactly how that happens.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('root.tsx');
		expect(names).toContain('lib/server/db/schema.ts');
		// the module that posts, named here on purpose: it takes the brand on every entry it
		// writes, so it is the file a shortcut would be taken in. a scan that stopped reaching it
		// would go quiet rather than red.
		expect(names).toContain('lib/server/ledger/posting.ts');
		expect(names.length).toBeGreaterThan(10);
	});

	it('excludes spec files from the scan, so a negative probe may still cast', () => {
		// stated as an assertion rather than left to the reader of `sourceFiles`, because the
		// exclusion is a decision (see `isSpec`) and an incidental one would be a hole.
		const names = files.map((f) => relative(SRC, f));
		expect(names).not.toContain('lib/server/ledger/posting.workers.spec.ts');
		expect(names).not.toContain('lib/server/ledger/sole-writer.spec.ts');
	});

	it('finds no `as PostableAccountId` outside accounts.ts and postable.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const name = relative(SRC, file);
			if (MINTS.includes(name)) continue;
			if (CAST.test(readFileSync(file, 'utf8'))) offenders.push(name);
		}

		// the message is the whole value of this test: it is read by whoever just wrote the
		// cast, at the moment they are deciding whether to keep it.
		expect(
			offenders,
			`these modules mint \`PostableAccountId\` by hand: ${offenders.join(', ')}. only ${MINTS.join(' and ')} may — see the "two ways in and no third" header in db/postable.ts. if you are naming a seeded account, use \`postableId(key)\`; if you are reading an account row, hand it to \`postableFromAccount(row)\`; if you have an id as a plain string, read its row first and hand that to \`postableFromAccount\`. an inline cast asserts a rollup check nobody performed, and a rollup in the ledger double-counts every report over its subtree, permanently.`
		).toEqual([]);
	});

	it('matches the two minting files, so the pattern is known to work', () => {
		// without this, a typo'd regex matching nothing anywhere would report a clean tree
		// forever. these two files are the ones that must match.
		for (const name of MINTS) {
			expect(CAST.test(readFileSync(join(SRC, name), 'utf8')), name).toBe(true);
		}
	});
});
