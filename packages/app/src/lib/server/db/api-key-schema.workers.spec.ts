import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// the constraints `api_key` carries, which are one-way for the reason
// ./donation-schema.workers.spec.ts opens with: each is a rebuild of the table to change.
//
// `STRICT` on the table is read off sqlite's catalogue by ./strict.workers.spec.ts, and the
// `notBlank` body on `name` is the shared helper, pinned elsewhere; neither is repeated here.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';

/** runs `fn` and requires D1 to have rejected it; same helper as the sibling schema specs. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

type Row = {
	id: string;
	kind?: string;
	keyHash?: string;
	prefix?: string;
	revokedAt?: number | null;
	archivedAt?: number | null;
};

const insertKey = (row: Row) =>
	env.DB.prepare(
		`insert into api_key (id, name, kind, key_hash, prefix, last_four, created_at, revoked_at, archived_at)
		 values (?, 'a key', ?, ?, ?, 'wxyz', 0, ?, ?)`
	)
		.bind(
			row.id,
			row.kind ?? 'api',
			row.keyHash ?? row.id.padEnd(64, '0'),
			row.prefix ?? 'bgk_7Qm2',
			row.revokedAt ?? null,
			row.archivedAt ?? null
		)
		.run();

beforeEach(async () => {
	await env.DB.prepare('delete from api_key').run();
});

describe("at most one of Zapier's keys works at a time", () => {
	it('refuses a second un-revoked zapier key', async () => {
		await insertKey({ id: 'a', kind: 'zapier' });
		const message = await rejection(() => insertKey({ id: 'b', kind: 'zapier' }));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
		expect(message).toContain('api_key.kind');
	});

	it('takes a new zapier key beside a revoked one', async () => {
		await insertKey({ id: 'a', kind: 'zapier', revokedAt: 1 });
		await insertKey({ id: 'b', kind: 'zapier' });
		const { results } = await env.DB.prepare(`select id from api_key order by id`).all();
		expect(results).toEqual([{ id: 'a' }, { id: 'b' }]);
	});

	it('takes any number of un-revoked api keys', async () => {
		await insertKey({ id: 'a' });
		await insertKey({ id: 'b' });
		const { results } = await env.DB.prepare(`select id from api_key order by id`).all();
		expect(results).toEqual([{ id: 'a' }, { id: 'b' }]);
	});
});

describe('the key is never stored, whole or in pieces', () => {
	it('refuses a prefix longer than bgk_ and four characters', async () => {
		const message = await rejection(() => insertKey({ id: 'a', prefix: `bgk_${'A'.repeat(43)}` }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('api_key_prefix_check');
	});

	it('refuses the key written where its hash belongs', async () => {
		const message = await rejection(() => insertKey({ id: 'a', keyHash: `bgk_${'A'.repeat(43)}` }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('api_key_key_hash_check');
	});
});

describe('a key is archived only once revoked', () => {
	it('refuses an archived key that still works', async () => {
		const message = await rejection(() => insertKey({ id: 'a', archivedAt: 1 }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('api_key_archived_revoked_check');
	});

	it('archives a revoked key', async () => {
		await insertKey({ id: 'a', revokedAt: 1, archivedAt: 2 });
		const row = await env.DB.prepare(`select archived_at from api_key where id = 'a'`).first();
		expect(row).toEqual({ archived_at: 2 });
	});
});
