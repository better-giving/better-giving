import { ADMIN_USERNAME } from '@better-giving/operator/admin-password';
import { createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { signInRateLimitMessage } from '$lib/server/api/rate-limit';
import { createAuth, inviteMember, redeemInvitation } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb } from '$lib/server/db/client';
import { PASSWORD_RESET_FLASH, redirectWithFlash } from '$lib/server/flash';
import { requestContext } from '../request-context';
import { action, loader } from './login';
import type { Route } from './+types/login';

// the sign-in screen's server half, against the real D1 the pool binds.
//
// a workers spec and not a node one: this route is outside every layout there is — that is what
// makes it reachable without a session — so it resolves its own signing key and builds its own auth
// instance, and both are D1 reads. a stand-in for those would only prove the stand-in (CLAUDE.md).
//
// **the handlers are called rather than mounted, which is the one place this file departs from
// ../route-request.testing.ts.** two reasons, and both are local to this route. no `middleware`
// sits above it, so a mounted chain would run nothing a direct call misses — the limiter this
// screen owes is charged inside the action rather than by a layout. and `queryRoute` hands back a
// handler's value with a `data()`'s status dropped, which is the whole of what a form rejection
// carries: every refusal below would read as 200. ../routes.spec.ts is what holds the other half —
// that this file is served at `/login`, outside the protected layout, on the public allow-list.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** what an empty box and a box the request did not carry are both told, quoted rather than imported. */
const MISSING = 'required';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-very-long-random-staff-password';

/**
 * the deploy-time env every request here carries: the staff credential, and the values the five
 * set-up jobs are read off ($lib/server/config/setup-state.ts).
 *
 * the five are here because this screen is gated on them — an unfinished deployment serves the
 * set-up list in place of the password box — so a spec about signing in has to be a spec about a
 * deployment somebody finished setting up. the row the same reading needs is `finished()` below.
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

/** what react router hands a handler, built the way src/worker.ts builds it for a real request. */
function args(request: Request, deployed: typeof DEPLOYED = DEPLOYED): Route.LoaderArgs {
	return {
		request,
		// the normalised url, which is what react router passes a handler: after the first
		// navigation the browser asks for `<path>.data`, and the `?next=` this route reads is on
		// the address the operator was going to rather than on that payload's own url.
		url: new URL(request.url),
		params: {},
		pattern: '/login',
		context: requestContext(deployed, createExecutionContext())
	};
}

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const db = createDb(env.DB);
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/** the organisation's own row, written past drizzle: what this page reads is a column. */
async function saveOrg(legalName: string, taxId: string | null = null): Promise<void> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, created_at, updated_at)
		 values ('default', ?, ?, 0, 0)`
	)
		.bind(legalName, taxId)
		.run();
}

function get(search = '', cookie = ''): Request {
	return new Request(`${ORIGIN}/login${search}`, {
		headers: cookie ? { cookie } : {}
	});
}

/**
 * the one row the five are read off, so this deployment reads as finished.
 *
 * no site is listed and none is wanted: the site list is a fold on the console and no set-up job,
 * because a deployment with no website of its own gives on the donation page it serves at its own
 * address ($lib/server/config/readiness.ts).
 */
async function finished(legalName = 'Acme Foundation'): Promise<void> {
	// both identity fields, because the organisation job is `identityMissing`'s answer and it asks
	// for the registered name and the EIN ($lib/server/org/identity.ts).
	await saveOrg(legalName, '12-3456789');
	await env.DB.prepare(
		`update org_profile set notification_email = 'alerts@example.org' where id = 'default'`
	).run();
}

/** the loader's answer, or the redirect it threw instead of answering. */
async function visit(
	search = '',
	cookie = ''
): Promise<Response | Awaited<ReturnType<typeof loader>>> {
	try {
		return await loader(args(get(search, cookie)));
	} catch (thrown) {
		if (thrown instanceof Response) return thrown;
		throw thrown;
	}
}

beforeEach(async () => {
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_user').run();
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare('delete from site').run();
});

describe('GET /login — a visitor who is already signed in', () => {
	/**
	 * the second tab. one browser can hold this page open twice — the gate mints a `/login?next=…`
	 * per turned-away request — so the tab that did not sign in is a page with nothing to do and a
	 * destination still on its url.
	 */
	it('is sent on to their destination', async () => {
		const answer = await visit('?next=%2Fadmin%2Fdonors', await signIn());

		expect(answer).toBeInstanceOf(Response);
		expect((answer as Response).status).toBe(303);
		expect((answer as Response).headers.get('location')).toBe('/admin/donors');
	});

	it("is sent to the app's entrance when there is no destination, or it does not validate", async () => {
		const cookie = await signIn();

		const bare = await visit('', cookie);
		const hostile = await visit('?next=%2F%2Fevil.example', cookie);

		expect((bare as Response).headers.get('location')).toBe('/');
		// silently. an attacker composes the url this parameter arrives on, so a message quoting
		// the value it refused would be their page, one click further away ($lib/server/auth/next.ts).
		expect((hostile as Response).headers.get('location')).toBe('/');
	});

	/** and an anonymous visitor is left to sign in, which is what the page is for. */
	it('is not what an anonymous visitor is, so the page renders for them', async () => {
		await finished();

		const answer = await visit('?next=%2Fadmin%2Fdonors');

		expect(answer).not.toBeInstanceOf(Response);
	});
});

describe('GET /login — which deployment this is', () => {
	it('names the organisation this deployment was set up as', async () => {
		await finished('Acme Foundation');

		expect(await served()).toEqual({
			shape: 'sign-in',
			orgName: 'Acme Foundation',
			passwordReset: false
		});
	});

	it('serves the set-up list in place of the password box while a job is unfinished', async () => {
		// a fresh fork has no row at all, so there is no organisation and no address to alert — and a
		// password typed here would buy nothing but the same list one screen later (./_app.tsx).
		const answer = (await visit()) as Extract<
			Awaited<ReturnType<typeof loader>>,
			{ shape: 'setup' }
		>;

		expect(answer.shape).toBe('setup');
		expect(answer.lines.filter((line) => line.state === 'todo').map((line) => line.id)).toEqual([
			'organisation',
			'notifications'
		]);
	});

	it('goes back to serving the password box once the last job is done', async () => {
		await finished();

		expect(await served()).toEqual({
			shape: 'sign-in',
			orgName: 'Acme Foundation',
			passwordReset: false
		});
	});

	it('publishes the name and nothing else about the organisation', async () => {
		// this page is served to anyone who asks for it. the rest of that row — the EIN,
		// the address, where receipts come from — is what a deployment tells its donors after a
		// gift, not what it tells an anonymous visitor at a password box.
		// `finished()` stores the EIN, which is exactly the field this case is about.
		await finished();

		const answer = await served();

		expect(Object.keys(answer)).toEqual(['shape', 'orgName', 'passwordReset']);
		expect(JSON.stringify(answer)).not.toContain('12-3456789');
	});

	/**
	 * the deployment whose database is not answering, which is the one this page has to keep
	 * working on: every screen that reports a broken deployment is behind this password box, so a
	 * name that could not be read has to cost the name and nothing else.
	 *
	 * a handle over no binding at all, which is what `requestDb` builds when `DB` is missing — the
	 * shape of a deployment whose database this Worker cannot reach. the session read fails the
	 * same way and for the same reason, and it costs the bounce rather than the page.
	 */
	it('renders the sign-in box when the organisation’s name cannot be read', async () => {
		const unreachable = { ...DEPLOYED, DB: undefined } as unknown as typeof DEPLOYED;

		const answer = await loader(args(get(), unreachable));

		// and no set-up list either: a read that did not land found no job undone, so the gate stays
		// out of the way of the one screen that still works ($lib/server/config/setup-state.ts).
		expect(published(answer)).toEqual({ shape: 'sign-in', orgName: null, passwordReset: false });
	});

	/**
	 * the marker /reset leaves behind, which is what turns "your password is changed" into a
	 * sentence on the screen the member lands on rather than one that route had to render itself.
	 *
	 * the clearing rides the same response that publishes it, so a reload reports nothing —
	 * $lib/server/flash.ts is where that is argued, and being shown twice is what the transport
	 * exists to prevent.
	 */
	it('reports a finished password reset once, and burns the marker on the same response', async () => {
		await finished();
		const marker = await resetMarker();

		const landed = await loader(args(get('', marker)));
		const reloaded = await loader(args(get('', marker.replace(/=.*/, '='))));

		expect(published(landed)).toMatchObject({ shape: 'sign-in', passwordReset: true });
		expect(headerOf(landed)).toContain('Max-Age=0');
		expect(published(reloaded)).toMatchObject({ passwordReset: false });
	});
});

/** the sign-in shape as the loader publishes it, past the `data()` the clearing header rides on. */
async function served(): Promise<Record<string, unknown>> {
	const answer = await visit();
	if (answer instanceof Response) throw new Error('the loader redirected instead of answering');
	return published(answer) as Record<string, unknown>;
}

/** the payload of a loader answer, whether or not it was wrapped to carry a header. */
function published(answer: unknown): unknown {
	return answer !== null && typeof answer === 'object' && 'data' in answer
		? (answer as { data: unknown }).data
		: answer;
}

/** the `Set-Cookie` a wrapped loader answer carries, if it carries one. */
function headerOf(answer: unknown): string {
	const init = (answer as { init?: ResponseInit }).init;
	return String(new Headers(init?.headers).get('set-cookie'));
}

/**
 * the cookie a finished reset leaves in the browser, as the browser would send it back.
 *
 * written by the real transport rather than by hand: what makes this marker land is the
 * destination inside the value matching the address the load runs for, and a hand-built cookie
 * would be a fixture that agreed with itself ($lib/server/flash.ts).
 */
async function resetMarker(): Promise<string> {
	const response = await redirectWithFlash(
		new Request(`${ORIGIN}/reset`),
		PASSWORD_RESET_FLASH,
		'/login',
		'reset'
	);
	const written = response.headers.get('set-cookie');
	if (written === null) throw new Error('the flash wrote no cookie');
	return written.split(';', 1)[0] ?? '';
}

// ---------------------------------------------------------------------------
// the write, which is the one this deployment serves to a caller with no session.

/** what the action answers with when it refuses: `invalid()`'s data, with the status on it. */
type Refused = Exclude<Awaited<ReturnType<typeof action>>, Response>;

/** how many sessions this deployment is holding. */
async function sessions(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from auth_session').first<{ n: number }>();
	return row?.n ?? 0;
}

/**
 * the staff path as the form submits it: the deployer's username in the identifier box.
 *
 * the constant rather than the word, because the console prints it beside its own password box off
 * that same export (packages/console-ui/src/lib/password-fold.tsx) — a literal here would keep
 * passing the day the identifier moves and the two surfaces disagree.
 */
function typed(password: string): FormData {
	return typedAs(ADMIN_USERNAME, password);
}

/** whatever was typed in the two boxes, which is the whole of what this form carries. */
function typedAs(identifier: string, password: string): FormData {
	const body = new FormData();
	body.set('identifier', identifier);
	body.set('password', password);
	return body;
}

function post(
	body: FormData,
	{
		search = '',
		ip,
		deployed = DEPLOYED
	}: { search?: string; ip?: string; deployed?: typeof DEPLOYED } = {}
) {
	const headers = new Headers({ origin: ORIGIN });
	if (ip) headers.set('cf-connecting-ip', ip);
	return action(
		args(new Request(`${ORIGIN}/login${search}`, { method: 'POST', headers, body }), deployed)
	);
}

/** the refusal, or a loud failure rather than a case that silently asserted nothing. */
async function refused(...call: Parameters<typeof post>): Promise<Refused> {
	const answer = await post(...call);
	if (answer instanceof Response)
		throw new Error(`the sign-in answered ${answer.status} instead of refusing`);
	return answer;
}

/** the form-level sentence a refusal carries, which is what the banner renders. */
function banner(answer: Refused): string | undefined {
	return answer.data.form.result.error?.['']?.[0];
}

/** the sentence under the password box. */
function underTheBox(answer: Refused): string[] | null | undefined {
	return answer.data.form.result.error?.password;
}

/** and the one under the box above it. */
function underTheIdentifier(answer: Refused): string[] | null | undefined {
	return answer.data.form.result.error?.identifier;
}

describe('POST /login — where a sign-in ends up', () => {
	/**
	 * the destination rides on the page's own url rather than in a field, which is what makes this
	 * work with nothing for the page to render: a `<Form method="post">` with no `action` posts to
	 * the current url, query string and all, so the action reads the parameter the gate minted
	 * straight off `url`.
	 */
	it('returns to the destination the gate turned away', async () => {
		const answer = await post(typed(PASSWORD), {
			search: '?next=%2Fadmin%2Fforms%2Fabc%2Fsettings%3Ftab%3Dx'
		});

		expect(answer).toBeInstanceOf(Response);
		expect((answer as Response).status).toBe(303);
		expect((answer as Response).headers.get('location')).toBe('/admin/forms/abc/settings?tab=x');
	});

	/** the ordinary sign-in, which nobody was redirected into: the app's entrance at `/`. */
	it("lands on the app's entrance when there is no destination", async () => {
		const answer = await post(typed(PASSWORD));

		expect((answer as Response).headers.get('location')).toBe('/');
	});

	/**
	 * and a destination that does not validate is the same as none — silently. an attacker composes
	 * the url this parameter arrives on, so the one thing this must not do is hand the operator a
	 * page of theirs off the back of a sign-in that worked, and the second thing is say a word
	 * about it: a message quoting the value is the same page, one click further away.
	 *
	 * `safeNext` in $lib/server/auth/next.ts is where the rule lives and where its spellings are
	 * enumerated; what is asserted here is that this route spends it at all.
	 */
	it("lands on the app's entrance when the destination names another origin", async () => {
		for (const hostile of ['https://evil.example', '//evil.example', '/\\evil.example']) {
			const answer = await post(typed(PASSWORD), {
				search: `?next=${encodeURIComponent(hostile)}`
			});

			expect((answer as Response).headers.get('location')).toBe('/');
		}
	});

	/**
	 * and the browser leaves holding the session, which is the half a redirect cannot claim for
	 * itself. better-auth builds its `set-cookie` on the response for the HTTP surface this
	 * deployment does not serve, and nothing copies it onto ours — dropped, a sign-in that
	 * worked lands the operator back at this page with the gate turning them away again.
	 */
	it('sets the session cookie on the redirect it answers with', async () => {
		const answer = (await post(typed(PASSWORD))) as Response;

		expect(await sessions()).toBe(1);
		expect(answer.headers.getSetCookie().some((value) => value.includes('session'))).toBe(true);
	});
});

describe('POST /login — what the browser gets back', () => {
	/**
	 * the empty POST, which is what `mustArrive` refuses before the schema is allowed to fill the
	 * box in. `curl -X POST` is the caller, and it meets the same sentence under the box that an
	 * operator who tabbed past it meets.
	 */
	it('refuses a body with no password, without hashing anything', async () => {
		const answer = await refused(new FormData());

		expect(answer.init?.status).toBe(400);
		expect(underTheBox(answer)).toEqual([MISSING]);
		expect(await sessions()).toBe(0);
	});

	/** and a blank box says the same thing, because it is the same problem. */
	it('refuses a blank password with the sentence an empty body gets', async () => {
		const answer = await refused(typed(''));

		expect(underTheBox(answer)).toEqual([MISSING]);
		// the box carried its key, so nothing about the body was incomplete and there is no
		// banner: the sentence belongs under the input.
		expect(banner(answer)).toBeUndefined();
		expect(await sessions()).toBe(0);
	});

	/**
	 * and the box above it, which is stated the same way: a body that names no identity is refused
	 * where an absent key is refused, and a box submitted blank meets the same sentence.
	 */
	it('refuses a body that names no identity, and a blank box with it', async () => {
		const absent = new FormData();
		absent.set('password', PASSWORD);

		const missing = await refused(absent);
		const blank = await refused(typedAs('', PASSWORD));

		expect(missing.init?.status).toBe(400);
		expect(underTheIdentifier(missing)).toEqual([MISSING]);
		expect(underTheIdentifier(blank)).toEqual([MISSING]);
		// the sentence belongs under the input, so there is nothing for the banner to say.
		expect(banner(blank)).toBeUndefined();
		expect(await sessions()).toBe(0);
	});

	/**
	 * rejected before it is hashed, which is the point of the cap — and the case is discriminating
	 * because the password it sends is the deployment's own with padding on the end. an attempt
	 * that reached the auth layer at all would have been compared, not signed in; one that reached
	 * it after the cap was raised would be the 257-character secret this deployment does have.
	 */
	it('refuses an over-long password before the auth layer sees it', async () => {
		const overCap = 'x'.repeat(257);
		const answer = await refused(typed(overCap), {
			deployed: { ...DEPLOYED, ADMIN_PASSWORD: overCap }
		});

		expect(answer.init?.status).toBe(400);
		expect(underTheBox(answer)?.at(-1)).toBe('must be at most 256 characters');
		expect(await sessions()).toBe(0);
	});

	/**
	 * 401 is the only status whose message is repeated back to the caller, because it is the only
	 * one about what they sent — and with one secret and one account there is nothing it could
	 * disambiguate.
	 */
	it('says a wrong password is a wrong password', async () => {
		const answer = await refused(typed('not-the-staff-password'));

		expect(answer.init?.status).toBe(401);
		expect(banner(answer)).toBe('Invalid password.');
		expect(await sessions()).toBe(0);
	});

	/**
	 * every other status is about the deployment, and the unconfigured credential is the one that
	 * matters: its message states the configured `ADMIN_PASSWORD`'s length, which is written for an
	 * agent reading a status body on a surface an operator controls. an anonymous POST to this form
	 * must not read it back, so it gets the pointer at the console instead.
	 */
	it('points an unconfigured deployment at the console rather than reading its credential back', async () => {
		const answer = await refused(typed(PASSWORD), {
			deployed: { ...DEPLOYED, ADMIN_PASSWORD: 'short' }
		});

		expect(answer.init?.status).toBe(500);
		expect(banner(answer)).toContain('better-giving open');
		expect(JSON.stringify(answer.data)).not.toContain('ADMIN_PASSWORD is shorter');
		expect(JSON.stringify(answer.data)).not.toContain('(it is 5)');
	});

	/**
	 * and the deployment whose schema is not there, which is what a fresh fork hits: no
	 * `auth_signing_key` row to sign a cookie with. the answer names the commands that apply
	 * migrations rather than the row, because that is the fix either way.
	 */
	it('tells a deployment with no schema to apply its migrations', async () => {
		const unreachable = { ...DEPLOYED, DB: undefined } as unknown as typeof DEPLOYED;

		const answer = await refused(typed(PASSWORD), { deployed: unreachable });

		expect(answer.init?.status).toBe(500);
		expect(banner(answer)).toContain('migrations');
	});

	/**
	 * the one this whole route is careful about. every rejection sends the submitted values back so
	 * the boxes keep what was typed, and this box holds the staff credential — without the form
	 * withholding it, it would come back inside the page and be rendered into a `value=` attribute.
	 *
	 * asserted on every failing arm rather than on one, because the leak is per-return.
	 */
	it('never sends the password back, on any arm that fails', async () => {
		const wrong = await refused(typed(PASSWORD.toUpperCase()));
		expect(wrong.init?.status).toBe(401);
		expect(JSON.stringify(wrong.data)).not.toContain(PASSWORD.toUpperCase());

		const unconfigured = await refused(typed(PASSWORD), {
			deployed: { ...DEPLOYED, ADMIN_PASSWORD: 'short' }
		});
		expect(unconfigured.init?.status).toBe(500);
		expect(JSON.stringify(unconfigured.data)).not.toContain(PASSWORD);

		// and the arm where the schema itself refused, which is the one that carries what was typed
		// by construction — a rejection replies with the payload it parsed.
		const tooLong = `${PASSWORD}${'x'.repeat(300)}`;
		const overCap = await refused(typed(tooLong));
		expect(overCap.init?.status).toBe(400);
		expect(JSON.stringify(overCap.data)).not.toContain(PASSWORD);
	});
});

// ---------------------------------------------------------------------------
// the bound on the write. the pool binds the real `SIGN_IN_RATE_LIMITER`, so what is under test is
// the charge as it deploys rather than a description of it.
//
// the case worth stating twice is the one below about a missing binding, because it is the opposite
// answer to the one `refuseIfRateLimited` gives on the public surface. serving on with no limiter is
// the decision, and a comment saying so is not coverage — flipping the call site to refuse instead
// has to turn this file red.

/** submits the deployment's own password until the limiter refuses, or fails loudly. */
async function untilRefused(ip: string): Promise<Refused> {
	for (let i = 0; i < 50; i++) {
		const answer = await post(typed(PASSWORD), { ip });
		if (!(answer instanceof Response) && answer.init?.status === 429) return answer;
	}
	throw new Error(`50 sign-in attempts from ${ip} and the limiter refused none of them`);
}

describe('the limit on POST /login', () => {
	/**
	 * the gap this closes on this path. the action calls `auth.api.signInStaff` directly, so
	 * better-auth's own rule on `/sign-in/staff` — declared in $lib/server/auth/staff-plugin.ts —
	 * never runs: it is bound to an HTTP router this deployment does not mount. unbounded, this is
	 * a single `ADMIN_PASSWORD` on a public URL.
	 */
	it('refuses a caller who has attempted too often, before the password is compared', async () => {
		const refusal = await untilRefused('203.0.113.30');
		const signedInWhenRefused = await sessions();

		await post(typed(PASSWORD), { ip: '203.0.113.30' });

		expect(refusal.init?.status).toBe(429);
		// the status alone would pass against an action that refused after hashing. what is being
		// bounded is the work an anonymous POST can buy, so the assertion is that the attempt did
		// not happen at all — a correct password that reached the auth layer would have signed in.
		expect(await sessions()).toBe(signedInWhenRefused);
	});

	/** the earlier attempts were served, or the limiter is refusing everything and proves nothing. */
	it('serves the attempts before that one', async () => {
		await untilRefused('203.0.113.31');

		expect(await sessions()).toBeGreaterThan(0);
	});

	/**
	 * the refusal is the page's own shape — a form rejection the banner renders — and not the JSON
	 * `Response` the public api answers with. a `Response` returned from this action is a
	 * navigation, not something the screen can draw.
	 */
	it('answers in the shape this page renders, and says nothing about the password', async () => {
		const refusal = await untilRefused('203.0.113.32');

		expect(banner(refusal)).toBe(signInRateLimitMessage());
		// it is answered before the credential is compared, so it has no outcome to leak — and the
		// sentence must stay that way, or a limit on this form becomes an oracle.
		expect(banner(refusal)?.toLowerCase()).not.toContain('invalid password');
		// the form it answers with is built from the statement rather than from the request, so the
		// body was never read — which is the whole reason the charge sits ahead of `parseForm`.
		// no sentence under the box either: there is nothing wrong with what was typed.
		expect(underTheBox(refusal)).toBeUndefined();
		expect(JSON.stringify(refusal.data)).not.toContain(PASSWORD);
	});

	/**
	 * the bucket is per caller, on the same `payer` normalisation the public api's key uses
	 * ($lib/server/api/rate-limit.ts). the `/64` half is the security property: a caller holding a
	 * routed ipv6 `/64` — the standard delegation from any vps host — binds a fresh source address
	 * per request, so a bucket keyed on the whole address would bound nothing at all here.
	 */
	it('holds one ipv6 /64 to one bucket', async () => {
		await untilRefused('2001:db8:a:1::1');
		const signedInWhenRefused = await sessions();

		const neighbour = await post(typed(PASSWORD), { ip: '2001:db8:a:1:ffff:ffff:ffff:ffff' });

		expect(neighbour instanceof Response ? 0 : neighbour.init?.status).toBe(429);
		expect(await sessions()).toBe(signedInWhenRefused);
	});

	/**
	 * and the other half: the block is `/64` and not something wider. otherwise one guesser closes
	 * the login on every other subscriber of their isp — including the operator.
	 */
	it('leaves another /64 alone', async () => {
		await untilRefused('2001:db8:b:1::1');
		const signedInWhenRefused = await sessions();

		const elsewhere = await post(typed(PASSWORD), { ip: '2001:db8:b:2::1' });

		expect(elsewhere).toBeInstanceOf(Response);
		expect(await sessions()).toBe(signedInWhenRefused + 1);
	});

	/**
	 * a deployment with no binding signs staff in, which is the decision and not an oversight —
	 * `isRateLimited` in $lib/server/api/rate-limit.ts is where it is argued, and `ADMIN_PASSWORD`
	 * is what bounds this form without it.
	 *
	 * the address is spent against the real binding first, and that half is what makes the case
	 * discriminating rather than decorative: without it, a call site that never charged anything
	 * would pass this identically.
	 */
	it('signs staff in on a deployment that has no limiter at all', async () => {
		await untilRefused('203.0.113.33');
		const signedInWhenRefused = await sessions();
		// a deployment whose `ratelimits` block does not name this binding — a fork that edited it
		// out, a Worker deployed before it existed, an account where the binding is not there.
		const unbound = { ...DEPLOYED, SIGN_IN_RATE_LIMITER: undefined } as unknown as typeof DEPLOYED;

		for (let i = 0; i < 8; i++) {
			expect(await post(typed(PASSWORD), { ip: '203.0.113.33', deployed: unbound })).toBeInstanceOf(
				Response
			);
		}

		// every one of them, not just the first: an absent binding is not an empty bucket either.
		expect(await sessions()).toBe(signedInWhenRefused + 8);
	});

	/**
	 * and the same for a caller the edge attributed no address to, which under the zone-level
	 * "Remove visitor IP headers" managed transform is every caller of the deployment at once. the
	 * binding is bound here and refusing this address is exactly what it must not do — otherwise
	 * one guesser holds the only login closed on the operator, which is worse than the guessing.
	 */
	it('signs staff in when the edge attributed no address at all', async () => {
		for (let i = 0; i < 8; i++) {
			expect(await post(typed(PASSWORD), { ip: 'not-an-address' })).toBeInstanceOf(Response);
		}

		expect(await sessions()).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// the two identities, at one pair of boxes. a member signs in with the address they were invited at
// and the password they chose; the deployer types the username the constant holds. one screen, one
// action, one bucket.

/** what a colleague chooses when they accept, long enough for better-auth to accept it. */
const MEMBER_PASSWORD = 'a-colleagues-own-password';

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

/** the value in the identifier box after a refusal, which is an ordinary box and comes back filled. */
function identifierHeld(answer: Refused): unknown {
	return (answer.data.form.result.initialValue as Record<string, unknown> | undefined)?.identifier;
}

describe('POST /login — which identity the boxes name', () => {
	it('signs in with the address they were invited at and the password they chose', async () => {
		await makeMember('nadia@riverbanktrust.org');

		const answer = (await post(typedAs('nadia@riverbanktrust.org', MEMBER_PASSWORD))) as Response;

		expect(answer.status).toBe(303);
		expect(await sessions()).toBe(1);
		expect(answer.headers.getSetCookie().some((value) => value.includes('session'))).toBe(true);
	});

	/**
	 * an unknown address and a wrong password are one refusal, which is better-auth's own behaviour
	 * and is kept: telling them apart would turn this form into a way to ask whether a given person
	 * works here, on a deployment whose donation page names the organisation.
	 */
	it('says one thing about a wrong password and an address nobody here has', async () => {
		await makeMember('nadia@riverbanktrust.org');

		const wrong = await refused(typedAs('nadia@riverbanktrust.org', 'not-her-password'));
		const stranger = await refused(typedAs('nobody@riverbanktrust.org', MEMBER_PASSWORD));

		expect(wrong.init?.status).toBe(401);
		expect(banner(wrong)).toBe(banner(stranger));
		// and the sentence covers both boxes without telling the two ways in apart: a refusal
		// naming only an address would say that a username is the other kind of identity.
		expect(banner(wrong)).toBe(
			'That username or email address and password do not match a member of this organisation.'
		);
		expect(await sessions()).toBe(0);
	});

	/** and a value that is not an address at all joins them rather than reading as a broken deployment. */
	it('says the same thing about a value that is not an address', async () => {
		await makeMember('nadia@riverbanktrust.org');

		const nonsense = await refused(typedAs('not-an-address', MEMBER_PASSWORD));

		expect(nonsense.init?.status).toBe(401);
		expect(await sessions()).toBe(0);
	});

	/**
	 * the identifier box is an ordinary box and comes back holding what was typed; the password box
	 * is withheld and comes back empty. one form, one echo policy, and the credential half of it is
	 * what `withheld` states.
	 */
	it('gives the identifier back on a refusal and never the password', async () => {
		await makeMember('nadia@riverbanktrust.org');

		const answer = await refused(typedAs('nadia@riverbanktrust.org', 'not-her-password'));

		expect(identifierHeld(answer)).toBe('nadia@riverbanktrust.org');
		expect(JSON.stringify(answer.data)).not.toContain('not-her-password');
	});

	/**
	 * the deployer's own way in through the same two boxes, which is the whole of how one form
	 * serves two identities: the identifier is what chooses, and the constant is what it is
	 * compared against.
	 */
	it('signs the deployer in on the username, beside a member at the same boxes', async () => {
		await makeMember('nadia@riverbanktrust.org');

		const staff = (await post(typed(PASSWORD))) as Response;

		expect(staff.status).toBe(303);
		expect(await sessions()).toBe(1);
		expect(staff.headers.getSetCookie().some((value) => value.includes('session'))).toBe(true);
	});

	/**
	 * and the deployer typing it the way anybody types a name into a box. the identifier is trimmed
	 * and lower-cased before anything is compared, so a capital and the space a paste carries reach
	 * the same branch rather than being sent to the member path to be refused there.
	 */
	it('reaches the deployer through a capital and a trailing space', async () => {
		const staff = (await post(typedAs('Admin ', PASSWORD))) as Response;

		expect(staff.status).toBe(303);
		expect(await sessions()).toBe(1);
	});

	/**
	 * an empty box was the deployer's way in and is now nobody's. it is asserted here rather than
	 * only under the box, because what changed is the branch: a blank identifier must not fall
	 * through to the deployment's own password.
	 */
	it('does not take an empty identifier for the deployer', async () => {
		const answer = await refused(typedAs('', PASSWORD));

		expect(answer.init?.status).toBe(400);
		expect(await sessions()).toBe(0);
	});

	/** and the deployer's password does not sign a member in, nor theirs the deployer. */
	it('does not let either password stand in for the other', async () => {
		await makeMember('nadia@riverbanktrust.org');

		const crossed = await refused(typedAs('nadia@riverbanktrust.org', PASSWORD));
		const staffAsMember = await refused(typed(MEMBER_PASSWORD));

		expect(crossed.init?.status).toBe(401);
		expect(staffAsMember.init?.status).toBe(401);
		expect(await sessions()).toBe(0);
	});
});

describe('the limit on POST /login — one bucket for both ways in', () => {
	/**
	 * the charge is the action's and sits ahead of both paths, so a guesser cannot buy a fresh
	 * bucket by putting an address in the box. `signInRateLimitKey` is keyed on the caller and never
	 * on the path, which is what makes this one payer rather than two.
	 */
	it('refuses a member attempt on a bucket the deployer’s attempts spent', async () => {
		await makeMember('nadia@riverbanktrust.org');
		await untilRefused('203.0.113.40');
		const signedInWhenRefused = await sessions();

		const asMember = await post(typedAs('nadia@riverbanktrust.org', MEMBER_PASSWORD), {
			ip: '203.0.113.40'
		});

		expect(asMember instanceof Response ? 0 : asMember.init?.status).toBe(429);
		expect(await sessions()).toBe(signedInWhenRefused);
	});

	/** and the other way round: a member's failed attempts spend the deployer's bucket too. */
	it('charges a member attempt on the same bucket', async () => {
		await makeMember('nadia@riverbanktrust.org');
		for (let i = 0; i < 12; i++) {
			const answer = await post(typedAs('nadia@riverbanktrust.org', 'wrong'), {
				ip: '203.0.113.41'
			});
			if (!(answer instanceof Response) && answer.init?.status === 429) break;
		}

		const asStaff = await post(typed(PASSWORD), { ip: '203.0.113.41' });

		expect(asStaff instanceof Response ? 0 : asStaff.init?.status).toBe(429);
		expect(await sessions()).toBe(0);
	});
});
