import { env } from 'cloudflare:test';
import { expect } from 'vitest';
import { createAuth, inviteMember, readAuthEnv, redeemInvitation } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import type { Db } from '$lib/server/db/client';

// a real staff session for a route spec, through the same `auth.api` calls the login's action
// makes. each caller states its own bindings, origin and password: the key and the pin are read
// off the bindings the way ./lib/server/auth/gate.ts reads them, and the cookie's `__Secure-`
// prefix follows the origin.

/** the deployment a session is made on. */
export type StaffDeployment = {
	/** the bindings the requests under test arrive with. */
	readonly env: unknown;
	/** the staff password signed in with, whatever `env` holds. */
	readonly password: string;
	/** the origin requests arrive on. */
	readonly origin: string;
};

/** the bindings a set-up deployment carries, with `password` as its staff password. */
export function deployedBindings(password: string): Env {
	return {
		...env,
		ADMIN_PASSWORD: password,
		STRIPE_SECRET_KEY: 'sk_test_x',
		STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
		SMTP_HOST: 'smtp.example.org',
		SMTP_USERNAME: 'apikey',
		SMTP_PASSWORD: 'mail-secret',
		MAIL_FROM: 'giving@example.org'
	} as unknown as Env;
}

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

/** a colleague who accepted an invitation, through the real invite and redeem. */
export async function signInAsMember(db: Db, deployment: StaffDeployment): Promise<string> {
	const invited = await inviteMember(db, {
		email: 'nadia@riverbanktrust.org',
		now: new Date(),
		invitedBy: null
	});
	if (!invited.ok) throw new Error(`the fixture could not invite: ${invited.reason}`);
	const redeemed = await redeemInvitation(db, await staffAuth(db, deployment), {
		token: invited.token,
		name: 'Nadia Hart',
		password: 'a-colleagues-own-password',
		headers: new Headers({ origin: deployment.origin }),
		now: new Date()
	});
	if (!redeemed.ok) throw new Error(`the fixture could not redeem: ${redeemed.reason}`);
	return asCookieHeader([...redeemed.cookies]);
}
