import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as finder from './_app.admin.settings_.nonprofits';
import * as organisation from './_app.admin.settings_.nonprofits_.$ein';

// the two reads behind Settings' "Find your charity", through the protected layout, with `fetch` to
// Better Giving's nonprofit lookup stubbed: what each address asks the service, and what each of
// the service's answers becomes.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

let db: Db;
/** one chain per address: each entry `mountRoutes` takes is the parent of the next. */
let finderRequest: RouteRequester;
let organisationRequest: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	finderRequest = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/settings/nonprofits', module: finder }
	]);
	organisationRequest = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/settings/nonprofits/:ein', module: organisation }
	]);
});

beforeEach(async () => {
	for (const table of ['auth_member_invitation', 'auth_session', 'auth_user']) {
		await run(stmt(`delete from ${table}`));
	}
	deployer = await signInAsDeployer(db, DEPLOYMENT);
});

/**
 * a `fetch` that answers from a script and remembers what it was asked. running out throws rather
 * than answering, and the module reads a throw as `unavailable`, so a request a case did not script
 * shows in the calls it asserts on.
 */
function service(responses: readonly (Response | Error)[]) {
	const remaining = [...responses];
	const calls: { readonly url: URL; readonly headers: Headers }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
			const next = remaining.shift();
			if (next === undefined) throw new Error(`unscripted request to ${String(input)}`);
			if (next instanceof Error) throw next;
			return next;
		})
	);
	return calls;
}

function get(path: string, cookie: string = deployer, env: Env = DEPLOYMENT.env) {
	const request = path.startsWith('/admin/settings/nonprofits?')
		? finderRequest
		: organisationRequest;
	return request(new Request(`${ORIGIN}${path}`, { headers: { cookie } }), { env });
}

describe('a member’s session', () => {
	it('gets not-found from both addresses, and the service is not asked', async () => {
		const calls = service([]);
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get('/admin/settings/nonprofits?q=red%20cross', member)).status).toBe(404);
		expect((await get('/admin/settings/nonprofits/53-0196605', member)).status).toBe(404);
		expect(calls).toEqual([]);
	});
});

/** a problem-details or JSON answer, as the service serialises one. */
const answer = (payload: unknown, status = 200, headers: Record<string, string> = {}): Response =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

/** the service's lookup of the Red Cross, trimmed to what this app reads and a little it does not. */
const RED_CROSS = {
	ein: '530196605',
	name: 'AMERICAN NATIONAL RED CROSS',
	address: { street: '431 18TH ST NW', city: 'WASHINGTON', state: 'DC', zip: '20006-5310' },
	is501c3: true,
	deductible: true,
	revoked: false,
	revocationDate: null,
	reinstatementDate: null,
	mission: 'Prevent and alleviate human suffering.'
};

describe('a query of nine digits', () => {
	it.each(['530196605', '53-0196605', ' 53-0196605 '])(
		'looks %j up by EIN and searches nothing',
		async (q) => {
			const calls = service([answer(RED_CROSS)]);

			const response = await get(`/admin/settings/nonprofits?q=${encodeURIComponent(q)}`);

			expect(response.status).toBe(200);
			expect(calls.map(({ url }) => url.href)).toEqual([
				'https://nonprofits.better.giving/v1/orgs/530196605'
			]);
			expect(await response.json()).toMatchObject({ kind: 'lookup', outcome: 'found' });
		}
	);
});

describe('a query of a name', () => {
	it('searches by it and answers each match with its EIN as stored', async () => {
		const calls = service([
			answer({
				results: [
					{
						ein: '530196605',
						name: 'AMERICAN NATIONAL RED CROSS',
						city: 'WASHINGTON',
						state: 'DC',
						is501c3: true,
						deductible: true,
						revoked: false,
						revocationDate: null,
						provenance: {}
					},
					{
						ein: '237069110',
						name: 'RED CROSS OF NOWHERE',
						city: 'SPRINGFIELD',
						state: 'IL',
						is501c3: true,
						deductible: null,
						revoked: true,
						revocationDate: '2023-05-15',
						provenance: {}
					}
				]
			})
		]);

		const response = await get('/admin/settings/nonprofits?q=red%20cross');

		expect(calls.map(({ url }) => [url.origin + url.pathname, url.searchParams.get('q')])).toEqual([
			['https://nonprofits.better.giving/v1/search', 'red cross']
		]);
		expect(await response.json()).toEqual({
			kind: 'search',
			outcome: 'found',
			matches: [
				{
					ein: '53-0196605',
					name: 'American National Red Cross',
					city: 'Washington',
					state: 'DC',
					deductible: true,
					revoked: false,
					revocationDate: null
				},
				{
					ein: '23-7069110',
					name: 'Red Cross of Nowhere',
					city: 'Springfield',
					state: 'IL',
					deductible: null,
					revoked: true,
					revocationDate: '2023-05-15'
				}
			]
		});
	});

	it('searches a name that holds digits, which is not an EIN', async () => {
		const calls = service([answer({ results: [] })]);

		const response = await get('/admin/settings/nonprofits?q=211%20LA%20County');

		expect(calls.map(({ url }) => url.searchParams.get('q'))).toEqual(['211 LA County']);
		expect(await response.json()).toEqual({ kind: 'search', outcome: 'found', matches: [] });
	});
});

describe('the address of one EIN', () => {
	it('maps the organisation onto the details form’s boxes, with its standing beside them', async () => {
		const calls = service([
			answer({ ...RED_CROSS, deductible: false, revoked: true, revocationDate: '2023-05-15' })
		]);

		const response = await get('/admin/settings/nonprofits/53-0196605');

		expect(calls.map(({ url }) => url.href)).toEqual([
			'https://nonprofits.better.giving/v1/orgs/530196605'
		]);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			kind: 'lookup',
			outcome: 'found',
			fields: {
				legal_name: 'American National Red Cross',
				tax_id: '53-0196605',
				address_line1: '431 18th St Nw',
				city: 'Washington',
				region: 'DC',
				postal_code: '20006-5310',
				country: 'United States'
			},
			deductible: false,
			revoked: true,
			revocationDate: '2023-05-15'
		});
	});

	it('empties a box the IRS files hold nothing for', async () => {
		service([
			answer({
				...RED_CROSS,
				name: null,
				address: { street: null, city: 'WASHINGTON', state: 'DC', zip: null },
				deductible: null,
				revoked: null
			})
		]);

		const found = await (await get('/admin/settings/nonprofits/530196605')).json();

		expect(found).toMatchObject({
			fields: { legal_name: '', address_line1: '', city: 'Washington', postal_code: '' },
			deductible: null,
			revoked: null
		});
	});

	it('answers not-found for an address that is no EIN, and asks the service nothing', async () => {
		const calls = service([]);

		expect((await get('/admin/settings/nonprofits/..%2Fsearch%3Fq%3Dx')).status).toBe(404);
		expect((await get('/admin/settings/nonprofits/1234')).status).toBe(404);
		expect(calls).toEqual([]);
	});
});

/** the three reads, each as the screen asks it. */
const READS = [
	['a name search', '/admin/settings/nonprofits?q=red%20cross', 'search'],
	['an EIN typed in the box', '/admin/settings/nonprofits?q=53-0196605', 'lookup'],
	['a picked match', '/admin/settings/nonprofits/53-0196605', 'lookup']
] as const;

/** a refusal as the service words one (RFC 9457 problem details). */
const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify({ type: 'about:blank', status, code, detail: 'what to do' }), {
		status,
		headers: { 'content-type': 'application/problem+json', ...headers }
	});

describe('the service’s rate limit', () => {
	it.each(READS)('answers %s with the seconds to wait', async (_, path, kind) => {
		service([problem(429, 'per_minute_limit_exceeded', { 'retry-after': '42' })]);

		const response = await get(path);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ kind, outcome: 'rate_limited', retryAfter: 42 });
	});
});

describe('an EIN the IRS files do not hold', () => {
	it.each(READS.filter(([, , kind]) => kind === 'lookup'))(
		'answers %s as not found',
		async (_, path) => {
			service([problem(404, 'not_found')]);

			expect(await (await get(path)).json()).toEqual({ kind: 'lookup', outcome: 'not_found' });
		}
	);

	it('is told apart from a 404 that names no organisation', async () => {
		service([problem(404, 'route_not_found')]);

		const answered = await (await get('/admin/settings/nonprofits/53-0196605')).json();

		expect(answered).toEqual({ kind: 'lookup', outcome: 'unavailable' });
	});
});

describe('a service that cannot answer', () => {
	it.each(READS)('answers %s as unavailable when the network fails', async (_, path, kind) => {
		service([new TypeError('fetch failed')]);

		const response = await get(path);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ kind, outcome: 'unavailable' });
	});

	it.each([
		['a 503', problem(503, 'data_unavailable')],
		['a refused key', problem(401, 'invalid_api_key')],
		['a 429 with no wait to read', problem(429, 'per_minute_limit_exceeded')],
		['a page that is not JSON', new Response('<html>bad gateway</html>', { status: 502 })],
		['a 200 that is no organisation', answer({ ein: '530196605' })],
		['a 200 that is not JSON', new Response('<html></html>', { status: 200 })]
	])('answers %s as unavailable', async (_, refusal) => {
		service([refusal]);

		const answered = await (await get('/admin/settings/nonprofits/53-0196605')).json();

		expect(answered).toEqual({ kind: 'lookup', outcome: 'unavailable' });
	});

	it('answers a search the service answered with no list as unavailable', async () => {
		service([answer({ query: 'red cross' })]);

		const answered = await (await get('/admin/settings/nonprofits?q=red%20cross')).json();

		expect(answered).toEqual({ kind: 'search', outcome: 'unavailable' });
	});
});

describe('the deployment’s key', () => {
	const KEYED: Env = { ...DEPLOYMENT.env, NONPROFITS_API_KEY: 'nk_test_0123456789abcdef' };

	it.each(READS)('is sent as a bearer token with %s', async (_, path) => {
		const calls = service([answer(path.includes('?q=red') ? { results: [] } : RED_CROSS)]);

		await get(path, deployer, KEYED);

		expect(calls.map(({ headers }) => headers.get('authorization'))).toEqual([
			'Bearer nk_test_0123456789abcdef'
		]);
	});

	it.each([
		['unset', DEPLOYMENT.env],
		['blank', { ...DEPLOYMENT.env, NONPROFITS_API_KEY: '  ' }]
	])('is not sent while %s, and the call goes keyless', async (_, env) => {
		const calls = service([answer(RED_CROSS)]);

		const answered = await (
			await get('/admin/settings/nonprofits/53-0196605', deployer, env)
		).json();

		expect(calls.map(({ headers }) => headers.has('authorization'))).toEqual([false]);
		expect(answered).toMatchObject({ outcome: 'found' });
	});
});
