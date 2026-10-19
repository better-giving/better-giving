/**
 * `pnpm db:seed` — ./seed-local.sql applied to the database at `DATABASE_URL`, after
 * `pnpm db:migrate`. a contributor's checkout only: what the file writes, and why no deployment
 * takes it, is that file's header.
 */

import { readFile } from 'node:fs/promises';
import { causeChain } from '../src/lib/server/db/rejection.ts';
import { openDatabase } from '../src/lib/server/db/open.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set — it names the database file, as a file: URL.');
	process.exit(1);
}

const client = await openDatabase(url);
try {
	await client.executeMultiple(
		await readFile(new URL('./seed-local.sql', import.meta.url), 'utf8')
	);
} catch (error) {
	console.error(causeChain(error).join('\n  '));
	process.exitCode = 1;
} finally {
	client.close();
}
