import type { Client, InStatement } from '@libsql/client';
import {
	createStaticHandler,
	type LoaderFunction,
	type MiddlewareFunction,
	type StaticHandlerContext
} from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { requestContext } from '../request-context';
import { mountRoutes, queryDocument, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer } from '../staff-session.testing';
import * as layout from './_app';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the protected layout serves its screens on any deployment a session reaches, set up or not, and
// names the organisation in the identity band where there is a row to name it from.
//
// the child is a stand-in that counts its own calls, because what is asserted is that the layout
// let it run — a real screen would answer the same question through its own rows.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

/** the staff password and nothing else: no processor, no mail host. */
const unconfigured = (): Env => readEnv({ ADMIN_PASSWORD: PASSWORD }, specRateLimiters());

let db: Db;
let request: RouteRequester;
const ran = { loader: 0, action: 0 };

const screen = {
	loader: () => {
		ran.loader += 1;
		return { screen: true };
	},
	action: () => {
		ran.action += 1;
		return { saved: true };
	}
};

/** the layout over the stand-in, as react router's own route objects for a document request. */
const handler = createStaticHandler([
	{
		id: 'app',
		middleware: layout.middleware as unknown as MiddlewareFunction[],
		loader: layout.loader as unknown as LoaderFunction,
		children: [{ id: 'screen', path: 'admin/screen', loader: screen.loader }]
	}
]);

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/screen', module: screen }
	]);
});

beforeEach(async () => {
	ran.loader = 0;
	ran.action = 0;
	for (const table of ['auth_session', 'auth_user', 'org_profile']) {
		await run(stmt(`delete from ${table}`));
	}
});

const post = (cookie: string) =>
	request(
		new Request(`${ORIGIN}/admin/screen`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body: new FormData()
		}),
		{ env: unconfigured() }
	);

const get = (cookie: string) =>
	request(new Request(`${ORIGIN}/admin/screen`, { headers: { cookie } }), { env: unconfigured() });

/** the page as a document request draws it: the status and each route's loader data. */
const drawn = (cookie: string, on: Client = client): Promise<StaticHandlerContext> =>
	queryDocument(
		handler,
		new Request(`${ORIGIN}/admin/screen`, { headers: { cookie } }),
		requestContext({ env: unconfigured(), deferred: createDeferredWork(), client: on })
	);

/**
 * a database that refuses the organisation's row and answers everything else, so the session gate
 * resolves and only the organisation's name is lost.
 */
function profileUnreadable(): Client {
	const refuses = (statement: InStatement) =>
		(typeof statement === 'string' ? statement : statement.sql).includes('org_profile');
	return new Proxy(client, {
		get(target, key) {
			if (key === 'execute') {
				return (statement: InStatement) =>
					refuses(statement)
						? Promise.reject(new Error('the database is not answering'))
						: target.execute(statement);
			}
			const value = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

describe('on a deployment nobody has set up', () => {
	it('runs the screen it was asked for, with no organisation row and no processor keys', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await get(cookie);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ screen: true });
		expect(ran.loader).toBe(1);
	});

	it('runs the write it was sent', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const response = await post(cookie);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ saved: true });
		expect(ran.action).toBe(1);
	});

	it('draws the frame with no name in the identity band', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const page = await drawn(cookie);

		expect(page.statusCode).toBe(200);
		expect(page.loaderData.app).toEqual({ orgName: null, deployer: true });
	});
});

describe('the identity band', () => {
	it('names the organisation off its registered name', async () => {
		await run(
			stmt(`insert into org_profile (id, legal_name, created_at, updated_at)
			 values ('default', 'Riverbank Trust', 0, 0)`)
		);
		const cookie = await signInAsDeployer(db, DEPLOYMENT);

		const page = await drawn(cookie);

		expect(page.loaderData.app).toEqual({ orgName: 'Riverbank Trust', deployer: true });
	});

	it('loses the name and not the page when the row cannot be read', async () => {
		const cookie = await signInAsDeployer(db, DEPLOYMENT);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const page = await drawn(cookie, profileUnreadable());

		expect(page.statusCode).toBe(200);
		expect(page.loaderData.app).toEqual({ orgName: null, deployer: true });
		expect(errors).toHaveBeenCalledOnce();
	});
});
