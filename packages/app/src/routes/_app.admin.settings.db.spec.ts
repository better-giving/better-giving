import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.settings';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

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
	for (const table of ['auth_member_invitation', 'auth_session', 'auth_user', 'org_profile']) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(`insert into org_profile (id, legal_name, tax_id, address_line1, city, country, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', '1 Main St', 'Springfield', 'US', 'alerts@example.org', 0, 0)`)
	);
});

function get(cookie: string): Promise<Response> {
	return request(new Request(`${ORIGIN}/admin/settings`, { headers: { cookie } }), {
		env: DEPLOYMENT.env
	});
}

/** a save from a tab still drawn as one combined Settings form. */
function post(cookie: string): Promise<Response> {
	const body = new FormData();
	body.set('legal_name', 'Hope Foundation');
	body.set('notification_email', 'new@example.org');
	return request(
		new Request(`${ORIGIN}/admin/settings`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: DEPLOYMENT.env }
	);
}

function storedProfile() {
	return first<Record<string, unknown>>(
		stmt('select legal_name, notification_email, updated_at from org_profile')
	);
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

	it('sends the deployer’s save on to Organisation details, and writes nothing', async () => {
		const deployer = await signInAsDeployer(db, DEPLOYMENT);
		const before = await storedProfile();

		const response = await post(deployer);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/admin/settings/organisation');
		expect(await storedProfile()).toEqual(before);
	});

	it('is not-found for a member’s save, as every section’s is', async () => {
		await signInAsDeployer(db, DEPLOYMENT);
		const member = await signInAsMember(db, DEPLOYMENT);
		const before = await storedProfile();

		expect((await post(member)).status).toBe(404);
		expect(await storedProfile()).toEqual(before);
	});
});
