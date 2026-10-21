import { type Client, createClient } from '@libsql/client';

/**
 * the process's one client on the database at `url`, with the settings every statement here assumes.
 *
 * one connection (`concurrency: 1`), because a pragma is a setting of the connection that ran it and
 * not of the database: a pool would open later connections with libSQL's defaults rather than these.
 * one connection costs nothing in parallelism either — libSQL's local driver runs each statement
 * synchronously on the calling thread, so a second connection in this process could never run
 * beside the first.
 *
 * `foreign_keys` is on, because D1 enforces foreign keys on every connection and the migrations
 * and their specs are written to that (`PRAGMA defer_foreign_keys` in the rebuild migrations
 * defers this check, and only does anything while it is on).
 *
 * `journal_mode=WAL` is a property of the file and outlives this client. a reader in another
 * process — a backup, or `pnpm db:migrate` reading the applied list — never blocks a write here,
 * and a commit costs one sync rather than two. it needs the file on a local disk: WAL's index is
 * shared memory, which a network filesystem does not provide (https://sqlite.org/wal.html).
 *
 * `timeout` is the busy timeout: a statement that meets another process's write lock waits up to
 * that long rather than failing with `SQLITE_BUSY` at once.
 */
export async function openDatabase(url: string): Promise<Client> {
	const client = createClient({ url, concurrency: 1, timeout: BUSY_TIMEOUT_MS });
	await client.execute('PRAGMA foreign_keys = ON');
	await client.execute('PRAGMA journal_mode = WAL');
	return client;
}

const BUSY_TIMEOUT_MS = 5000;
