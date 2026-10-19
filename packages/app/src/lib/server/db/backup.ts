import type { Client } from '@libsql/client';

/**
 * a copy of the database behind `client`, written to the new file at `path` — every table, photos'
 * bytes and the applied migrations included, so restoring is putting the file where `DATABASE_URL`
 * points.
 *
 * `VACUUM INTO` copies inside one read transaction, so the copy is consistent while the server keeps
 * writing, and it is a single file with no `-wal` beside it. SQLite refuses a `path` that already
 * holds a file (https://sqlite.org/lang_vacuum.html#vacuuminto).
 */
export async function backupDatabase(client: Client, path: string): Promise<void> {
	await client.execute({ sql: 'VACUUM INTO ?', args: [path] });
}
