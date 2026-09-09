import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client';
import { rejectionCode } from './rejection.testing';
import { contact } from './schema';

// the guard on `contact_consented_to_contact_bool_check`, and on the three checks beside it.
//
// why the check exists. `integer({ mode: 'boolean' })` is an affinity and `STRICT INTEGER`
// takes `2` — and drizzle reads a stored `2` back with `Number(v) === 1`, i.e. as `false`.
// on this column that is not a wrong flag, it is a refusal the donor never gave, on the one
// column in the schema whose purpose is recording what they said.
//
// read off the migrated database rather than off `schema.ts`, which is the only reading that
// can fail: drizzle recreates a table from a snapshot that cannot record a check, so a
// constraint lost on the way into the SQL is one the snapshot still agrees with and reports
// no drift over. a table rebuild is where that loss happens, and `contact` has children — the
// hazard is named in `CONTRIBUTING.md` -> Migrations, and any rebuild landing here brings its
// own spec re-running it over seeded rows.
//
// the null stays a third state. the check permits `0`, `1` and `NULL`, because a sqlite
// CHECK fails only on a false result and `NULL in (0, 1)` is NULL. never asked has to stay
// distinguishable from said no — argued on the column in `./schema.ts`.

/** a check constraint, i.e. not the type system. the name D1 appends to its own message. */
const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

/** a contact row with no consent answer, written straight at D1 so no app rule is in the way. */
const seedContact = (id: string, email: string) =>
	env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Seeded Donor', ?, 0, 0)`
	).bind(id, email);

describe('the check on contact.consented_to_contact', () => {
	beforeEach(async () => {
		// storage is isolated per file rather than per test, so rows written by one `it` are
		// visible to the next.
		await env.DB.prepare('delete from donation').run();
		await env.DB.prepare('delete from contact').run();
	});

	it('refuses a 2, by extended result code and by the constraint that fired', async () => {
		// through drizzle on purpose: a statement issued that way comes back as drizzle's own
		// `Failed query: …` with D1's error demoted to `.cause`, so a match on the outermost
		// message would pass against a constraint that never fired. `rejectionCode` walks the
		// chain — see ./rejection.testing.ts. the raw `sql` is what a hand-run
		// `wrangler d1 execute` looks like, which is the only writer that can produce a `2`:
		// drizzle's `mode: 'boolean'` emits 0 or 1 and nothing else.
		const chain = await rejectionCode(() =>
			db.run(
				sql`insert into contact (id, kind, display_name, created_at, updated_at, consented_to_contact)
				    values ('two', 'individual', 'Two', 0, 0, 2)`
			)
		);
		expect(chain).toContain(SQLITE_CONSTRAINT_CHECK);
		// which check fired is the claim. the code alone says only "some check failed", and
		// `2` clears STRICT INTEGER — this is the only thing that stops it.
		expect(chain).toContain('contact_consented_to_contact_bool_check');
	});

	it('accepts true, false and never-asked, and reads each back as itself', async () => {
		await db.insert(contact).values([
			{ id: 'yes', kind: 'individual', displayName: 'Yes', consentedToContact: true },
			{ id: 'no', kind: 'individual', displayName: 'No', consentedToContact: false },
			{ id: 'unasked', kind: 'individual', displayName: 'Unasked' }
		]);

		const rows = await db
			.select({ id: contact.id, consented: contact.consentedToContact })
			.from(contact)
			.orderBy(contact.id);

		// `null` and not `false`. that distinction is the reason the column is nullable, and
		// it is the one a `2` would have destroyed by reading back as a refusal.
		expect(rows).toEqual([
			{ id: 'no', consented: false },
			{ id: 'unasked', consented: null },
			{ id: 'yes', consented: true }
		]);
	});

	it('leaves the column nullable — the check does not make an answer required', async () => {
		// the check permits NULL because a CHECK fails only on false, and `NULL in (0, 1)` is
		// NULL. tightening this to NOT NULL would answer "declined" for every contact staff
		// typed in, which /admin's create form never asks about.
		await db.insert(contact).values({ id: 'quiet', kind: 'individual', displayName: 'Quiet' });
		const row = await db.select().from(contact).where(eq(contact.id, 'quiet')).get();
		expect(row?.consentedToContact).toBeNull();
	});
});

describe('the rest of the table, off the applied migrations', () => {
	beforeAll(async () => {
		await env.DB.prepare('delete from donation').run();
		await env.DB.prepare('delete from contact').run();
		await env.DB.batch([
			seedContact('keep-1', 'one@example.org'),
			seedContact('keep-2', 'two@example.org')
		]);
	});

	it('carries the functional email index, unquoted and usable', async () => {
		// the hand-edit a rebuild of this table has to remember: a rebuild drops the table's
		// indexes with it and drizzle re-renders an expression index with the whole expression
		// backticked, which makes it an identifier and fails `no such column`. the lookup below
		// is the dedupe path, and it is the only index on the column.
		const row = await env.DB.prepare(
			`select count(*) as n from contact where lower(primary_email) = lower('ONE@example.org')`
		).first<{ n: number }>();
		expect(row?.n).toBe(1);
		const idx = await env.DB.prepare(
			`select name from pragma_index_list('contact') where name = 'contact_primary_email_lower_idx'`
		).first<{ name: string }>();
		expect(idx?.name).toBe('contact_primary_email_lower_idx');
	});

	it('carries the three checks beside the boolean one', async () => {
		// stated rather than counted: every constraint on a table is re-emitted from drizzle's
		// snapshot on any rebuild, and a single omission is a silent loss of exactly the
		// guarantee it was added for. each is probed by the value it refuses.
		const kind = await rejectionCode(() =>
			db.run(
				sql`insert into contact (id, kind, display_name, created_at, updated_at)
				    values ('bad-kind', 'robot', 'Robot', 0, 0)`
			)
		);
		expect(kind).toContain('contact_kind_check');

		const blank = await rejectionCode(() =>
			db.run(
				sql`insert into contact (id, kind, display_name, created_at, updated_at)
				    values ('blank', 'individual', char(160), 0, 0)`
			)
		);
		expect(blank).toContain('contact_display_name_not_blank_check');

		const attributes = await rejectionCode(() =>
			db.run(
				sql`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
				    values ('bad-json', 'individual', 'Bad', 'not json at all', 0, 0)`
			)
		);
		expect(attributes).toContain('contact_attributes_object_check');
	});
});
