import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.settings';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the Settings screen's server half, against a real database, through the protected layout — who
// is signed in is what every answer here turns on, and the session gate is that layout's middleware
// (../route-request.testing.ts).

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/settings';
const PASSWORD = 'a-very-long-random-staff-password';

/** a set-up deployment, its mail values included. */
const deployed = () => deployedBindings(PASSWORD);

const DEPLOYMENT = { env: deployed(), password: PASSWORD, origin: ORIGIN };

let db: Db;
let request: RouteRequester;
let deployer: string;

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
	deployer = await signInAsDeployer(db, DEPLOYMENT);
});

function get(cookie: string, env: Env = deployed()): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), { env });
}

function post(cookie: string, body: FormData, env: Env = deployed()): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env }
	);
}

/** a body naming one of this screen's forms, with its boxes. */
function bodyOf(form: string, boxes: Record<string, string | readonly string[]>): FormData {
	const body = new FormData();
	body.set('__form_id__', form);
	for (const [name, value] of Object.entries(boxes)) {
		if (typeof value === 'string') body.set(name, value);
		else for (const each of value) body.append(name, each);
	}
	return body;
}

describe('a member’s session', () => {
	it('gets not-found for the page, which the deployer is served', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(deployer)).status).toBe(200);
		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for each press, and no press changes the profile', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		const saved = await post(
			member,
			bodyOf('settings-notifications', { notification_email: 'nadia@riverbanktrust.org' })
		);

		expect(saved.status).toBe(404);
		const row = await first<{ notification_email: string }>(
			stmt('select notification_email from org_profile')
		);
		expect(row?.notification_email).toBe('alerts@example.org');
	});
});

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
async function drawnVersion(cookie: string = deployer): Promise<string> {
	const read = (await (await get(cookie)).json()) as { version: number };
	return String(read.version);
}

describe('saving the notification address', () => {
	it('stores the address and leaves the rest of the profile as it was', async () => {
		await run(
			stmt(`update org_profile set mission = 'Clean water.', brand_colour = '#1f6feb',
			 social_links = '[{"platform":"x","href":"https://x.com/riverbank"}]'`)
		);
		const before = await storedProfile();

		const response = await post(
			deployer,
			bodyOf('settings-notifications', {
				notification_email: '  ops@riverbanktrust.org ',
				__version__: await drawnVersion()
			})
		);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(SCREEN);
		expect(await storedProfile()).toEqual({
			...before,
			notification_email: 'ops@riverbanktrust.org'
		});
	});

	it('clears the address when the box is emptied', async () => {
		await post(
			deployer,
			bodyOf('settings-notifications', {
				notification_email: '',
				__version__: await drawnVersion()
			})
		);

		expect((await storedProfile())?.notification_email).toBeNull();
	});

	it('refuses a value that is not an address, under the box, and keeps the one stored', async () => {
		const response = await post(
			deployer,
			bodyOf('settings-notifications', {
				notification_email: 'Riverbank Trust',
				__version__: await drawnVersion()
			})
		);

		expect(response.status).toBe(400);
		expect(await refusal(response)).toEqual({ notification_email: ['Not an email address.'] });
		expect((await storedProfile())?.notification_email).toBe('alerts@example.org');
	});

	it('refuses a page drawn before another save, and keeps what that save stored', async () => {
		const drawn = await drawnVersion();
		await run(
			stmt(`update org_profile set notification_email = 'new@example.org', updated_at = 5`)
		);

		const response = await post(
			deployer,
			bodyOf('settings-notifications', {
				notification_email: 'old@example.org',
				__version__: drawn
			})
		);

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual({
			'': [
				'The organisation’s details changed since this page was opened. Reload it and save again.'
			]
		});
		expect((await storedProfile())?.notification_email).toBe('new@example.org');
	});

	it('asks for the organisation’s details first where none are saved', async () => {
		await run(stmt('delete from org_profile'));

		const response = await post(
			deployer,
			bodyOf('settings-notifications', {
				notification_email: 'ops@riverbanktrust.org',
				__version__: await drawnVersion()
			})
		);

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual({
			'': ['Save the organisation details first, then the notification address.']
		});
	});
});

/** the messages a rejection carries, keyed as conform keys them: `''` for the form's own. */
async function refusal(response: Response): Promise<Record<string, string[]>> {
	return ((await response.json()) as { form: { result: { error: Record<string, string[]> } } }).form
		.result.error;
}

describe('saving the organisation’s details', () => {
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
		return post(
			deployer,
			bodyOf('settings-details', {
				...DETAILS,
				...boxes,
				__version__: version ?? (await drawnVersion())
			})
		);
	}

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
		expect(await refusal(response)).toEqual({
			'': [
				'The organisation’s details changed since this page was opened. Reload it and save again.'
			]
		});
		expect((await storedProfile())?.legal_name).toBe('Riverbank Trust Ltd');
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
});

describe('a save the database refuses', () => {
	/** runs `send` with every write to the profile refused by the database itself. */
	async function refusingTheProfile(send: () => Promise<Response>): Promise<Response> {
		await run(
			stmt(`create trigger refuse_profile before update on org_profile
			 begin select raise(abort, 'profile refused'); end`)
		);
		try {
			return await send();
		} finally {
			await run(stmt('drop trigger refuse_profile'));
		}
	}

	const WRITE_FAILED = 'Saving this failed and nothing was changed. Try again.';

	it.each([
		{
			form: 'settings-notifications',
			boxes: { notification_email: 'ops@riverbanktrust.org' }
		},
		{
			form: 'settings-details',
			boxes: {
				legal_name: 'Hope Foundation',
				tax_id: '12-3456789',
				address_line1: '1 Main St',
				address_line2: '',
				city: 'Springfield',
				region: '',
				postal_code: '',
				country: 'US',
				mission: '',
				vision: '',
				brand_colour: ''
			}
		}
	])(
		'answers $form with the form’s own refusal rather than an error page',
		async ({ form, boxes }) => {
			const version = await drawnVersion();

			const response = await refusingTheProfile(() =>
				post(deployer, bodyOf(form, { ...boxes, __version__: version }))
			);

			expect(response.status).toBe(500);
			expect(await refusal(response)).toEqual({ '': [WRITE_FAILED] });
		}
	);
});

/** the deployment with no mail values at all, which every send case runs on: a send reaches no host. */
function withoutMail(): Env {
	const {
		SMTP_HOST: _host,
		SMTP_USERNAME: _username,
		SMTP_PASSWORD: _password,
		MAIL_FROM: _from,
		...rest
	} = deployed() as unknown as Record<string, unknown>;
	return rest as unknown as Env;
}

type TestSent = { testSend?: { outcome: string; detail: string | null; to: string } };

describe('sending a test email', () => {
	function sendTest(to: string): Promise<Response> {
		return post(deployer, bodyOf('settings-test-email', { to }), withoutMail());
	}

	it('names the values to set when this deployment cannot send, and where it would have gone', async () => {
		const response = await sendTest('ops@hope.example');

		expect(response.status).toBe(500);
		const answer = (await response.clone().json()) as TestSent;
		expect(answer.testSend).toMatchObject({ outcome: 'failed', to: 'ops@hope.example' });
		expect((await refusal(response))['']?.join(' ')).toContain('SMTP_HOST');
	});

	it('sends where the press said, not where the organisation row points', async () => {
		const answer = (await (await sendTest('someone.else@hope.example')).json()) as TestSent;

		expect(answer.testSend?.to).toBe('someone.else@hope.example');
	});

	it('takes an address with space around it', async () => {
		const answer = (await (await sendTest('  ops@hope.example \n')).json()) as TestSent;

		expect(answer.testSend?.to).toBe('ops@hope.example');
	});

	it.each([
		{ what: 'a value that is not an address', to: 'Hope Foundation' },
		{ what: 'an empty one', to: '   ' },
		{ what: 'a second address beside the first', to: 'a@hope.example b@hope.example' },
		{ what: 'one longer than an address may be', to: `${'a'.repeat(320)}@hope.example` }
	])('refuses $what under the box, and sends nothing', async ({ to }) => {
		const response = await sendTest(to);

		expect(response.status).toBe(400);
		const answer = (await response.clone().json()) as TestSent;
		expect(answer.testSend).toBeUndefined();
		expect((await refusal(response)).to).toEqual([
			'That is not an address this deployment can send to. Nothing was sent.'
		]);
	});
});

type Drawn = {
	details: Record<string, string | string[]>;
	logo: { id: string; src: string } | null;
	notificationEmail: string | null;
	mail: { from: string; host: string } | null;
	saved: string | null;
};

async function drawn(env: Env = deployed()): Promise<Drawn> {
	const response = await get(deployer, env);
	expect(response.status).toBe(200);
	return (await response.json()) as Drawn;
}

describe('what the screen is drawn from', () => {
	it('states the sender and the host where mail is set up, and no credential', async () => {
		const response = await get(deployer);
		const text = await response.clone().text();

		expect(((await response.json()) as Drawn).mail).toEqual({
			from: 'giving@example.org',
			host: 'smtp.example.org'
		});
		expect(text).not.toContain('mail-secret');
		expect(text).not.toContain('apikey');
	});

	it('states no mail where its values are not all set', async () => {
		expect((await drawn(withoutMail())).mail).toBeNull();
	});

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

	it('seeds empty boxes and no address on a deployment with no profile', async () => {
		await run(stmt('delete from org_profile'));

		const read = await drawn();

		expect(read.details.legal_name).toBe('');
		expect(read.details.social_links).toEqual([]);
		expect(read.notificationEmail).toBeNull();
		expect(read.logo).toBeNull();
	});

	it('names the save that just landed, on the page it lands on', async () => {
		const saved = await post(
			deployer,
			bodyOf('settings-notifications', {
				notification_email: 'ops@riverbanktrust.org',
				__version__: await drawnVersion()
			})
		);
		const cookie = `${deployer}; ${saved.headers.get('set-cookie')?.split(';', 1)[0]}`;

		const read = (await (await get(cookie)).json()) as Drawn;

		expect(read.saved).toBe('notifications');
		expect(read.notificationEmail).toBe('ops@riverbanktrust.org');
	});
});
