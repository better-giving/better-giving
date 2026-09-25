import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "reverse.ts is the only module that may write a refund-direction payment row", the
// only one that walks one back (`PAYMENT_STATUSES` in ../db/schema.ts) or lowers its amount (a lost
// dispute's close), and the only one that writes a `dispute` row.
//
// written the way ./sole-inserter.spec.ts is, and for the same kind of rule: a refund row is what
// moves a gift to refunded and takes it off the donor's total, and ./reverse.ts writes it in the
// same batch() as the entry group that takes the money out of the books. a second writer is a gift
// reading refunded while the books still count it, or the other way round, with every row reading
// clean.
//
// a source scan rather than a runtime hook, so it catches the writer nobody wrote a test for. it
// reads text, so a computed column name fools it, and so does a status or amount update that finds
// its refund row by id alone without naming the direction; what it defends against is a shortcut, not an
// adversary. the reads that subtract refunds compare the column (`direction = 'refund'`,
// `a.direction === 'refund'`) and never set it, which is the whole difference the patterns below
// look for. specs are exempt: a fixture row is not a refund.

const SRC = resolve(import.meta.dirname, '../../..');
const WRITER = resolve(import.meta.dirname, 'reverse.ts');

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** a spec in any pool, plus the `.testing.ts` modules specs import. */
function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-spec source file under `src/`, minus the writer. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== WRITER
		) {
			out.push(path);
		}
	}
	return out;
}

/**
 *   - drizzle — `direction: 'refund'` in any object: the values of an insert or the set of an update.
 *   - raw SQL — an insert into `payment` naming `'refund'` before the statement ends.
 *   - drizzle status or amount update — `update(payment).set({ status … })` or
 *     `.set({ amountMinor … })` whose statement goes on to compare `payment.direction` with
 *     `'refund'`.
 *   - raw SQL status or amount update — `update payment set status …` or `… amount_minor …` naming
 *     `direction = 'refund'` before the statement ends.
 */
const WRITERS: { label: string; re: RegExp }[] = [
	{ label: 'drizzle write', re: /\bdirection\s*:\s*['"`]refund['"`]/ },
	{
		label: 'raw SQL insert',
		re: /insert\s+(?:or\s+\w+\s+)?into\s+[`"']?payment[`"']?[\s(][^;]*'refund'/i
	},
	{
		label: 'drizzle status or amount update',
		re: /\bupdate\(\s*(?:schema\.)?payment\s*\)\s*\.set\(\s*\{[^}]*\b(?:status|amountMinor)\b[^;]*?\beq\(\s*(?:schema\.)?payment\.direction\s*,\s*['"`]refund['"`]/
	},
	{
		label: 'raw SQL status or amount update',
		re: /update\s+[`"']?payment[`"']?\s+set\b[^;]*\b(?:status|amount_minor)\b[^;]*\bdirection\s*=\s*'refund'/i
	}
];

/**
 *   - drizzle — `insert(dispute)`, `update(dispute)` or `delete(dispute)`.
 *   - raw SQL — `insert into dispute`, `update dispute` or `delete from dispute`.
 */
const DISPUTE_WRITERS: { label: string; re: RegExp }[] = [
	{
		label: 'drizzle dispute write',
		re: /\b(?:insert|update|delete)\(\s*(?:schema\.)?dispute\s*\)/
	},
	{
		label: 'raw SQL dispute write',
		re: /\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from)\s+[`"']?dispute[`"']?[\s(]/i
	}
];

describe('reverse.ts is the only writer of a refund-direction payment row', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all, and no spec among them', () => {
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/donations/settle.ts');
		expect(names).toContain('lib/server/contacts/queries.ts');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
	});

	it('finds no refund-direction payment row written outside src/lib/server/donations/reverse.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of WRITERS) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules write or walk back a refund-direction payment row: ${offenders.join(', ')}. only src/lib/server/donations/reverse.ts may — the row and the entry group that reverses the gift land in one batch() there, and a row written or walked back anywhere else moves the gift and the donor's total without the books.`
		).toEqual([]);
	});

	it('matches the writer itself, so the drizzle patterns are known to work', () => {
		const writer = readFileSync(WRITER, 'utf8');
		expect(WRITERS[0]?.re.test(writer)).toBe(true);
		expect(WRITERS[2]?.re.test(writer)).toBe(true);
	});

	it('matches a raw status update of a refund row and passes one of a gift’s, so that pattern is known to work', () => {
		const raw = WRITERS[3]?.re;
		expect(
			raw?.test("update payment set status = 'cancelled' where id = ? and direction = 'refund'")
		).toBe(true);
		expect(
			raw?.test("update payment set status = 'succeeded' where id = ? and direction = 'inbound'")
		).toBe(false);
	});

	it('matches an amount update of a refund row and passes one of a gift’s, in drizzle and in raw SQL', () => {
		const [drizzle, raw] = [WRITERS[2]?.re, WRITERS[3]?.re];
		expect(
			drizzle?.test(
				"db.update(payment).set({ amountMinor: took }).where(and(eq(payment.id, id), eq(payment.direction, 'refund')))"
			)
		).toBe(true);
		expect(
			drizzle?.test(
				'db.update(payment).set({ amountMinor: row.amountMinor }).where(eq(payment.id, row.id));'
			)
		).toBe(false);
		expect(
			raw?.test("update payment set amount_minor = ? where id = ? and direction = 'refund'")
		).toBe(true);
		expect(
			raw?.test("update payment set amount_minor = ? where id = ? and direction = 'inbound'")
		).toBe(false);
	});

	it('matches a raw insert and passes a read, so the SQL pattern is known to work', () => {
		const raw = WRITERS[1]?.re;
		expect(
			raw?.test(
				"insert into payment (id, donation_id, direction, status) values (?, ?, 'refund', 'succeeded')"
			)
		).toBe(true);
		expect(
			raw?.test(
				"select sum(case when direction = 'refund' then amount_minor end) from payment; insert into payment values (?)"
			)
		).toBe(false);
	});

	it('finds no dispute row written outside src/lib/server/donations/reverse.ts', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of DISPUTE_WRITERS) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules write a dispute row: ${offenders.join(', ')}. only src/lib/server/donations/reverse.ts may — a dispute's row lands in one batch() with the money it withdrew, and closing it is what decides whether that money comes back.`
		).toEqual([]);
	});

	it('matches the writer’s own dispute writes, so the drizzle pattern is known to work', () => {
		expect(DISPUTE_WRITERS[0]?.re.test(readFileSync(WRITER, 'utf8'))).toBe(true);
	});

	it('matches a raw dispute write and passes a read, so the SQL pattern is known to work', () => {
		const raw = DISPUTE_WRITERS[1]?.re;
		expect(raw?.test("update dispute set outcome = 'won' where payment_id = ?")).toBe(true);
		expect(raw?.test('insert into dispute (payment_id) values (?)')).toBe(true);
		expect(
			raw?.test(
				'select 1 from dispute d join payment w on w.id = d.payment_id where d.outcome is null'
			)
		).toBe(false);
	});
});
