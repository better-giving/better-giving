/**
 * `pnpm db:backup <file>` — a copy of the database at `DATABASE_URL`, written to `<file>`, safe to
 * run while the server is serving. what the copy holds is ../src/lib/server/db/backup.ts's header.
 *
 * `<file>` must not exist yet. a relative path is relative to `packages/app`, where the root
 * `package.json` forwards the command. to restore, stop the server and put the copy where
 * `DATABASE_URL` points, with no `-wal` or `-shm` file left beside it.
 */

import { resolve } from 'node:path';
import { causeChain } from '../src/lib/server/db/rejection.ts';
import { openDatabase } from '../src/lib/server/db/open.ts';
import { backupDatabase } from '../src/lib/server/db/backup.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set — it names the database file, as a file: URL.');
	process.exit(1);
}
const [target] = process.argv.slice(2);
if (target === undefined) {
	console.error('usage: pnpm db:backup <file>');
	process.exit(1);
}

const path = resolve(target);
const client = await openDatabase(url);
try {
	await backupDatabase(client, path);
	console.log(path);
} catch (error) {
	console.error(causeChain(error).join('\n  '));
	process.exitCode = 1;
} finally {
	client.close();
}
