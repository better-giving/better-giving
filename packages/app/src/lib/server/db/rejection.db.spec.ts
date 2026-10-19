import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client';
import { client } from './database.testing';
import { sqliteResultCode } from './rejection';
import { rejectionCode } from './rejection.testing';

// ./rejection.ts read against what a real libSQL file throws, raw and through drizzle. the pure
// walk is ./rejection.spec.ts; this is the proof that the shape it walks is libSQL's.

const db = createDb(client);

// tables of the spec's own, so each refusal is the one constraint it names and the cases do not
// move with the app's schema.
beforeAll(async () => {
	await client.executeMultiple(`
		CREATE TABLE probe_parent (id TEXT PRIMARY KEY) STRICT;
		CREATE TABLE probe (
			id TEXT PRIMARY KEY,
			code TEXT NOT NULL UNIQUE,
			amount INTEGER CHECK (amount > 0),
			parent_id TEXT REFERENCES probe_parent(id)
		) STRICT;
		INSERT INTO probe (id, code) VALUES ('first', 'taken');
	`);
});

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
	} catch (e) {
		return e;
	}
	throw new Error('expected the database to reject this statement, but it succeeded');
}

describe('sqliteResultCode() on libSQL', () => {
	it('names a UNIQUE refusal through drizzle', async () => {
		const error = await caught(() =>
			db.run(sql`INSERT INTO probe (id, code) VALUES ('u', 'taken')`)
		);

		expect(sqliteResultCode(error)).toBe('SQLITE_CONSTRAINT_UNIQUE');
	});

	it('names a foreign key refusal', async () => {
		const error = await caught(() =>
			client.execute(`INSERT INTO probe (id, code, parent_id) VALUES ('f', 'f', 'missing')`)
		);

		expect(sqliteResultCode(error)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
	});

	it('names a STRICT refusal', async () => {
		const error = await caught(() =>
			client.execute(`INSERT INTO probe (id, code, amount) VALUES ('s', 's', 'not a number')`)
		);

		expect(sqliteResultCode(error)).toBe('SQLITE_CONSTRAINT_DATATYPE');
	});

	it('puts the extended name in the chain a spec matches against', async () => {
		expect(
			await rejectionCode(() =>
				db.run(sql`INSERT INTO probe (id, code, amount) VALUES ('c', 'c', -1)`)
			)
		).toMatch(/\bSQLITE_CONSTRAINT_CHECK\b/);
	});
});
