import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.settings';
import { client, run, stmt } from '$lib/server/db/database.testing';

// /admin/settings, which is no page of its own: Settings' sections are three routes beside it.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

let db: Db;
let request: RouteRequester;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/settings', module: screen }
	]);
});

beforeEach(async () => {
	for (const table of ['auth_member_invitation', 'auth_session', 'auth_user']) {
		await run(stmt(`delete from ${table}`));
	}
});

function get(cookie: string): Promise<Response> {
	return request(new Request(`${ORIGIN}/admin/settings`, { headers: { cookie } }), {
		env: DEPLOYMENT.env
	});
}

describe('/admin/settings', () => {
	it('sends the deployer on to Organisation details', async () => {
		const response = await get(await signInAsDeployer(db, DEPLOYMENT));

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/admin/settings/organisation');
	});

	it('is not-found for a member, as every section is', async () => {
		await signInAsDeployer(db, DEPLOYMENT);
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(member)).status).toBe(404);
	});
});
