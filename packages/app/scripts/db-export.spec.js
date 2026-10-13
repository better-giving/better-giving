import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/lib/server/db/schema';
import { booksTables, composeBackup } from './db-export.js';

/** every table ../src/lib/server/db/schema.ts declares, by its SQL name. */
const declared = Object.values(schema)
	.filter((value) => is(value, SQLiteTable))
	.map((table) => getTableName(table));

describe('booksTables()', () => {
	it('keeps every table the schema declares but the photos, and the migration ledger', () => {
		const live = ['d1_migrations', 'sqlite_sequence', '_cf_KV', '_cf_METADATA', ...declared];

		const expected = ['d1_migrations', ...declared.filter((name) => name !== 'image_bytes')];
		expect(booksTables(live)).toEqual(expected);
		expect(declared).toContain('image_bytes');
		expect(declared.length).toBeGreaterThan(20);
	});
});

describe('composeBackup()', () => {
	const rows = 'PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "account" ("id") VALUES(\'a\');\n';

	it('writes the rows after every table and index, and before the triggers', () => {
		const schema = [
			'PRAGMA defer_foreign_keys=TRUE;',
			'CREATE TABLE `account` (',
			'\t`id` text PRIMARY KEY NOT NULL',
			') STRICT;',
			'CREATE UNIQUE INDEX `account_id_idx` ON `account` (`id`);',
			'CREATE TRIGGER `account_touch` AFTER UPDATE ON `account` BEGIN SELECT 1; END;'
		].join('\n');

		const lines = composeBackup(schema, rows).trimEnd().split('\n');

		const insert = lines.indexOf('INSERT INTO "account" ("id") VALUES(\'a\');');
		expect(insert).toBeGreaterThan(
			lines.findIndex((line) => line.startsWith('CREATE UNIQUE INDEX'))
		);
		expect(insert).toBeLessThan(lines.findIndex((line) => line.startsWith('CREATE TRIGGER')));
	});

	it('refuses a schema that creates an index after a trigger', () => {
		const schema = [
			'CREATE TABLE `account` (`id` text) STRICT;',
			'CREATE TRIGGER `account_touch` AFTER UPDATE ON `account` BEGIN SELECT 1; END;',
			'CREATE INDEX `account_id_idx` ON `account` (`id`);'
		].join('\n');

		expect(() => composeBackup(schema, rows)).toThrow(/CREATE INDEX `account_id_idx`/);
	});
});
