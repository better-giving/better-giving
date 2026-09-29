import { expect } from 'vitest';
import { createAuth, readAuthEnv } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import type { Db } from '$lib/server/db/client';

// a real staff session for a route spec, through the same `auth.api` calls the login's action
// makes, shared by ./program-routes.testing.ts and ./webhook-routes.testing.ts. each states its own
// bindings, origin and password: the key and the pin are read off the bindings the way
// ./lib/server/auth/gate.ts reads them, and the cookie's `__Secure-` prefix follows the origin.

/** the deployment a session is made on. */
export type StaffDeployment = {
	/** the bindings the requests under test arrive with. */
	readonly env: unknown;
	/** the staff password signed in with, whatever `env` holds. */
	readonly password: string;
	/** the origin requests arrive on. */
	readonly origin: string;
};

/** the auth instance a request on `deployment` would be given. */
export async function staffAuth(db: Db, deployment: StaffDeployment) {
	const authEnv = readAuthEnv(deployment.env);
	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) throw new Error(signingKey.message);
	return createAuth(
		db,
		{ ...authEnv, ADMIN_PASSWORD: deployment.password },
		{ secret: signingKey.secret, requestOrigin: deployment.origin }
	);
}

/** `Set-Cookie` values as the `Cookie` header a browser would send back. */
export function asCookieHeader(setCookies: readonly string[]): string {
	const cookies = setCookies.map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/** the deployer signed in with the staff password, as the `Cookie` header a browser would send. */
export async function signInAsDeployer(db: Db, deployment: StaffDeployment): Promise<string> {
	const { headers } = await (await staffAuth(db, deployment)).api.signInStaff({
		body: { password: deployment.password },
		headers: new Headers({ origin: deployment.origin }),
		returnHeaders: true
	});
	return asCookieHeader(headers.getSetCookie());
}
