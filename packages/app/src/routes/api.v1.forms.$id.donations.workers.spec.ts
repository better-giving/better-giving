import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mountRoutes } from '../route-request.testing';
import * as donations from './api.v1.forms.$id.donations';
import * as surface from './api.v1';

// the endpoint's own three decisions: which status each refusal answers with, who is allowed to
// read the answer, and what a submission costs against this route's own bucket. which refusal a
// submission produces is `$lib/server/donations/quote.workers.spec.ts`, against a real D1 and
// injected ports.
//
// a workers spec because every answer here is decided from a row, the CORS headers included:
// `allowed_origins` is a column, so a case that stood in for it would be proving the stand-in
// (CLAUDE.md).
//
// the route is driven through react router rather than by calling its `action` — the surface's
// rate limit is a `middleware` on the layout above it, and ../route-request.testing.ts is where
// that is argued: `queryRoute` without `generateMiddlewareResponse` runs the handler with no
// middleware at all and says nothing, so a spec written that way is a spec for an unmetered
// endpoint. the chain below is the two files react router nests (../routes.spec.ts holds the
// nesting), and mounting the layout is also what puts every case here in front of the meter.
//
// ---------------------------------------------------------------------------
// every case below stops before the network, and that is a property of the fixtures rather than of
// a stub.
//
// this route builds its own payment provider and passes the real `verifyTurnstile`, which is the
// point — those two lines are what a spec injecting both would never exercise. so the deployment
// these cases describe holds no `TURNSTILE_SECRET_KEY`, which `verifyTurnstile` answers
// `misconfigured` for without opening a connection, and no submission gets past it to the
// processor. what that buys is the whole route wired as it deploys: the body read once, the form
// row read, the headers built from it, the status chosen.
// ---------------------------------------------------------------------------

/** the api surface and the endpoint on it, outermost first, as ../routes.ts nests them. */
const surfaceRoutes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/donations', module: donations }
]);

const FORM_ID = 'frm_quoteendpoint01';
const ALLOWED = 'https://acme.org';

/**
 * this deployment's own origin, which is the host every request in this file is made to.
 *
 * no form names it and none can: the donation page it serves has no `site` row and is not something
 * an operator ticks, so the value comes off the request's own url.
 */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, and which has no challenge secret. */
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
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.', 0, 0)`
	).run();
	await warmCadences(CACHED_CADENCES);
});

/**
 * a caller nobody else in this file shares a bucket with.
 *
 * the meter on the layout charges every request that reaches this endpoint, the preflight
 * included, so a case reusing an address would eventually be answered 429 by the surface and go
 * green on a refusal it never asked for. the block the bucket cases at the foot of this file spend
 * is below this range and is not reachable from here.
 *
 * documentation range (TEST-NET-1), which no other spec in this pool keys on.
 */
let addresses = 0;
function nextAddress(): string {
	addresses += 1;
	return `192.0.2.${100 + (addresses % 150)}`;
}

/**
 * the pool's env with the deploy-time values a case wants, as a proxy rather than a copy: `env` is
 * the runtime's own object and spreading it would keep only whichever of its members happen to be
 * enumerable — the D1 binding and the two rate limiters among the ones at risk.
 *
 * `quoteLimiter: false` is the deployment that declares no `QUOTE_RATE_LIMITER`, which is a case
 * about this route rather than a convenience: absence there is `isRateLimited`'s decision to serve
 * ($lib/server/api/rate-limit.ts), and the surface bucket on the layout is still in front of it.
 */
function envWith(
	values: Record<string, string>,
	{ quoteLimiter = true }: { quoteLimiter?: boolean } = {}
): Env {
	return new Proxy(env, {
		get(target, property) {
			if (property === 'QUOTE_RATE_LIMITER' && !quoteLimiter) return undefined;
			if (typeof property === 'string' && property in values) return values[property];
			return Reflect.get(target, property);
		}
	}) as Env;
}

/**
 * how often a gift may repeat, kept where this route's reader looks for it.
 *
 * both the served config and the quote read the same edge cache
 * ($lib/server/forms/cadence-cache.ts), so warming it is what keeps every case inside workerd: a
 * cold entry would send the endpoint to Stripe with the fixture key above, which is a case that
 * passes or fails on somebody else's uptime.
 */
const CADENCE_KEY = new Request('https://give.example.workers.dev/__recurring-cadences');
const CACHED_CADENCES = ['one_time', 'monthly', 'yearly'];

/** the zone's own store, which the ambient `CacheStorage` type has no name for. */
const edge = (globalThis as unknown as { caches: { default: Cache } }).caches.default;

async function warmCadences(cadences: readonly string[]): Promise<void> {
	await edge.put(
		CADENCE_KEY,
		new Response(JSON.stringify(cadences), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
}

/** a body a donor's browser would send. */
const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	formId: FORM_ID,
	amountMinor: 10_000,
	frequency: 'one_time',
	method: 'card',
	coversFee: false,
	email: 'ada@example.org',
	firstName: 'Ada',
	lastName: 'Okafor',
	consentedToContact: false,
	turnstileToken: 'tok',
	...over
});

type PostOptions = {
	id?: string;
	origin?: string | null;
	raw?: string;
	ip?: string;
	limiter?: boolean;
	vars?: Record<string, string>;
};

/**
 * the submission, as a browser on the org's own site makes it.
 *
 * `ip` defaults to an address of this case's own, because the meter on the layout charges one per
 * request. `limiter` is this route's own bucket and defaults to the binding the pool declares.
 */
function post(
	over: Record<string, unknown> = {},
	{
		id = FORM_ID,
		origin = ALLOWED as string | null,
		raw,
		ip,
		limiter = true,
		vars = STRIPE
	}: PostOptions = {}
): Promise<Response> {
	const headers = new Headers({
		'content-type': 'application/json',
		accept: 'application/json',
		'cf-connecting-ip': ip ?? nextAddress()
	});
	if (origin !== null) headers.set('origin', origin);
	const request = new Request(`https://give.example.workers.dev/api/v1/forms/${id}/donations`, {
		method: 'POST',
		headers,
		body: raw ?? JSON.stringify(body(over))
	});
	return surfaceRoutes(request, { env: envWith(vars, { quoteLimiter: limiter }) });
}

/** the preflight a browser sends before a JSON POST, which is never a simple request. */
function preflight(
	id = FORM_ID,
	origin: string | null = ALLOWED,
	vars: Record<string, string> = STRIPE
): Promise<Response> {
	const headers = new Headers({
		'access-control-request-method': 'POST',
		'access-control-request-headers': 'content-type',
		'cf-connecting-ip': nextAddress()
	});
	if (origin !== null) headers.set('origin', origin);
	const request = new Request(`https://give.example.workers.dev/api/v1/forms/${id}/donations`, {
		method: 'OPTIONS',
		headers
	});
	return surfaceRoutes(request, { env: envWith(vars) });
}

describe('OPTIONS /api/v1/forms/:id/donations', () => {
	it('grants POST and the one header a JSON body needs', async () => {
		const response = await preflight();

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
		// `content-type: application/json` is not CORS-safelisted, so a route granting no headers
		// would refuse every submission it exists to take. this is the whole difference from the
		// config route's preflight, which grants none.
		expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
		expect(response.headers.get('access-control-max-age')).toBe('600');
	});

	it('grants nothing to a site the form does not name', async () => {
		const response = await preflight(FORM_ID, 'https://attacker.test');

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('answers an id nothing matches exactly as it answers a site it will not grant', async () => {
		const unknown = await preflight('frm_nosuchform00001');

		// a preflight that 404'd would tell any page on the internet which form ids this deployment
		// holds.
		expect(unknown.status).toBe(204);
		expect(unknown.headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('POST /api/v1/forms/:id/donations — who may read the answer', () => {
	it('echoes the origin of a site the form names, on a refusal too', async () => {
		const response = await post();

		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('vary')).toBe('Origin');
	});

	it('echoes nothing to a site the form does not name, and answers the same body', async () => {
		const named = await post();
		const stranger = await post({}, { origin: 'https://attacker.test' });

		// `Origin` is an attribution signal and never an authorization control (CLAUDE.md), so the
		// refusal is the same refusal — it is only unreadable in a browser.
		expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
		expect(stranger.status).toBe(named.status);
	});

	it('answers a caller with no Origin at all', async () => {
		const response = await post({}, { origin: null });

		// curl, a server-side fetch, an agent. there is nothing to echo, and CORS governs what a
		// browser lets a page read rather than who may call.
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.status).toBeGreaterThan(0);
	});
});

/**
 * this deployment's own origin, which no form names and every form answers.
 *
 * the donation page is a route on this deployment, so the gift it sends is same-origin — and a
 * browser still needs the echo on the answer, because the endpoint sets one or sets none and never
 * distinguishes. the hostname is already accepted by the challenge check (`mintQuote` in
 * $lib/server/donations/quote.ts); this is the second gate on the same donation.
 */
describe('POST /api/v1/forms/:id/donations — this deployment’s own origin', () => {
	beforeEach(async () => {
		// a form ticked onto no site at all, which is the form an organisation with no website of
		// its own has. nothing in `allowed_origins` can make these pass.
		await env.DB.prepare(`update form set allowed_origins = '[]' where id = ?`).bind(FORM_ID).run();
	});

	it('reads the answer to a gift sent from a form that names no site', async () => {
		const response = await post({}, { origin: OWN });

		// the challenge, which is where every submission in this file ends. what is under test is
		// who may read it, not what it says.
		expect(response.status).toBe(503);
		expect(response.headers.get('access-control-allow-origin')).toBe(OWN);
	});

	it('is granted the preflight a JSON body needs', async () => {
		const response = await preflight(FORM_ID, OWN);

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(OWN);
		expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
	});

	/** compared literally, exactly as a stored line is: a near miss is a miss. */
	it('echoes nothing to a site this deployment’s origin merely resembles', async () => {
		const response = await post({}, { origin: 'https://give.example.workers.dev.attacker.test' });

		expect(response.headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('POST /api/v1/forms/:id/donations — the status each refusal carries', () => {
	it('answers 404 for an id this deployment never had', async () => {
		const response = await post({}, { id: 'frm_nosuchform00001' });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: 'form_not_found' });
	});

	it('answers 409 for a form that is still a draft', async () => {
		await env.DB.prepare(`update form set status = 'draft' where id = ?`).bind(FORM_ID).run();

		const response = await post();

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: 'form_not_published' });
	});

	it('answers 410 for a form that was retired', async () => {
		await env.DB.prepare(`update form set status = 'archived' where id = ?`).bind(FORM_ID).run();

		const response = await post();

		expect(response.status).toBe(410);
		expect(await response.json()).toMatchObject({ error: 'form_retired' });
	});

	it('answers 400 for a body the form’s own bounds refuse', async () => {
		const response = await post({ amountMinor: 100 });

		expect(response.status).toBe(400);
		const answered = (await response.json()) as Record<string, unknown>;
		// no `error` code: the fix is in the integrator's own code rather than on any screen, and
		// `API_ERROR_CODES` members each name one.
		expect(answered.error).toBeUndefined();
		expect(answered.message).toContain('amountMinor');
		// the bounds fix and not some other refusal's: what it tells the integrator is where the
		// range is set, and a sentence about minor units instead would send them to the wrong file.
		expect(answered.fix).toContain('smallest and largest gift');
	});

	/**
	 * the bound read off the row rather than written into the case, on both ends.
	 *
	 * what an endpoint that takes money owes instead of a session is an amount checked against the
	 * form record and never against the body (CLAUDE.md), and a case posting a number this file
	 * chose would pass just as well against a constant compiled into the app. so the row is what
	 * says what is out of range, and the submission is one minor unit past it — which is also the
	 * boundary an off-by-one lands on.
	 */
	it.each([
		{ end: 'below the minimum', column: 'min_minor', step: -1 },
		{ end: 'above the maximum', column: 'max_minor', step: 1 }
	])('answers 400 for an amount $end the form record holds', async ({ column, step }) => {
		const row = await env.DB.prepare(`select ${column} as bound from form where id = ?`)
			.bind(FORM_ID)
			.first<{ bound: number }>();
		expect(row?.bound).toBeGreaterThan(0);

		const response = await post({ amountMinor: (row?.bound ?? 0) + step });

		expect(response.status).toBe(400);
		const answered = (await response.json()) as Record<string, unknown>;
		expect(answered.message).toContain('amountMinor');
		// the figure the record holds is in the sentence, so an integrator reads the bound rather
		// than being told to go and look for it.
		expect(String(answered.message) + String(answered.fix)).toContain(String(row?.bound));
	});

	/** and the amount the record does allow gets past the parse entirely. */
	it('takes an amount the form record’s own bounds allow', async () => {
		const row = await env.DB.prepare('select min_minor as bound from form where id = ?')
			.bind(FORM_ID)
			.first<{ bound: number }>();

		const response = await post({ amountMinor: row?.bound });

		// the challenge, which is where every submission in this file ends — so the amount was not
		// what stopped it.
		expect(response.status).toBe(503);
	});

	it('answers 400 for a body that left `consentedToContact` out', async () => {
		const response = await post({ consentedToContact: undefined });

		// the field is three-valued and still required (packages/form/src/v1.ts). an integrator who forgot
		// the question is told which value is missing rather than quietly filed as not-asked.
		expect(response.status).toBe(400);
		const answered = (await response.json()) as Record<string, unknown>;
		expect(answered.message).toContain('consentedToContact');
		expect(answered.fix).toContain('`null`');
	});

	it('takes `consentedToContact: null` from an integrator who never asked', async () => {
		const response = await post({ consentedToContact: null });

		// past the body entirely: 503 is this deployment's challenge answer, which every submission
		// this file makes ends at (see the note at the top). what it proves here is that `null` is
		// not a 400 — the parse accepted it, and where the gift is written is
		// $lib/server/donations/quote.workers.spec.ts.
		expect(response.status).toBe(503);
	});

	it('answers 400 for a body that is not JSON at all, readably', async () => {
		const response = await post({}, { raw: 'amountMinor=10000' });

		expect(response.status).toBe(400);
		// the CORS header is the reason this is not refused before the form row is read: a browser
		// cannot read a 4xx body without it.
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			message: expect.stringContaining('JSON object')
		});
	});

	it('answers 503 when the deployment cannot make a challenge at all', async () => {
		const response = await post();

		// no `TURNSTILE_SECRET_KEY` on this deployment, so nothing can be verified. it is not the
		// donor's fault and no fresh token fixes it, so it carries no code.
		expect(response.status).toBe(503);
		const answered = (await response.json()) as Record<string, unknown>;
		expect(answered.error).toBeUndefined();
		// the donor's sentence, not the operator's: `operatorFix` names the variable to set and is
		// written for the deployment's log (../lib/server/api/turnstile.ts).
		expect(answered.message).toContain('cannot verify a challenge');
	});

	it('never publishes a deploy-time variable in the body', async () => {
		const response = await post();

		const answered = JSON.stringify(await response.json());
		expect(answered).not.toContain('TURNSTILE_SECRET_KEY');
		expect(answered).not.toContain('STRIPE_SECRET_KEY');
	});
});

/**
 * this endpoint's own bucket, tighter than the surface bucket the layout charges above it.
 *
 * the surface limit bounds a caller against one D1 read; what a submission costs is a read, a
 * Turnstile verification and a payment intent minted at the processor, so this route carries a
 * limit of its own — sixty a minute against the surface's six hundred (wrangler.jsonc). the pool
 * holds the same ordering with smaller numbers (../../vitest.workers.config.ts), which is what
 * lets a case here reach this bucket at all.
 *
 * the charge is the first thing the handler does, and where it sits is the design decision worth
 * stating. the surface refusal on ./api.v1.ts is bare — no CORS headers — because decorating it
 * would need the `allowed_origins` read it exists to avoid. that argument does not carry over
 * here: this refusal is aimed at a donor mid-checkout on somebody's site, quite possibly behind a
 * carrier NAT they share with the caller who spent the bucket, and without the echo their browser
 * refuses the response and the embedded runtime can only report that the request never completed
 * (`createQuote` in packages/form/src/embed/api.ts) — a sentence about CORS, for a refusal
 * that has nothing to do with it. so the refusal pays for one read of `allowed_origins` to say what
 * happened. that read is bounded by the surface bucket the layout already charged, which is sized
 * for exactly this: six hundred reads a minute per address is the cost the config endpoint carries
 * on every request anyway.
 */
describe('POST /api/v1/forms/:id/donations — the bucket this endpoint carries', () => {
	/**
	 * asked until refused rather than counted to a number: the bucket size is the deployment's
	 * policy (wrangler.jsonc) and the pool's is deliberately smaller, so a case that knew the number
	 * would be a case about the config file. `rate-limit.config.spec.ts` is what reads that file.
	 */
	async function untilRefused(options: PostOptions): Promise<Response> {
		for (let i = 0; i < 50; i++) {
			const response = await post({}, options);
			if (response.status !== 429) continue;
			// this endpoint's refusal and not the layout's, which is a 429 too and would otherwise
			// answer every case in this block whether or not the charge below it ran at all. the two
			// are told apart by `Vary`: the layout's carries no CORS at all, because building one
			// needs the `allowed_origins` read it exists to avoid, and this one is built from the
			// form's row ($lib/server/api/rate-limit.ts).
			expect(response.headers.get('vary')).toBe('Origin');
			return response;
		}
		throw new Error('50 submissions and the limiter refused none of them');
	}

	it('refuses an address that has submitted too often', async () => {
		const refused = await untilRefused({ limiter: true, ip: '192.0.2.40' });

		expect(refused.status).toBe(429);
		expect(refused.headers.get('retry-after')).toBe('60');
		expect(refused.headers.get('cache-control')).toBe('no-store');
	});

	/**
	 * the id a caller writes is not in the key (`quoteRateLimitKey` in
	 * $lib/server/api/rate-limit.ts), so a scanner inventing a thousand ids spends one bucket and
	 * not a thousand — which is the caller a per-form limit cannot see at all, since an id nothing
	 * matches arrives with no form to attribute it to.
	 *
	 * the refusal does still cost a read: the CORS echo is built from the form's own
	 * `allowed_origins` and the route pays for it before answering. that is the trade the describe
	 * block above states, and it is the reason this bucket is not the layout's.
	 */
	it('counts a caller scanning invented ids in one bucket, not one per id', async () => {
		const known = await post({}, { id: 'frm_nosuchform00001', limiter: true, ip: '192.0.2.41' });
		expect(known.status).toBe(404);

		const refused = await untilRefused({
			id: 'frm_nosuchform00001',
			limiter: true,
			ip: '192.0.2.41'
		});
		expect(refused.status).toBe(429);

		// a fresh id from the same caller does not buy a fresh bucket, and it is still this
		// endpoint's bucket answering rather than the layout's.
		const another = await post({}, { id: 'frm_nosuchform00002', limiter: true, ip: '192.0.2.41' });
		expect(another.status).toBe(429);
		expect(another.headers.get('vary')).toBe('Origin');
	});

	/**
	 * the trade this route takes and the layout does not: the donor's page may read the refusal. the
	 * echo is built from the form's own `allowed_origins`, exactly as every other answer here is, so
	 * the runtime renders the sentence instead of a failure card about a header.
	 */
	it('lets the donor’s page read why the gift was refused', async () => {
		const refused = await untilRefused({ limiter: true, ip: '192.0.2.42' });

		expect(refused.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(refused.headers.get('vary')).toBe('Origin');
		const refusal = (await refused.json()) as Record<string, unknown>;
		// the gift bucket's sentence and not the surface bucket's: a donor who pressed Donate is
		// told nothing was charged, where a page asking in a loop is told nothing about a charge.
		expect(refusal.message).toContain('nothing has been charged');
		expect(refusal.fix).toContain('60');
		// no code, for the same reason every other refusal without one here has none: waiting is not
		// a screen, and every `API_ERROR_CODES` member names one.
		expect(refusal.error).toBeUndefined();
	});

	/**
	 * and the page mid-checkout reads it too, off the deployment's env rather than off the row —
	 * the form here names a site and it is not the page, so nothing in `allowed_origins` answers
	 * this.
	 */
	it('lets this deployment’s own donation page read why the gift was refused', async () => {
		const refused = await untilRefused({
			limiter: true,
			ip: '192.0.2.46',
			origin: OWN
		});

		expect(refused.status).toBe(429);
		expect(refused.headers.get('access-control-allow-origin')).toBe(OWN);
		expect(((await refused.json()) as Record<string, unknown>).fix).toContain('60');
	});

	/** and the echo is still the form's decision, not the refusal's. */
	it('echoes nothing to a site the form does not name', async () => {
		const refused = await untilRefused({
			limiter: true,
			ip: '192.0.2.43',
			origin: 'https://attacker.test'
		});

		expect(refused.status).toBe(429);
		expect(refused.headers.get('access-control-allow-origin')).toBeNull();
	});

	/** two addresses are two buckets, or one caller closes the form on every donor at once. */
	it('leaves another address alone', async () => {
		await untilRefused({ limiter: true, ip: '192.0.2.44' });

		const other = await post({}, { limiter: true, ip: '192.0.2.45' });

		expect(other.status).not.toBe(429);
	});

	/**
	 * a deployment with no `QUOTE_RATE_LIMITER` takes gifts, and that is the decision rather than an
	 * oversight — `isRateLimited` in $lib/server/api/rate-limit.ts is where it is argued. what is
	 * local to this route is that absence leaves nothing unmetered: the layout charged the surface
	 * bucket above it and refuses 500 when that binding is gone.
	 *
	 * the address is spent against the real binding first, and that half is what makes the case
	 * discriminating rather than decorative: without it, a route that charged nothing at all would
	 * pass this identically. the same caller is refused with the binding and served without it.
	 */
	it('takes submissions on a deployment that has no limiter at all', async () => {
		const refused = await untilRefused({ limiter: true, ip: '192.0.2.46' });
		expect(refused.status).toBe(429);

		for (let i = 0; i < 8; i++) {
			const response = await post({}, { limiter: false, ip: '192.0.2.46' });
			expect(response.status).not.toBe(429);
		}
	});

	/**
	 * and the same for a caller the edge attributed no address to, with the binding present.
	 *
	 * under the zone-level "Remove visitor IP headers" managed transform that is every caller of
	 * the deployment at once, so a bucket that counted them would be one tap across every donor
	 * there is — sixty gifts a minute for the whole deployment, held closed by whoever spends it
	 * first. the surface bucket still counts them; this one must not.
	 */
	it('takes submissions from a caller the edge attributed no address to', async () => {
		for (let i = 0; i < 8; i++) {
			const response = await post({}, { limiter: true, ip: 'not-an-address' });
			expect(response.status).not.toBe(429);
		}
	});
});

/**
 * every other method this address answers.
 *
 * react router routes `GET`, `HEAD` and `OPTIONS` to the `loader` and every mutating method to the
 * `action`, so both handlers see verbs this endpoint does not take and both have to say so. the
 * one that matters is `PUT`: unanswered, it would arrive at the `action` and be minted as a
 * submission.
 */
describe('the methods this endpoint does not take', () => {
	async function send(method: string): Promise<Response> {
		const headers = new Headers({ 'cf-connecting-ip': nextAddress() });
		// a body only where the method takes one, and it is a well-formed one: a route that read
		// the body before the method would then be refusing the verb rather than the JSON.
		const carries = method !== 'GET' && method !== 'HEAD';
		if (carries) headers.set('content-type', 'application/json');
		return surfaceRoutes(
			new Request(`https://give.example.workers.dev/api/v1/forms/${FORM_ID}/donations`, {
				method,
				headers,
				...(carries ? { body: JSON.stringify(body()) } : {})
			}),
			{ env: envWith(STRIPE) }
		);
	}

	it.each(['GET', 'PUT', 'DELETE', 'PATCH'])(
		'answers %s with 405 and what it does take',
		async (method) => {
			const response = await send(method);

			expect(response.status).toBe(405);
			expect(response.headers.get('allow')).toBe('POST, OPTIONS');
			const answered = (await response.json()) as Record<string, unknown>;
			expect(String(answered.message)).toContain(method);
			expect(String(answered.fix)).toContain('POST');
			// no `error` code: every `API_ERROR_CODES` member names the screen that fixes it, and no
			// screen fixes a request made with the wrong verb.
			expect(answered).not.toHaveProperty('error');
		}
	);

	/**
	 * and it costs no read. the answer names no form, so there is no `allowed_origins` to build an
	 * echo from and nothing for a row to decide — a read spent here is one anybody on the internet
	 * can ask for, bounded only by the surface bucket.
	 */
	it('reads nothing to say so', async () => {
		let prepared = 0;
		const counted = new Proxy(env.DB, {
			get(target, property) {
				if (property === 'prepare') {
					return (query: string) => {
						prepared += 1;
						return target.prepare(query);
					};
				}
				const value = Reflect.get(target, property) as unknown;
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

		const response = await surfaceRoutes(
			new Request(`https://give.example.workers.dev/api/v1/forms/${FORM_ID}/donations`, {
				headers: { 'cf-connecting-ip': nextAddress() }
			}),
			{
				env: new Proxy(env, {
					get: (target, property) => (property === 'DB' ? counted : Reflect.get(target, property))
				}) as Env
			}
		);

		expect(response.status).toBe(405);
		expect(prepared).toBe(0);
	});
});

describe('POST /api/v1/forms/:id/donations — what a refused submission costs', () => {
	it('takes nothing, and writes nothing, on any of these', async () => {
		await post();
		await post({ amountMinor: 100 });

		const gifts = await env.DB.prepare('select count(*) as n from donation').first<{ n: number }>();
		const payments = await env.DB.prepare('select count(*) as n from payment').first<{
			n: number;
		}>();
		expect(gifts?.n).toBe(0);
		expect(payments?.n).toBe(0);
	});

	/**
	 * and no commitment, on any path out of this endpoint.
	 *
	 * a `recurring_plan` row is written by the first charge that settles and by
	 * $lib/server/donations/collect.ts alone (CLAUDE.md). this endpoint authorizes a repeating gift
	 * at the processor and records the gift for it — but no commitment, because an authorization is
	 * not a collection and a plan minted here would claim a commitment the donor's bank may still
	 * refuse.
	 *
	 * the repeating submission below is refused at the challenge like every other case in this
	 * file, so what this holds is the near half of the rule — nothing on the way in mints one. the
	 * far half, a commitment created at the processor and still no row, is
	 * `$lib/server/donations/quote.workers.spec.ts`'s, against an injected port.
	 */
	it('writes no commitment for a repeating gift it did not collect', async () => {
		await post({ frequency: 'monthly' });

		const plans = await env.DB.prepare('select count(*) as n from recurring_plan').first<{
			n: number;
		}>();
		expect(plans?.n).toBe(0);
	});
});

/**
 * a capability of this deployment that lapsed after the donor's page was served.
 *
 * the served config is cached and reaches pages this deployment cannot recall, so a submission
 * carrying a rail the account has since stopped being approved for is charged rather than refused
 * (CLAUDE.md). the fixture is the state that produces it: the edge entry both the served config
 * and this endpoint read is emptied, so the deployment offers no rail at all, and the body still
 * asks for one.
 *
 * driven through the real cache seam rather than a port answer, because that is the seam the
 * narrowing happens at: `readPublishedConfig` mints no refusal over an empty rail list, and
 * `parseQuoteRequest` gates a submitted rail against `OFFERED_PAYMENT_METHODS` whole rather than
 * against the served list ($lib/server/donations/quote-input.ts). this is the case that says the
 * endpoint composes neither of them into one.
 *
 * what is asserted is that the rail was not what stopped it — the submission reaches the
 * challenge, which is where every case in this file ends. the refusal it must not be is
 * `invalid_request`, which is 400, and the other is the config route's own 503 over an
 * unrenderable config, which carries `payments_not_configured`.
 */
describe('POST /api/v1/forms/:id/donations — the capability it does not gate on', () => {
	const RAIL_KEY = new Request('https://give.example.workers.dev/__offered-rails');

	it('charges a gift on a rail this deployment no longer offers', async () => {
		await edge.put(
			RAIL_KEY,
			new Response('[]', {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);

		try {
			const response = await post({ method: 'card' });

			expect(response.status).toBe(503);
			const answered = (await response.json()) as Record<string, unknown>;
			expect(answered.error).toBeUndefined();
			expect(String(answered.message)).toContain('challenge');
		} finally {
			// the entry is the zone's and outlives this case: left behind, every case after it would
			// be served a rail list nothing else asked for.
			await edge.delete(RAIL_KEY);
		}
	});
});
