import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from '@libsql/client';

// the committed `migrations/*.sql` applied to a libSQL database. `pnpm db:migrate`
// (../../../../scripts/migrate.ts) runs it ahead of the server, and every `*.db.spec.ts` gets its
// schema from it (./database.testing.ts), so the SQL under test is the SQL that ships. nothing in
// the app imports it: migrations are never a boot side effect (AGENTS.md → Schema).
//
// **a file and the row that records it commit together, in one transaction.** a file's own
// `PRAGMA defer_foreign_keys` lasts to the end of the current transaction, and the rebuild
// migrations' copy, drop and rename stand on it (../../../../migrations/0010's header), so a file
// split across transactions would fail on any database holding the rows it moves. nothing here
// splits a file or reads a statement's shape: the file goes to the database whole.
//
// **a file is recorded by filename, and a recorded one is never sent again.** the table is
// wrangler's `d1_migrations`, in the statement wrangler creates it with, so a database exported
// from a D1 deployment arrives here with its applied list intact and resumes rather than replays.
// a file edited after it was applied therefore never re-runs (AGENTS.md → Never).
//
// **before the commit, `PRAGMA foreign_key_check` must come back empty.** a rebuild's closing
// `defer_foreign_keys=false` clears the violations deferred so far, so the commit itself checks
// nothing: a copy that lost a parent row would commit its children orphaned. the check is the step
// the 12-step rebuild ends with (https://sqlite.org/lang_altertable.html#otheralter), done here
// once per file rather than written into each.
//
// **the run stops at the first file that fails, and that file leaves nothing behind.** each file
// is written against the schema the ones before it leave, so carrying on past one would apply files
// to a schema that was never reached. the files in front of it stay applied, and a rerun starts
// again at the one that failed.

export type Migration = { readonly name: string; readonly sql: string };

/** every `.sql` file in `dir`, in filename order — the zero-padded prefix is the order. */
export async function readMigrations(dir: string): Promise<Migration[]> {
	const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
	return Promise.all(
		names.map(async (name) => ({ name, sql: await readFile(join(dir, name), 'utf8') }))
	);
}

/**
 * applies, in order, every migration the database has not recorded, and answers the names it applied.
 *
 * throws on the first file the database refuses, with that file named and the database's error as
 * `cause`.
 */
export async function applyMigrations(
	client: Client,
	migrations: readonly Migration[]
): Promise<string[]> {
	await client.execute(BOOTSTRAP_SQL);
	const { rows } = await client.execute('SELECT name FROM "d1_migrations"');
	const recorded = new Set(rows.map((row) => String(row.name)));

	const applied: string[] = [];
	for (const migration of migrations) {
		if (recorded.has(migration.name)) continue;
		await applyOne(client, migration);
		applied.push(migration.name);
	}
	return applied;
}

async function applyOne(client: Client, { name, sql }: Migration): Promise<void> {
	const tx = await client.transaction('write');
	try {
		await tx.executeMultiple(sql);
		const orphans = await tx.execute('PRAGMA foreign_key_check');
		if (orphans.rows.length > 0) {
			const tables = [...new Set(orphans.rows.map((row) => String(row.table)))].join(', ');
			throw new Error(`leaves foreign keys pointing at nothing in ${tables}`);
		}
		await tx.execute({ sql: 'INSERT INTO "d1_migrations" (name) VALUES (?)', args: [name] });
		await tx.commit();
	} catch (cause) {
		throw new Error(`migration ${name} was not applied`, { cause });
	} finally {
		tx.close();
	}
}

/** wrangler's `getCreateMigrationsTableQuery`, column order and quoting included. */
const BOOTSTRAP_SQL = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;
