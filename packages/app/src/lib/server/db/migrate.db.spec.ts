import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, openUnmigrated } from './database.testing';
import { applyMigrations, readMigrations } from './migrate';

// the migrate command's module, run against fresh files. what it applies is the committed
// `migrations/` directory, the same SQL `pnpm db:migrate` sends.

describe('applyMigrations()', () => {
	it('applies every committed file to an empty database, in filename order', async () => {
		const client = await openUnmigrated();
		const onDisk = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

		const applied = await applyMigrations(client, await readMigrations(MIGRATIONS_DIR));

		expect(applied).toEqual(onDisk);
		expect(applied[0]).toBe('0000_initial_schema.sql');
	});

	it('applies nothing on a second run', async () => {
		const client = await openUnmigrated();
		const migrations = await readMigrations(MIGRATIONS_DIR);
		await applyMigrations(client, migrations);

		expect(await applyMigrations(client, migrations)).toEqual([]);
	});

	// the chains below are written for the case rather than read from disk, so each can fail a file
	// on purpose.
	const PARENT = {
		name: '0000_parent.sql',
		sql: `CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT;
			CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id)) STRICT;
			INSERT INTO parent VALUES ('p');
			INSERT INTO child VALUES ('c', 'p');`
	};

	it('leaves nothing of a file the database refuses, and keeps the files before it', async () => {
		const client = await openUnmigrated();
		const failing = {
			name: '0001_fails.sql',
			sql: `CREATE TABLE half (id TEXT) STRICT;
				INSERT INTO parent VALUES ('p');`
		};

		await expect(applyMigrations(client, [PARENT, failing])).rejects.toThrow(/0001_fails\.sql/);

		const tables = await client.execute(
			`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('parent', 'half')`
		);
		expect(tables.rows.map((r) => r.name)).toEqual(['parent']);
		const recorded = await client.execute('SELECT name FROM d1_migrations');
		expect(recorded.rows.map((r) => r.name)).toEqual(['0000_parent.sql']);
	});

	it('refuses a rebuild that commits a child pointing at nothing', async () => {
		const client = await openUnmigrated();
		// the shape of a rebuild that lost its parent's rows in the copy: the closing `=false`
		// clears the deferred violation, so only a check before the commit can see it.
		const lossy = {
			name: '0001_lossy_rebuild.sql',
			sql: `PRAGMA defer_foreign_keys=true;
				CREATE TABLE __new_parent (id TEXT PRIMARY KEY) STRICT;
				DROP TABLE parent;
				ALTER TABLE __new_parent RENAME TO parent;
				PRAGMA defer_foreign_keys=false;`
		};

		await expect(applyMigrations(client, [PARENT, lossy])).rejects.toThrow(/0001_lossy_rebuild/);

		const parents = await client.execute('SELECT id FROM parent');
		expect(parents.rows.map((r) => r.id)).toEqual(['p']);
	});

	it('lets a rebuild that keeps every row commit with foreign keys on', async () => {
		const client = await openUnmigrated();
		const rebuild = {
			name: '0001_rebuild.sql',
			sql: `PRAGMA defer_foreign_keys=true;
				CREATE TABLE __new_parent (id TEXT PRIMARY KEY, label TEXT) STRICT;
				INSERT INTO __new_parent (id) SELECT id FROM parent;
				DROP TABLE parent;
				ALTER TABLE __new_parent RENAME TO parent;
				PRAGMA defer_foreign_keys=false;`
		};

		expect(await applyMigrations(client, [PARENT, rebuild])).toEqual([
			'0000_parent.sql',
			'0001_rebuild.sql'
		]);
		const fk = await client.execute('PRAGMA foreign_keys');
		expect(fk.rows[0]?.foreign_keys).toBe(1);
	});
});
