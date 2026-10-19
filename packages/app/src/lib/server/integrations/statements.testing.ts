import type { Client, InStatement } from '@libsql/client';
import { createDb, type Db } from '../db/client';
import { client } from '../db/database.testing';

// what a spec needs to read what a list read asked of the database: each statement it ran, with
// what it bound, so a spec can ask sqlite for the plan or re-run the statement.
//
// not a spec itself — no pool's `include` matches this name, which is what keeps it a module the
// list specs import rather than a file of tests.

export type Prepared = { readonly sql: string; readonly params: unknown[] };

/** every statement `read` runs, in order, with what was bound to each. */
export async function statementsOf(read: (db: Db) => Promise<unknown>): Promise<Prepared[]> {
	const prepared: Prepared[] = [];
	const record = (statement: InStatement): void => {
		if (typeof statement === 'string') prepared.push({ sql: statement, params: [] });
		else
			prepared.push({
				sql: statement.sql,
				params: Array.isArray(statement.args) ? [...statement.args] : []
			});
	};
	const handle = new Proxy(client, {
		get(target, key) {
			if (key === 'execute') {
				return (statement: InStatement) => {
					record(statement);
					return target.execute(statement);
				};
			}
			if (key === 'batch') {
				return (statements: InStatement[], mode?: Parameters<Client['batch']>[1]) => {
					for (const statement of statements) record(statement);
					return target.batch(statements, mode);
				};
			}
			// bound, because the client keeps its pool in private fields a proxy receiver cannot reach
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	await read(createDb(handle));
	return prepared;
}
