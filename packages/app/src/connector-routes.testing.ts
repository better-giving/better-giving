import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, expect } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { type MountedRoute, mountRoutes, type RouteRequester } from './route-request.testing';
import * as layout from './routes/_app';
import * as allow from './routes/_app.admin.connector.allow';
import * as surface from './routes/connector.v1';
import * as exchange from './routes/connector.v1.exchange';
import { deployedBindings, signInAsDeployer } from './staff-session.testing';

// what the `/connector/v1` route specs share: a deployment with its organisation and a signed-in
// deployer, wiped back to that before each case, and the connect the central connector makes —
// Allow pressed, then the code exchanged for a key — so a case starts from a key in hand.
//
// here rather than beside the routes for ./program-routes.testing.ts's reason: every file directly
// under ./routes/ is an address to `flatRoutes`, bar a spec.

export const ORIGIN = 'https://give.example';
const PASSWORD = 'a-very-long-random-staff-password';
export const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

/** the bindings with no per-key bucket, which the test pool sizes at three calls a minute. */
const UNMETERED = { ...DEPLOYMENT.env, INTEGRATIONS_KEY_RATE_LIMITER: undefined } as unknown as Env;

/** `module` mounted at `path` under the surface's layout, as the route files nest it. */
export const under = (path: string, module: MountedRoute['module']) =>
	mountRoutes([
		{ path: 'connector/v1', module: surface },
		{ path, module }
	]);

/** every table a connector case writes, emptied in an order no foreign key refuses. */
const WIPED = [
	'photo_link',
	'connector_code',
	'connector_key',
	'api_key',
	'page',
	'form',
	'auth_member_invitation',
	'auth_session',
	'auth_user',
	'org_profile'
];

export type CallInit = { method?: string; key?: string; body?: unknown; metered?: boolean };

/**
 * registers the spec's hooks — the routes `mount` names mounted once, the tables wiped and the
 * organisation and deployer seeded before each case — and hands back what a case calls them with.
 */
export function connectorHarness<R extends Record<string, RouteRequester>>(mount: () => R) {
	let db: Db | undefined;
	let deployer = '';
	let routes: (R & { exchange: RouteRequester; allow: RouteRequester }) | undefined;
	let caller = 0;
	let calls = 0;

	beforeAll(() => {
		db = createDb(env.DB);
		routes = {
			...mount(),
			exchange: under('exchange', exchange),
			allow: mountRoutes([
				{ path: undefined, module: layout },
				{ path: 'admin/connector/allow', module: allow }
			])
		};
	});

	beforeEach(async () => {
		for (const table of WIPED) await env.DB.prepare(`delete from ${table}`).run();
		await env.DB.prepare(
			`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
			 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
		).run();
		deployer = await signInAsDeployer(harness.db, DEPLOYMENT);
		caller += 1;
	});

	/** each call from an address of its own, so the caller bucket is never what answers a case. */
	const ip = () => `2001:db8:${caller.toString(16)}:${(calls++).toString(16)}::1`;

	function mounted(): NonNullable<typeof routes> {
		if (routes === undefined) throw new Error('the connector routes are mounted in beforeAll');
		return routes;
	}

	const harness = {
		get db(): Db {
			if (db === undefined) throw new Error('the database is opened in beforeAll');
			return db;
		},
		get deployer(): string {
			return deployer;
		},
		/** a mounted route by name, for a case that sends it a request of its own. */
		route(name: keyof R | 'allow'): RouteRequester {
			return mounted()[name] as RouteRequester;
		},

		/** `path` under the surface, sent to the route mounted as `route`. */
		call(route: keyof R | 'exchange', path: string, init: CallInit = {}): Promise<Response> {
			const headers: Record<string, string> = {
				'cf-connecting-ip': ip(),
				accept: 'application/json'
			};
			if (init.key !== undefined) headers.authorization = `Bearer ${init.key}`;
			if (init.body !== undefined) headers['content-type'] = 'application/json';
			return (mounted()[route] as RouteRequester)(
				new Request(`${ORIGIN}/connector/v1${path}`, {
					method: init.method ?? 'GET',
					headers,
					...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
				}),
				{ env: init.metered === true ? DEPLOYMENT.env : UNMETERED }
			);
		},

		/** Allow pressed by `cookie` for `state`, answering the redirect it sends the browser. */
		pressAllow(cookie: string, intent: 'allow' | 'deny', state = 'st-123'): Promise<Response> {
			const body = new FormData();
			body.set('intent', intent);
			return mounted().allow(
				new Request(`${ORIGIN}/admin/connector/allow?state=${state}`, {
					method: 'POST',
					headers: { cookie, origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
					body
				}),
				{ env: DEPLOYMENT.env }
			);
		},

		/** the whole connect: Allow, then the exchange the connector makes with the code. */
		async connect(): Promise<string> {
			const allowed = await harness.pressAllow(deployer, 'allow');
			const code = new URL(allowed.headers.get('location') ?? '').searchParams.get('code');
			const exchanged = await harness.call('exchange', '/exchange', {
				method: 'POST',
				body: { code }
			});
			expect(exchanged.status).toBe(200);
			return ((await exchanged.json()) as { key: string }).key;
		}
	};
	return harness;
}
