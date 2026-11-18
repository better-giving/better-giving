import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.settings_.mail';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the Mail section's server half, against a real database, through the protected layout — who is
// signed in is what every answer here turns on, and the session gate is that layout's middleware
// (../route-request.testing.ts).

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/settings/mail';
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
		{ path: 'admin/settings/mail', module: screen }
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

function post(cookie: string, to: string, env: Env = deployed()): Promise<Response> {
	const body = new FormData();
	body.set('__form_id__', 'settings-test-email');
	body.set('to', to);
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env }
	);
}

/** the messages a rejection carries, keyed as conform keys them: `''` for the form's own. */
async function refusal(response: Response): Promise<Record<string, string[]>> {
	return ((await response.json()) as { form: { result: { error: Record<string, string[]> } } }).form
		.result.error;
}

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

describe('a member’s session', () => {
	it('gets not-found for the page, which the deployer is served', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(deployer)).status).toBe(200);
		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for the test send, before anything is sent', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		const response = await post(member, 'ops@hope.example', withoutMail());

		expect(response.status).toBe(404);
	});
});

type TestSent = { testSend?: { outcome: string; detail: string | null; to: string } };

describe('sending a test email', () => {
	const sendTest = (to: string) => post(deployer, to, withoutMail());

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
	notificationEmail: string | null;
	mail: { from: string; host: string; delivers: boolean } | null;
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

		// `smtp.example.org` is the placeholder `.env.example` ships, so the values are drawn
		// and nothing is delivered (`mailDelivers` in $lib/server/email/delivers.ts).
		expect(((await response.json()) as Drawn).mail).toEqual({
			from: 'giving@example.org',
			host: 'smtp.example.org',
			delivers: false
		});
		expect(text).not.toContain('mail-secret');
		expect(text).not.toContain('apikey');
	});

	it('states that mail delivers when the values are not the placeholders', async () => {
		const env = { ...deployed(), SMTP_HOST: 'mail.example.org' } as Env;

		expect((await drawn(env)).mail).toEqual({
			from: 'giving@example.org',
			host: 'mail.example.org',
			delivers: true
		});
	});

	it('states no mail where its values are not all set', async () => {
		expect((await drawn(withoutMail())).mail).toBeNull();
	});

	it('seeds the test send with the stored notification address', async () => {
		expect((await drawn()).notificationEmail).toBe('alerts@example.org');
	});
});
