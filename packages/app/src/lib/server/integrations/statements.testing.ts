import type { Client, InStatement, InValue } from '@libsql/client';
import { createDb, type Db } from '../db/client';
import { client } from '../db/database.testing';

// what a spec needs to read what a list read asked of the database: each statement it ran, with
// what it bound, so a spec can ask sqlite for the plan or re-run the statement.
//
// not a spec itself — no project's `include` matches this name, which is what keeps it a module the
// list specs import rather than a file of tests.

export type Prepared = { readonly sql: string; readonly params: InValue[] };

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

/**
 * the rows an `update … where …` selects, as a `select` of the same table with the same filter, for
 * a plan to be read off. `explain query plan` of an update itself leaves libsql's connection
 * mid-statement, and it then refuses every later commit with `SQLITE_BUSY`.
 */
export function selectedByUpdate(update: Prepared): Prepared {
	const head = /^update ("?\w+"?) set .*? where /s.exec(update.sql);
	if (head === null) throw new Error(`not an update with a where: ${update.sql}`);
	const before = head[0].match(/\?/g)?.length ?? 0;
	return {
		sql: `select 1 from ${head[1]} where ${update.sql.slice(head[0].length).replace(/ returning .*$/s, '')}`,
		params: update.params.slice(before)
	};
}

/**
 * sqlite's plan steps for every `select` and `update` among `statements`, in order. the other
 * statements are skipped: an `insert` or `delete` cannot be explained here for the reason
 * `selectedByUpdate` gives.
 */
export async function planStepsOf(statements: readonly Prepared[]): Promise<string[]> {
	const steps: string[] = [];
	for (const statement of statements) {
		const read = /^\s*select\b/i.test(statement.sql)
			? statement
			: /^\s*update\b/i.test(statement.sql)
				? selectedByUpdate(statement)
				: undefined;
		if (read === undefined) continue;
		const plan = await client.execute({
			sql: `explain query plan ${read.sql}`,
			args: read.params
		});
		for (const row of plan.rows) steps.push(String(row.detail));
	}
	return steps;
}
