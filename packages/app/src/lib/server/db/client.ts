import type { Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

export { openDatabase } from './open';

/**
 * the handle every consumer types against — declared, not inferred.
 *
 * inferring it (`ReturnType<typeof createDb>`) resolves to
 * `LibSQLDatabase<typeof schema> & { $client: Client }`, which would put `db.$client` and an
 * autocompleting `db.transaction()` at every call site. both are wrong for this project. the write
 * path is `batch()` and nothing else: it is the one atomic primitive every flavor of this app has
 * (D1 has no interactive transaction), so the ledger's writes stay the same call wherever the
 * migrations run. and the client ./open.ts opens holds one connection, which an open `transaction()` would
 * hold for as long as its callback awaits — every other request waiting behind it. `Omit` removes
 * both, leaving `batch()` as the only way to write more than one row together. both are compile
 * errors now:
 *
 *   db.transaction(...)  ->  Property 'transaction' does not exist
 *   db.$client           ->  Property '$client' does not exist
 *
 * `batch()` being atomic is not taken on faith: `../ledger/posting.db.spec.ts` fails a statement
 * mid-batch against a real libSQL file and asserts the earlier rows are gone.
 */
export type Db = Omit<LibSQLDatabase<typeof schema>, 'transaction' | '$client'>;

/**
 * with ./open.ts, the only modules that know which driver sits under the schema: libSQL on a local
 * `file:` URL. ./open.ts opens the client and this re-exports it; it is a module of its own so that
 * `pnpm db:migrate` can run it under plain node, which cannot resolve the extensionless imports
 * under ./schema.ts.
 *
 * nothing here is a module-scope singleton. the server entry opens one client when the process
 * starts and hands it down, and the drizzle instance is built per request:
 *
 *   const db = createDb(client);
 *
 * migrations are never an app-boot side effect — `pnpm db:migrate` (./migrate.ts) runs them ahead
 * of the server, and nothing here applies one.
 */
export function createDb(client: Client): Db {
	return drizzle(client, { schema });
}
