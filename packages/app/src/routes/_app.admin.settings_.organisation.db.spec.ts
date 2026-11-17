import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { putBanner } from '$lib/server/org/logo.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.settings_.organisation';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the Organisation details section's server half, against a real database, through the protected
// layout — who is signed in is what every answer here turns on, and the session gate is that
// layout's middleware (../route-request.testing.ts).

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/settings/organisation';
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
		{ path: 'admin/settings/organisation', module: screen }
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
	body.set('__form_id__', 'settings-details');
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

/** the profile row as stored, every column a save could move. */
async function storedProfile() {
	return first<Record<string, unknown>>(
		stmt(
			`select legal_name, tax_id, address_line1, address_line2, city, region, postal_code, country,
			 notification_email, mission, vision, brand_colour, social_links, logo_image_id
			 from org_profile`
		)
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

/** every box the details form states, filled in as a receipt needs. */
const DETAILS = {
	legal_name: 'Hope Foundation',
	tax_id: '123456789',
	address_line1: '1 Main St',
	address_line2: '',
	city: 'Springfield',
	region: '',
	postal_code: '',
	country: 'US',
	mission: '',
	vision: '',
	brand_colour: ''
};

async function saveDetails(boxes: Record<string, string>, version?: string) {
	return post(deployer, {
		...DETAILS,
		...boxes,
		__version__: version ?? (await drawnVersion())
	});
}

describe('a member’s session', () => {
	it('gets not-found for the page, which the deployer is served', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(deployer)).status).toBe(200);
		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for the save, and the profile stays as it was', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);
		const before = await storedProfile();

		const saved = await post(member, { ...DETAILS, __version__: '0' });

		expect(saved.status).toBe(404);
		expect(await storedProfile()).toEqual(before);
	});
});

describe('saving the organisation’s details', () => {
	it('stores the details as a receipt prints them, and keeps the notification address', async () => {
		const response = await saveDetails({});

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(SCREEN);
		expect(await storedProfile()).toMatchObject({
			legal_name: 'Hope Foundation',
			tax_id: '12-3456789',
			address_line1: '1 Main St',
			address_line2: null,
			notification_email: 'alerts@example.org'
		});
	});

	it('stores the story, the colour and the links, in the spelling a page prints them in', async () => {
		await saveDetails({
			mission: ' Clean water. ',
			brand_colour: '#1F6FEB',
			'social_links[0]': 'https://www.instagram.com/hope',
			'social_links[1]': 'youtu.be/abc'
		});

		const stored = await storedProfile();
		expect(stored).toMatchObject({
			mission: 'Clean water.',
			vision: null,
			brand_colour: '#1f6feb'
		});
		expect(JSON.parse(String(stored?.social_links))).toEqual([
			{ platform: 'instagram', href: 'https://www.instagram.com/hope' },
			{ platform: 'youtube', href: 'https://youtu.be/abc' }
		]);
	});

	it('stores no links when every row was removed', async () => {
		await run(
			stmt(`update org_profile set social_links = '[{"platform":"x","href":"https://x.com/h"}]'`)
		);

		await saveDetails({});

		expect((await storedProfile())?.social_links).toBe('[]');
	});

	it('refuses a link on no platform it knows, keyed at the list', async () => {
		const response = await saveDetails({ 'social_links[0]': 'https://example.org' });

		expect(response.status).toBe(400);
		expect((await refusal(response)).social_links).toEqual([
			'https://example.org is not a Facebook, Instagram, YouTube, LinkedIn, TikTok or X address.'
		]);
	});

	it('refuses details missing what a receipt cannot be printed without, naming every box', async () => {
		const response = await saveDetails({ tax_id: '', address_line1: '', city: '', country: '' });

		expect(response.status).toBe(400);
		expect(Object.keys(await refusal(response))).toEqual(
			expect.arrayContaining(['tax_id', 'address_line1', 'city', 'country'])
		);
		expect((await storedProfile())?.legal_name).toBe('Riverbank Trust');
	});

	it('refuses an EIN that is not nine digits, in the words the shared EIN rule uses', async () => {
		const response = await saveDetails({ tax_id: '12-34' });

		expect((await refusal(response)).tax_id).toEqual([
			'Nine digits, written `12-3456789`. The dash is optional.'
		]);
	});

	it('refuses a page drawn before another save, and keeps what that save stored', async () => {
		const drawn = await drawnVersion();
		await run(stmt(`update org_profile set legal_name = 'Riverbank Trust Ltd', updated_at = 5`));

		const response = await saveDetails({}, drawn);

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual({ '': [STALE_SAVE] });
		expect((await storedProfile())?.legal_name).toBe('Riverbank Trust Ltd');
	});

	it('refuses a second press of a page already saved from, and keeps the first save’s details', async () => {
		const drawn = await drawnVersion();

		expect((await saveDetails({ legal_name: 'First Name Trust' }, drawn)).status).toBe(303);
		const second = await saveDetails({ legal_name: 'Second Name Trust' }, drawn);

		expect(second.status).toBe(409);
		expect(await refusal(second)).toEqual({ '': [STALE_SAVE] });
		expect((await storedProfile())?.legal_name).toBe('First Name Trust');
	});

	it('makes the profile on a deployment that has none', async () => {
		await run(stmt('delete from org_profile'));

		const response = await saveDetails({});

		expect(response.status).toBe(303);
		expect(await storedProfile()).toMatchObject({
			legal_name: 'Hope Foundation',
			notification_email: null
		});
	});

	it('answers a write the database refuses with the form’s own refusal rather than an error page', async () => {
		const version = await drawnVersion();
		await run(
			stmt(`create trigger refuse_profile before update on org_profile
			 begin select raise(abort, 'profile refused'); end`)
		);
		try {
			const response = await saveDetails({ tax_id: '12-3456789' }, version);

			expect(response.status).toBe(500);
			expect(await refusal(response)).toEqual({
				'': ['Saving this failed and nothing was changed. Try again.']
			});
		} finally {
			await run(stmt('drop trigger refuse_profile'));
		}
	});
});

type Drawn = {
	details: Record<string, string | string[]>;
	logo: { id: string; src: string } | null;
	banner: { id: string; src: string } | null;
	saved: string | null;
};

async function drawn(cookie: string = deployer): Promise<Drawn> {
	const response = await get(cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as Drawn;
}

describe('what the screen is drawn from', () => {
	it('seeds every box the details form states, an empty one as empty, and the links as typed', async () => {
		await run(
			stmt(
				`update org_profile set social_links = '[{"platform":"x","href":"https://x.com/riverbank"}]'`
			)
		);

		expect((await drawn()).details).toEqual({
			legal_name: 'Riverbank Trust',
			tax_id: '12-3456789',
			address_line1: '1 Main St',
			address_line2: '',
			city: 'Springfield',
			region: '',
			postal_code: '',
			country: 'US',
			mission: '',
			vision: '',
			brand_colour: '',
			social_links: ['https://x.com/riverbank']
		});
	});

	it('seeds empty boxes and no photos on a deployment with no profile', async () => {
		await run(stmt('delete from org_profile'));

		const read = await drawn();

		expect(read.details.legal_name).toBe('');
		expect(read.details.social_links).toEqual([]);
		expect(read.logo).toBeNull();
		expect(read.banner).toBeNull();
	});

	it('states the banner at the address it is served from, and none before one is put on', async () => {
		expect((await drawn()).banner).toBeNull();

		const id = await putBanner(db, { contentType: 'image/png', width: 1600, height: 400 });

		expect((await drawn()).banner).toEqual({ id, src: `/image/${id}` });
	});

	it('names the save that just landed, on the page it lands on', async () => {
		const saved = await saveDetails({});
		const cookie = `${deployer}; ${saved.headers.get('set-cookie')?.split(';', 1)[0]}`;

		const read = await drawn(cookie);

		expect(read.saved).toBe('details');
		expect(read.details.legal_name).toBe('Hope Foundation');
	});
});
