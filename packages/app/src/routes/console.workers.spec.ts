import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEPLOY_VARS } from '@better-giving/operator/deploy-split';
import {
	PAYMENT_PROCESSORS,
	type PaymentsReport,
	type ProcessorPayments,
	type WalletLevellingReport,
	type WalletsReading
} from '@better-giving/operator/console/payments';
import type {
	RecurringReport,
	RecurringSetupReport
} from '@better-giving/operator/console/recurring';
import {
	CONSOLE_SESSION_SECONDS,
	CONSOLE_TOKEN_MIN_RANDOM,
	formatConsoleToken
} from '@better-giving/operator/console/token';
import { refusing } from '$lib/server/payments/provider';
import type {
	AccountChargeability,
	PaymentProvider,
	PaymentResult,
	ProcessorName,
	RailSwitchboard,
	RecurringGiftProvision,
	RecurringGiftStanding,
	WalletDomain,
	WebhookEndpointRegistry
} from '$lib/server/payments/provider';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as org from './console.org';
import * as payments from './console.payments';
import * as recurring from './console.recurring';
import * as sites from './console.sites';
import * as testEmail from './console.test-email';
import * as walletDomains from './console.wallet-domains';
import * as webhookRepair from './console.webhook-repair';
import * as surface from './console';

// every route of the console surface, against a real D1.
//
// a workers spec because every answer here is assembled out of rows: the site list and the
// organisation's profile are tables, the two writes are writes, and the test send reads the
// organisation row before it sends. standing in for any of that would prove the stand-in
// (CLAUDE.md).
//
// every request below is mounted through the surface's own layout rather than handed to a
// handler, which is what puts the credential check in front of it: the check is the `middleware`
// on ./console.ts ($lib/server/console/gate.ts), and a case that called the exported `loader`
// would be exercising an endpoint nothing had checked. ../route-request.testing.ts is where that
// mounting is explained; ../routes.spec.ts is what holds the chains stated here against the tree
// react router actually resolves.
//
// no route module sees the token. what they read off the request context is when
// the session ends, so a route added beside them inherits the check by nesting where they nest.

/** the deployment's own Stripe values, as a case that asks what the report carries them as. */
const STRIPE_VALUES = {
	STRIPE_SECRET_KEY: 'sk_live_51SomethingSecretAndLong',
	STRIPE_PUBLISHABLE_KEY: 'pk_live_51SomethingPublic',
	STRIPE_WEBHOOK_SECRET: 'whsec_SomethingSecretAndLong'
};

/**
 * the payment port each processor's routes are given, or nothing for the one this deployment's own
 * values build.
 *
 * it stands in for an account rather than for the processor: what these cases need is registrations
 * to look at, and those are on the far side of the port rather than in anything a variable can
 * describe. every processor left out of it goes on meeting the real adapter, which is what the
 * unconfigured arms below are about — so the file keeps both, and `beforeEach` puts it back.
 *
 * keyed by processor because the report is a reading per processor: one port handed back under
 * every name would make a case about one account answer for both, which is the exact mistake the
 * unconfigured arm exists to prevent.
 *
 * mounted over the factory rather than passed in, because a route builds its own provider from the
 * request's platform env (`createPaymentProviders` in $lib/server/payments/factory.ts) and there is
 * nothing on the wire to hand one through. the real module is delegated to rather than replaced,
 * so `configured` and `unset` beside it go on being the deployment's own answer.
 */
const stub = vi.hoisted(() => ({
	ports: {} as Partial<Record<'stripe' | 'paypal', PaymentProvider>>
}));

vi.mock('$lib/server/payments/factory', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/payments/factory')>();
	return {
		...actual,
		createPaymentProviders: (platformEnv: Env) => {
			const processors = actual.createPaymentProviders(platformEnv);
			return {
				...processors,
				for: (name: 'stripe' | 'paypal') => stub.ports[name] ?? processors.for(name)
			};
		}
	};
});

/**
 * when the session these cases hold ends, and the token that carries it.
 *
 * minted against the clock rather than written down, because the check is now in front of every
 * case here and a fixed date is a suite that goes red on a morning nobody touched it. whole
 * seconds, which is what the format stores (`formatConsoleToken` in
 * `@better-giving/operator/console/token`) — the expiry read back has to equal this `Date`
 * exactly.
 */
const EXPIRES_AT = new Date(
	Math.floor((Date.now() + CONSOLE_SESSION_SECONDS * 1000) / 1000) * 1000
);
const TOKEN = formatConsoleToken(EXPIRES_AT, 'z'.repeat(CONSOLE_TOKEN_MIN_RANDOM));

interface Envelope {
	sites: string[];
	org: Record<string, string> | null;
	version: string | null;
	session: { expiresAt: string };
}

/**
 * the pool's env with this deployment's session and deploy-time values, as a proxy rather than a
 * copy: `env` is the runtime's own object and spreading it would keep only whichever of its
 * members happen to be enumerable — the D1 binding among the ones at risk.
 */
function envWith(values: Record<string, unknown>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
}

/** the deployment as these cases meet it: the Stripe values set, and a live session on it. */
const DEPLOYMENT = { ...STRIPE_VALUES, CONSOLE_TOKEN: TOKEN };

/** the surface's own address, and each write beneath it, as ../routes.ts nests them. */
const reportRoutes: RouteRequester = mountRoutes([{ path: 'console', module: surface }]);
const sitesRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'sites', module: sites }
]);
const orgRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'org', module: org }
]);
const testEmailRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'test-email', module: testEmail }
]);
const recurringRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'recurring', module: recurring }
]);
const paymentsRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'payments', module: payments }
]);
const webhookRepairRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'webhook-repair', module: webhookRepair }
]);
const walletDomainsRoutes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'wallet-domains', module: walletDomains }
]);

/** the credential the console presents, unless a case is about not presenting one. */
function bearer(token: string | null): HeadersInit {
	return token === null
		? { 'content-type': 'application/json' }
		: { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

/** the read. */
function report(
	token: string | null = TOKEN,
	vars: Record<string, string | undefined> = {}
): Promise<Response> {
	return reportRoutes(
		new Request('https://give.example.workers.dev/console', { headers: bearer(token) }),
		{ env: envWith({ ...DEPLOYMENT, ...vars }) }
	);
}

/** a write, with a body that is JSON. */
function post(
	routes: RouteRequester,
	path: string,
	body: unknown,
	token: string | null = TOKEN
): Promise<Response> {
	return routes(
		new Request(`https://give.example.workers.dev${path}`, {
			method: 'POST',
			headers: bearer(token),
			body: JSON.stringify(body)
		}),
		{ env: envWith(DEPLOYMENT) }
	);
}

const saveSites = (body: unknown, token?: string | null): Promise<Response> =>
	post(sitesRoutes, '/console/sites', body, token);
const saveOrg = (body: unknown, token?: string | null): Promise<Response> =>
	post(orgRoutes, '/console/org', body, token);

/**
 * a press on one of the two acts, which carry no body at all.
 *
 * an act's whole input is the deployment's own state, so `vars` is the only thing a case varies —
 * and a name given `undefined` there is a value this deployment does not hold, which is how the
 * unconfigured arms are reached.
 */
function act(
	routes: RouteRequester,
	path: string,
	vars: Record<string, string | undefined> = {},
	token: string | null = TOKEN
): Promise<Response> {
	return routes(
		new Request(`https://give.example.workers.dev${path}`, {
			method: 'POST',
			headers: bearer(token)
		}),
		{ env: envWith({ ...DEPLOYMENT, ...vars }) }
	);
}

/**
 * a press on the one act that carries a body: the address the message goes to.
 *
 * `vars` is what a case varies to reach the unconfigured arms, the way {@link act} above states,
 * and `body` is what it varies to reach the refusals.
 */
function sendTest(
	vars: Record<string, string | undefined> = {},
	token: string | null = TOKEN,
	body: unknown = { to: 'ops@hope.example' }
): Promise<Response> {
	return testEmailRoutes(
		new Request('https://give.example.workers.dev/console/test-email', {
			method: 'POST',
			headers: bearer(token),
			body: JSON.stringify(body)
		}),
		{ env: envWith({ ...DEPLOYMENT, ...vars }) }
	);
}

const setUpRecurring = (
	vars: Record<string, string | undefined> = {},
	token?: string | null
): Promise<Response> => act(recurringRoutes, '/console/recurring', vars, token);

/**
 * the same press, naming the one account it is about.
 *
 * `processor` is `unknown` because the refusals are half of what this body is: a name no processor
 * answers to has to come back as a 4xx naming the value, rather than as a press on whatever the
 * deployment happened to hold.
 */
function setUpRecurringOn(
	processor: unknown,
	vars: Record<string, string | undefined> = {}
): Promise<Response> {
	return recurringRoutes(
		new Request('https://give.example.workers.dev/console/recurring', {
			method: 'POST',
			headers: bearer(TOKEN),
			body: JSON.stringify({ processor })
		}),
		{ env: envWith({ ...DEPLOYMENT, ...vars }) }
	);
}

/** the read beside that press: where the account stands, changing nothing. */
function readRecurring(vars: Record<string, string | undefined> = {}): Promise<Response> {
	return recurringRoutes(
		new Request('https://give.example.workers.dev/console/recurring', {
			headers: bearer(TOKEN)
		}),
		{ env: envWith({ ...DEPLOYMENT, ...vars }) }
	);
}

/**
 * where the account this deployment charges on stands, changing nothing.
 *
 * the host is the one the surface's other cases use, and it is load-bearing here and nowhere else:
 * the endpoint this deployment looks for on the account is derived from the request that reached
 * it (`webhookEndpointUrl` in `@better-giving/operator/stripe/webhook-endpoint`), so the address a
 * case sends to is the address it is asking about.
 */
function readPayments(vars: Record<string, string | undefined> = {}): Promise<Response> {
	return paymentsRoutes(
		new Request('https://give.example.workers.dev/console/payments', { headers: bearer(TOKEN) }),
		{ env: envWith({ ...DEPLOYMENT, ...vars }) }
	);
}

/** one processor's reading off the report, which is what every case about an account is about. */
async function readingFor(
	processor: ProcessorName,
	vars: Record<string, string | undefined> = {}
): Promise<ProcessorPayments> {
	const body = (await (await readPayments(vars)).json()) as PaymentsReport;
	const reading = body.processors.find((entry) => entry.processor === processor);
	if (!reading) throw new Error(`the report carries no ${processor} reading`);
	return reading;
}

/** the same reading, narrowed to the arm a case that set the credentials is about. */
async function configuredReading(
	processor: ProcessorName,
	vars: Record<string, string | undefined> = {}
): Promise<Extract<ProcessorPayments, { state: 'configured' }>> {
	const reading = await readingFor(processor, vars);
	if (reading.state !== 'configured') {
		throw new Error(`${processor} is ${reading.state} on this deployment`);
	}
	return reading;
}

/**
 * the press beside that read: bringing the endpoint at this deployment's address level.
 *
 * the host matters here for `readPayments`' reason — the endpoint the press acts on is found by the
 * address the request reached, so a case presses about the deployment it asked.
 */
const repairWebhook = (
	vars: Record<string, string | undefined> = {},
	token?: string | null
): Promise<Response> => act(webhookRepairRoutes, '/console/webhook-repair', vars, token);

/**
 * the press that registers this deployment's own address and every site it lists.
 *
 * the host matters here for `readPayments`' reason and once more besides: the first hostname the
 * press acts on is the address the request reached, so a case presses about the deployment it asked.
 */
const levelWallets = (
	vars: Record<string, string | undefined> = {},
	token?: string | null
): Promise<Response> => act(walletDomainsRoutes, '/console/wallet-domains', vars, token);

/** the address every case here asks on, which is this deployment's own. */
const OWN_HOST = 'give.example.workers.dev';

/** every drawn wallet active, with nothing said about any of them. */
const DRAWING: WalletDomain['wallets'] = {
	apple_pay: { state: 'active', detail: null },
	google_pay: { state: 'active', detail: null },
	link: { state: 'active', detail: null }
};

/**
 * an account holding these hostnames for wallets and registering, drawing, whatever else it is
 * asked for.
 *
 * the money arms refuse rather than throw, so a case reads the arms it is about; the account is
 * kept as a list so a press and the read after it see the same one.
 */
function walletPort(held: readonly WalletDomain[]): PaymentProvider {
	const account = [...held];
	return {
		...refusing('stripe', 'not_configured', 'no case here asks this arm'),
		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			return { ok: true, value: [...account] };
		},
		async registerWalletDomain(host: string): Promise<PaymentResult<WalletDomain>> {
			const domain: WalletDomain = { host, enabled: true, wallets: DRAWING };
			account.push(domain);
			return { ok: true, value: domain };
		}
	};
}

/** one site row, in the operator's own order. */
function listSite(id: string, origin: string, position: number): Promise<unknown> {
	return env.DB.prepare(
		`insert into site (id, origin, position, created_at, updated_at)
		 values (?, ?, ?, 0, 0)`
	)
		.bind(id, origin, position)
		.run();
}

/** this deployment holding no Stripe key at all, which is every fork before payments are set up. */
const NO_STRIPE: Record<string, string | undefined> = { STRIPE_SECRET_KEY: undefined };

/** an organisation with somewhere to send a sample to. */
const WITH_RECIPIENT = `insert into org_profile (id, legal_name, tax_id, address_line1, city,
                          country, notification_email, created_at, updated_at)
   values ('default', 'Hope Foundation', '12-3456789', '1 Main St', 'Springfield', 'US',
           'office@hope.example', 0, 0)`;

/** the same write with a body nothing will parse. */
function saveSitesRaw(body: string): Promise<Response> {
	return sitesRoutes(
		new Request('https://give.example.workers.dev/console/sites', {
			method: 'POST',
			headers: { authorization: `Bearer ${TOKEN}` },
			body
		}),
		{ env: envWith(DEPLOYMENT) }
	);
}

/** the body a handler answered with, read once. */
async function envelopeOf(response: Response): Promise<Envelope> {
	return (await response.json()) as Envelope;
}

beforeEach(async () => {
	stub.ports = {};
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from site').run();
	await env.DB.prepare('delete from org_profile').run();
});

describe('the report this deployment answers with', () => {
	it('carries the site list and the organisation’s details', async () => {
		await env.DB.prepare(
			`insert into site (id, origin, position, created_at, updated_at)
			 values ('ste_1', 'https://acme.org', 0, 0, 0)`
		).run();
		await env.DB.prepare(
			`insert into org_profile (id, legal_name, tax_id, address_line1, city, country,
			                          deductibility_statement, created_at, updated_at)
			 values ('default', 'Hope Foundation', '12-3456789', '1 Main St', 'Springfield', 'US',
			         'No goods or services were provided in exchange for this gift.', 0, 0)`
		).run();

		const body = await envelopeOf(await report());
		expect(body.sites).toEqual(['https://acme.org']);
		expect(body.org).toMatchObject({ legal_name: 'Hope Foundation', tax_id: '12-3456789' });
	});

	/** a fresh deployment has saved no profile, and that is an answer rather than a failure. */
	it('answers null for an organisation nobody has saved', async () => {
		const body = await envelopeOf(await report());
		expect(body.org).toBeNull();
		expect(body.sites).toEqual([]);
	});

	/**
	 * the version this worker was built from, which off a build nobody tagged is nothing.
	 *
	 * the release workflow puts the tag in the build's environment and ./vite.config.ts turns it
	 * into a constant; a checkout build carries no such value, and neither does this suite. `null` is
	 * therefore the answer a console reads here from every deployment it did not install, and it
	 * judges those by migrations alone.
	 */
	it('carries no version off a build nobody tagged', async () => {
		const body = await envelopeOf(await report());
		expect(body).toHaveProperty('version');
		expect(body.version).toBeNull();
	});

	/** the console warns before the session dies, which it can only do if the expiry rides along. */
	it('carries when the session ends', async () => {
		const body = await envelopeOf(await report());
		expect(body.session).toEqual({ expiresAt: EXPIRES_AT.toISOString() });
	});

	/**
	 * no Stripe credential is on this wire at all — not whole and not cut.
	 *
	 * the case beside this one holds the whole rule; this one holds the shapes a cut credential
	 * takes, which a name-and-value sweep cannot see: a prefix or a last-four echoed back is a
	 * value neither list contains.
	 */
	it('carries no Stripe credential, whole or cut', async () => {
		const text = await (await report()).text();
		expect(text).not.toContain(STRIPE_VALUES.STRIPE_SECRET_KEY);
		expect(text).not.toContain(STRIPE_VALUES.STRIPE_WEBHOOK_SECRET);
		expect(text).not.toContain('sk_live');
		expect(text).not.toContain('whsec_');
	});

	/**
	 * no configuration value crosses this wire, and neither does the name of one.
	 *
	 * the console reads all seventeen off the Cloudflare account it is signed in to, so a member
	 * here that reported one too would be a second seed disagreeing with the first mid-deploy —
	 * which is why the envelope carries none and why this is one case over the whole list rather
	 * than an assertion per name. the name is checked as well as the value because a member is
	 * keyed by it: an envelope that carried a value back would say `SMTP_PASSWORD` before anybody
	 * looked at what was under it.
	 */
	it('names no configuration value and carries no value of one', async () => {
		const held: Record<string, string> = Object.fromEntries(
			DEPLOY_VARS.map((name, index) => [name, `held-value-${index}`])
		);
		const text = await (await report(TOKEN, held)).text();
		for (const [name, value] of Object.entries(held)) {
			expect(text).not.toContain(name);
			expect(text).not.toContain(value);
		}
	});

	/**
	 * a browser page must not be able to read this, so there is no header that would let it — and
	 * nothing between here and the console may keep a copy of which secrets are set.
	 */
	it('sends no CORS header and is never stored', async () => {
		const response = await report();
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('writing the site list', () => {
	it('stores the submitted list and answers with the report', async () => {
		const response = await saveSites({ sites: ['https://acme.org', 'https://give.acme.org'] });
		expect(response.status).toBe(200);
		const body = await envelopeOf(response);
		expect(body.sites).toEqual(['https://acme.org', 'https://give.acme.org']);
	});

	it('removes a site left out of the submitted list', async () => {
		await saveSites({ sites: ['https://acme.org', 'https://give.acme.org'] });
		const body = await envelopeOf(await saveSites({ sites: ['https://acme.org'] }));
		expect(body.sites).toEqual(['https://acme.org']);
	});

	/**
	 * the decision carried over from the sites action on the console: a removal that would
	 * leave a live form pointing at a site this deployment no longer lists is refused by name, with
	 * every form standing in the way named too. an archived form never blocks — it serves nothing
	 * and cannot be edited, so a removal blocked by one would be blocked forever.
	 */
	it('refuses to remove a site a live form still uses, naming the forms', async () => {
		await saveSites({ sites: ['https://acme.org'] });
		await env.DB.prepare(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values ('frm_console1', 'General Fund', 'live',
			         (select id from account where is_postable = 1 and code = '4110'),
			         'USD', 500, 1000000, '[2500]', ?, 0, 0)`
		)
			.bind(JSON.stringify(['https://acme.org']))
			.run();

		const response = await saveSites({ sites: [] });
		expect(response.status).toBe(409);
		const body = (await response.json()) as {
			error: string;
			message: string;
			inUse: { site: string; forms: { id: string; name: string }[] }[];
		};
		expect(body.error).toBe('site_in_use');
		expect(body.message).toContain('https://acme.org');
		expect(body.inUse).toEqual([
			{ site: 'https://acme.org', forms: [{ id: 'frm_console1', name: 'General Fund' }] }
		]);
		expect(await envelopeOf(await report())).toMatchObject({ sites: ['https://acme.org'] });
	});

	/** the existing parse boundary decides what a site may be, and its sentence is the refusal. */
	it('refuses a value there is no site in, saying what is wrong and not what was sent', async () => {
		const response = await saveSites({ sites: ['not a url'] });
		expect(response.status).toBe(422);
		const body = (await response.json()) as { error: string; message: string };
		expect(body.error).toBe('sites_refused');
		expect(body.message).toBe('invalid url');
	});

	it('stores what a row normalises to rather than the line it was sent', async () => {
		// the repair is the parse boundary's (`readOriginList` in `@better-giving/operator/origins`)
		// and this is where it lands: what is stored is the origin a browser will send, which is what
		// /api/v1 compares an `Origin` header against.
		const response = await saveSites({ sites: ['acme.org', 'https://give.acme.org/donate?x=1'] });
		expect(response.status).toBe(200);
		expect(await envelopeOf(await report())).toMatchObject({
			sites: ['https://acme.org', 'https://give.acme.org']
		});
	});

	it.each([
		{ what: 'no sites key at all', body: {} },
		{ what: 'sites that is not a list', body: { sites: 'https://acme.org' } },
		{ what: 'a list holding something other than strings', body: { sites: [7] } }
	])('refuses a body carrying $what', async ({ body }) => {
		const response = await saveSites(body);
		expect(response.status).toBe(400);
		expect((await response.json()) as { error: string }).toMatchObject({ error: 'bad_body' });
	});

	/** the body is read exactly once here, so the failure of that read is this route's to answer. */
	it('refuses a body that is not JSON at all', async () => {
		const response = await saveSitesRaw('sites=https://acme.org');
		expect(response.status).toBe(400);
		expect((await response.json()) as { message: string }).toMatchObject({
			error: 'bad_body',
			message: 'The request body is not JSON.'
		});
	});
});

describe('writing the organisation’s legal identity', () => {
	const PROFILE = {
		legal_name: 'Hope Foundation',
		tax_id: '12-3456789',
		address_line1: '1 Main St',
		city: 'Springfield',
		country: 'US'
	};

	it('stores the submitted profile and answers with the report', async () => {
		const response = await saveOrg({ org: PROFILE });
		expect(response.status).toBe(200);
		const body = await envelopeOf(response);
		expect(body.org).toMatchObject(PROFILE);
	});

	it('reads back through a later report', async () => {
		await saveOrg({ org: PROFILE });
		const body = await envelopeOf(await report());
		expect(body.org).toMatchObject({ legal_name: 'Hope Foundation' });
	});

	/**
	 * the existing parse boundary again, and its whole error map rather than the first failure: a
	 * console reporting one problem per round trip is how a ten-field save takes ten submissions.
	 */
	it('refuses a profile missing what a receipt cannot be printed without, naming the fields', async () => {
		const response = await saveOrg({ org: { legal_name: 'Hope Foundation' } });
		expect(response.status).toBe(422);
		const body = (await response.json()) as { error: string; errors: Record<string, string> };
		expect(body.error).toBe('org_refused');
		expect(Object.keys(body.errors)).toEqual(
			expect.arrayContaining(['tax_id', 'address_line1', 'city', 'country'])
		);
	});

	it.each([
		{ what: 'no org key at all', body: {} },
		{ what: 'an org that is not an object', body: { org: 'Hope Foundation' } },
		{ what: 'a field that is not a string', body: { org: { legal_name: 7 } } }
	])('refuses a body carrying $what', async ({ body }) => {
		const response = await saveOrg(body);
		expect(response.status).toBe(400);
		expect((await response.json()) as { error: string }).toMatchObject({ error: 'bad_body' });
	});

	/** a write answers with the report, so the same headers hold on it. */
	it('sends no CORS header and is never stored', async () => {
		const response = await saveOrg({ org: PROFILE });
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

/**
 * the act the console cannot perform for itself: it needs this deployment's own mail transport and
 * this deployment's own SMTP credentials, and it holds neither.
 *
 * the pool sets no mail values, so every case that reaches a send lands on the port's refusal — and
 * that is the arm worth asserting here anyway, because it is the one a fresh fork presses.
 */
describe('sending a test email', () => {
	/**
	 * CLAUDE.md: a body reporting a failure names the offending value and the command that sets it.
	 * those sentences are the port's and reach the console verbatim — a paraphrase would throw away
	 * the only actionable part.
	 */
	it('names the values to set when this deployment cannot send at all', async () => {
		const response = await sendTest();
		expect(response.status).toBe(500);
		const body = (await response.json()) as { outcome: string; detail: string; to: string };
		expect(body.outcome).toBe('failed');
		expect(body.detail).toContain('SMTP_HOST');
		// and where it would have gone, which is what the press named and not what any row holds.
		expect(body.to).toBe('ops@hope.example');
	});

	/**
	 * the destination is the caller's, and the organisation row does not decide it. a deployment
	 * holding a notification address sends to the press's address anyway, which is the whole reason
	 * the box on the console is retypeable: a mail host checked against an inbox somebody watches.
	 */
	it('sends where the press said, not where the organisation row points', async () => {
		await env.DB.prepare(WITH_RECIPIENT).run();
		const response = await sendTest({}, TOKEN, { to: 'someone.else@hope.example' });
		const body = (await response.json()) as { to: string };
		expect(body.to).toBe('someone.else@hope.example');
	});

	/** a pasted address arrives with the whitespace around it, and that is not a refusal. */
	it('takes an address with space around it', async () => {
		const response = await sendTest({}, TOKEN, { to: '  ops@hope.example \n' });
		expect((await response.json()) as { to: string }).toMatchObject({ to: 'ops@hope.example' });
	});

	/**
	 * input validation and not a threat model: whoever holds this credential can deploy code to
	 * this worker, so refusing a destination buys no capability back. what it buys is a caller
	 * who typed something that is not an address hearing so instead of watching an inbox.
	 */
	it.each([
		{ what: 'a value that is not an address', to: 'Hope Foundation' },
		{ what: 'an empty one', to: '   ' },
		{ what: 'a second address beside the first', to: 'a@hope.example b@hope.example' },
		{ what: 'one longer than an address may be', to: `${'a'.repeat(320)}@hope.example` }
	])('refuses $what, and sends nothing', async ({ to }) => {
		const response = await sendTest({}, TOKEN, { to });
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string; message: string; fix: string };
		expect(body.error).toBe('bad_to');
		// CLAUDE.md: a 4xx body names the offending value and where to fix it.
		expect(body.message).toContain('to');
		expect(body.fix).toContain('To');
	});

	it.each([
		{ what: 'no destination at all', body: {} },
		{ what: 'a destination that is not a string', body: { to: 7 } }
	])('refuses a body carrying $what', async ({ body }) => {
		const response = await sendTest({}, TOKEN, body);
		expect(response.status).toBe(400);
		expect((await response.json()) as { error: string }).toMatchObject({ error: 'bad_body' });
	});

	it('refuses a body that is not JSON at all', async () => {
		const response = await testEmailRoutes(
			new Request('https://give.example.workers.dev/console/test-email', {
				method: 'POST',
				headers: { authorization: `Bearer ${TOKEN}` },
				body: 'to=ops@hope.example'
			}),
			{ env: envWith(DEPLOYMENT) }
		);
		expect(response.status).toBe(400);
		expect((await response.json()) as { message: string }).toMatchObject({
			error: 'bad_body',
			message: 'The request body is not JSON.'
		});
	});

	/** the credential the send is made with never comes back out of it. */
	it('carries no mail credential in its answer', async () => {
		const response = await sendTest({
			SMTP_HOST: 'smtp.hope.example',
			SMTP_USERNAME: 'postmaster@hope.example',
			SMTP_PASSWORD: 'a-password-nothing-may-echo',
			MAIL_FROM: 'donations@hope.example'
		});
		expect(await response.text()).not.toContain('a-password-nothing-may-echo');
	});

	it('sends no CORS header and is never stored', async () => {
		const response = await sendTest();
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	/** a press and never a read: a GET that sent a message would send one on a reload. */
	it('answers a read with the method it takes', async () => {
		const response = await testEmailRoutes(
			new Request('https://give.example.workers.dev/console/test-email', {
				headers: bearer(TOKEN)
			}),
			{ env: envWith(DEPLOYMENT) }
		);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
	});
});

/**
 * the other act only this deployment can perform: it goes through the payment port with the key
 * this deployment holds, which is the whole asymmetry with setting Stripe up — that press calls the
 * processor with a key an operator has just pasted, because there is nothing on the deployment yet
 * to ask.
 */
describe('setting up repeating gifts', () => {
	/** PayPal's two credentials, which is what makes the deployment configured for it. */
	const PAYPAL_VALUES = {
		PAYPAL_CLIENT_ID: 'notarealclientid',
		PAYPAL_CLIENT_SECRET: 'notarealclientsecret'
	};

	/** a deployment set up on PayPal and on nothing else, which is the fork this block is about. */
	const PAYPAL_ONLY = { ...NO_STRIPE, ...PAYPAL_VALUES };

	/** an account answering the two repeating-gift arms, and refusing everything else. */
	function giftPort(
		processor: ProcessorName,
		script: {
			read?: PaymentResult<RecurringGiftStanding>;
			prepare?: PaymentResult<RecurringGiftProvision>;
		}
	): PaymentProvider {
		return {
			...refusing(processor, 'not_configured', 'no case here asks this arm'),
			async readRecurringGiftProvision(): Promise<PaymentResult<RecurringGiftStanding>> {
				return script.read ?? { ok: false, reason: 'internal_error', detail: 'not scripted' };
			},
			async prepareRecurringGifts(): Promise<PaymentResult<RecurringGiftProvision>> {
				return script.prepare ?? { ok: false, reason: 'internal_error', detail: 'not scripted' };
			}
		};
	}

	const reportOf = async (response: Response): Promise<RecurringReport> =>
		(await response.json()) as RecurringReport;

	const setupOf = async (response: Response): Promise<RecurringSetupReport> =>
		(await response.json()) as RecurringSetupReport;

	/**
	 * the deployment this block exists for: PayPal's boxes are full, Stripe's are empty, and the one
	 * press has to reach the account the deployment actually holds.
	 */
	it('presses on the processor a deployment holding one of them holds', async () => {
		stub.ports.paypal = giftPort('paypal', { prepare: { ok: true, value: { created: true } } });

		const report = await setupOf(await setUpRecurring(PAYPAL_ONLY));

		expect(report.outcome).toBe('set_up');
		expect(report.processors.map((one) => one.processor)).toEqual(['paypal']);
		expect(report.processors[0]?.label).toBe('PayPal');
	});

	/**
	 * the deployment the naming exists for: PayPal is set up and Stripe's key was stored seconds ago,
	 * too recently for the values this press reads to hold it.
	 *
	 * asked about the configured accounts alone, the press reaches PayPal, hears that it already has
	 * what it needs, and reports the run finished having never asked Stripe about anything. named, the
	 * account is asked, and what comes back is the refusal that says to press again — as a fact as
	 * well as a sentence, because a caller matching a fragment of that sentence is matching one that
	 * names this processor's variable and can never name another's.
	 */
	it('presses on the processor the body names, and not on the one it counts as configured', async () => {
		stub.ports.paypal = giftPort('paypal', { prepare: { ok: true, value: { created: false } } });

		const response = await setUpRecurringOn('stripe', PAYPAL_ONLY);
		const report = await setupOf(response);

		expect(response.status).toBe(500);
		expect(report.processors.map((one) => one.processor)).toEqual(['stripe']);
		expect(report.processors[0]?.reason).toBe('no_key');
		expect(report.processors[0]?.detail).toContain('STRIPE_SECRET_KEY');
	});

	/**
	 * and an account the deployment does hold the key for is the other member, whatever the sentence
	 * says: the press was made, the processor answered, and pressing again answers the same way.
	 */
	it('names a refusal by the processor as one, on an account it holds the key for', async () => {
		stub.ports.stripe = giftPort('stripe', {
			prepare: {
				ok: false,
				reason: 'provider_error',
				detail: 'Stripe would not create the product.'
			}
		});

		const report = await setupOf(await setUpRecurringOn('stripe'));

		expect(report.processors[0]?.reason).toBe('failed');
		expect(report.processors[0]?.detail).toBe('Stripe would not create the product.');
	});

	/**
	 * a body whose `processor` is null names none, which is the press an operator makes.
	 *
	 * a caller that sends the value it holds rather than leaving the name out is not making a
	 * different request, and a null read as a name no processor answers to would refuse a press that
	 * named nothing.
	 */
	it('reads a body naming no processor as the press that acts on every configured one', async () => {
		stub.ports.paypal = giftPort('paypal', { prepare: { ok: true, value: { created: true } } });

		const report = await setupOf(await setUpRecurringOn(null, PAYPAL_ONLY));

		expect(report.processors.map((one) => one.processor)).toEqual(['paypal']);
	});

	/**
	 * a name no processor answers to is refused rather than pressed on whatever the deployment holds.
	 *
	 * the refusal names the value and what it takes, because a 4xx on this surface is read by an agent
	 * (CLAUDE.md).
	 */
	it('refuses a body naming a processor this release cannot charge on', async () => {
		const response = await setUpRecurringOn('square');
		const refusal = (await response.json()) as { error: string; message: string; fix: string };

		expect(response.status).toBe(400);
		expect(refusal.error).toBe('bad_processor');
		expect(refusal.message).toContain('`processor`');
		expect(refusal.fix).toContain('stripe');
	});

	/** and reads the same account, rather than reporting on one it holds no key for. */
	it('reports a standing for the processor a deployment holds a key for', async () => {
		stub.ports.paypal = giftPort('paypal', { read: { ok: true, value: 'ready' } });

		const report = await reportOf(await readRecurring(PAYPAL_ONLY));

		expect(report.processors).toEqual([
			{ processor: 'paypal', label: 'PayPal', reading: { state: 'ready' } }
		]);
	});

	/**
	 * a standing only for the accounts this deployment can reach.
	 *
	 * a reading of an account nobody named would be a row an operator is asked to act on over keys
	 * they have never set, and the boxes under it are already the whole truth of that state.
	 */
	it('reports nothing at all for a processor it holds no key for', async () => {
		stub.ports.stripe = giftPort('stripe', { read: { ok: true, value: 'absent' } });

		const report = await reportOf(await readRecurring());

		expect(report.processors.map((one) => one.processor)).toEqual(['stripe']);
	});

	/** and nothing whatever on a fork holding neither processor's credentials. */
	it('reports no standing at all where no processor is configured', async () => {
		expect(await reportOf(await readRecurring(NO_STRIPE))).toEqual({ processors: [] });
	});

	/**
	 * one press over both accounts, and neither one's answer stands for the other: a donor is
	 * offered a repeating gift only where every configured processor can collect one, so an account
	 * that is ready says nothing about the deployment while the other is short.
	 */
	it('reports every configured processor’s own outcome and answers with the worst', async () => {
		stub.ports.stripe = giftPort('stripe', { prepare: { ok: true, value: { created: true } } });
		stub.ports.paypal = giftPort('paypal', {
			prepare: {
				ok: false,
				reason: 'provider_error',
				detail: 'PayPal would not create the product.'
			}
		});

		const response = await setUpRecurring(PAYPAL_VALUES);
		const report = await setupOf(response);

		expect(response.status).toBe(500);
		expect(report.outcome).toBe('failed');
		expect(report.processors).toEqual([
			{ processor: 'stripe', label: 'Stripe', outcome: 'set_up', detail: null, reason: null },
			{
				processor: 'paypal',
				label: 'PayPal',
				outcome: 'failed',
				detail: 'PayPal would not create the product.',
				reason: 'failed'
			}
		]);
	});

	/**
	 * the read is the port's read arm and never the find-or-create one: a console drawing a block
	 * from `prepare` would add a product to an operator's processor account as a side effect of them
	 * opening a page.
	 */
	it('answers a read with a standing rather than a refusal, and provisions nothing', async () => {
		const response = await readRecurring();
		const report = await reportOf(response);
		const reading = report.processors[0]?.reading;

		expect(response.status).toBe(200);
		expect(reading?.state).toBe('unreadable');
		expect(reading?.state === 'unreadable' && reading.detail.length).toBeGreaterThan(0);
	});

	/**
	 * a press carrying no body at all is the operator's, and it acts on every account this deployment
	 * holds the credentials for — which on a deployment holding none is no account, and a refusal
	 * naming where the credentials come from rather than a report about accounts nobody named.
	 */
	it('answers a deployment holding no credentials at all with where to set them', async () => {
		const response = await setUpRecurring(NO_STRIPE);
		const refusal = (await response.json()) as { error: string; message: string; fix: string };

		expect(response.status).toBe(409);
		expect(refusal.error).toBe('nothing_to_set_up');
		expect(refusal.fix).toContain('STRIPE_SECRET_KEY');
		expect(refusal.fix).toContain('PAYPAL_CLIENT_ID');
	});

	/**
	 * nothing is written on any arm. what this press changes lives on somebody else's account and
	 * this deployment keeps no copy of it — no row, no id, no flag — which is what lets a console
	 * read the account fresh rather than reconciling a claim about a third party's state.
	 */
	it('writes nothing to this deployment', async () => {
		await setUpRecurring(NO_STRIPE);
		await readRecurring(NO_STRIPE);
		const body = await envelopeOf(await report());
		expect(body.org).toBeNull();
		expect(body.sites).toEqual([]);
	});

	/** the key the call is made with never comes back out of it. */
	it('carries no Stripe key in either answer', async () => {
		const pressed = await (await setUpRecurring()).text();
		const read = await (await readRecurring()).text();
		expect(pressed).not.toContain(STRIPE_VALUES.STRIPE_SECRET_KEY);
		expect(read).not.toContain(STRIPE_VALUES.STRIPE_SECRET_KEY);
	});

	it('sends no CORS header and is never stored', async () => {
		const response = await setUpRecurring(NO_STRIPE);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('the accounts this deployment charges on', () => {
	/**
	 * a fold per processor whether or not this deployment can charge on it, because the fold for one
	 * it cannot is where the boxes that configure it are.
	 */
	it('carries a reading for every processor this release can charge on', async () => {
		const body = (await (await readPayments()).json()) as PaymentsReport;

		expect(body.processors.map((entry) => entry.processor)).toEqual([...PAYMENT_PROCESSORS]);
	});

	/**
	 * the whole point of the shape: a deployment set up on one processor says nothing about the other.
	 *
	 * `unconfigured` is not a read that failed and must not be drawn as one — nothing was asked, so
	 * there is nothing about the account to report and no row to colour in. what it carries instead is
	 * which boxes are empty, which is a fact the deployment holds and the console does not.
	 */
	it('reports a processor it holds no credentials for as unconfigured', async () => {
		const reading = await readingFor('paypal');

		expect(reading.state).toBe('unconfigured');
		expect(reading.state === 'unconfigured' && reading.unset).toEqual([
			'PAYPAL_CLIENT_ID',
			'PAYPAL_CLIENT_SECRET'
		]);
	});

	/** and it says nothing whatever about that account — not a rail, not an endpoint, not a wallet. */
	it('reports no reading at all under a processor it holds no credentials for', async () => {
		const reading = await readingFor('paypal');

		expect(Object.keys(reading).sort()).toEqual(['label', 'processor', 'state', 'unset']);
	});

	/** the name an operator is shown, decided on the deployment and travelling rather than spelled. */
	it('names each processor the way an operator is shown it', async () => {
		const body = (await (await readPayments()).json()) as PaymentsReport;

		expect(body.processors.map((entry) => entry.label)).toEqual(['Stripe', 'PayPal']);
	});

	/**
	 * the deployment with no Stripe key at all, which is every fork before payments are set up.
	 *
	 * it is the arm above the readings rather than a rails reading that could not be made:
	 * `unreadable` is a deployment with something wrong with it, and this one merely has not been
	 * set up yet.
	 */
	it('reports a deployment holding no Stripe key as unconfigured rather than unreadable', async () => {
		const reading = await readingFor('stripe', NO_STRIPE);

		expect(reading.state).toBe('unconfigured');
		expect(reading.state === 'unconfigured' && reading.unset).toEqual(['STRIPE_SECRET_KEY']);
	});

	/** a key is held, so the read was attempted and came away without an answer. */
	it('reports a key the processor will not answer for as a rails read that failed', async () => {
		const reading = await configuredReading('stripe');

		expect(reading.rails.state).toBe('unreadable');
		expect(reading.rails.state === 'unreadable' && reading.rails.detail.length).toBeGreaterThan(0);
	});

	/**
	 * the standing the deleted settings screen used to report and nothing has since. `unset` is a
	 * hole and `unconfirmable` is a deployment that may well be working, and the two send an
	 * operator to opposite places — see `webhookSecretStanding` in
	 * $lib/server/payments/webhook-secret.ts.
	 */
	it('answers a deployment holding no signing secret with unset', async () => {
		const reading = await configuredReading('stripe', { STRIPE_WEBHOOK_SECRET: undefined });

		expect(reading.webhook).toEqual({ state: 'unset', detail: null });
	});

	/**
	 * an endpoint nobody could read carries no stamp to compare against, and reported as a mismatch
	 * it would send an operator to replace a working endpoint and cost them the secret they have.
	 */
	it('answers a deployment whose account could not be read with unconfirmable', async () => {
		const reading = await configuredReading('stripe');

		expect(reading.webhook.state).toBe('unconfirmable');
	});

	/**
	 * the third member: what the endpoint at this deployment's address is subscribed to. it is not
	 * the secret's standing and cannot be got from it — an endpoint switched off or short of an
	 * event verifies every delivery it makes and makes fewer than it should.
	 */
	it('answers a deployment that could not ask with a subscription it cannot state', async () => {
		const reading = await configuredReading('stripe');

		expect(reading.subscription.state).toBe('unreadable');
	});

	/**
	 * neither credential leaves the worker, and the signing secret cannot: what crosses the wire is
	 * which of four states it is in, computed from a digest that stays here
	 * (`packages/operator/src/stripe/secret-fingerprint.ts`).
	 */
	it('carries neither Stripe credential in its answer', async () => {
		const said = await (await readPayments()).text();
		expect(said).not.toContain(STRIPE_VALUES.STRIPE_SECRET_KEY);
		expect(said).not.toContain(STRIPE_VALUES.STRIPE_WEBHOOK_SECRET);
	});

	/** it reads and changes nothing, here or on the account. */
	it('writes nothing to this deployment', async () => {
		await readPayments(NO_STRIPE);
		const body = await envelopeOf(await report());
		expect(body.org).toBeNull();
		expect(body.sites).toEqual([]);
	});

	it('answers a press with the method it takes', async () => {
		const response = await act(paymentsRoutes, '/console/payments', NO_STRIPE);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET');
	});

	it('sends no CORS header and is never stored', async () => {
		const response = await readPayments(NO_STRIPE);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

/**
 * the same reading of a processor that answers differently on three of its four members.
 *
 * the port is stood in for rather than met, which is what keeps every case here off the network: the
 * account arms answer what the adapter asserts (`readAccountChargeability` in
 * $lib/server/payments/paypal.ts argues why it asserts), and the two arms this release does not
 * manage refuse the way the adapter refuses them. that the real adapter refuses those two with
 * `unsupported` is held where the real adapter is used —
 * $lib/server/payments/webhook-registration.spec.ts and
 * $lib/server/payments/wallet-domains.spec.ts — so what is left here is the mapping onto the wire,
 * which is this route's own.
 */
describe('a deployment set up on a processor that publishes no per-rail approval', () => {
	const PAYPAL_VALUES = {
		PAYPAL_CLIENT_ID: 'notarealclientid',
		PAYPAL_CLIENT_SECRET: 'notarealclientsecret'
	};

	/** the two rails PayPal settles, asserted active the way the adapter asserts them. */
	function paypalPort(): PaymentProvider {
		const rails = { paypal: 'active', venmo: 'active' } as const;
		return {
			...refusing('paypal', 'not_configured', 'no case here asks this arm'),
			async readAccountChargeability(): Promise<PaymentResult<AccountChargeability>> {
				return { ok: true, value: { chargesEnabled: true, rails } };
			},
			async readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>> {
				return {
					ok: true,
					value: {
						paypal: { offered: true, switchedOn: true },
						venmo: { offered: true, switchedOn: true }
					}
				};
			},
			async listWebhookEndpoints(): Promise<PaymentResult<WebhookEndpointRegistry>> {
				return {
					ok: false,
					reason: 'unsupported',
					detail:
						'This release does not manage PayPal’s listeners. The listener for this deployment’s ' +
						'address is created on the PayPal developer dashboard.'
				};
			},
			async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
				return {
					ok: false,
					reason: 'unsupported',
					detail: 'PayPal registers no hostname for wallets.'
				};
			}
		};
	}

	beforeEach(() => {
		stub.ports.paypal = paypalPort();
	});

	/**
	 * the honesty this whole reading turns on. every rail comes back `approved` because the
	 * credentials authenticated, and a console that drew that the way it draws Stripe's would tell an
	 * operator Venmo is switched on for an account that has never enabled it.
	 */
	it('says what its rail standings are worth', async () => {
		const reading = await configuredReading('paypal', PAYPAL_VALUES);

		expect(reading.rails.state === 'read' && reading.rails.evidence).toBe('credentials_only');
	});

	/** and the sentence beside each rail says the same thing in the words an operator reads. */
	it('speaks beside every approved rail rather than leaving it silent', async () => {
		const reading = await configuredReading('paypal', PAYPAL_VALUES);
		const rails = reading.rails.state === 'read' ? reading.rails.rails : [];

		expect(rails.map((line) => line.rail)).toEqual(['paypal', 'venmo']);
		for (const line of rails) {
			expect(line.standing).toBe('approved');
			expect(line.note).toMatch(/PayPal/);
			expect(line.note).not.toMatch(/Stripe/);
		}
	});

	/**
	 * an endpoint this release does not manage is not an endpoint nobody could read, and the two send
	 * an operator to opposite places. this one is a registration to make by hand, so the arm carries
	 * the address it has to be pointed at — which nothing else in this tree ever tells them.
	 */
	it('reports the endpoint as unmanaged and says where deliveries have to arrive', async () => {
		const reading = await configuredReading('paypal', PAYPAL_VALUES);

		expect(reading.subscription.state).toBe('unmanaged');
		expect(reading.subscription.state === 'unmanaged' && reading.subscription.address).toBe(
			`https://${OWN_HOST}/api/paypal/webhook`
		);
	});

	/** the listener id has the same lifecycle as a signing secret, and an unset one is a hole. */
	it('reports a deployment holding no listener id as unset', async () => {
		const reading = await configuredReading('paypal', PAYPAL_VALUES);

		expect(reading.webhook).toEqual({ state: 'unset', detail: null });
	});

	/**
	 * a processor that draws its funding sources in its own window registers no hostname anywhere, so
	 * there is nothing to read and no section to draw. an empty reading would be a screen inviting an
	 * operator to register sites that would do nothing.
	 */
	it('reports no wallet section at all rather than an empty one', async () => {
		const reading = await configuredReading('paypal', PAYPAL_VALUES);

		expect(reading.wallets).toBeNull();
	});

	/** and a deployment set up on both says nothing false about either. */
	it('leaves the other processor’s reading alone', async () => {
		const body = (await (await readPayments(PAYPAL_VALUES)).json()) as PaymentsReport;
		const stripe = body.processors.find((entry) => entry.processor === 'stripe');

		expect(stripe?.state).toBe('configured');
	});
});

/**
 * the repair for the reading above: the same endpoint subscribed to what it is short of and
 * switched back on, keeping the signing secret it has.
 *
 * it is the cheap half of the pair. replacing an endpoint mints a new secret and costs a deployment
 * its verification until somebody carries the new one to it, and nothing about a missing
 * subscription is worth that.
 */
describe('bringing the webhook endpoint level', () => {
	it('answers a deployment holding no Stripe key with what to set', async () => {
		const response = await repairWebhook(NO_STRIPE);
		expect(response.status).toBe(500);
		const body = (await response.json()) as { outcome: string; detail: string };
		expect(body.outcome).toBe('failed');
		expect(body.detail).toContain('STRIPE_SECRET_KEY');
		expect(body.detail).toContain('better-giving open');
	});

	/**
	 * the endpoint is found by this deployment's own address inside the worker, so there is nothing
	 * for a caller to name — and an id a request could carry would be a press acting on whichever
	 * endpoint it was told to, including another deployment's on the same account.
	 */
	it('answers a read with the method it takes', async () => {
		const response = await webhookRepairRoutes(
			new Request('https://give.example.workers.dev/console/webhook-repair', {
				headers: bearer(TOKEN)
			}),
			{ env: envWith(DEPLOYMENT) }
		);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
	});

	/** the repair touches neither credential, and neither may come back out of it. */
	it('carries no Stripe credential in its answer', async () => {
		const said = await (await repairWebhook()).text();
		expect(said).not.toContain(STRIPE_VALUES.STRIPE_SECRET_KEY);
		expect(said).not.toContain(STRIPE_VALUES.STRIPE_WEBHOOK_SECRET);
	});

	/** what it changes is on somebody else's account, and this deployment keeps no copy of it. */
	it('writes nothing to this deployment', async () => {
		await repairWebhook(NO_STRIPE);
		const body = await envelopeOf(await report());
		expect(body.org).toBeNull();
		expect(body.sites).toEqual([]);
	});

	it('sends no CORS header and is never stored', async () => {
		const response = await repairWebhook(NO_STRIPE);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

/**
 * which hostnames the account will draw wallet buttons on, and the press that registers them.
 *
 * the hostnames are the deployment's own address and the sites it has listed, and neither is
 * anything a caller sends: a hostname that travelled through a page would be a registration made on
 * the operator's own Stripe account against whatever the page said. so the cases below vary the
 * `site` table and the address they ask on, and never a body.
 */
describe('the hostnames this deployment wants wallet buttons on', () => {
	/**
	 * the donation page a deployment serves is on no `site` row (CLAUDE.md), so it is first rather
	 * than absent — and a site naming the same host is the operator listing the address the
	 * deployment already answers on, which is one registration and not two.
	 */
	it('reads its own address first and the sites it lists after it, in their stored order', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		await listSite('ste_2', `https://${OWN_HOST}`, 1);
		await listSite('ste_3', 'https://hope.example:8443', 2);
		stub.ports.stripe = walletPort([]);

		const wallets = (await configuredReading('stripe')).wallets as WalletsReading;
		expect(wallets.state).toBe('read');
		if (wallets.state !== 'read') return;
		expect(wallets.hosts.map((line) => line.host)).toEqual([
			OWN_HOST,
			'www.hope.example',
			'hope.example'
		]);
		expect(wallets.hosts.map((line) => line.own)).toEqual([true, false, false]);
	});

	/**
	 * the whole line as it crosses, because what a console draws under a hostname is the processor's
	 * own sentence about the wallet it is not drawing — the only thing either end can say about what
	 * to do, since what such a wallet is short of is settled on the operator's own domain.
	 */
	it('carries each wallet’s state and the processor’s own sentence about it', async () => {
		stub.ports.stripe = walletPort([
			{
				host: OWN_HOST,
				enabled: true,
				wallets: {
					...DRAWING,
					google_pay: { state: 'inactive', detail: 'The domain does not serve the hosted file.' }
				}
			}
		]);

		const wallets = (await configuredReading('stripe')).wallets;
		const expected: WalletsReading = {
			state: 'read',
			hosts: [
				{
					host: OWN_HOST,
					own: true,
					standing: 'wallet_inactive',
					wallets: {
						apple_pay: { state: 'active', detail: null },
						google_pay: {
							state: 'inactive',
							detail: 'The domain does not serve the hosted file.'
						},
						link: { state: 'active', detail: null }
					}
				}
			]
		};
		expect(wallets).toEqual(expected);
	});

	/**
	 * a registration the processor is not honouring draws no wallet whatever its wallets say, and
	 * reported off the wallets alone it would read as finished: the account holds the site, every
	 * wallet is active, and the donor is shown no button.
	 */
	it('reports a registration the account is not honouring as switched off', async () => {
		stub.ports.stripe = walletPort([{ host: OWN_HOST, enabled: false, wallets: DRAWING }]);

		const wallets = (await configuredReading('stripe')).wallets as WalletsReading;
		expect(wallets.state === 'read' && wallets.hosts[0]?.standing).toBe('switched_off');
	});

	/**
	 * a deployment that has never been set up asks nothing, so there is no reading of hostnames at all
	 * rather than one that failed — the same arm the rails beside it land on, because both go through
	 * one port with one key.
	 */
	it('reads no hostname at all on a deployment holding no key', async () => {
		const reading = await readingFor('stripe', NO_STRIPE);

		expect(reading.state).toBe('unconfigured');
	});

	/** the press: a hostname the account does not hold is registered, and says so. */
	it('registers the hostnames the account does not hold', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		stub.ports.stripe = walletPort([]);

		const response = await levelWallets();
		expect(response.status).toBe(200);
		const report = (await response.json()) as WalletLevellingReport;
		expect(report.state).toBe('levelled');
		if (report.state !== 'levelled') return;
		expect(report.hosts.map((entry) => entry.line.host)).toEqual([OWN_HOST, 'www.hope.example']);
		expect(report.hosts.map((entry) => entry.changed)).toEqual([true, true]);
		expect(report.hosts.map((entry) => entry.line.standing)).toEqual(['drawing', 'drawing']);
		expect(report.hosts.map((entry) => entry.detail)).toEqual([null, null]);
	});

	/**
	 * a deployment with no site listed is an ordinary one rather than a broken one — it serves its
	 * forms on the donation page at its own address — so the press has a hostname to level whatever
	 * the list holds.
	 */
	it('levels its own address on a deployment that lists no site', async () => {
		stub.ports.stripe = walletPort([]);

		const report = (await (await levelWallets()).json()) as WalletLevellingReport;
		expect(report.state === 'levelled' && report.hosts.length).toBe(1);
		expect(report.state === 'levelled' && report.hosts[0]?.line).toEqual({
			host: OWN_HOST,
			own: true,
			standing: 'drawing',
			wallets: DRAWING
		});
	});

	/**
	 * nothing was attempted, so it is the read that opens the press failing rather than any hostname
	 * — a 500 for ./console.webhook-repair.ts's reason: no value a caller could send fixes it.
	 */
	it('answers a deployment holding no key with what to set, having pressed nothing', async () => {
		const response = await levelWallets(NO_STRIPE);
		expect(response.status).toBe(500);
		const report = (await response.json()) as WalletLevellingReport;
		expect(report.state).toBe('unreadable');
		expect(report.state === 'unreadable' && report.reason).toBe('no_key');
		expect(report.state === 'unreadable' && report.detail).toContain('STRIPE_SECRET_KEY');
	});

	/**
	 * the hostnames are settled by the address the request reached and by this deployment's own
	 * rows, so there is nothing for a caller to name and no read at this address to answer.
	 */
	it('answers a read with the method it takes', async () => {
		const response = await walletDomainsRoutes(
			new Request(`https://${OWN_HOST}/console/wallet-domains`, { headers: bearer(TOKEN) }),
			{ env: envWith(DEPLOYMENT) }
		);
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
	});

	it('sends no CORS header and is never stored', async () => {
		const response = await levelWallets(NO_STRIPE);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

/**
 * the check in front of all five, carried over from the hook it used to be a branch in.
 *
 * the absence of a rate limiter on this surface rests on one property, and it is the property
 * asserted below: a refused request costs no statement against the database and no binding call.
 * were the check ever moved into the route files, a wrong token would start paying for a read
 * first and this surface would be worth metering ($lib/server/console/surface.ts).
 *
 * the sentences themselves are $lib/server/console/access.spec.ts's, over the whole refusal table.
 * what is here is that the check runs at all, that it runs before the endpoint beneath it reads,
 * and that its answer reaches the wire as this surface's envelope.
 */
describe('the credential in front of the surface', () => {
	/**
	 * the pool's `DB` with every statement counted, over the real binding.
	 *
	 * nothing here stands in for D1 — every statement still runs against the real database and
	 * returns what it returns. what is counted is the traffic to it, which is the claim worth
	 * making about a refused request: it must cost no read at all.
	 */
	function countingBinding(): { readonly binding: D1Database; readonly prepared: () => number } {
		let prepared = 0;
		const binding = new Proxy(env.DB, {
			get(target, property) {
				if (property === 'prepare') {
					return (query: string) => {
						prepared += 1;
						return target.prepare(query);
					};
				}
				// bound to the target rather than handed back bare: these are a native class's
				// methods and calling one with the proxy as `this` throws.
				const value = Reflect.get(target, property) as unknown;
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
		return { binding, prepared: () => prepared };
	}

	/** a token in the right shape that this deployment does not hold. */
	const WRONG = formatConsoleToken(EXPIRES_AT, 'q'.repeat(CONSOLE_TOKEN_MIN_RANDOM));

	it('refuses a request carrying no credential, before any read at all', async () => {
		const counted = countingBinding();
		const response = await reportRoutes(new Request('https://give.example.workers.dev/console'), {
			env: envWith({ ...DEPLOYMENT, DB: counted.binding })
		});

		expect(response.status).toBe(401);
		expect(counted.prepared()).toBe(0);
		expect((await response.json()) as { error: string }).toMatchObject({ error: 'no_bearer' });
	});

	it('refuses a wrong token without ever reaching the write beneath it', async () => {
		const counted = countingBinding();
		const response = await sitesRoutes(
			new Request('https://give.example.workers.dev/console/sites', {
				method: 'POST',
				headers: bearer(WRONG),
				body: JSON.stringify({ sites: ['https://acme.org'] })
			}),
			{ env: envWith({ ...DEPLOYMENT, DB: counted.binding }) }
		);

		expect(response.status).toBe(401);
		expect(counted.prepared()).toBe(0);
		expect((await response.json()) as { error: string }).toMatchObject({
			error: 'session_mismatch'
		});
		// and nothing was written, which a status alone would not say.
		expect(await envelopeOf(await report())).toMatchObject({ sites: [] });
	});

	/**
	 * the wire caller's refusal is a body it can read, and it is the one thing the position of
	 * this check buys that a place under the protected layout would not: the gate there answers an
	 * anonymous caller with a 303 to an HTML login, which on a JSON wire is a console that reports
	 * the login page as the deployment's answer.
	 */
	it.each([
		{ surface: 'the report', ask: () => report(null) },
		{ surface: 'the site list', ask: () => saveSites({ sites: [] }, null) },
		{ surface: 'the organisation', ask: () => saveOrg({ org: {} }, null) },
		{ surface: 'the test send', ask: () => sendTest({}, null) },
		{ surface: 'repeating gifts', ask: () => setUpRecurring({}, null) },
		{ surface: 'the webhook repair', ask: () => repairWebhook({}, null) },
		{ surface: 'the wallet registration', ask: () => levelWallets({}, null) }
	])('answers $surface with the refusal envelope and never a redirect', async ({ ask }) => {
		const response = await ask();
		expect(response.status).toBe(401);
		expect(response.headers.get('location')).toBeNull();
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(
			(await response.json()) as { error: string; message: string; fix: string }
		).toMatchObject({ error: 'no_bearer' });
	});
});
