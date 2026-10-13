import { describe, expect, it, vi } from 'vitest';
import { edgeCache } from '../edge-cache.testing';
import { lookUpFiling } from './filing';

// the edge cache in front of the IRS lookup, against workerd's own `caches`.
//
// a workers spec though it touches no database, as ../forms/cadence-cache.workers.spec.ts is: the
// thing under test is the platform's cache, and node has none. the API is a global `fetch` stub
// answering at an upstream of the spec's own, so no case reaches the live API.
//
// every case looks up under an origin of its own, because the entries live in one store for the
// whole run: a shared address would make each case depend on which ran first.

const UPSTREAM = 'https://irs.test';
const EIN = '12-3456789';

/** `GET /v1/orgs/{ein}` as the API answers it, figures and all. */
const ON_RECORD = {
	ein: '123456789',
	name: 'HOPE FOUNDATION',
	mission: 'Warm coats for every child in Springfield.',
	activitySummary: 'Collects and hands out winter coats through the city’s schools.',
	programs: [{ description: 'Coat drive', expense: 182345, grants: 40321, revenue: 9876 }],
	finances: { revenue: 912345, expenses: 876543, assets: 1234567, taxYear: 2024 },
	website: 'hope.example',
	notes: ['Program figures are from Part III']
};

const FILING = {
	mission: 'Warm coats for every child in Springfield.',
	activity: 'Collects and hands out winter coats through the city’s schools.',
	programs: ['Coat drive'],
	notes: ['Program figures are from Part III']
};

function answering(...responses: Response[]) {
	const stub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
		const next = responses.shift();
		if (next === undefined) throw new Error('unscripted request');
		return next;
	});
	vi.stubGlobal('fetch', stub);
	return stub;
}

const found = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('a lookup held at the edge', () => {
	it('answers a second lookup within the hour without asking the API', async () => {
		const origin = 'https://held-then-served.example';
		const fetch = answering(found(ON_RECORD));

		const first = await lookUpFiling(EIN, origin, UPSTREAM);
		const second = await lookUpFiling(EIN, origin, UPSTREAM);

		expect(first).toStrictEqual(FILING);
		expect(second).toStrictEqual(FILING);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('holds no answer that found nothing, so the next lookup asks again', async () => {
		const origin = 'https://nothing-then-found.example';
		const fetch = answering(
			found({ type: 'about:blank', status: 429, code: 'per_minute_limit_exceeded' }, 429),
			found(ON_RECORD)
		);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const first = await lookUpFiling(EIN, origin, UPSTREAM);
		const second = await lookUpFiling(EIN, origin, UPSTREAM);

		expect(first).toBeNull();
		expect(second).toStrictEqual(FILING);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('holds the words read and no figure, for an hour', async () => {
		const origin = 'https://what-is-held.example';
		answering(found(ON_RECORD));

		await lookUpFiling(EIN, origin, UPSTREAM);

		const held = await edgeCache().match(`${origin}/__irs-filing/123456789`);
		expect(held?.headers.get('cache-control')).toBe('max-age=3600');
		expect(await held?.json()).toStrictEqual(FILING);
	});

	it('reads past a held entry not in the shape of a filing, and asks the API', async () => {
		const origin = 'https://held-elsewise.example';
		await edgeCache().put(
			`${origin}/__irs-filing/123456789`,
			new Response(JSON.stringify({ ...FILING, finances: { revenue: 912345 } }), {
				headers: { 'cache-control': 'max-age=3600' }
			})
		);
		const fetch = answering(found(ON_RECORD));

		expect(await lookUpFiling(EIN, origin, UPSTREAM)).toStrictEqual(FILING);
		expect(fetch).toHaveBeenCalledOnce();
	});
});
