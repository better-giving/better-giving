import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client, InStatement, InValue, ResultSet, Row } from '@libsql/client';
import { afterAll } from 'vitest';
import { openDatabase } from './client';
import { applyMigrations, readMigrations } from './migrate';

// the database a `*.db.spec.ts` runs against: a real libSQL file in a temp directory, with every
// committed migration applied by the same module `pnpm db:migrate` runs.
//
// module scope on purpose. vitest's db project isolates each spec file (`isolate`, on by default in
// ../../../../vitest.config.ts), so this module is evaluated once per spec file and every file gets
// a database of its own. not a spec itself — no project's `include` matches this name.

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../../migrations');

/** the committed migrations, read once, for a spec that applies part of the chain itself. */
export const MIGRATIONS = await readMigrations(MIGRATIONS_DIR);

const dir = mkdtempSync(join(tmpdir(), 'better-giving-db-'));
const opened: Client[] = [];

afterAll(() => {
	for (const c of opened) c.close();
	rmSync(dir, { recursive: true, force: true });
});

/** a further database in this spec file's directory, opened as the server opens one, with nothing applied. */
export async function openUnmigrated(): Promise<Client> {
	const c = await openDatabase(pathToFileURL(join(dir, `${opened.length}.db`)).href);
	opened.push(c);
	return c;
}

/** this spec file's database, every migration applied: `createDb(client)` is the request path's handle. */
export const client = await openUnmigrated();
await applyMigrations(client, MIGRATIONS);

/** one statement and what it binds, for `run`, `first`, `all` and `client.batch`. */
export const stmt = (sql: string, ...args: InValue[]): InStatement => ({ sql, args });

/** the three calls a raw probe makes, against `on`, each answering in the shape the probe reads. */
export function rawSql(on: Client) {
	return {
		run: (statement: InStatement): Promise<ResultSet> => on.execute(statement),
		/** the first row, or `null` when there is none. */
		first: async <T = Row>(statement: InStatement): Promise<T | null> =>
			((await on.execute(statement)).rows[0] as T | undefined) ?? null,
		all: async <T = Row>(statement: InStatement): Promise<T[]> =>
			(await on.execute(statement)).rows as T[]
	};
}

/** `rawSql` on this spec file's database. */
export const { run, first, all } = rawSql(client);
