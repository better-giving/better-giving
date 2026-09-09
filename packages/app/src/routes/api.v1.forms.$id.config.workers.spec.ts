import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mountRoutes } from '../route-request.testing';
import * as config from './api.v1.forms.$id.config';
import * as surface from './api.v1';

// a workers spec because every answer this route gives is decided from a row, the CORS headers
// included — `allowed_origins` is a column, so a case that stood in for it would be proving the
// stand-in (CLAUDE.md).
//
// what is under test is the endpoint's own two decisions and nothing else. which refusal a form
// produces is `published-config.spec.ts`'s, against values; what is here is the status each one
// answers with and who is allowed to read it, because those are the parts a browser on a site
// nobody here can see is held to.
//
// the route is driven through react router rather than by calling its `loader` — ../route-request.testing.ts
// is where that is argued, and the short of it is that the limit on this surface is a `middleware`
// on the layout above: a spec that called the loader would be a spec for an unmetered endpoint.
// the chain below is the two files react router nests (../routes.spec.ts holds that nesting), and
// mounting the layout is also what makes every case here pay the meter — which is why each request
// arrives from an address of its own.

/** the api surface and the endpoint on it, outermost first, as ../routes.ts nests them. */
const surfaceRoutes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/config', module: config }
]);

/** the form these cases read, written by this file: no migration seeds one. */
const FORM_ID = 'frm_configendpoint1';

/** the one site the form names. */
const ALLOWED = 'https://acme.org';

/**
 * this deployment's own origin, which is the host every request in this file is made to.
 *
 * no form names it and none can: the donation page it serves is not a site anyone ticks in /admin,
 * so a case that put it in `allowed_origins` would be proving the column rather than the reading off
 * the request.
 */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

let revenueAccountId: string;

beforeAll(async () => {
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500,5000]', ?, 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId, JSON.stringify([ALLOWED]))
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement,
		                          created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789',
		         'No goods or services were provided in exchange for this gift.', 0, 0)`
	).run();
	await warmCadences();
});

/**
 * a caller nobody else in this file shares a bucket with.
 *
 * the meter on the layout charges every request that reaches this endpoint, the preflight
 * included, and the pool's bucket is three ($lib/server/api/rate-limit.ts keys on the caller's
 * address, ../../vitest.workers.config.ts sets the size). so each request here arrives from an
 * address of its own and no case can go green by being refused — which is the failure the retired
 * hook's spec named too, and the one that reads as a passing test.
 *
 * documentation range, and each address is used once and never reused.
 */
let addresses = 0;
function nextAddress(): string {
	addresses += 1;
	return `203.0.113.${addresses % 250}`;
}

/**
 * the pool's env with the deploy-time values a case wants set, as a proxy rather than a copy:
 * `env` is the runtime's own object and spreading it would keep only whichever of its members
 * happen to be enumerable — the D1 binding and the rate limiter among the ones at risk.
 *
 * the pool declares no Stripe variable at all, so the deployment that holds no keys is the pool's
 * env unchanged and needs no proxy.
 */
function envWith(values: Record<string, string>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
}

/**
 * the address the served cadences are kept under, which every case here writes before it reads.
 *
 * how often a gift may repeat comes off this deployment's processor account, and this endpoint
 * reaches it through the edge cache (`$lib/server/forms/cadence-cache.ts`). warming that cache is
 * what keeps every case below inside workerd: a cold one would send the endpoint to Stripe with the
 * fixture key above, which is a case that passes or fails on somebody else's uptime — the same
 * reason the quote path takes its port as a dependency.
 *
 * it is also a claim rather than only a fixture: what this endpoint serves is what the cache held.
 */
const CADENCE_KEY = new Request('https://give.example.workers.dev/__recurring-cadences');
const CACHED_CADENCES = ['one_time', 'yearly'];

/** the zone's own store, which the ambient `CacheStorage` type has no name for. */
const edge = (globalThis as unknown as { caches: { default: Cache } }).caches.default;

/**
 * where the served rail list is kept, for the one case that puts this route in front of an account
 * approved for nothing.
 *
 * not warmed in `beforeEach` beside the cadences: every other case wants the ordinary reading, and
 * the ordinary reading is what a cold entry produces here — the provider is built from an env
 * whose key reaches nothing, so `offeredRails` in `$lib/server/forms/offered-rails.ts` answers
 * the unreadable arm with the deployment's list whole.
 */
const RAIL_KEY = new Request('https://give.example.workers.dev/__offered-rails');

async function warmCadences(): Promise<void> {
	await edge.put(
		CADENCE_KEY,
		new Response(JSON.stringify(CACHED_CADENCES), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
}

/** the read a browser makes, with or without an `Origin` header. */
function get(
	id = FORM_ID,
	origin: string | null = ALLOWED,
	vars: Record<string, string> = STRIPE
): Promise<Response> {
	const headers = new Headers({ accept: 'application/json', 'cf-connecting-ip': nextAddress() });
	if (origin !== null) headers.set('origin', origin);
	const request = new Request(`https://give.example.workers.dev/api/v1/forms/${id}/config`, {
		headers
	});
	return surfaceRoutes(request, { env: envWith(vars) });
}

/** the preflight a browser sends before a request it is not allowed to send outright. */
function preflight(
	id = FORM_ID,
	origin: string | null = ALLOWED,
	vars: Record<string, string> = STRIPE
): Promise<Response> {
	const headers = new Headers({
		'access-control-request-method': 'GET',
		'cf-connecting-ip': nextAddress()
	});
	if (origin !== null) headers.set('origin', origin);
	const request = new Request(`https://give.example.workers.dev/api/v1/forms/${id}/config`, {
		method: 'OPTIONS',
		headers
	});
	return surfaceRoutes(request, { env: envWith(vars) });
}

describe('GET /api/v1/forms/:id/config', () => {
	it('serves the form’s config to a site the form names', async () => {
		const response = await get();
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toMatchObject({
			formId: FORM_ID,
			currency: 'USD',
			minAmountMinor: 500,
			orgLegalName: 'Hope Foundation',
			// what the cache held, which the row seeded above does not agree with: this endpoint is
			// what assembles the cadence read and hands it the origin the request arrived on, so a
			// served list matching the column instead would mean it was never asked.
			frequencies: CACHED_CADENCES
		});
	});

	/**
	 * curl, a server-side fetch, an agent reading this deployment. there is nothing to echo and
	 * nothing to withhold: CORS governs what a browser lets a page read, and a caller that sent
	 * no `Origin` is not a page.
	 */
	it('serves a caller that sent no Origin, and echoes nothing back', async () => {
		const response = await get(FORM_ID, null);
		expect(response.status).toBe(200);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(await response.json()).toMatchObject({ formId: FORM_ID });
	});

	/**
	 * the answer is the same one; only the browser's permission to read it changes.
	 *
	 * `Origin` is an attribution signal and never an authorization control (CLAUDE.md), so a site
	 * the form does not name is refused by the missing header rather than by a status — anything
	 * else would be this endpoint claiming to authorize on a value the caller writes.
	 */
	it.each([
		{ what: 'another site', origin: 'https://not-acme.example' },
		// the same host over http is a different origin, and the form named the https one.
		{ what: 'the named site over http', origin: 'http://acme.org' },
		// nothing is normalised at this end: a stored entry is already the origin a browser sends,
		// normalised on the way in (`readOriginList` in `@better-giving/operator/origins`), so the
		// compare here is literal and a near miss in the header is a miss.
		{ what: 'a near miss on the named site', origin: 'https://acme.org/' }
	])('answers $what, without letting its page read it', async ({ origin }) => {
		const response = await get(FORM_ID, origin);
		expect(response.status).toBe(200);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(await response.json()).toMatchObject({ formId: FORM_ID });
	});

	/**
	 * an id nothing matches, and the one answer that carries no CORS at all.
	 *
	 * there is no row, so there is no `allowed_origins` to check the request against — and the
	 * endpoint has no other list to fall back on. echoing the caller's own origin here instead
	 * would make this a form-id oracle any page on the internet could read, so the body goes out
	 * unreadable to a browser and whole to `curl` and to an agent.
	 */
	it('is a 404 with no CORS at all for an id nothing matches', async () => {
		const response = await get('frm_nosuchformatall1');
		expect(response.status).toBe(404);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(await response.json()).toMatchObject({
			error: 'form_not_found',
			message: expect.stringContaining('frm_nosuchformatall1')
		});
	});

	/**
	 * a refusal the page that asked for it can actually read, which is the whole reason the row
	 * travels out with one (`PublishedConfigResult` in $lib/server/forms/published-config.ts).
	 * without the echoed header the browser rejects the response before any status is legible and
	 * the embedded runtime can only say the request never completed
	 * (`createLoadConfig` in packages/form/src/embed/runtime.ts).
	 */
	it('is a 409 a named site can read when the form is still a draft', async () => {
		await env.DB.prepare(`update form set status = 'draft' where id = ?`).bind(FORM_ID).run();
		const response = await get();
		expect(response.status).toBe(409);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toMatchObject({ error: 'form_not_published' });
	});

	/**
	 * the one refusal a caller must act on rather than wait out: a retired form is never
	 * published again, so the snippet in the page's own HTML is what has to change. 410 says
	 * that where 409 would say "try again after somebody saves".
	 */
	it('is a 410 when the form was retired', async () => {
		await env.DB.prepare(`update form set status = 'archived', archived_at = 1 where id = ?`)
			.bind(FORM_ID)
			.run();
		const response = await get();
		expect(response.status).toBe(410);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toMatchObject({ error: 'form_retired' });
	});

	/**
	 * the same 409 as a draft, and deliberately: both are the named form's own stored state, and
	 * both are undone on the one /admin screen that edits it. the `error` code is what says which
	 * box, which is the division `PUBLISHED_CONFIG_REFUSALS` is drawn on.
	 */
	it('is a 409 when the stored form cannot serve', async () => {
		await env.DB.prepare('update form set min_minor = null, max_minor = null where id = ?')
			.bind(FORM_ID)
			.run();
		const response = await get();
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: 'form_unservable' });
	});

	/**
	 * nothing about the request or the form is wrong — this deployment has not been finished, and
	 * the integrator reading the answer may have no way to see /admin at all. 5xx is what tells
	 * them to stop debugging their own page, and it is what makes a donation form nobody can use
	 * register as an outage rather than as somebody's bad request.
	 *
	 * both of these sit behind the not-found answer, because `publishedConfig` refuses on the id
	 * first — so reaching either one takes a form id off a snippet the org itself published.
	 */
	it.each([
		{
			what: 'the organisation’s details were never saved',
			code: 'org_profile_incomplete',
			arrange: () => env.DB.prepare('delete from org_profile').run(),
			stripe: STRIPE
		},
		{
			what: 'this deployment holds no Stripe keys',
			code: 'payments_not_configured',
			arrange: () => Promise.resolve(),
			stripe: {}
		}
	])('is a 503 when $what', async ({ code, arrange, stripe }) => {
		await arrange();
		const response = await get(FORM_ID, ALLOWED, stripe);
		expect(response.status).toBe(503);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toMatchObject({ error: code });
	});

	/**
	 * the one refusal this route adds on top of the shared ladder, made through the real cache seam.
	 *
	 * `readPublishedConfig` serves a config with no rails rather than refusing it, because the
	 * donation path shares that reader and must go on charging a gift already in flight
	 * (`$lib/server/forms/published-config.ts`, `renderableConfig`). so the refusal exists only where
	 * a body is about to be handed to `readFormConfig` in `packages/form/src/config.ts`, which drops a config
	 * offering no rail — and this case is what says this route is that place.
	 *
	 * driven by warming the entry rather than by a port answer, the way the cadence cases above are:
	 * the served list is read through `$lib/server/forms/rail-cache.ts`, so an endpoint that never
	 * asked would answer 200 here.
	 */
	it('is a 503 when this deployment’s account is approved for no rail', async () => {
		await edge.put(
			RAIL_KEY,
			new Response('[]', {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);

		try {
			const response = await get();
			expect(response.status).toBe(503);
			expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
			expect(await response.json()).toMatchObject({ error: 'payments_not_configured' });
		} finally {
			// the entry is the zone's and outlives this case: left behind, every case after it would
			// be served a rail list nothing else asked for.
			await edge.delete(RAIL_KEY);
		}
	});

	/**
	 * both headers on every answer, and they are not two spellings of one thing.
	 *
	 * `no-store` is because this body turns over on an /admin save — a publish, a new origin, a
	 * key — with no way to purge whatever cached the answer from the pages it is embedded in.
	 * `Vary: Origin` is because the answer differs by the request header even when the body does
	 * not, so a cache that kept one page's copy would hand it to a site the form never named.
	 */
	it('carries no-store and Vary: Origin on an answer and on a refusal alike', async () => {
		const answered = await get();
		expect(answered.headers.get('cache-control')).toBe('no-store');
		expect(answered.headers.get('vary')).toBe('Origin');

		await env.DB.prepare(`update form set status = 'draft' where id = ?`).bind(FORM_ID).run();
		const refused = await get();
		expect(refused.status).toBe(409);
		expect(refused.headers.get('cache-control')).toBe('no-store');
		expect(refused.headers.get('vary')).toBe('Origin');
	});

	/**
	 * the cause reaches the wire, which is the one thing the endpoint adds to the reader's answer.
	 *
	 * two shapes and an absence, because the key is optional on `FormConfig` — a body that carried
	 * `program: null` would be a field the donation form reads as a control to draw.
	 */
	it('serves a pinned cause on the body a site reads', async () => {
		const programId = '019fb300-0000-7000-8000-0000000000d1';
		await env.DB.prepare(
			`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Clean water', 'active', 0, 0)`
		)
			.bind(programId)
			.run();
		await env.DB.prepare(`update form set program_mode = 'pinned', program_id = ? where id = ?`)
			.bind(programId, FORM_ID)
			.run();

		const response = await get();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			program: { mode: 'pinned', name: 'Clean water' }
		});
	});

	it('omits the cause entirely for a form that asks about none', async () => {
		const response = await get();
		expect(response.status).toBe(200);
		expect(await response.json()).not.toHaveProperty('program');
	});
});

describe('OPTIONS /api/v1/forms/:id/config', () => {
	/**
	 * the preflight is answered from the same list the answer itself is, because it is the same
	 * question one step earlier: may this page talk to this form. it never reaches
	 * `publishedConfig` — whether the form is a draft, or the deployment has no keys, is nothing
	 * a browser asked here and would turn the preflight into a second, statusless copy of the
	 * refusal ladder.
	 */
	it('grants a named site the method it asked about', async () => {
		const response = await preflight();
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('access-control-allow-methods')).toContain('GET');
	});

	/**
	 * one answer for a site the form does not name and for an id no form carries, and the same
	 * answer either way: 204 with nothing granted. a preflight that 404'd would tell any page on
	 * the internet which form ids this deployment holds, before the browser has been allowed to
	 * ask anything at all.
	 */
	it.each([
		{ what: 'a site the form does not name', id: FORM_ID, origin: 'https://not-acme.example' },
		{ what: 'an id nothing matches', id: 'frm_nosuchformatall1', origin: ALLOWED }
	])('grants nothing to $what, and says nothing else either', async ({ id, origin }) => {
		const response = await preflight(id, origin);
		expect(response.status).toBe(204);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(response.headers.get('vary')).toBe('Origin');
	});

	/**
	 * the grant is a method and a cache lifetime, and that is the whole of it. pinned, because a
	 * preflight is where a permission surface grows without anyone deciding to grow it — the two
	 * headers below are the ones a copied CORS snippet adds.
	 *
	 * no `Access-Control-Allow-Headers`: this endpoint takes nothing a browser has to ask
	 * permission for. `Accept` is CORS-safelisted, so the read the donation form makes is a
	 * simple request and is never preflighted at all — a caller that got here sent a header this
	 * route has no use for.
	 *
	 * no `Access-Control-Allow-Credentials`: a cookie on this request would be a session on the
	 * one surface in the app that has none, and the header is also what makes a browser refuse an
	 * echoed origin outright.
	 */
	it('grants a method and a lifetime, and no vocabulary beyond them', async () => {
		const response = await preflight();
		expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
		expect(response.headers.get('access-control-max-age')).toBe('600');
		expect(response.headers.has('access-control-allow-headers')).toBe(false);
		expect(response.headers.has('access-control-allow-credentials')).toBe(false);
	});
});

/**
 * this deployment's own origin, which no form names and every form answers.
 *
 * the donation page is a route on this deployment, so the call the page makes is same-origin — and
 * a browser still needs the echo on it, because the endpoint sets one or sets none and never
 * distinguishes. it is not a site an operator ticks and it has no `site` row — untickable is the
 * point, since a page an operator can untick is a page they can break — so the value comes off the
 * request's own url and is compared as literally as a stored line is.
 */
describe('this deployment’s own origin', () => {
	beforeEach(async () => {
		// a form ticked onto no site at all, which is the form an organisation with no website of
		// its own has. nothing in `allowed_origins` can make this pass.
		await env.DB.prepare(`update form set allowed_origins = '[]' where id = ?`).bind(FORM_ID).run();
	});

	it('reads the config of a form that names no site', async () => {
		const response = await get(FORM_ID, OWN);
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(OWN);
		expect(await response.json()).toMatchObject({ formId: FORM_ID });
	});

	it('is granted the preflight it sends before that read', async () => {
		const response = await preflight(FORM_ID, OWN);
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(OWN);
		expect(response.headers.get('access-control-allow-methods')).toContain('GET');
	});

	/**
	 * a refusal is the answer the page most needs to read: without the echo the browser rejects it
	 * before any status is legible and the runtime can only say the request never completed
	 * (`createLoadConfig` in packages/form/src/embed/runtime.ts).
	 */
	it('reads a refusal about a form that is still a draft', async () => {
		await env.DB.prepare(`update form set status = 'draft' where id = ?`).bind(FORM_ID).run();
		const response = await get(FORM_ID, OWN);
		expect(response.status).toBe(409);
		expect(response.headers.get('access-control-allow-origin')).toBe(OWN);
		expect(await response.json()).toMatchObject({ error: 'form_not_published' });
	});

	/**
	 * and the one answer no site ever reads, which the page does.
	 *
	 * the not-found refusal carries no echo for a named site because there is no row to check one
	 * against, and echoing the caller's own origin would make this a form-id oracle for every page
	 * on the internet. the page is not that: it is on this deployment's own origin, so nobody else
	 * can put a script there to read the answer — and the page carrying an id nothing matches is
	 * exactly the case that has to say so.
	 */
	it('reads a 404 for an id nothing matches', async () => {
		const response = await get('frm_nosuchformatall1', OWN);
		expect(response.status).toBe(404);
		expect(response.headers.get('access-control-allow-origin')).toBe(OWN);
		expect(await response.json()).toMatchObject({ error: 'form_not_found' });
	});

	/**
	 * the value is compared literally, exactly as a stored line is: an origin this deployment answers
	 * on does not make its host over another scheme, or a neighbouring worker, readable.
	 */
	it.each([
		{ what: 'another site', origin: 'https://attacker.test' },
		{ what: 'this deployment over http', origin: 'http://give.example.workers.dev' },
		{ what: 'a near miss on it', origin: 'https://give.example.workers.dev/' }
	])('echoes nothing to $what', async ({ origin }) => {
		const response = await get(FORM_ID, origin);
		expect(response.status).toBe(200);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
	});
});

/**
 * the only three values `Access-Control-Allow-Origin` may ever hold here, swept over every shape of
 * answer this endpoint gives: the one site the form names, this deployment's own origin, or nothing
 * at all.
 *
 * stated as a whitelist rather than as `not.toBe('*')`, which asserts almost nothing here: most of
 * these answers carry no header, so that sweep passes trivially on them — and on the ones that do
 * carry one it passes against the mistake somebody actually makes, which is not a literal `*`
 * but the request's own `Origin` echoed back with no membership test. that reads as working from
 * every site at once. a wildcard, a reflection and an origin left over from a form that no longer
 * names it all fail this.
 *
 * a sweep rather than a case because the way a wrong value gets here is somebody adding a branch,
 * not somebody editing one that exists.
 */
describe('what may be echoed, and the whole of it', () => {
	it('is the named site or nothing, on every answer this endpoint gives', async () => {
		const answers = [
			await get(),
			await get(FORM_ID, null),
			await get(FORM_ID, 'https://not-acme.example'),
			await get('frm_nosuchformatall1'),
			await get(FORM_ID, ALLOWED, {}),
			await preflight(),
			await preflight(FORM_ID, 'https://not-acme.example'),
			await preflight(FORM_ID, null)
		];
		await env.DB.prepare(`update form set status = 'archived', archived_at = 1 where id = ?`)
			.bind(FORM_ID)
			.run();
		answers.push(await get(), await preflight());
		answers.push(
			await get(FORM_ID, OWN),
			await get('frm_nosuchformatall1', OWN),
			await get(FORM_ID, 'https://attacker.test'),
			await preflight(FORM_ID, OWN)
		);

		for (const answer of answers) {
			expect([null, ALLOWED, OWN]).toContain(answer.headers.get('access-control-allow-origin'));
		}
	});
});
