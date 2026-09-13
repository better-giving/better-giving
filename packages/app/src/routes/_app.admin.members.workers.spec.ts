import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, inviteMember, redeemInvitation } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { STAFF_USER_ID } from '$lib/server/auth/staff-plugin';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as members from './_app.admin.members';

// the members screen's server half, against the real D1 the pool binds.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern and is load-bearing on this screen twice over: the session gate is a `middleware` on
// ./_app.tsx, and who is signed in is what this screen's every decision turns on — a loader called
// on its own would run with nothing on the router context to read.
//
// the deployment is set up in every case below, because the layout above this screen refuses to
// serve any child while a set-up job is outstanding (./_app.tsx). `smtp` decides what the mail
// variables hold, which is the one deploy-time value this screen's own action spends.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the address this screen answers on. */
const SCREEN = '/admin/members';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-very-long-random-staff-password';

/** what a colleague chooses when they accept, long enough for better-auth to accept it. */
const MEMBER_PASSWORD = 'a-colleagues-own-password';

/**
 * a deployment whose mail settings this Worker could dial.
 *
 * `smtp.example.org` is a hostname `parseSmtpEndpoint` accepts, so a send gets as far as opening a
 * socket — which is why no case below sends with it.
 */
const MAIL_CONFIGURED = {
	SMTP_HOST: 'smtp.example.org',
	SMTP_USERNAME: 'apikey',
	SMTP_PASSWORD: 'mail-secret',
	MAIL_FROM: 'giving@example.org'
};

/**
 * the same four set, and a host a Worker is not allowed to reach.
 *
 * it is what a send that fails looks like without a socket: `parseSmtpEndpoint` refuses a
 * private-network host before anything is dialled ($lib/server/email/smtp-config.ts), so the
 * refused arm below is reached in the same millisecond as every other case. the set-up gate above
 * this screen only asks whether the four are set, so this deployment still reads as finished.
 */
const MAIL_UNREACHABLE = { ...MAIL_CONFIGURED, SMTP_HOST: 'localhost' };

function deployed(mail: Record<string, string> = MAIL_CONFIGURED) {
	return {
		...env,
		ADMIN_PASSWORD: PASSWORD,
		STRIPE_SECRET_KEY: 'sk_test_x',
		STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
		...mail
	} as unknown as Env;
}

let db: Db;
let request: RouteRequester;
let staffSession: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/members', module: members }
	]);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_user').run();
	await env.DB.prepare('delete from org_profile').run();
	await finished();
	staffSession = await signInAsDeployer();
});

/**
 * the one row the five set-up jobs are read off, so this deployment reads as finished.
 *
 * the same shape ./login.workers.spec.ts states, and for the same reason: a screen that is only
 * served behind the gate has to be tested on a deployment somebody finished setting up.
 */
async function finished(): Promise<void> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
}

/** the deployer's session, as the `Cookie` header a browser would send back. */
async function signInAsDeployer(): Promise<string> {
	const auth = await authInstance();
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	return asCookieHeader(headers.getSetCookie());
}

/**
 * a colleague who accepted an invitation, and the session they hold.
 *
 * it goes through the real invite and the real redeem rather than writing the two rows, because
 * what the cases below turn on is the difference between that session and the deployer's — and a
 * hand-written `auth_user` row with no credential behind it is not the thing being told apart.
 */
async function signInAsMember(email: string): Promise<string> {
	const invited = await inviteMember(db, { email, now: new Date(), invitedBy: null });
	if (!invited.ok) throw new Error(`the fixture could not invite ${email}: ${invited.reason}`);

	const redeemed = await redeemInvitation(db, await authInstance(), {
		token: invited.token,
		name: 'Nadia Hart',
		password: MEMBER_PASSWORD,
		headers: new Headers({ origin: ORIGIN }),
		now: new Date()
	});
	if (!redeemed.ok) throw new Error(`the fixture could not redeem ${email}: ${redeemed.reason}`);
	return asCookieHeader([...redeemed.cookies]);
}

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

/** a live invitation for one address, minted the way the screen mints it. */
async function invitationFor(email: string): Promise<string> {
	const invited = await inviteMember(db, { email, now: new Date(), invitedBy: null });
	if (!invited.ok) throw new Error(`the fixture could not invite ${email}: ${invited.reason}`);
	return invited.token;
}

/** the loader's answer, as the screen's own data. */
async function visit(
	cookie: string,
	search = '',
	mail: Record<string, string> = MAIL_CONFIGURED
): Promise<{
	mayManage: boolean;
	members: { id: string; email: string; name: string | null; invited: boolean }[];
	sentTo: string | null;
	removing: { id: string; email: string; name: string | null; invited: boolean } | null;
}> {
	const response = await request(
		new Request(`${ORIGIN}${SCREEN}${search}`, { headers: { cookie } }),
		{
			env: deployed(mail)
		}
	);
	expect(response.status).toBe(200);
	return await response.json();
}

describe('GET /admin/members — who can sign in', () => {
	it('lists a colleague who accepted and an invitation still outstanding, by address', async () => {
		await signInAsMember('nadia@riverbanktrust.org');
		await invitationFor('sam@riverbanktrust.org');

		const screen = await visit(staffSession);

		expect(screen.members.map((m) => [m.email, m.name, m.invited])).toEqual([
			['nadia@riverbanktrust.org', 'Nadia Hart', false],
			['sam@riverbanktrust.org', null, true]
		]);
	});

	it('leaves the deployer off the list, which is the deployment rather than a member', async () => {
		const screen = await visit(staffSession);

		expect(screen.members).toEqual([]);
		expect(JSON.stringify(screen)).not.toContain(STAFF_USER_ID);
	});
});

describe('GET /admin/members — who may invite and remove', () => {
	it('is the deployer, who is offered both', async () => {
		const screen = await visit(staffSession);

		expect(screen.mayManage).toBe(true);
	});

	/**
	 * and a member sees the list and neither control. the decision is the route's own — a member is
	 * not offered the invite box and gets no remove column — and it is a screen-side reading of a
	 * refusal the action makes for itself.
	 */
	it('is not a member, who still sees the list', async () => {
		const memberSession = await signInAsMember('nadia@riverbanktrust.org');

		const screen = await visit(memberSession);

		expect(screen.mayManage).toBe(false);
		expect(screen.members.map((m) => m.email)).toEqual(['nadia@riverbanktrust.org']);
	});
});

describe('GET /admin/members — the row a removal is being confirmed for', () => {
	it('is the one the address names', async () => {
		await signInAsMember('nadia@riverbanktrust.org');
		const listed = await visit(staffSession);
		const row = listed.members[0];
		if (!row) throw new Error('the fixture listed no members');

		const screen = await visit(staffSession, `?confirm=${row.id}`);

		expect(screen.removing).toEqual(row);
	});

	it('is nothing for an id no row on this screen answers to', async () => {
		const screen = await visit(staffSession, '?confirm=0195-not-a-member');

		expect(screen.removing).toBeNull();
	});

	/** a member is never asked the question, because a member cannot press it. */
	it('is nothing for a member, whatever the address says', async () => {
		const memberSession = await signInAsMember('nadia@riverbanktrust.org');
		const listed = await visit(memberSession);
		const row = listed.members[0];
		if (!row) throw new Error('the fixture listed no members');

		const screen = await visit(memberSession, `?confirm=${row.id}`);

		expect(screen.removing).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// the two writes.

/** how many live invitations this deployment is holding, whatever address they are for. */
async function liveInvitations(): Promise<number> {
	const row = await env.DB.prepare(
		`select count(*) as n from auth_member_invitation
		 where accepted_at is null and revoked_at is null and expires_at > ?`
	)
		.bind(Date.now())
		.first<{ n: number }>();
	return row?.n ?? 0;
}

/** how many sessions this deployment is holding for one address. */
async function sessionsFor(email: string): Promise<number> {
	const row = await env.DB.prepare(
		`select count(*) as n from auth_session s
		 join auth_user u on u.id = s.user_id where u.email = ?`
	)
		.bind(email)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

function post(
	cookie: string,
	body: FormData,
	{ search = '', mail = MAIL_CONFIGURED }: { search?: string; mail?: Record<string, string> } = {}
): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${SCREEN}${search}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: deployed(mail) }
	);
}

function inviteBody(email: string): FormData {
	const body = new FormData();
	body.set('__form_id__', 'members-invite');
	body.set('email', email);
	return body;
}

function removeBody(id: string): FormData {
	const body = new FormData();
	body.set('__form_id__', 'members-remove');
	body.set('member_id', id);
	return body;
}

/** the form-level sentence a refusal carries, which is what a banner would render. */
async function formRefusal(response: Response): Promise<string | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error?.['']?.[0];
}

/** the sentence under the address box, off a rejection the screen would render. */
async function underTheBox(response: Response): Promise<string[] | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error?.email;
}

describe('POST /admin/members — inviting a colleague', () => {
	/**
	 * the whole of the send path, up to the message itself: the row is written, and the mail is
	 * handed to whatever transport this deployment is configured for. what cannot be asserted here
	 * is the message that went out — a route builds its provider from `platform.env` and there is
	 * no seam to hand it a recorder — so this case stops at the row, and ./join.workers.spec.ts is
	 * where a minted token is carried through the link to a session.
	 */
	it('writes the invitation before the message goes, and leaves it when the message does not', async () => {
		const answer = await post(staffSession, inviteBody('sam@riverbanktrust.org'), {
			mail: MAIL_UNREACHABLE
		});

		expect(answer.status).toBe(500);
		expect(await underTheBox(answer)).toEqual([expect.stringContaining('better-giving start')]);
		// the row survives the failure, which is what makes pressing again the whole repair.
		expect(await liveInvitations()).toBe(1);
	});

	it('refuses an address that can already sign in, under the box', async () => {
		await signInAsMember('nadia@riverbanktrust.org');

		const answer = await post(staffSession, inviteBody('nadia@riverbanktrust.org'));

		expect(answer.status).toBe(400);
		expect(await underTheBox(answer)).toEqual(['This address can already sign in here.']);
		expect(await liveInvitations()).toBe(0);
	});

	it('refuses a value that is not an address, under the same box', async () => {
		const answer = await post(staffSession, inviteBody('not-an-address'));

		expect(answer.status).toBe(400);
		expect(await underTheBox(answer)).toEqual([
			'This is not an email address an invitation could be sent to.'
		]);
		expect(await liveInvitations()).toBe(0);
	});

	it('refuses a blank box with the sentence an empty body gets', async () => {
		const blank = await post(staffSession, inviteBody(''));
		const empty = await post(
			staffSession,
			(() => {
				const body = new FormData();
				body.set('__form_id__', 'members-invite');
				return body;
			})()
		);

		expect(await underTheBox(blank)).toEqual(['required']);
		expect(await underTheBox(empty)).toEqual(['required']);
		expect(await liveInvitations()).toBe(0);
	});

	/** one address, one spelling — the row, the mail and the press's marker all take the stored one. */
	it('takes the address as it is stored, whatever case it was typed in', async () => {
		await post(staffSession, inviteBody('  SAM@Riverbanktrust.ORG  '), { mail: MAIL_UNREACHABLE });

		const screen = await visit(staffSession);

		expect(screen.members.map((m) => m.email)).toEqual(['sam@riverbanktrust.org']);
	});
});

describe('POST /admin/members — removing a colleague', () => {
	it('ends every session the colleague was holding', async () => {
		await signInAsMember('nadia@riverbanktrust.org');
		const listed = await visit(staffSession);
		const row = listed.members[0];
		if (!row) throw new Error('the fixture listed no members');
		expect(await sessionsFor('nadia@riverbanktrust.org')).toBe(1);

		const answer = await post(staffSession, removeBody(row.id), { search: `?confirm=${row.id}` });

		expect(answer.status).toBe(303);
		// back to the list without the question on the address, so the card closes on what it changed.
		expect(answer.headers.get('location')).toBe(SCREEN);
		expect(await sessionsFor('nadia@riverbanktrust.org')).toBe(0);
	});

	it('stops the link in an invitation nobody has accepted', async () => {
		await invitationFor('sam@riverbanktrust.org');
		const listed = await visit(staffSession);
		const row = listed.members[0];
		if (!row) throw new Error('the fixture listed no invitations');

		const answer = await post(staffSession, removeBody(row.id));

		expect(answer.status).toBe(303);
		expect(await liveInvitations()).toBe(0);
	});

	/** a second press of the same button, which is the ordinary way to name a row that has gone. */
	it('answers a row that is already gone the way it answers one it removed', async () => {
		const answer = await post(staffSession, removeBody('0195-nobody'));

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe(SCREEN);
	});

	/** the deployer is the deployment, and the id is refused by name rather than by the list. */
	it('refuses the deployer’s own row, which the list never showed', async () => {
		const answer = await post(staffSession, removeBody(STAFF_USER_ID));

		expect(answer.status).toBe(400);
		expect(await formRefusal(answer)).toContain('cannot be removed');
	});
});

describe('POST /admin/members — a press that is not the deployer’s', () => {
	it('is refused before the body is read, whichever form it names', async () => {
		const memberSession = await signInAsMember('nadia@riverbanktrust.org');
		const listed = await visit(staffSession);
		const row = listed.members[0];
		if (!row) throw new Error('the fixture listed no members');

		const invited = await post(memberSession, inviteBody('sam@riverbanktrust.org'));
		const removed = await post(memberSession, removeBody(row.id));

		expect(invited.status).toBe(403);
		expect(removed.status).toBe(403);
		expect(await formRefusal(invited)).toContain('ADMIN_PASSWORD');
		// and neither press did anything.
		expect(await liveInvitations()).toBe(0);
		expect(await sessionsFor('nadia@riverbanktrust.org')).toBe(1);
	});
});
