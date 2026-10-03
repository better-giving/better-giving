import { env } from 'cloudflare:test';
import { createDb, type Db } from '../db/client';

// what a spec needs to read what a list read asked of D1: each statement it prepared, with what it
// bound, so a spec can ask sqlite for the plan or re-run the statement and read what it cost.
//
// not a spec itself — no pool's `include` matches this name, which is what keeps it a module the
// list specs import rather than a file of tests.

export type Prepared = { readonly sql: string; readonly params: unknown[] };

/** every statement `read` prepares, in order, with what was bound to each. */
export async function statementsOf(read: (db: Db) => Promise<unknown>): Promise<Prepared[]> {
	const prepared: Prepared[] = [];
	const handle = new Proxy(env.DB, {
		get(target, key) {
			if (key !== 'prepare') return Reflect.get(target, key, target);
			return (sql: string) => {
				const entry: Prepared = { sql, params: [] };
				prepared.push(entry);
				const statement = target.prepare(sql);
				return new Proxy(statement, {
					get(stmt, method) {
						if (method !== 'bind') return Reflect.get(stmt, method, stmt);
						return (...params: unknown[]) => {
							entry.params.push(...params);
							return stmt.bind(...params);
						};
					}
				});
			};
		}
	});
	await read(createDb(handle));
	return prepared;
}

/**
 * the rows D1 counts every statement `read` prepares as reading, each re-run on its own with what
 * it bound: what a read costs, in the unit D1 bills and limits a query by.
 */
export async function rowsReadBy(read: (db: Db) => Promise<unknown>): Promise<number> {
	let rows = 0;
	for (const { sql, params } of await statementsOf(read)) {
		const { meta } = await env.DB.prepare(sql)
			.bind(...params)
			.all();
		rows += meta.rows_read;
	}
	return rows;
}
