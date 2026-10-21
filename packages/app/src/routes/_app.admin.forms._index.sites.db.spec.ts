import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { refusing } from '$lib/server/payments/provider';
import type {
	PaymentProvider,
	PaymentResult,
	ProcessorName,
	WalletDomain
} from '$lib/server/payments/provider';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import {
	deployed,
	formBody,
	freshDeployment,
	ORIGIN,
	signInAsDeployer,
	signInAsMember,
	withFlash
} from '../webhook-routes.testing';
import * as layout from './_app';
import * as forms from './_app.admin.forms._index';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the deployment's list of sites, saved from the card at the foot of /admin/forms: what a save
// stores and refuses, who may save, and the wallet registrations a save brings level on Stripe.
//
// the payment port is mounted over the factory rather than passed in: the action builds its
// provider from the request's env, so nothing on the wire can hand one through. the real module is
// delegated to, so `configured` stays the deployment's own answer about which keys are set.

const stub = vi.hoisted(() => ({
	ports: {} as Partial<Record<ProcessorName, PaymentProvider>>,
	/** every hostname a case's Stripe port was asked to register, in order. */
	registered: [] as string[]
}));

vi.mock('$lib/server/payments/factory', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/payments/factory')>();
	return {
		...actual,
		createPaymentProviders: (platformEnv: Env) => {
			const processors = actual.createPaymentProviders(platformEnv);
			return {
				...processors,
				for: (name: ProcessorName) => stub.ports[name] ?? processors.for(name)
			};
		}
	};
});

const SCREEN = '/admin/forms';

/** the host every request in this file arrives on, which the wallet press levels first. */
const OWN_HOST = new URL(ORIGIN).hostname;

/** a deployment set up on PayPal alone, so the five jobs are done and no Stripe key is held. */
function withoutStripe(): Env {
	return {
		...deployed(),
		STRIPE_SECRET_KEY: undefined,
		STRIPE_PUBLISHABLE_KEY: undefined,
		PAYPAL_CLIENT_ID: 'paypal-client',
		PAYPAL_CLIENT_SECRET: 'paypal-secret'
	} as unknown as Env;
}

/** a Stripe account holding no hostname, which registers whatever it is asked to. */
function walletPort(): PaymentProvider {
	return {
		...refusing('stripe', 'not_configured', 'no case here asks this arm'),
		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			return { ok: true, value: [] };
		},
		async registerWalletDomain(host: string): Promise<PaymentResult<WalletDomain>> {
			stub.registered.push(host);
			const active = { state: 'active', detail: null } as const;
			return {
				ok: true,
				value: {
					host,
					enabled: true,
					wallets: { apple_pay: active, google_pay: active, link: active }
				}
			};
		}
	};
}

/** a Stripe account that does not answer at all. */
function unreachablePort(): PaymentProvider {
	return {
		...refusing('stripe', 'not_configured', 'no case here asks this arm'),
		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			return { ok: false, reason: 'unreachable', detail: 'Stripe did not answer.' };
		}
	};
}

type SitesCard = {
	donatePage: string;
	listed: string[];
	mayEdit: boolean;
	saved: 'saved' | 'wallets_pending' | null;
};

let db: Db;
let request: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/forms', module: forms }
	]);
});

beforeEach(async () => {
	await run(stmt('delete from page'));
	await run(stmt('delete from form'));
	await run(stmt('delete from site'));
	await freshDeployment();
	deployer = await signInAsDeployer(db);
	stub.ports = { stripe: walletPort() };
	stub.registered = [];
});

function get(cookie: string, env: Env = deployed()): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), { env });
}

async function card(cookie: string, env: Env = deployed()): Promise<SitesCard> {
	const response = await get(cookie, env);
	expect(response.status).toBe(200);
	return ((await response.json()) as { sites: SitesCard }).sites;
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

/** the body the card posts: the form's id, then one indexed box per row. */
function sitesBody(rows: readonly string[]): FormData {
	const body = formBody({ __form_id__: 'forms-sites' });
	rows.forEach((row, at) => {
		body.append(`sites[${at}]`, row);
	});
	return body;
}

describe('saving the site list', () => {
	it('stores what the deployer submitted, and the list comes back in that order', async () => {
		const answer = await post(deployer, sitesBody(['https://acme.org', 'https://give.acme.org']));
		expect(answer.status).toBe(303);

		expect((await card(withFlash(deployer, answer))).listed).toEqual([
			'https://acme.org',
			'https://give.acme.org'
		]);
	});

	it('removes a site left out of the submitted list', async () => {
		await post(deployer, sitesBody(['https://acme.org', 'https://give.acme.org']));
		await post(deployer, sitesBody(['https://acme.org']));

		expect((await card(deployer)).listed).toEqual(['https://acme.org']);
	});

	/** an emptied row editor submits no row at all, and that is the empty list rather than a gap. */
	it('saves an emptied list as empty', async () => {
		await post(deployer, sitesBody(['https://acme.org']));
		const answer = await post(deployer, sitesBody([]));
		expect(answer.status).toBe(303);

		expect((await card(deployer)).listed).toEqual([]);
	});

	it('stores what a row normalises to rather than the line it was sent', async () => {
		// the repair is `readOriginList`'s in `@better-giving/operator/origins`: what is stored is the
		// origin a browser sends, which is what /api/v1 compares an `Origin` header against.
		await post(deployer, sitesBody(['acme.org', 'https://give.acme.org/donate?x=1']));

		expect((await card(deployer)).listed).toEqual(['https://acme.org', 'https://give.acme.org']);
	});

	it('refuses a row there is no site in, under that row, and stores nothing', async () => {
		const answer = await post(deployer, sitesBody(['https://acme.org', 'not a url']));
		expect(answer.status).toBe(400);
		expect(await rowErrors(answer)).toEqual({ 'sites[1]': ['invalid url'] });

		expect((await card(deployer)).listed).toEqual([]);
	});

	it('refuses a row left blank, under that row', async () => {
		const answer = await post(deployer, sitesBody(['https://acme.org', '']));
		expect(answer.status).toBe(400);
		expect(await rowErrors(answer)).toEqual({ 'sites[1]': ['required'] });
	});

	/**
	 * a removal that would leave a form that is not archived pointing at a site this deployment no
	 * longer lists is refused, naming every form in the way.
	 */
	it('refuses to remove a site a form still uses, naming the forms', async () => {
		await post(deployer, sitesBody(['https://acme.org', 'https://give.acme.org']));
		await formOn('frm_generalfund', 'General Fund', 'live', ['https://acme.org']);
		await formOn('frm_winterappeal', 'Winter Appeal', 'draft', ['https://acme.org']);

		const answer = await post(deployer, sitesBody(['https://give.acme.org']));
		expect(answer.status).toBe(409);
		const [sentence] = await formErrors(answer);
		expect(sentence).toContain('`https://acme.org` (General Fund, Winter Appeal)');
		expect(sentence).toMatch(/^Nothing was saved\./);

		expect((await card(deployer)).listed).toEqual(['https://acme.org', 'https://give.acme.org']);
	});

	/** an archived form serves nothing and cannot be edited, so a removal it blocked would be blocked for good. */
	it('lets a site go that only an archived form still lists', async () => {
		await post(deployer, sitesBody(['https://acme.org']));
		await formOn('frm_springdrive', 'Spring Drive', 'archived', ['https://acme.org']);

		expect((await post(deployer, sitesBody([]))).status).toBe(303);
		expect((await card(deployer)).listed).toEqual([]);
	});
});

describe('who may save the site list', () => {
	it('answers a member’s POST with not-found, and stores nothing', async () => {
		const member = await signInAsMember(db);

		expect((await post(member, sitesBody(['https://acme.org']))).status).toBe(404);
		expect((await card(deployer)).listed).toEqual([]);
	});

	it('shows a member the same list, marked read-only', async () => {
		await post(deployer, sitesBody(['https://acme.org']));
		const member = await signInAsMember(db);

		expect(await card(member)).toEqual({
			donatePage: `${ORIGIN}/donate`,
			listed: ['https://acme.org'],
			mayEdit: false,
			saved: null
		});
		expect((await card(deployer)).mayEdit).toBe(true);
	});
});

describe('the wallet registrations behind a save', () => {
	it('registers this deployment’s own host and every listed site on Stripe', async () => {
		const answer = await post(deployer, sitesBody(['https://acme.org', 'https://give.acme.org']));

		expect(stub.registered).toEqual([OWN_HOST, 'acme.org', 'give.acme.org']);
		expect((await card(withFlash(deployer, answer))).saved).toBe('saved');
	});

	it('asks nothing of Stripe on a deployment holding no Stripe key', async () => {
		const answer = await post(deployer, sitesBody(['https://acme.org']), withoutStripe());
		expect(answer.status).toBe(303);

		expect(stub.registered).toEqual([]);
		expect((await card(withFlash(deployer, answer), withoutStripe())).saved).toBe('saved');
	});

	it('keeps the save when Stripe does not answer, and says the wallets are still to come', async () => {
		stub.ports = { stripe: unreachablePort() };
		const answer = await post(deployer, sitesBody(['https://acme.org']));
		expect(answer.status).toBe(303);

		const landed = await card(withFlash(deployer, answer));
		expect(landed.listed).toEqual(['https://acme.org']);
		expect(landed.saved).toBe('wallets_pending');
	});

	it('reports the outcome once, burning the marker on the response that reports it', async () => {
		const answer = await post(deployer, sitesBody(['https://acme.org']));
		const first = await get(withFlash(deployer, answer));

		expect(
			first.headers.getSetCookie().filter((cookie) => /^admin_saved=.*Max-Age=0/i.test(cookie))
		).toHaveLength(1);
	});
});

/** a form listing `origins`, written past drizzle so the fixture is not the query under test. */
function formOn(
	id: string,
	name: string,
	status: 'live' | 'draft' | 'archived',
	origins: readonly string[]
): Promise<unknown> {
	return run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, allowed_origins,
			                   archived_at, created_at, updated_at)
			 values (?, ?, ?, (select id from account where is_postable = 1 and code = '4110'),
			         'USD', ?, ?, 0, 0)`,
			id,
			name,
			status,
			JSON.stringify(origins),
			status === 'archived' ? 1 : null
		)
	);
}

type Rejection = { form: { result: { error?: Record<string, string[]> } } };

/** the messages a rejection keys to a box, the form's own `''` left out. */
async function rowErrors(answer: Response): Promise<Record<string, string[]>> {
	const { '': _, ...boxes } = ((await answer.json()) as Rejection).form.result.error ?? {};
	return boxes;
}

/** the messages a rejection keys to no box. */
async function formErrors(answer: Response): Promise<string[]> {
	return ((await answer.json()) as Rejection).form.result.error?.[''] ?? [];
}
