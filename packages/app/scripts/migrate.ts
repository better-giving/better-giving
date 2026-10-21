/**
 * `pnpm db:migrate` — every committed migration the database at `DATABASE_URL` has not recorded,
 * applied in filename order. run it before the server starts; the server never runs it
 * (AGENTS.md → Schema). what it does to each file is ../src/lib/server/db/migrate.ts's header.
 *
 * prints each file it applied to stdout, and nothing when the database was already current. a file
 * the database refused is named on stderr with the database's reason, and the exit status is 1.
 */

import { resolve } from 'node:path';
import { causeChain } from '../src/lib/server/db/rejection.ts';
import { openDatabase } from '../src/lib/server/db/open.ts';
import { applyMigrations, readMigrations } from '../src/lib/server/db/migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set — it names the database file, as a file: URL.');
	process.exit(1);
}

const client = await openDatabase(url);
try {
	const applied = await applyMigrations(
		client,
		await readMigrations(resolve(import.meta.dirname, '../migrations'))
	);
	for (const name of applied) console.log(name);
} catch (error) {
	console.error(causeChain(error).join('\n  '));
	process.exitCode = 1;
} finally {
	client.close();
}
