import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { all, client, run, stmt } from '$lib/server/db/database.testing';
import { sweepSupporterLeftovers } from './sweep';

// the hourly sweep of what a supporter's sign-in leaves behind, against the real tables.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

const SUPPORTER = '019fb600-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const HOUR = 60 * 60_000;
const at = (offset: number) => NOW.getTime() + offset;

beforeEach(async () => {
	for (const table of ['supporter_session', 'supporter_link', 'supporter']) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(
			`insert into supporter (id, email, name, created_at) values (?, 'maya@example.org', 'Maya', 0)`,
			SUPPORTER
		)
	);
});

/** a sign-in link whose hash is `tag` repeated, expiring at `expiresAt`, used at `usedAt`. */
async function link(tag: string, expiresAt: number, usedAt: number | null = null) {
	await run(
		stmt(
			`insert into supporter_link (token_hash, supporter_id, purpose, created_at, expires_at, used_at)
			 values (?, ?, 'sign_in', ?, ?, ?)`,
			tag.repeat(64),
			SUPPORTER,
			expiresAt - HOUR,
			expiresAt,
			usedAt
		)
	);
}

async function session(tag: string, expiresAt: number) {
	await run(
		stmt(
			`insert into supporter_session (token_hash, supporter_id, created_at, expires_at)
			 values (?, ?, 0, ?)`,
			tag.repeat(64),
			SUPPORTER,
			expiresAt
		)
	);
}

const left = async (table: 'supporter_link' | 'supporter_session') =>
	(await all<{ token_hash: string }>(stmt(`select token_hash from ${table} order by token_hash`)))
		.map((row) => row.token_hash[0])
		.join('');

describe('sweeping supporter leftovers', () => {
	it('deletes links a day past their expiry, used or not, and keeps the rest', async () => {
		await link('a', at(-25 * HOUR));
		await link('b', at(-25 * HOUR), at(-26 * HOUR));
		await link('c', at(-23 * HOUR), at(-23.5 * HOUR));
		await link('d', at(HOUR / 2));
		await link('e', at(HOUR / 2), at(-HOUR / 4));

		await sweepSupporterLeftovers(db, NOW);

		expect(await left('supporter_link')).toBe('cde');
	});

	it('deletes sessions past their expiry, and keeps the live ones', async () => {
		await session('a', at(-1));
		await session('b', at(0));
		await session('c', at(1));

		await sweepSupporterLeftovers(db, NOW);

		expect(await left('supporter_session')).toBe('c');
	});
});
