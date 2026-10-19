import type { Client, InStatement } from '@libsql/client';
import { client } from './database.testing';

// the spec file's database with the traffic to it counted, for a case that claims a request cost no
// read at all.
//
// nothing here stands in for the database: every statement still runs against the real file and
// returns what it returns. not a spec itself — no project's `include` matches this name.

/** `on` with each statement sent through it counted: a `batch()` counts every statement it carries. */
export function countingClient(on: Client = client): {
	readonly client: Client;
	readonly statements: () => number;
} {
	let statements = 0;
	const counting = new Proxy(on, {
		get(target, key) {
			if (key === 'execute') {
				return (statement: InStatement) => {
					statements += 1;
					return target.execute(statement);
				};
			}
			if (key === 'batch') {
				return (list: InStatement[], mode?: Parameters<Client['batch']>[1]) => {
					statements += list.length;
					return target.batch(list, mode);
				};
			}
			// bound to the target: the client keeps its connection in private fields a proxy receiver cannot reach
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return { client: counting, statements: () => statements };
}
