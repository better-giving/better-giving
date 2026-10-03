import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer } from '../staff-session.testing';
import * as layout from './_app';
import * as signOut from './_app.admin.sign-out';

// the set-up gate on the protected layout: while any of the five jobs is outstanding no screen
// beneath it reads or writes, and the one way out still works.
//
// the child is a stand-in that counts its own calls, because what is asserted is that the layout
// let it run or did not — a real screen would answer the same question through its own rows.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

/** the bindings of a deployment whose values are all set; the org row decides the rest. */
const bindings = (): Env => deployedBindings(PASSWORD);

let db: Db;
let request: RouteRequester;
let signOutRequest: RouteRequester;
const ran = { loader: 0, action: 0 };

beforeAll(() => {
	db = createDb(env.DB);
	// a chain is one line of nesting (../route-request.testing.ts), so the way out is its own.
	signOutRequest = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/sign-out', module: signOut }
	]);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{
			path: 'admin/screen',
			module: {
				loader: () => {
					ran.loader += 1;
					return { screen: true };
				},
				action: () => {
					ran.action += 1;
					return { saved: true };
				}
			}
		}
	]);
});

beforeEach(async () => {
	ran.loader = 0;
	ran.action = 0;
	for (const table of ['auth_session', 'auth_user', 'org_profile']) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

/** the organisation's identity and alert address saved, which finishes the last two jobs. */
async function finishSetUp(): Promise<void> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
}

const post = (cookie: string, at = '/admin/screen', to = request) =>
	to(
		new Request(`${ORIGIN}${at}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body: new FormData()
		}),
		{ env: bindings() }
	);

const get = (cookie: string, at = '/admin/screen', withBindings = bindings()) =>
	request(new Request(`${ORIGIN}${at}`, { headers: { cookie } }), { env: withBindings });

/**
 * the bindings with a database that refuses the organisation's row and answers everything else,
 * so the session gate resolves and only the set-up reading fails.
 */
function profileUnreadable(): Env {
	const real = env.DB;
	const DB = new Proxy(real, {
		get(target, key) {
			if (key === 'prepare') {
				return (sql: string) => {
					if (sql.includes('org_profile'))
						throw new Error('D1_ERROR: the database is not answering');
					return target.prepare(sql);
				};
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return { ...bindings(), DB } as Env;
}

describe('while a set-up job is outstanding', () => {
	it('answers a read with the gate and runs no screen beneath it', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await get(cookie);

		expect(ran.loader).toBe(0);
		expect(response.status).toBe(503);
		const body = (await response.json()) as {
			shape: string;
			lines: { id: string; state: string }[];
		};
		expect(body.shape).toBe('setup');
		expect(body.lines.filter((line) => line.state === 'todo').map((line) => line.id)).toEqual([
			'organisation',
			'notifications'
		]);
	});

	it('refuses a write without running it and sends the browser back to the same address', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await post(cookie, '/admin/screen?tab=plans');

		expect(ran.action).toBe(0);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/admin/screen?tab=plans');
	});

	it('still signs a stale tab out', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await post(cookie, '/admin/sign-out', signOutRequest);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login');
		const row = await env.DB.prepare('select count(*) as n from auth_session').first<{
			n: number;
		}>();
		expect(row?.n).toBe(0);
	});
});

describe('once set-up is finished', () => {
	it('runs the screen it was asked for', async () => {
		await finishSetUp();
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await get(cookie);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ screen: true });
		expect(ran.loader).toBe(1);
	});

	it('runs the write it was sent', async () => {
		await finishSetUp();
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await post(cookie);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ saved: true });
		expect(ran.action).toBe(1);
	});
});

describe('when the set-up reading does not land', () => {
	it('gates nothing, so the screen still runs', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await get(cookie, '/admin/screen', profileUnreadable());

		expect(response.status).toBe(200);
		expect(ran.loader).toBe(1);
		expect(errors).toHaveBeenCalledOnce();
	});
});
