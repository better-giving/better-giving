import { ADMIN_USERNAME } from '@better-giving/operator/admin-password';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInRateLimitMessage } from '$lib/server/api/rate-limit';
import { createAuth, inviteMember, redeemInvitation } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { STAFF_USER_EMAIL } from '$lib/server/auth/staff-plugin';
import { createDb } from '$lib/server/db/client';
import { requestContext } from '../request-context';
import { action, loader } from './forgot';
import { action as signIn } from './login';
import type { Route } from './+types/forgot';
import type { Route as LoginRoute } from './+types/login';

// the screen a member who cannot sign in asks for a link from, against the real D1 the pool binds.
//
// a workers spec and not a node one, for ./login.workers.spec.ts's reason: this route is outside
// every layout there is, so it resolves its own signing key and builds its own auth instance, and
// both are D1 reads. the token the link carries is a row better-auth writes through the drizzle
// adapter, and a stand-in for it would only prove the stand-in (CLAUDE.md).
//
// the handlers are called rather than mounted, also for that file's reason: no `middleware` sits
// above this route, and `queryRoute` drops the status a form rejection carries.
//
// **the mailer is the one thing stubbed, and it is what this route uniquely owns.** the link is
// composed here and nowhere else — `$lib/server/auth/members.ts` hands over an address and a token
// and reads no origin — so the assertion worth having is the address in the message. the fixtures
// around it are ./login.workers.spec.ts's and ./_app.admin.members.workers.spec.ts's, copied rather
// than imported: a spec that imported another spec's helpers would make one file's clean-up decide
// another file's isolation.

/** what the route handed the mailer, in order. */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string; text: string }[]);

vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: { to: string; subject: string; html: string; text: string }) {
			sent.push(message);
			return { ok: true as const };
		}
	})
}));

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** what an empty box and a box the request did not carry are both told, quoted rather than imported. */
const MISSING = 'required';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-very-long-random-staff-password';

/** what a colleague chooses when they accept, long enough for better-auth to accept it. */
const MEMBER_PASSWORD = 'a-colleagues-own-password';

/**
 * the deploy-time env every request here carries: the staff credential, and the values the five
 * set-up jobs are read off ($lib/server/config/setup-state.ts).
 *
 * the mail variables are set because this screen's whole job is to send a message, and the stub
 * above is what stands in for the socket.
 */
const DEPLOYED = {
	...env,
	ADMIN_PASSWORD: PASSWORD,
	STRIPE_SECRET_KEY: 'sk_test_x',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
	SMTP_HOST: 'smtp.example.org',
	SMTP_USERNAME: 'apikey',
	SMTP_PASSWORD: 'mail-secret',
	MAIL_FROM: 'giving@example.org'
};

/** the execution context the last call was made with, so the deferred send can be waited on. */
let running: ExecutionContext;

/** what react router hands a handler, built the way src/worker.ts builds it for a real request. */
function args(request: Request, deployed: typeof DEPLOYED = DEPLOYED): Route.LoaderArgs {
	running = createExecutionContext();
	return {
		request,
		url: new URL(request.url),
		params: {},
		pattern: '/forgot',
		context: requestContext(deployed, running)
	};
}

/** the organisation's own row, so this deployment can say whose sign-in page this is. */
async function saveOrg(legalName = 'Acme Foundation'): Promise<void> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', ?, '12-3456789', 'alerts@example.org', 0, 0)`
	)
		.bind(legalName)
		.run();
}

/** a colleague who accepted an invitation, made the way /join makes one. */
async function makeMember(email: string): Promise<void> {
	const db = createDb(env.DB);
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);

	const invited = await inviteMember(db, { email, now: new Date(), invitedBy: null });
	if (!invited.ok) throw new Error(`the fixture could not invite ${email}: ${invited.reason}`);
	const redeemed = await redeemInvitation(db, auth, {
		token: invited.token,
		name: 'Nadia Hart',
		password: MEMBER_PASSWORD,
		headers: new Headers({ origin: ORIGIN }),
		now: new Date()
	});
	if (!redeemed.ok) throw new Error(`the fixture could not redeem ${email}: ${redeemed.reason}`);
	await env.DB.prepare('delete from auth_session').run();
}

beforeEach(async () => {
	await env.DB.prepare('delete from auth_verification').run();
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_account').run();
	await env.DB.prepare('delete from auth_user').run();
	await env.DB.prepare('delete from org_profile').run();
	sent.length = 0;
});

describe('GET /forgot', () => {
	it('names the organisation this deployment was set up as', async () => {
		await saveOrg('Riverbank Trust');

		expect(await loader(args(new Request(`${ORIGIN}/forgot`)))).toEqual({
			orgName: 'Riverbank Trust'
		});
	});

	/**
	 * the deployment whose database is not answering, which this page has to keep working on for
	 * ./login.tsx's reason: a name that could not be read costs the name and nothing else.
	 */
	it('renders without a name when the organisation’s row cannot be read', async () => {
		const unreachable = { ...DEPLOYED, DB: undefined } as unknown as typeof DEPLOYED;

		expect(await loader(args(new Request(`${ORIGIN}/forgot`), unreachable))).toEqual({
			orgName: null
		});
	});
});

// ---------------------------------------------------------------------------
// the write, which is served to a caller with no session and mails whoever is named.

/** what the action answers with when it refuses: `invalid()`'s data, with the status on it. */
type Refused = Exclude<Awaited<ReturnType<typeof action>>, { sent: true }>;

function typed(email: string): FormData {
	const body = new FormData();
	body.set('email', email);
	return body;
}

async function post(
	body: FormData,
	{ ip, deployed = DEPLOYED }: { ip?: string; deployed?: typeof DEPLOYED } = {}
) {
	const headers = new Headers({ origin: ORIGIN });
	if (ip) headers.set('cf-connecting-ip', ip);
	const answer = await action(
		args(new Request(`${ORIGIN}/forgot`, { method: 'POST', headers, body }), deployed)
	);
	// the send is handed to `waitUntil` rather than awaited, so the message only exists once the
	// isolate has finished the work the request left behind.
	await waitOnExecutionContext(running);
	return answer;
}

/** the refusal, or a loud failure rather than a case that silently asserted nothing. */
async function refused(...call: Parameters<typeof post>): Promise<Refused> {
	const answer = await post(...call);
	// `invalid()` answers a `data()`, so the rejection is under `.data` rather than on the value
	// itself — the accepted arm is the bare `{ sent: true }`.
	if (!('data' in answer)) throw new Error('the request was accepted instead of refused');
	return answer;
}

/** the form-level sentence a refusal carries, which is what the banner renders. */
function banner(answer: Refused): string | undefined {
	return answer.data.form.result.error?.['']?.[0];
}

describe('POST /forgot', () => {
	it('mails a member the link that sets a new password', async () => {
		await saveOrg('Riverbank Trust');
		await makeMember('nadia@riverbanktrust.org');

		const answer = await post(typed('nadia@riverbanktrust.org'));

		expect(answer).toEqual({ sent: true });
		expect(sent.map((message) => message.to)).toEqual(['nadia@riverbanktrust.org']);
		// the link is composed by this route and nowhere else, so the address in the message is the
		// one thing here no other module could have got right.
		expect(sent[0]?.text).toContain(`${ORIGIN}/reset?token=`);
	});

	/**
	 * an address nobody here has is answered exactly as a member's is, which is
	 * `requestPasswordReset`'s decision — telling them apart would turn this form into a way to ask
	 * whether a given person works here.
	 */
	it('answers an address this deployment has never seen the same way, and mails nobody', async () => {
		await saveOrg();

		const answer = await post(typed('stranger@example.org'));

		expect(answer).toEqual({ sent: true });
		expect(sent).toEqual([]);
	});

	/**
	 * the deployer's identifier gets the same sentence and no mail. their password is a deploy-time
	 * secret with no `auth_account` row behind it, and a token minted against that fixed row would
	 * hand it a hash this deployment never stores ($lib/server/auth/credential.ts).
	 */
	it('answers the deployer’s own identifier the same way, and mails nobody', async () => {
		await saveOrg();

		const answer = await post(typed(STAFF_USER_EMAIL));

		expect(answer).toEqual({ sent: true });
		expect(sent).toEqual([]);
	});

	it('refuses an empty box under the box, and mails nobody', async () => {
		await saveOrg();

		const answer = await refused(typed('   '));

		expect(answer.init?.status).toBe(400);
		expect(answer.data.form.result.error?.email?.[0]).toBe(MISSING);
		expect(sent).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// the bound on the write. the pool binds the real `SIGN_IN_RATE_LIMITER`, so what is under test is
// the charge as it deploys rather than a description of it.

/** asks for a link until the limiter refuses, or fails loudly. */
async function untilRefused(ip: string): Promise<Refused> {
	for (let i = 0; i < 50; i++) {
		const answer = await post(typed('nadia@riverbanktrust.org'), { ip });
		if ('data' in answer && answer.init?.status === 429) return answer;
	}
	throw new Error(`50 reset requests from ${ip} and the limiter refused none of them`);
}

describe('the limit on POST /forgot', () => {
	/**
	 * charged before the body is read, because a request here mails whoever is named: unbounded,
	 * this form is a way to post somebody else's inbox from this deployment's own address.
	 */
	it('refuses a caller who has asked too often, before the body is read', async () => {
		await saveOrg();
		await makeMember('nadia@riverbanktrust.org');

		const refusal = await untilRefused('203.0.113.40');
		const mailedWhenRefused = sent.length;
		await post(typed('nadia@riverbanktrust.org'), { ip: '203.0.113.40' });

		expect(refusal.init?.status).toBe(429);
		expect(banner(refusal)).toBe(signInRateLimitMessage());
		// the form it answers with is built from the statement rather than from the request, so the
		// body was never read — and no message went either.
		expect(refusal.data.form.result.initialValue).toEqual({});
		expect(sent.length).toBe(mailedWhenRefused);
	});

	/**
	 * the same bucket the login spends, which is the whole point of `signInRateLimitKey` not moving
	 * with the path: a guesser who has spent the sign-in bucket cannot buy a fresh budget here, and
	 * somebody flooding this form cannot leave the login untouched.
	 */
	it('shares one bucket with the sign-in', async () => {
		await saveOrg();
		await makeMember('nadia@riverbanktrust.org');
		await untilRefused('203.0.113.41');
		const signInBody = new FormData();
		// a body the sign-in would otherwise serve, so what the 429 stands in front of is a real
		// attempt: the deployer's username in the identifier box, and the deployment's own password.
		signInBody.set('identifier', ADMIN_USERNAME);
		signInBody.set('password', PASSWORD);
		const request = new Request(`${ORIGIN}/login`, {
			method: 'POST',
			headers: new Headers({ origin: ORIGIN, 'cf-connecting-ip': '203.0.113.41' }),
			body: signInBody
		});

		const attempt = await signIn({
			request,
			url: new URL(request.url),
			params: {},
			pattern: '/login',
			context: requestContext(DEPLOYED, createExecutionContext())
		} as LoginRoute.ActionArgs);

		expect(attempt instanceof Response ? 0 : attempt.init?.status).toBe(429);
	});
});
