import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, inviteMember, redeemInvitation } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { API_KEY_SHAPE, mintApiKey } from '$lib/server/integrations/keys';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as screen from './_app.admin.integrations.api';
import * as surface from './integrations.v1';
import * as gifts from './integrations.v1.gifts';

// the API page's server half, against the real D1 the pool binds, through the protected layout —
// who is signed in is what every answer here turns on, and the session gate is that layout's
// middleware (../route-request.testing.ts).
//
// a key made here is carried to the read API it exists for, so "it reads gifts" and "a revoked
// key is refused at once" are asserted against the surface itself rather than against a column.

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/integrations/api';
const PASSWORD = 'a-very-long-random-staff-password';
const MEMBER_PASSWORD = 'a-colleagues-own-password';

function deployed() {
	return {
		...env,
		ADMIN_PASSWORD: PASSWORD,
		STRIPE_SECRET_KEY: 'sk_test_x',
		STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
		SMTP_HOST: 'smtp.example.org',
		SMTP_USERNAME: 'apikey',
		SMTP_PASSWORD: 'mail-secret',
		MAIL_FROM: 'giving@example.org'
	} as unknown as Env;
}

let db: Db;
let request: RouteRequester;
let frame: RouteRequester;
let readGifts: RouteRequester;
let deployer: string;

/** the read API's layout charges each address, so each case reads from one of its own. */
let caller = 0;

beforeAll(() => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/integrations/api', module: screen }
	]);
	// the layout answering on its own, for what it hands the rail.
	frame = mountRoutes([{ path: 'admin', module: layout }]);
	readGifts = mountRoutes([
		{ path: 'integrations/v1', module: surface },
		{ path: 'gifts', module: gifts }
	]);
});

beforeEach(async () => {
	for (const table of [
		'api_key',
		'auth_member_invitation',
		'auth_session',
		'auth_user',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	// the one row the five set-up jobs are read off, so the layout serves its children.
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
	deployer = await signInAsDeployer();
	caller += 1;
});

async function authInstance() {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	return createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
}

function asCookieHeader(setCookies: readonly string[]): string {
	const cookies = setCookies.map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

async function signInAsDeployer(): Promise<string> {
	const { headers } = await (await authInstance()).api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	return asCookieHeader(headers.getSetCookie());
}

/** a colleague who accepted an invitation, through the real invite and redeem. */
async function signInAsMember(): Promise<string> {
	const invited = await inviteMember(db, {
		email: 'nadia@riverbanktrust.org',
		now: new Date(),
		invitedBy: null
	});
	if (!invited.ok) throw new Error(`the fixture could not invite: ${invited.reason}`);
	const redeemed = await redeemInvitation(db, await authInstance(), {
		token: invited.token,
		name: 'Nadia Hart',
		password: MEMBER_PASSWORD,
		headers: new Headers({ origin: ORIGIN }),
		now: new Date()
	});
	if (!redeemed.ok) throw new Error(`the fixture could not redeem: ${redeemed.reason}`);
	return asCookieHeader([...redeemed.cookies]);
}

type ListedKey = {
	id: string;
	name: string;
	madeAt: string;
	madeOn: string;
	lastUsedAt: string | null;
	lastUsedOn: string;
};

type Screen = { keys: ListedKey[]; revoking: ListedKey | null };

function get(cookie: string, search = ''): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}${search}`, { headers: { cookie } }), {
		env: deployed()
	});
}

async function visit(cookie: string, search = ''): Promise<Screen> {
	const response = await get(cookie, search);
	expect(response.status).toBe(200);
	return (await response.json()) as Screen;
}

function post(cookie: string, body: FormData): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: deployed() }
	);
}

function makeBody(name: string): FormData {
	const body = new FormData();
	body.set('__form_id__', 'api-key-make');
	body.set('name', name);
	return body;
}

function revokeBody(id: string): FormData {
	const body = new FormData();
	body.set('__form_id__', 'api-key-revoke');
	body.set('key_id', id);
	return body;
}

/** the read the key exists for, as an organisation's own system makes it. */
function giftsWith(key: string): Promise<Response> {
	return readGifts(
		new Request(`${ORIGIN}/integrations/v1/gifts`, {
			headers: { authorization: `Bearer ${key}`, 'cf-connecting-ip': `198.51.100.${caller}` }
		}),
		{ env: deployed() }
	);
}

async function underTheBox(response: Response): Promise<string[] | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error?.name;
}

async function keyRows(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from api_key').first<{ n: number }>();
	return row?.n ?? 0;
}

describe('GET /admin/integrations/api — the keys', () => {
	it('lists every key the organisation made, newest first, and never Zapier’s', async () => {
		const older = await mintApiKey(db, { name: 'Reporting sheet', kind: 'api' });
		await mintApiKey(db, { name: 'Zapier', kind: 'zapier' });
		const newer = await mintApiKey(db, { name: 'Donor wall', kind: 'api' });
		await env.DB.prepare('update api_key set created_at = ? where id = ?')
			.bind(Date.UTC(2026, 8, 2, 23, 30), older.id)
			.run();

		const { keys } = await visit(deployer);

		expect(keys.map((key) => key.id)).toEqual([newer.id, older.id]);
		expect(keys[1]).toMatchObject({ name: 'Reporting sheet', madeOn: '2 Sep 2026' });
	});

	it('says when each key was last used, and Never for one nothing has presented', async () => {
		const used = await mintApiKey(db, { name: 'Reporting sheet', kind: 'api' });
		await mintApiKey(db, { name: 'Donor wall', kind: 'api' });
		await env.DB.prepare('update api_key set last_used_at = ? where id = ?')
			.bind(Date.UTC(2026, 8, 27, 9), used.id)
			.run();

		const { keys } = await visit(deployer);

		expect(Object.fromEntries(keys.map((key) => [key.name, key.lastUsedOn]))).toEqual({
			'Reporting sheet': '27 Sep 2026',
			'Donor wall': 'Never'
		});
	});

	it('never holds the key, nor anything the key could be rebuilt from', async () => {
		const minted = await mintApiKey(db, { name: 'Reporting sheet', kind: 'api' });

		const served = await (await get(deployer)).text();

		expect(served).not.toContain(minted.key.slice(4, 12));
		expect(served).not.toContain(minted.key.slice(-4));
	});

	it('names the key a revoke is being confirmed for, and nothing for an id no row answers to', async () => {
		const minted = await mintApiKey(db, { name: 'Reporting sheet', kind: 'api' });

		expect((await visit(deployer, `?confirm=${minted.id}`)).revoking).toMatchObject({
			id: minted.id,
			name: 'Reporting sheet'
		});
		expect((await visit(deployer, '?confirm=0195-no-such-key')).revoking).toBeNull();
	});
});

describe('POST /admin/integrations/api — making a key', () => {
	it('answers with the key once, and the key reads gifts', async () => {
		const answer = await post(deployer, makeBody('  Reporting sheet  '));

		expect(answer.status).toBe(200);
		const { made } = (await answer.json()) as { made: { name: string; key: string } };
		expect(made.name).toBe('Reporting sheet');
		expect(made.key).toMatch(API_KEY_SHAPE);

		expect((await giftsWith(made.key)).status).toBe(200);
	});

	it('lists the key it made on the next read, by name and never by the key', async () => {
		const answer = await post(deployer, makeBody('Reporting sheet'));
		const { made } = (await answer.json()) as { made: { key: string } };

		const response = await get(deployer);
		const served = await response.clone().text();
		const { keys } = (await response.json()) as Screen;

		expect(keys.map((key) => [key.name, key.lastUsedOn])).toEqual([['Reporting sheet', 'Never']]);
		expect(served).not.toContain(made.key.slice(4));
	});

	it('refuses a blank name under the box, whitespace included, and makes nothing', async () => {
		const blank = await post(deployer, makeBody(''));
		const spaces = await post(deployer, makeBody('   '));

		expect(blank.status).toBe(400);
		expect(await underTheBox(blank)).toEqual(['required']);
		expect(await underTheBox(spaces)).toEqual(['required']);
		expect(await keyRows()).toBe(0);
	});

	it('refuses a name past the bound under the box', async () => {
		const answer = await post(deployer, makeBody('x'.repeat(201)));

		expect(answer.status).toBe(400);
		expect(await underTheBox(answer)).toEqual(['must be at most 200 characters']);
		expect(await keyRows()).toBe(0);
	});
});

describe('POST /admin/integrations/api — revoking a key', () => {
	it('refuses the key at the read API at once and takes it off the list', async () => {
		const minted = await mintApiKey(db, { name: 'Reporting sheet', kind: 'api' });
		expect((await giftsWith(minted.key)).status).toBe(200);

		const answer = await post(deployer, revokeBody(minted.id));

		expect(answer.status).toBe(303);
		// back to the list without the question on the address, so the card closes on what it changed.
		expect(answer.headers.get('location')).toBe(SCREEN);
		expect((await giftsWith(minted.key)).status).toBe(401);
		expect((await visit(deployer)).keys).toEqual([]);
	});

	it('answers a key already gone the way it answers one it revoked', async () => {
		const answer = await post(deployer, revokeBody('0195-no-such-key'));

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe(SCREEN);
	});

	it('leaves Zapier’s key working, which no row on this page names', async () => {
		const zapier = await mintApiKey(db, { name: 'Zapier', kind: 'zapier' });

		await post(deployer, revokeBody(zapier.id));

		const row = await env.DB.prepare('select revoked_at from api_key where id = ?')
			.bind(zapier.id)
			.first<{ revoked_at: number | null }>();
		expect(row?.revoked_at).toBeNull();
	});
});

describe('a member’s session', () => {
	it('is drawn no Integrations group, which the deployer is', async () => {
		const member = await signInAsMember();
		const read = async (cookie: string) =>
			(await (
				await frame(new Request(`${ORIGIN}/admin`, { headers: { cookie } }), { env: deployed() })
			).json()) as { deployer: boolean };

		expect((await read(deployer)).deployer).toBe(true);
		expect((await read(member)).deployer).toBe(false);
	});

	it('gets not-found for the page', async () => {
		const member = await signInAsMember();

		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for each press, and neither press does anything', async () => {
		const member = await signInAsMember();
		const minted = await mintApiKey(db, { name: 'Reporting sheet', kind: 'api' });

		expect((await post(member, makeBody('Warehouse'))).status).toBe(404);
		expect((await post(member, revokeBody(minted.id))).status).toBe(404);

		expect(await keyRows()).toBe(1);
		expect((await giftsWith(minted.key)).status).toBe(200);
	});
});
