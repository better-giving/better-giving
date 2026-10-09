import { describe, expect, it, vi } from 'vitest';
import { lookUpFiling } from './filing';

// what a failed lookup logs, beside why; the EIN is never part of it.
const WARNING = 'the IRS nonprofit lookup answered nothing:';

// the IRS nonprofit API is the one boundary stood in for: a global `fetch` stub answering with the
// bodies given, as ../api/turnstile.spec.ts stubs siteverify.

const UPSTREAM = 'https://irs.test';
const EIN = '53-0196605';

function answering(...responses: (Response | Error)[]) {
	const stub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
		const next = responses.shift();
		if (next === undefined) throw new Error('unscripted request');
		if (next instanceof Error) throw next;
		return next;
	});
	vi.stubGlobal('fetch', stub);
	return stub;
}

describe('a lookup that asks nothing', () => {
	it.each([
		['no EIN stored', null],
		['a number short of nine digits', '12-345678'],
		['letters', '12-34567AB'],
		['a dash in the wrong place', '123-456789']
	])('is %s', async (_, taxId) => {
		const fetch = answering(found(organisation()));
		const warn = vi.spyOn(console, 'warn');

		expect(await lookUpFiling(taxId, UPSTREAM)).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});
});

/** where a fact was read from, as the API cites it. */
const released = {
	file: 'https://www.irs.gov/pub/irs-soi/eo1.csv',
	releasedAt: '2026-08-12T00:00:00Z',
	fetchedAt: '2026-09-01T06:00:00Z'
};
const cited = {
	file: 'https://apps.irs.gov/pub/epostcard/990/xml/2026/2026_TEOS_XML_03A.zip',
	releasedAt: '2026-04-30T00:00:00Z',
	fetchedAt: '2026-09-01T06:00:00Z',
	objectId: '202601239349300135',
	taxYear: 2024,
	formType: '990'
};

/** `GET /v1/orgs/{ein}` as the API answers it: every member it documents, figures and all. */
function organisation(extra: object = {}) {
	return {
		ein: '530196605',
		name: 'AMERICAN NATIONAL RED CROSS',
		address: { street: '431 18TH ST NW', city: 'WASHINGTON', state: 'DC', zip: '20006-5310' },
		is501c3: true,
		deductible: true,
		revoked: false,
		revocationDate: null,
		reinstatementDate: null,
		mission: 'Prevents and alleviates human suffering in the face of emergencies.',
		activitySummary: 'Disaster relief, blood services and preparedness training nationwide.',
		programs: [
			{ description: 'Biomedical services', expense: 1834567, grants: 0, revenue: 2012345 },
			{ description: 'Domestic disaster services', expense: 912345, grants: 40321, revenue: 0 }
		],
		finances: { revenue: 3123456, expenses: 3012345, assets: 4123456, taxYear: 2024 },
		website: 'www.redcross.org',
		notes: [],
		provenance: {
			name: released,
			address: released,
			is501c3: released,
			deductible: released,
			revoked: released,
			revocationDate: null,
			reinstatementDate: null,
			mission: cited,
			activitySummary: cited,
			programs: cited,
			finances: cited,
			website: cited
		},
		...extra
	};
}

const found = (body: unknown, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

describe('a lookup of a filing on record', () => {
	it('asks the live API by default, keyless', async () => {
		const fetch = answering(found(organisation()));

		await lookUpFiling(EIN);

		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toBe('https://nonprofits.better.giving/v1/orgs/530196605');
		expect(new Headers(init?.headers).has('authorization')).toBe(false);
	});

	it('asks for the nine digits and answers its text facts alone', async () => {
		const fetch = answering(found(organisation()));
		const warn = vi.spyOn(console, 'warn');

		const filing = await lookUpFiling(EIN, UPSTREAM);

		expect(fetch.mock.calls[0]?.[0]).toBe('https://irs.test/v1/orgs/530196605');
		expect(warn).not.toHaveBeenCalled();
		expect(filing).toStrictEqual({
			mission: 'Prevents and alleviates human suffering in the face of emergencies.',
			activity: 'Disaster relief, blood services and preparedness training nationwide.',
			programs: ['Biomedical services', 'Domestic disaster services'],
			notes: []
		});
	});
});

/** an RFC 9457 refusal, as the API sends every error. */
const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
	new Response(
		JSON.stringify({ type: 'about:blank', title: 'Refused', status, detail: 'Try later.', code }),
		{ status, headers: { ...headers, 'content-type': 'application/problem+json' } }
	);

describe('a lookup that finds nothing to use', () => {
	it.each([
		['not found', () => problem(404, 'not_found'), '404 not_found'],
		[
			'the per-minute limit',
			() => problem(429, 'per_minute_limit_exceeded', { 'retry-after': '60' }),
			'429 per_minute_limit_exceeded'
		],
		[
			'the daily quota',
			() => problem(429, 'daily_quota_exceeded', { 'retry-after': '6900' }),
			'429 daily_quota_exceeded'
		],
		[
			'the service at its daily limit',
			() => problem(429, 'service_daily_limit_reached', { 'retry-after': '6900' }),
			'429 service_daily_limit_reached'
		],
		['its data unavailable', () => problem(503, 'data_unavailable'), '503 data_unavailable'],
		['its keys unavailable', () => problem(503, 'auth_unavailable'), '503 auth_unavailable'],
		[
			'a refusal whose code is not one the API names',
			() => problem(429, 'slow down\nforged line'),
			'429'
		],
		['an error with no problem body', () => found(organisation(), 500), '500'],
		['a refusal whose body is no JSON', () => found('<html>busy</html>', 502), '502'],
		['a body that is no JSON', () => found('<html>busy</html>'), 'shape'],
		['a body in another shape', () => found({ ...organisation(), notes: 'none' }), 'shape'],
		['an answer about another number', () => found(organisation({ ein: '987654321' })), 'shape'],
		['an answer naming nobody', () => found(organisation({ name: ' ' })), 'shape'],
		['an answer with no name on record', () => found(organisation({ name: null })), 'shape'],
		[
			'a body past the cap',
			() => found(organisation({ activitySummary: 'x'.repeat(300_000) })),
			'shape'
		],
		['no answer at all', () => new TypeError('network connection lost'), 'network']
	])(
		'answers nothing for %s, asking once, waiting on nothing and saying why',
		async (_, response, why) => {
			const fetch = answering(response());
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

			expect(await lookUpFiling(EIN, UPSTREAM)).toBeNull();
			expect(fetch).toHaveBeenCalledOnce();
			expect(warn.mock.calls).toStrictEqual([[WARNING, why]]);
		}
	);

	it('gives up on an API that never answers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: string, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					})
			)
		);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// nothing resolves this fetch, so the test finishes only on the module's own timeout.
		expect(await lookUpFiling(EIN, UPSTREAM)).toBeNull();
		expect(warn.mock.calls).toStrictEqual([[WARNING, 'timeout']]);
	}, 10_000);

	it('gives up on a 200 whose body stalls, within the same deadline', async () => {
		// a stub's body ignores the signal handed to `fetch`, so only the module's own wiring ends it.
		const stalled = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"ein":'));
			}
		});
		answering(new Response(stalled, { status: 200 }));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const started = performance.now();
		expect(await lookUpFiling(EIN, UPSTREAM)).toBeNull();
		expect(performance.now() - started).toBeLessThan(4000);
		expect(warn.mock.calls).toStrictEqual([[WARNING, 'timeout']]);
	}, 10_000);
});

describe('the facts a filing answers', () => {
	it('are trimmed, their control characters dropped and their space runs one space', async () => {
		answering(
			found(
				organisation({
					mission: '  Prevents\u0000 and\u0007 alleviates\n\thuman suffering.  ',
					activitySummary: 'Disaster\r\nrelief.\u001b[31m',
					programs: [
						{ description: '\u0085Biomedical services ', expense: 1, grants: 0, revenue: 0 }
					],
					notes: [' 990-EZ has no\u0000 activity summary ']
				})
			)
		);

		expect(await lookUpFiling(EIN, UPSTREAM)).toStrictEqual({
			mission: 'Prevents and alleviates human suffering.',
			activity: 'Disaster relief.[31m',
			programs: ['Biomedical services'],
			notes: ['990-EZ has no activity summary']
		});
	});

	it('are cut at their caps, three programs and five notes at most', async () => {
		answering(
			found(
				organisation({
					mission: 'm'.repeat(401),
					activitySummary: 'a'.repeat(1001),
					programs: ['one', 'two', 'three', 'four'].map((name) => ({
						description: `${name} ${'p'.repeat(600)}`,
						expense: null,
						grants: null,
						revenue: null
					})),
					notes: ['1', '2', '3', '4', '5', '6'].map((n) => `${n}${'n'.repeat(250)}`)
				})
			)
		);

		const filing = await lookUpFiling(EIN, UPSTREAM);

		expect(filing?.mission).toBe('m'.repeat(400));
		expect(filing?.activity).toBe('a'.repeat(1000));
		expect(filing?.programs).toStrictEqual(
			['one', 'two', 'three'].map((name) => `${name} ${'p'.repeat(500 - name.length - 1)}`)
		);
		expect(filing?.notes).toStrictEqual(
			['1', '2', '3', '4', '5'].map((n) => `${n}${'n'.repeat(199)}`)
		);
	});

	it('leave out a program with no words, and a fact of blank words is none', async () => {
		const program = { expense: 0, grants: 0, revenue: 0 };
		answering(
			found(
				organisation({
					mission: ' \u0000 ',
					activitySummary: null,
					programs: [
						{ ...program, description: null },
						{ ...program, description: '  ' },
						{ ...program, description: 'Biomedical services' }
					],
					notes: ['', '990-EZ has no activity summary']
				})
			)
		);

		expect(await lookUpFiling(EIN, UPSTREAM)).toStrictEqual({
			mission: null,
			activity: null,
			programs: ['Biomedical services'],
			notes: ['990-EZ has no activity summary']
		});
	});

	it('are the notes alone where the IRS holds no mission, activity or program', async () => {
		answering(
			found(
				organisation({
					mission: null,
					activitySummary: null,
					programs: [],
					finances: null,
					website: null,
					notes: ['990-N filer: no mission on record', 'no website on record']
				})
			)
		);

		expect(await lookUpFiling(EIN, UPSTREAM)).toStrictEqual({
			mission: null,
			activity: null,
			programs: [],
			notes: ['990-N filer: no mission on record', 'no website on record']
		});
	});
});
