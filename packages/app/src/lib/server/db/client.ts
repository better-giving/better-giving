import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * the handle every consumer types against — declared, not inferred.
 *
 * inferring it (`ReturnType<typeof createDb>`) resolves to
 * `DrizzleD1Database<typeof schema> & { $client: D1Database }`, which would put
 * `db.$client` and an autocompleting `db.transaction()` at every call site. that is
 * exactly wrong for this project: D1 has no interactive transaction and autocommits
 * each statement independently, so `db.transaction()` would look like atomicity and
 * provide none. `Omit` removes both, leaving `batch()` — the one atomic primitive that
 * does exist — as the only way to write more than one row together. both are compile
 * errors now:
 *
 *   db.transaction(...)  ->  Property 'transaction' does not exist
 *   db.$client           ->  Property '$client' does not exist
 *
 * `batch()` being atomic is not taken on faith: `../ledger/posting.workers.spec.ts`
 * fails a statement mid-batch against a real D1 and asserts the earlier rows are gone.
 */
export type Db = Omit<DrizzleD1Database<typeof schema>, 'transaction' | '$client'>;

/**
 * the one module that knows which driver sits under the schema.
 *
 * that driver is D1, and this project is written to it rather than merely deployed on
 * it — the write path is D1's `batch()`, and there is no interactive transaction
 * anywhere because D1 has none. a container or self-host target is not a second branch
 * here: it would be a second implementation of the ledger's write path, so it is out of
 * scope rather than pending.
 *
 * nothing here is a module-scope singleton. the D1 handle only exists on the env a request
 * arrived on, so the drizzle instance is built per request:
 *
 *   const db = createDb(env.DB);
 *
 * migrations are never an app-boot side effect — they run ahead of the Worker, in the
 * `deploy` script (`wrangler d1 migrations apply DB --remote`, then `wrangler deploy`).
 * there is deliberately no migrate-on-start here.
 */
export function createDb(d1: D1Database): Db {
	return drizzle(d1, { schema });
}

/**
 * the handle for one request, from the platform env it arrived on.
 *
 * this exists so that `DB` is spelled in this file and nowhere else, which is the rule stated
 * above read literally: `createDb` takes the binding, so every caller of it had to name one, and a
 * name repeated per route is a name that can be misspelled per route. src/request-context.ts is
 * the only caller — it seeds the result onto the router context once per request, and every loader
 * and middleware takes it from there (src/context.ts).
 *
 * structural rather than the generated `Env`, so this module keeps depending on one binding rather
 * than on the whole of a deployment's configuration.
 */
export function requestDb(env: { readonly DB: D1Database }): Db {
	return createDb(env.DB);
}
