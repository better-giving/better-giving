import { createExecutionContext, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { staffGate } from '$lib/server/auth/gate';
import { createDb, type Db } from '$lib/server/db/client';
import { requestContext } from './request-context';
import { signInAsDeployer } from './staff-session.testing';

// the fixture's session is only worth what the real gate makes of it, so each case hands the cookie
// to `staffGate` on a deployment and reads whether the screen beneath it ran.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-long-enough-password';

/** a deployment whose signing key is the `BETTER_AUTH_SECRET` override, not the row. */
const OVERRIDDEN = { ...env, BETTER_AUTH_SECRET: 'cd'.repeat(32) } as unknown as Env;

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_user').run();
});

/** whether the gate on `deployment` let a request carrying `cookie` through to the screen. */
async function reachesTheScreen(deployment: Env, cookie: string): Promise<boolean> {
	let ran = false;
	await staffGate(
		{
			request: new Request(`${ORIGIN}/admin`, { headers: { cookie } }),
			url: new URL(`${ORIGIN}/admin`),
			pattern: '/*',
			params: {},
			context: requestContext(deployment, createExecutionContext())
		},
		async () => {
			ran = true;
			return new Response('the screen');
		}
	).catch((thrown: unknown) => {
		if (!(thrown instanceof Response)) throw thrown;
	});
	return ran;
}

describe('signInAsDeployer', () => {
	it('signs with the key the deployment’s own gate verifies with', async () => {
		const cookie = await signInAsDeployer(db, {
			env: OVERRIDDEN,
			password: PASSWORD,
			origin: ORIGIN
		});
		expect(await reachesTheScreen(OVERRIDDEN, cookie)).toBe(true);
	});

	it('signs with nothing a deployment without that key accepts', async () => {
		const cookie = await signInAsDeployer(db, {
			env: OVERRIDDEN,
			password: PASSWORD,
			origin: ORIGIN
		});
		expect(await reachesTheScreen(env, cookie)).toBe(false);
	});
});
