import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.settings_.notifications';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the Notifications section's server half, against a real database, through the protected layout —
// who is signed in is what every answer here turns on, and the session gate is that layout's
// middleware (../route-request.testing.ts).

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/settings/notifications';
const PASSWORD = 'a-very-long-random-staff-password';

const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

const STALE_SAVE =
	'The organisation’s details changed since this page was opened. Reload it and save again.';

let db: Db;
let request: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/settings/notifications', module: screen }
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
	deployer = await signInAsDeployer(db, DEPLOYMENT);
});

function get(cookie: string): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), {
		env: DEPLOYMENT.env
	});
}

function post(cookie: string, boxes: Record<string, string>): Promise<Response> {
	const body = new FormData();
	body.set('__form_id__', 'settings-notifications');
	for (const [name, value] of Object.entries(boxes)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: DEPLOYMENT.env }
	);
}

/** the version the screen was drawn from, as the loader publishes it. */
async function drawnVersion(): Promise<string> {
	const read = (await (await get(deployer)).json()) as { version: number };
	return String(read.version);
}

/** the messages a rejection carries, keyed as conform keys them: `''` for the form's own. */
async function refusal(response: Response): Promise<Record<string, string[]>> {
	return ((await response.json()) as { form: { result: { error: Record<string, string[]> } } }).form
		.result.error;
}

async function storedAddress(): Promise<string | null | undefined> {
	return (
		await first<{ notification_email: string | null }>(
			stmt('select notification_email from org_profile')
		)
	)?.notification_email;
}

describe('a member’s session', () => {
	it('gets not-found for the page, which the deployer is served', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(deployer)).status).toBe(200);
		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for the save, and the address stays', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		const saved = await post(member, { notification_email: 'nadia@riverbanktrust.org' });

		expect(saved.status).toBe(404);
		expect(await storedAddress()).toBe('alerts@example.org');
	});
});

describe('saving the notification address', () => {
	it('stores the address and leaves the rest of the profile as it was', async () => {
		await run(
			stmt(`update org_profile set mission = 'Clean water.', brand_colour = '#1f6feb',
			 social_links = '[{"platform":"x","href":"https://x.com/riverbank"}]'`)
		);
		const columns = 'legal_name, tax_id, mission, brand_colour, social_links, logo_image_id';
		const before = await first(stmt(`select ${columns} from org_profile`));

		const response = await post(deployer, {
			notification_email: '  ops@riverbanktrust.org ',
			__version__: await drawnVersion()
		});

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(SCREEN);
		expect(await storedAddress()).toBe('ops@riverbanktrust.org');
		expect(await first(stmt(`select ${columns} from org_profile`))).toEqual(before);
	});

	it('clears the address when the box is emptied', async () => {
		await post(deployer, { notification_email: '', __version__: await drawnVersion() });

		expect(await storedAddress()).toBeNull();
	});

	it('refuses a value that is not an address, under the box, and keeps the one stored', async () => {
		const response = await post(deployer, {
			notification_email: 'Riverbank Trust',
			__version__: await drawnVersion()
		});

		expect(response.status).toBe(400);
		expect(await refusal(response)).toEqual({ notification_email: ['Not an email address.'] });
		expect(await storedAddress()).toBe('alerts@example.org');
	});

	it('refuses a page drawn before another save, and keeps what that save stored', async () => {
		const drawn = await drawnVersion();
		await run(
			stmt(`update org_profile set notification_email = 'new@example.org', updated_at = 5`)
		);

		const response = await post(deployer, {
			notification_email: 'old@example.org',
			__version__: drawn
		});

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual({ '': [STALE_SAVE] });
		expect(await storedAddress()).toBe('new@example.org');
	});

	it('refuses a second press of a page already saved from, and keeps the first save’s address', async () => {
		const drawn = await drawnVersion();
		const press = (address: string) =>
			post(deployer, { notification_email: address, __version__: drawn });

		expect((await press('first@example.org')).status).toBe(303);
		const second = await press('second@example.org');

		expect(second.status).toBe(409);
		expect(await refusal(second)).toEqual({ '': [STALE_SAVE] });
		expect(await storedAddress()).toBe('first@example.org');
	});

	it('asks for the organisation’s details first where none are saved', async () => {
		await run(stmt('delete from org_profile'));

		const response = await post(deployer, {
			notification_email: 'ops@riverbanktrust.org',
			__version__: await drawnVersion()
		});

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual({
			'': ['Save the organisation details first, then the notification address.']
		});
	});

	it('answers a write the database refuses with the form’s own refusal rather than an error page', async () => {
		const version = await drawnVersion();
		await run(
			stmt(`create trigger refuse_profile before update on org_profile
			 begin select raise(abort, 'profile refused'); end`)
		);
		try {
			const response = await post(deployer, {
				notification_email: 'ops@riverbanktrust.org',
				__version__: version
			});

			expect(response.status).toBe(500);
			expect(await refusal(response)).toEqual({
				'': ['Saving this failed and nothing was changed. Try again.']
			});
		} finally {
			await run(stmt('drop trigger refuse_profile'));
		}
	});
});

describe('what the screen is drawn from', () => {
	it('states the stored address, and none on a deployment with no profile', async () => {
		const read = async () =>
			((await (await get(deployer)).json()) as { notificationEmail: string | null })
				.notificationEmail;

		expect(await read()).toBe('alerts@example.org');
		await run(stmt('delete from org_profile'));
		expect(await read()).toBeNull();
	});

	it('states whether the organisation’s details are saved, which a save here needs', async () => {
		const read = async () =>
			((await (await get(deployer)).json()) as { hasProfile: boolean }).hasProfile;

		expect(await read()).toBe(true);
		await run(stmt('delete from org_profile'));
		expect(await read()).toBe(false);
	});

	it('names the save that just landed, on the page it lands on', async () => {
		const saved = await post(deployer, {
			notification_email: 'ops@riverbanktrust.org',
			__version__: await drawnVersion()
		});
		const cookie = `${deployer}; ${saved.headers.get('set-cookie')?.split(';', 1)[0]}`;

		const read = (await (await get(cookie)).json()) as {
			saved: string | null;
			notificationEmail: string | null;
		};

		expect(read.saved).toBe('notifications');
		expect(read.notificationEmail).toBe('ops@riverbanktrust.org');
	});
});
