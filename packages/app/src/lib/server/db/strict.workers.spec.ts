import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// the guards on the two properties of the migrated schema that drizzle-kit cannot see and
// therefore cannot report as drift: `STRICT` on every table, and `NO ACTION` on every foreign
// key but one. both are read out of sqlite's own catalogue, so a table or an FK added by a
// later migration is covered the moment it exists. the cascade half is argued at its own
// describe, further down; this header is about `STRICT`.
//
// the guard on `STRICT`, and the reason the keyword is safe to rely on.
//
// why this test exists. `STRICT` is hand-patched into the migration SQL because
// drizzle-kit cannot emit it — the sqlite dialect has no such concept, so `schema.ts`
// has no way to ask for it. the consequence is that drizzle also cannot *see* it: a
// future generated table rebuild (create-copy-drop-rename, which is what any constraint
// change produces) recreates the table from the snapshot, without `STRICT`, and reports
// no drift either way because the snapshot never held the keyword. nothing else in the
// toolchain would notice. this spec is what notices.
//
// what `STRICT` buys, precisely. without it `integer` is an affinity: a real that does
// not round-trip is stored as float64 in an `integer` column and every SELECT still
// looks correct. that is the one failure the ledger design exists to make impossible —
// an `entry_group` summing to 0.9999999999 while each row reads as a clean amount — so
// the guarantee belongs in the schema and not only at the app boundary.
//
// what it does not buy: STRICT INTEGER accepts 2, and accepts numeric text. the
// `in (0, 1)` CHECKs on the boolean columns and the range check on `tax_rate_e8` are
// load-bearing alongside it, never replaced by it — the last two cases below pin that.
//
// why these match the extended result code's name and not the prose. sqlite's extended
// result code is the stable surface; the sentence in front of it is not, and a rewording
// upstream would turn this suite red with no schema change. D1 does not expose a numeric
// `errcode` — it flattens the error to a message — but it appends two symbolic names, the
// primary code and then the extended one, so `SQLITE_CONSTRAINT_DATATYPE` is matchable and
// is the same identifier 3091 names. the extended one is what these assert: the primary is
// `SQLITE_CONSTRAINT` for every constraint there is, and ./rejection.ts is where that pair
// and the longest-match rule it forces are argued. the prose half of the message is never
// asserted on.

/** raised only by a STRICT table, and only by STRICT. */
const SQLITE_CONSTRAINT_DATATYPE = 'SQLITE_CONSTRAINT_DATATYPE';
/** a check constraint, i.e. not the type system. */
const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';

/**
 * runs `fn`, requires D1 to have rejected it, and hands back the message. fails loudly
 * rather than returning a sentinel if the statement succeeded, so a probe that stops
 * being rejected cannot pass quietly.
 */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

type TableRow = { name: string; strict: number };

/**
 * every application table in the migrated database, read from the database's own
 * catalogue rather than a list in this file — a table added in a later migration is
 * covered the moment it exists, with nothing here to forget to update.
 *
 * `PRAGMA table_list` reports strictness as a column, so this asks sqlite the question
 * instead of pattern-matching `sqlite_master.sql`; a rebuild that drops the keyword is
 * caught by the same assertion however the SQL happens to be formatted.
 *
 * `d1_migrations` is the one exclusion, and it is not ours: wrangler creates it to track
 * which migrations have run, without `STRICT`, both here and on the real database. every
 * column encoding this project uses (`text`, `integer`) is STRICT-legal, so there is no
 * shape of ours the rule cannot express and no other exclusion is needed.
 */
async function appTables(): Promise<TableRow[]> {
	const { results } = await env.DB.prepare(
		`select name, "strict" from pragma_table_list
		 where schema = 'main' and type = 'table'
		   and name not like 'sqlite_%' and name not like '\\_cf\\_%' escape '\\'
		   and name <> 'd1_migrations'
		 order by name`
	).all<TableRow>();
	return results;
}

describe('every table is STRICT', () => {
	it('finds the migrated tables at all', async () => {
		// a guard on the guard: if the pragma or the filter ever returns nothing, the
		// per-table assertion below would vacuously pass over an empty list.
		const names = (await appTables()).map((t) => t.name);
		expect(names).toContain('account');
		expect(names).toContain('contact');
		expect(names).toContain('auth_user');
		expect(names).toContain('auth_session');
		expect(names).toContain('auth_signing_key');
		expect(names).toContain('auth_verification');
		expect(names).toContain('entry_group');
		expect(names).toContain('ledger_entry');
		expect(names).toContain('program');
	});

	it('declares STRICT on every table', async () => {
		const lax = (await appTables()).filter((t) => t.strict !== 1).map((t) => t.name);
		// the message is the whole value of this test: it is read by whoever's
		// generated migration just silently dropped the keyword.
		expect(
			lax,
			`not STRICT: ${lax.join(', ')}. drizzle-kit cannot emit STRICT — append it by hand to the CREATE TABLE in migrations/, as ') STRICT;'. if a generated migration rebuilt one of these tables, the rebuild dropped it.`
		).toEqual([]);
	});
});

/**
 * the FKs allowed to CASCADE ON DELETE, as `table.column`. both hang off `auth_user`, and
 * both are there so that removing a member is one delete —
 * `src/lib/server/auth/members.ts` deletes that row and depends on them.
 *
 * a session and a credential are each worthless without the identity they belong to, and no
 * accounting record hangs off any of the three tables, so the loss a silently-fired cascade
 * could cause here is a logged-out admin and a colleague who has to be invited again.
 * everywhere else it is a hole in the books.
 */
const CASCADE_ALLOWLIST = new Set(['auth_session.user_id', 'auth_account.user_id']);

type FkRow = { child: string; column: string; on_delete: string };

/**
 * every foreign key in the schema and what it does on delete, read from sqlite's own
 * catalogue via `pragma_foreign_key_list` rather than from a list in this file — an FK added
 * in a later migration is covered the moment it exists.
 *
 * the join over `pragma_table_list` is what makes it exhaustive; `"table"` is the pragma's
 * argument column and has to be quoted, since `table` is a keyword.
 */
async function foreignKeys(): Promise<FkRow[]> {
	const { results } = await env.DB.prepare(
		`select t.name as child, f."from" as column, f.on_delete as on_delete
		 from pragma_table_list t
		 join pragma_foreign_key_list(t.name) f
		 where t.schema = 'main' and t.type = 'table'
		   and t.name not like 'sqlite_%' and t.name not like '\\_cf\\_%' escape '\\'
		   and t.name <> 'd1_migrations'
		 order by t.name, f."from"`
	).all<FkRow>();
	return results;
}

// the guard on "only the allowlisted FKs in this schema carry a cascade".
//
// why this test exists. `ON DELETE CASCADE` and the 12-step table rebuild are a silent,
// unrecoverable pair, and the header of `migrations/0000_initial_schema.sql` says so at
// length: `PRAGMA defer_foreign_keys=true` — the pragma every future rebuild depends on —
// does not defer a cascade, because a cascade is an action rather than a violation. so the
// rebuild's `DROP TABLE <parent>` performs an implicit delete of every parent row, the
// cascade fires against a table nobody was touching, the child is emptied, and the deferred
// check at commit then passes because the orphans it was watching for have been tidied away.
//
// that header leaves the residual hazard to attention — "neither of these two tables is
// rebuildable without noticing" — which is a claim about attention, not about the schema. the
// allowlist above is what turns it into one: another cascade would arrive the way these did
// before anyone weighed them, as a default somebody accepted while adding a table, and it
// fails here until a person puts it on the list.
//
// it reads sqlite's catalogue rather than the migration text, so a cascade introduced by a
// generated rebuild — the exact path that drops `STRICT`, above — is caught the same way.

describe('only the allowlisted foreign keys cascade on delete', () => {
	it('finds foreign keys at all', async () => {
		// a guard on the guard: an empty list would make the assertion below pass vacuously,
		// and a pragma that stops joining is exactly how that happens.
		const keys = (await foreignKeys()).map((f) => `${f.child}.${f.column}`);
		expect(keys).toContain('ledger_entry.account_id');
		expect(keys).toContain('donation.contact_id');
		expect(keys).toContain('auth_session.user_id');
		expect(keys.length).toBeGreaterThan(5);
	});

	it('leaves every other foreign key NO ACTION on delete', async () => {
		const offenders = (await foreignKeys())
			.filter((f) => f.on_delete !== 'NO ACTION')
			.map((f) => `${f.child}.${f.column} (ON DELETE ${f.on_delete})`)
			.filter((label) => !CASCADE_ALLOWLIST.has(label.split(' ')[0]!));

		// the message is the whole value of this test: it is read by whoever just added the
		// cascade, or by whoever's generated rebuild just widened one.
		expect(
			offenders,
			`these foreign keys act on delete: ${offenders.join(', ')}. only ${[...CASCADE_ALLOWLIST].join(', ')} may — every other one is NO ACTION on purpose. a cascade is not deferrable by \`PRAGMA defer_foreign_keys\`, so the next table rebuild empties the child table during its DROP and passes the commit-time check because the orphans are gone. see the header of migrations/0000_initial_schema.sql.`
		).toEqual([]);
	});

	it('keeps every allowlisted cascade, so the allowlist is not stale', async () => {
		// the other direction: an allowlist naming an FK that no longer cascades is a rule
		// nobody is following any more, and it would let the assertion above go quiet. it walks
		// the set rather than naming the tables, so an entry added there is checked both ways
		// without a second edit here.
		const keys = await foreignKeys();
		for (const allowed of CASCADE_ALLOWLIST) {
			const [child, column] = allowed.split('.');
			const fk = keys.find((f) => f.child === child && f.column === column);
			expect(fk?.on_delete, `${allowed} is allowlisted but no longer cascades`).toBe('CASCADE');
		}
	});
});

describe('STRICT rejects a non-integer written to an integer column', () => {
	// these probes insert rows into `account`, which the catalogue enumeration above also
	// reads. they never change its shape — only its contents — and the pool gives each
	// spec file its own D1 storage, so nothing here reaches `accounts.workers.spec.ts`.
	beforeAll(async () => {
		// touch the binding so a misconfigured pool fails here rather than inside a probe's
		// try/catch, where a missing table would read as a successful "rejection".
		await env.DB.prepare('select 1').run();
	});

	// `tax_rate_e8` is a rate scaled by 1e8 — the same integer encoding money uses, and
	// the same float64 hazard.
	const insertRate = (id: string, rate: number) =>
		env.DB.prepare(
			`insert into account (id, code, name, type, tax_rate_e8, created_at, updated_at)
			 values (?, ?, 'probe', 'liability', ?, 0, 0)`
		)
			.bind(id, id, rate)
			.run();

	// `created_at` is the integer column carrying no check at all, which is what makes it
	// the right place to probe text. on `tax_rate_e8` a text probe proves nothing about
	// STRICT: sqlite sorts text above every INTEGER, so `<= 100000000` is false and
	// `account_tax_rate_e8_check` rejects the row on a non-STRICT table too. here the
	// rejection is STRICT and only STRICT — drop the keyword and 'not-a-number' is stored,
	// as text, in a column every `_at` reader treats as unix ms.
	const insertCreatedAt = (id: string, at: string) =>
		env.DB.prepare(
			`insert into account (id, code, name, type, created_at, updated_at)
			 values (?, ?, 'probe', 'liability', ?, 0)`
		)
			.bind(id, id, at)
			.run();

	it('rejects a REAL that does not convert losslessly', async () => {
		expect(await rejection(() => insertRate('probe-5.5', 5.5))).toContain(
			SQLITE_CONSTRAINT_DATATYPE
		);
	});

	it('rejects TEXT in a column with no CHECK to fall back on', async () => {
		expect(await rejection(() => insertCreatedAt('probe-text', 'not-a-number'))).toContain(
			SQLITE_CONSTRAINT_DATATYPE
		);
	});

	it('accepts a REAL that converts losslessly, and stores it as an integer', async () => {
		// the nuance the decision rests on: STRICT is not "reject anything not typeof
		// integer", it is "reject anything that would lose information". 5.0 is 5, and
		// arrives as one — so a JS number that happens to be whole is not a false
		// failure, while the 0.5 that would break a sum-to-zero group is.
		await insertRate('probe-5.0', 5.0);
		const row = await env.DB.prepare(
			`select tax_rate_e8 as rate, typeof(tax_rate_e8) as t from account where id = ?`
		)
			.bind('probe-5.0')
			.first();
		expect(row).toEqual({ rate: 5, t: 'integer' });
	});

	it('leaves the CHECK constraints load-bearing: STRICT alone accepts 2 in a boolean column', async () => {
		// proof that removing a check because "STRICT covers it" would be wrong. the
		// insert fails — but on the check, not on the type. the constraint name is asserted
		// alongside the code because the code alone says only "some check failed", and
		// which one fired is the entire claim: `2` cleared STRICT INTEGER and was stopped
		// by the boolean check. the name is ours (schema.ts mints it), not sqlite prose.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into account (id, code, name, type, is_deductible, created_at, updated_at)
				 values ('probe-bool', 'probe-bool', 'probe', 'liability', 2, 0, 0)`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('account_is_deductible_bool_check');
	});

	it('stores the DEFAULT false / DEFAULT true literals drizzle emits as integers 0 and 1', async () => {
		// drizzle writes `integer ... DEFAULT false` for a boolean column. `false` is a
		// keyword literal, not the string 'false', so it survives STRICT INTEGER — but
		// that is worth pinning rather than assuming, since a text default here would
		// have failed at create-time in a way no other test covers.
		await env.DB.prepare(
			`insert into account (id, code, name, type, created_at, updated_at)
			 values ('probe-defaults', 'probe-defaults', 'probe', 'liability', 0, 0)`
		).run();
		const row = await env.DB.prepare(
			`select is_deductible as d, typeof(is_deductible) as dt,
			        is_postable as p, typeof(is_postable) as pt
			 from account where id = 'probe-defaults'`
		).first();
		expect(row).toEqual({ d: 0, dt: 'integer', p: 1, pt: 'integer' });
	});
});
