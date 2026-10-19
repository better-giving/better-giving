import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as config from './api.v1.forms.$id.config';
import * as surface from './api.v1';
import { countingClient } from '$lib/server/db/counting-client.testing';
import { first, run, stmt } from '$lib/server/db/database.testing';

// the public api's own layout, run end to end against a real database.
//
// what is under test is the mounting rather than the limiter. which block of addresses counts as
// one caller, and what the refusal says, are `$lib/server/api/rate-limit.ts`'s and are asserted
// against values in its own spec. what is here is the half that cannot be proven anywhere else:
// that the charge lands on this surface at all, that it lands *ahead of the read* the endpoint
// beneath cannot avoid, and that a preflight is not exempt from it.
//
// a db spec because the limiter and the database are the subject. the spec env declares the same
// `API_RATE_LIMITER` the deployment does with a much smaller bucket (`SPEC_RATE_LIMITS` in
// $lib/server/runtime/rate-limiter.testing.ts), and a stand-in for it would prove the stand-in —
// the same reason CLAUDE.md refuses one for the database.
//
// the endpoint mounted beneath is the real one, so "did the request reach a route" is answered by
// counting what that route asked of the database rather than by a flag a fake set. a `form` lookup is the
// read this limit exists to bound, and it is the one an id nothing matches still costs.

/** the caller these cases arrive as, unless a case wants a bucket of its own. */
const CALLER = '198.51.100.10';

/** a form id no row carries — the request that costs the most per byte sent, and still a read. */
const MISSING_FORM = 'frm_nosuchformatall1';

/** how many requests a case will make before it decides the limiter is refusing nobody. */
const CAP = 50;

let revenueAccountId: string;

beforeAll(async () => {
	const row = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	await run(stmt('delete from form'));
});

/** the api surface and the endpoint on it, outermost first, as ../routes.ts nests them. */
const surfaceRoutes: RouteRequester = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/config', module: config }
]);

interface Answered {
	readonly response: Response;
	/** how many statements the request prepared against the database before it was answered. */
	readonly reads: number;
}

/** one request onto the surface, counting what it cost. */
async function ask(
	path: string,
	{ ip = CALLER, method = 'GET' }: { ip?: string; method?: string } = {}
): Promise<Answered> {
	const counted = countingClient();
	const response = await surfaceRoutes(
		new Request(`https://give.example.workers.dev${path}`, {
			method,
			headers: { [CLIENT_IP_HEADER]: ip }
		}),
		{ client: counted.client }
	);
	return { response, reads: counted.statements() };
}

/** the endpoint's own address, with an id nothing matches. */
function config404(options?: { ip?: string; method?: string }): Promise<Answered> {
	return ask(`/api/v1/forms/${MISSING_FORM}/config`, options);
}

/**
 * asks until refused rather than counting to a number: the bucket size is a deployment's policy
 * (`RATE_LIMITS` in $lib/server/runtime/rate-limiter.ts) and the spec's is deliberately smaller,
 * so a case that knew the number would be a case about that table.
 *
 * the cap is what makes a failure legible — a limiter that never refuses ends the loop rather than
 * hanging the suite.
 */
async function untilRefused(options?: { ip?: string; method?: string }): Promise<Answered[]> {
	const answers: Answered[] = [];
	for (let i = 0; i < CAP; i++) {
		const answered = await config404(options);
		answers.push(answered);
		if (answered.response.status === 429) return answers;
	}
	throw new Error(`${CAP} requests and the limiter refused none of them`);
}

describe('the limit on the public api', () => {
	/**
	 * the whole shape of the decision, in one case: the charge is on the surface's layout, so it
	 * lands before the endpoint underneath reads anything.
	 *
	 * `reads` is what carries it. a 429 alone would pass against a limiter charged inside the
	 * endpoint after the `form` lookup — which is the version that meters requests without
	 * bounding what they cost, and the version a reviewer cannot tell apart from this one by
	 * reading the status.
	 */
	it('refuses a caller that has asked too often, before the endpoint reads', async () => {
		const answers = await untilRefused();
		const refused = answers.at(-1);

		expect(refused?.response.status).toBe(429);
		expect(refused?.response.headers.get('retry-after')).toBe('60');
		expect(refused?.response.headers.get('cache-control')).toBe('no-store');
		// nothing beneath the layout ran, so the read this limit exists to bound was never spent.
		expect(refused?.reads).toBe(0);
		// and the ones before it were served, or the limiter is refusing everything and this case
		// proves nothing about a bucket.
		expect(answers[0]?.response.status).toBe(404);
		expect(answers[0]?.reads).toBeGreaterThan(0);
	});

	/**
	 * the preflight is the cheapest request an attacker can issue and it is not exempt. it is also
	 * the one that would be, by construction, under any design that charged the limit from inside
	 * a `GET` handler.
	 */
	it('refuses an OPTIONS flood the same way', async () => {
		const refused = (await untilRefused({ ip: '198.51.100.11', method: 'OPTIONS' })).at(-1);
		expect(refused?.response.status).toBe(429);
		expect(refused?.reads).toBe(0);
	});

	/**
	 * two addresses are two buckets. without this the limit reads as working while being one
	 * global tap that any single caller can close on every donor at once.
	 */
	it('leaves another address alone', async () => {
		await untilRefused({ ip: '198.51.100.12' });
		const other = await config404({ ip: '198.51.100.13' });
		expect(other.response.status).toBe(404);
		expect(other.reads).toBeGreaterThan(0);
	});

	/**
	 * the layout's own address is on the surface, so it is metered like everything else there.
	 * stated because it is the one route on `/api/v1` that is not an endpoint, and "the meter
	 * covers the surface" is worth nothing if the surface has a hole in it.
	 */
	it('charges the surface’s own address too', async () => {
		const answers: Answered[] = [];
		for (let i = 0; i < CAP; i++) {
			const answered = await ask('/api/v1', { ip: '198.51.100.14' });
			answers.push(answered);
			if (answered.response.status === 429) break;
		}
		expect(answers.at(-1)?.response.status).toBe(429);
	});

	/**
	 * a served request is one the endpoint answered, which is what says the meter lets traffic
	 * through rather than merely refusing it. the fresh address is what keeps it out of every
	 * other case's bucket.
	 */
	it('serves a caller with a bucket to spend', async () => {
		await run(
			stmt(
				`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values ('frm_meteredsurface1', 'General Fund', 'draft', ?, 'USD', 500, 1000000,
			         '[2500]', '[]', 0, 0)`,
				revenueAccountId
			)
		);

		const answered = await ask('/api/v1/forms/frm_meteredsurface1/config', {
			ip: '198.51.100.15'
		});
		// the form is a draft, which is the endpoint's own refusal and not the meter's: the request
		// reached the route.
		expect(answered.response.status).toBe(409);
		expect(answered.reads).toBeGreaterThan(0);
	});
});

describe('the surface’s own address', () => {
	/**
	 * `/api/v1` is a route whether or not anyone meant it to be — a layout with a path of its own
	 * is a branch in the route tree — so this file answers it deliberately rather than letting the
	 * framework fault on a layout with nothing to return.
	 */
	it('is a 404 naming what the prefix is for, and reads nothing', async () => {
		const { response, reads } = await ask('/api/v1', { ip: '198.51.100.16' });
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(reads).toBe(0);

		const body = (await response.json()) as Record<string, unknown>;
		expect(String(body.message)).toContain('/api/v1');
		expect(String(body.fix)).toContain('/api/v1/forms/');
		// no `error` code: `API_ERROR_CODES` in packages/form/src/v1.ts is a permanent wire
		// vocabulary whose members each name the screen that fixes them, and no screen fixes this.
		expect(body).not.toHaveProperty('error');
	});

	/**
	 * and no CORS on it, for the reason the endpoint's own not-found answer carries none: the echo
	 * on this surface is built from one form's `allowed_origins`, and this address names no form.
	 */
	it('echoes nothing back to a browser', async () => {
		const response = await surfaceRoutes(
			new Request('https://give.example.workers.dev/api/v1', {
				headers: { [CLIENT_IP_HEADER]: '198.51.100.17', origin: 'https://acme.org' }
			})
		);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
	});
});
