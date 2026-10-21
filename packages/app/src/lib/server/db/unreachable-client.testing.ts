import type { Client } from '@libsql/client';
import { client } from './database.testing';

// the spec file's database as a client whose every statement fails, for a case about a screen that
// has to keep working on a deployment whose database is not answering.
//
// not a spec itself — no project's `include` matches this name.

/** a client that refuses every statement, `execute` and `batch` alike, with a driver-shaped error. */
export function unreachableClient(): Client {
	const refuse = () => Promise.reject(new Error('the database is not answering'));
	return new Proxy(client, {
		get(target, key) {
			if (key === 'execute' || key === 'batch' || key === 'transaction') return refuse;
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}
