import { createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { INVITATION_LIFETIME_MS, inviteMember } from '$lib/server/auth';
import { createDb, type Db } from '$lib/server/db/client';
import { requestContext } from '../request-context';
import { action, loader } from './join';
import type { Route } from './+types/join';

// the page an invited colleague opens, against the real D1 the pool binds.
//
// a workers spec and not a node one: every case turns on an invitation row and on the account the
// redeem writes, and the redeem goes through better-auth's own drizzle adapter — a stand-in for
// either would only prove the stand-in (CLAUDE.md).
//
// **the handlers are called rather than mounted**, which is ./login.workers.spec.ts's departure
// from ../route-request.testing.ts and is right here for the same two reasons: no `middleware` sits
// above this route — that is what makes it reachable by somebody holding no session — and
// `queryRoute` drops the status off a `data()`, which is the whole of what a form rejection
// carries. ../routes.spec.ts is what holds the other half, that this file is on the public
// allow-list.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, which nothing here signs in with. */
const PASSWORD = 'a-very-long-random-staff-password';

/** what a colleague chooses, long enough for better-auth to accept it. */
const CHOSEN = 'a-colleagues-own-password';

const DEPLOYED = {
	...env,
	ADMIN_PASSWORD: PASSWORD
} as unknown as Env;

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_account').run();
	await env.DB.prepare('delete from auth_user').run();
	await env.DB.prepare('delete from org_profile').run();
});

/** the organisation's own row, which is the caption above the heading. */
async function saveOrg(legalName: string): Promise<void> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', ?, '12-3456789', 'alerts@example.org', 0, 0)`
	)
		.bind(legalName)
		.run();
}

/** a live invitation, minted the way /admin/members mints one. */
async function invitationFor(email: string, now = new Date()): Promise<string> {
	const invited = await inviteMember(db, { email, now, invitedBy: null });
	if (!invited.ok) throw new Error(`the fixture could not invite ${email}: ${invited.reason}`);
	return invited.token;
}

function args(request: Request): Route.LoaderArgs {
	return {
		request,
		url: new URL(request.url),
		params: {},
		pattern: '/join',
		context: requestContext(DEPLOYED, createExecutionContext())
	};
}

function visit(token: string | null) {
	const search = token === null ? '' : `?token=${encodeURIComponent(token)}`;
	return loader(args(new Request(`${ORIGIN}/join${search}`)));
}

function typed(name: string, password: string): FormData {
	const body = new FormData();
	body.set('name', name);
	body.set('password', password);
	return body;
}

function submit(token: string | null, body: FormData) {
	const search = token === null ? '' : `?token=${encodeURIComponent(token)}`;
	return action(
		args(
			new Request(`${ORIGIN}/join${search}`, {
				method: 'POST',
				headers: { origin: ORIGIN },
				body
			})
		)
	);
}

/** what the action answers with when it refuses: `invalid()`'s data, with the status on it. */
type Refused = Exclude<Awaited<ReturnType<typeof action>>, Response>;

async function refused(...call: Parameters<typeof submit>): Promise<Refused> {
	const answer = await submit(...call);
	if (answer instanceof Response)
		throw new Error(`the accept answered ${answer.status} instead of refusing`);
	return answer;
}

/** the sentence under one box. */
function underBox(answer: Refused, box: 'name' | 'password'): string[] | null | undefined {
	return answer.data.form.result.error?.[box];
}

describe('GET /join — the link a colleague was sent', () => {
	it('states the address the account is about to be made for', async () => {
		await saveOrg('Riverbank Trust');
		const token = await invitationFor('sam@riverbanktrust.org');

		expect(await visit(token)).toEqual({
			shape: 'accept',
			orgName: 'Riverbank Trust',
			email: 'sam@riverbanktrust.org'
		});
	});

	/**
	 * expired, already used, revoked and never minted are one answer, which is the invitations
	 * module's decision and is kept whole here: an answer that told them apart would tell somebody
	 * feeding tokens at this address which of theirs had ever been real.
	 */
	it('draws the blocker for a link that is expired, superseded, used or invented', async () => {
		await saveOrg('Riverbank Trust');
		const past = new Date(Date.now() - INVITATION_LIFETIME_MS - 1000);
		const expired = await invitationFor('expired@riverbanktrust.org', past);
		const superseded = await invitationFor('sam@riverbanktrust.org');
		await invitationFor('sam@riverbanktrust.org');

		for (const token of [expired, superseded, 'a'.repeat(64), null]) {
			expect(await visit(token)).toEqual({ shape: 'dead', orgName: 'Riverbank Trust' });
		}
	});

	/** and a deployment nobody has named yet still serves the page, with no caption over it. */
	it('renders without a name when the organisation’s row is not there', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');

		expect(await visit(token)).toEqual({
			shape: 'accept',
			orgName: null,
			email: 'sam@riverbanktrust.org'
		});
	});
});

describe('POST /join — setting a password', () => {
	it('creates the account and lands the colleague signed in on the dashboard', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');

		const answer = (await submit(token, typed('Sam Okonkwo', CHOSEN))) as Response;

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe('/admin');
		expect(answer.headers.getSetCookie().some((value) => value.includes('session'))).toBe(true);
	});

	/** the same link a second time, which is what a stale tab submits. */
	it('refuses a second use of the same link', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');
		await submit(token, typed('Sam Okonkwo', CHOSEN));

		const answer = (await submit(token, typed('Sam Okonkwo', 'another-long-password'))) as Response;

		// back to this page with the dead token off the address, where the loader draws the blocker:
		// what has to be reported is one thing, and the loader is the one place that decides it.
		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe('/join');
	});

	it('refuses a password shorter than this deployment will accept, under its own box', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');

		const answer = await refused(token, typed('Sam Okonkwo', 'short'));

		expect(answer.init?.status).toBe(400);
		expect(underBox(answer, 'password')?.at(0)).toContain('at least');
		expect(await accounts()).toBe(0);
	});

	it('refuses a blank name under its own box', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');

		const answer = await refused(token, typed('   ', CHOSEN));

		expect(answer.init?.status).toBe(400);
		expect(underBox(answer, 'name')).toEqual(['required']);
		expect(await accounts()).toBe(0);
	});

	/**
	 * the address on the invitation and never a box: the colleague is told which one they are
	 * signing up as and cannot change it, so a body that names another is a body that changes
	 * nothing.
	 */
	it('signs the colleague up as the address on the invitation, whatever the body says', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');
		const body = typed('Sam Okonkwo', CHOSEN);
		body.set('email', 'someone.else@example.org');

		const answer = (await submit(token, body)) as Response;

		expect(answer.status).toBe(303);
		const row = await env.DB.prepare('select email from auth_user').first<{ email: string }>();
		expect(row?.email).toBe('sam@riverbanktrust.org');
	});

	/**
	 * the one this page is careful about. every rejection sends the submitted values back so the
	 * boxes keep what was typed, and this one holds a credential the colleague just chose.
	 */
	it('never sends the password back, on any arm that fails', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');
		const tooLong = `${CHOSEN}${'x'.repeat(200)}`;

		const blank = await refused(token, typed('', CHOSEN));
		const overCap = await refused(token, typed('Sam Okonkwo', tooLong));

		expect(JSON.stringify(blank.data)).not.toContain(CHOSEN);
		expect(JSON.stringify(overCap.data)).not.toContain(CHOSEN);
	});

	/** and the token is never echoed either: it is a working credential right up until it is not. */
	it('never sends the token back', async () => {
		const token = await invitationFor('sam@riverbanktrust.org');

		const answer = await refused(token, typed('', CHOSEN));

		expect(JSON.stringify(answer.data)).not.toContain(token);
	});
});

/** how many credential accounts this deployment holds. */
async function accounts(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from auth_account').first<{ n: number }>();
	return row?.n ?? 0;
}
