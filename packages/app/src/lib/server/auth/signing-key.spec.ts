import { describe, expect, it } from 'vitest';
import type { Db } from '$lib/server/db/client';
import { resolveAuthSecret } from './signing-key';

/**
 * the row `migrations/0000_initial_schema.sql` mints: 64 lowercase hex characters.
 */
const ROW_VALUE = 'cd'.repeat(32);
const ENV_VALUE = 'an-override-set-by-hand';

/**
 * a `db` that answers the one query this module makes.
 *
 * hand-rolled rather than mocked: the chain is four calls long and fixed, so a stub is
 * shorter than the mock setup and it fails loudly if the query shape changes. the reject
 * channel is the branch that matters — a fresh fork with no migrations applied throws
 * `no such table` from inside the driver.
 */
function stubDb(outcome: { rows: unknown } | { rejects: unknown }): Db {
	const result = {
		from: () => result,
		where: () => result,
		limit: () =>
			'rejects' in outcome ? Promise.reject(outcome.rejects) : Promise.resolve(outcome.rows)
	};
	return { select: () => result } as unknown as Db;
}

/** the happy-path stub, spelled once. */
const rowsWith = (value: string) => stubDb({ rows: [{ value }] });

/** a `db` whose use is itself the failure — for the env-override path. */
function forbiddenDb(): Db {
	return {
		select: () => {
			throw new Error('the database must not be read when BETTER_AUTH_SECRET is set');
		}
	} as unknown as Db;
}

describe('resolveAuthSecret', () => {
	it('prefers BETTER_AUTH_SECRET and does not read the database at all', async () => {
		const result = await resolveAuthSecret(forbiddenDb(), { BETTER_AUTH_SECRET: ENV_VALUE });
		expect(result).toEqual({ ok: true, secret: ENV_VALUE, source: 'env' });
	});

	it('trims the env override', async () => {
		const result = await resolveAuthSecret(forbiddenDb(), {
			BETTER_AUTH_SECRET: `  ${ENV_VALUE}\n`
		});
		expect(result.ok && result.secret).toBe(ENV_VALUE);
	});

	// an empty secret is treated as unset, not as a secret. better-auth substitutes a
	// built-in default for a falsy one, and that default is public.
	it('falls through to the row when the env override is empty or blank', async () => {
		for (const BETTER_AUTH_SECRET of ['', '   ']) {
			const result = await resolveAuthSecret(rowsWith(ROW_VALUE), { BETTER_AUTH_SECRET });
			expect(result).toEqual({ ok: true, secret: ROW_VALUE, source: 'database' });
		}
	});

	it('reads the row when no override is set — the normal deployed path', async () => {
		const result = await resolveAuthSecret(rowsWith(ROW_VALUE), {});
		expect(result).toEqual({ ok: true, secret: ROW_VALUE, source: 'database' });
	});

	/**
	 * the refuse branch, and the reason this module returns a result instead of throwing:
	 * the message is the only thing an operator (or an agent reading a 500 body) has to
	 * go on, so it has to name the table, the reason and the command that fixes it.
	 */
	it('refuses when the row is absent, naming the migration command', async () => {
		const result = await resolveAuthSecret(stubDb({ rows: [] }), {});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('auth_signing_key');
		expect(result.message).toContain('no `default` row exists');
		expect(result.message).toContain('pnpm wrangler d1 migrations apply DB --local');
		expect(result.message).toContain('better-giving open');
		expect(result.message).toContain('BETTER_AUTH_SECRET');
	});

	it('refuses when the row exists but is empty, saying so distinctly', async () => {
		const result = await resolveAuthSecret(rowsWith('   '), {});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('the `default` row is empty');
	});

	// the value crosses D1's serialization boundary, so a row whose column is null is
	// representable at runtime whatever the type says. it must refuse, not TypeError.
	it('refuses a row whose value is not a string', async () => {
		const result = await resolveAuthSecret(stubDb({ rows: [{ value: null }] }), {});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('the `default` row is empty');
	});

	/**
	 * what a fresh fork actually hits: migrations have not been applied, so the table does
	 * not exist and the driver throws. it must become the same actionable message rather
	 * than a raw drizzle error, and it must not escape as an exception.
	 */
	it('turns a missing table into the same actionable message', async () => {
		const result = await resolveAuthSecret(
			stubDb({ rejects: new Error('D1_ERROR: no such table: auth_signing_key') }),
			{}
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('no such table: auth_signing_key');
		expect(result.message).toContain('pnpm wrangler d1 migrations apply DB --local');
	});

	it('describes a non-Error rejection without throwing', async () => {
		const result = await resolveAuthSecret(stubDb({ rejects: 'nope' }), {});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('nope');
	});
});
