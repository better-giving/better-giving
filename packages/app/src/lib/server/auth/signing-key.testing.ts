import { type MockInstance, vi } from 'vitest';
import { run, stmt } from '$lib/server/db/database.testing';

/**
 * runs `fn` against this spec file's database, whose `auth_signing_key` table cannot be read, with
 * `console.error` held, and puts both back however `fn` ends.
 *
 * the table is renamed rather than dropped, so the migration's own constraints and the minted row
 * survive for the next case. the answer the caller sees is `SIGNING_KEY_UNREADABLE`
 * (./signing-key.ts) and the cause is what `fn` reads off `logged`.
 *
 * the key is only read off the row where `BETTER_AUTH_SECRET` is unset, so the env the case
 * deploys with must not set it. db project only: it imports `database.testing`.
 */
export async function withSigningKeyUnreadable<T>(
	fn: (logged: MockInstance<typeof console.error>) => Promise<T>
): Promise<T> {
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	await run(stmt('alter table auth_signing_key rename to auth_signing_key_away'));
	try {
		return await fn(logged);
	} finally {
		await run(stmt('alter table auth_signing_key_away rename to auth_signing_key'));
		logged.mockRestore();
	}
}
