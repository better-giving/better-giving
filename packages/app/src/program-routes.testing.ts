import { env } from 'cloudflare:test';
import { expect } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import type { Db } from '$lib/server/db/client';

// what the three program route specs share, and nothing else: a real staff session, and the two
// writes that put a cause in the table past the queries under test.
//
// a module of its own rather than a helper inside one of the specs, because three files need it —
// the same shape ./route-request.testing.ts is under, and it sits here for the same reason that one
// does: **every file directly under ./routes/ is an address to `flatRoutes`**, which passes over
// `*.spec.*` and nothing else (./routes.ts). a helper put beside the routes it serves would be
// served.

/** the origin every request in these files arrives on. not loopback, so the cookie is `__Secure-`. */
export const ORIGIN = 'https://donations.example.workers.dev';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** a real session, as the `Cookie` header a browser would send back. */
export async function signIn(db: Db): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/**
 * a cause, written past drizzle so a fixture is not also exercising the queries under test.
 *
 * the timestamps are literals and none is an argument: the list orders by name rather than by age,
 * so a fixture that could vary them would be varying nothing any assertion reads. `archived` is the
 * one thing that moves, and it writes both halves of the retirement — `status` and `archived_at` —
 * because a row holding one without the other is a state no write in this app produces.
 */
export async function insertProgram(options: {
	id: string;
	name: string;
	description?: string | null;
	archived?: boolean;
}): Promise<string> {
	const { id, name, description = null, archived = false } = options;
	await env.DB.prepare(
		`insert into program (id, name, description, status, created_at, updated_at, archived_at)
		 values (?, ?, ?, ?, 0, 0, ?)`
	)
		.bind(id, name, description, archived ? 'archived' : 'active', archived ? 0 : null)
		.run();
	return id;
}
