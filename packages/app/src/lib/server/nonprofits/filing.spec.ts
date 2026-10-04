import { describe, expect, it, vi } from 'vitest';
import { API, lookUpFiling } from './filing';

// the IRS nonprofit API is the one boundary stood in for: a global `fetch` stub answering with the
// bodies given, as ../api/turnstile.spec.ts stubs siteverify.

const UPSTREAM = 'https://irs.test';
const EIN = '12-3456789';

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
	it('is every lookup while the built-in address is empty', async () => {
		const fetch = answering();

		expect(API).toBe('');
		expect(await lookUpFiling(EIN)).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		['no EIN stored', null],
		['a number short of nine digits', '12-345678'],
		['letters', '12-34567AB'],
		['a dash in the wrong place', '123-456789']
	])('is %s', async (_, taxId) => {
		const fetch = answering(found(organisation()));

		expect(await lookUpFiling(taxId, UPSTREAM)).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});

/** an organisation as the API answers one, every fact the lookup is documented to return. */
function organisation(filing: object = {}, extra: object = {}) {
	return {
		ein: '123456789',
		name: 'Warm Coats Fund',
		address: { street: '1 Main St', city: 'Springfield', state: 'IL', zip: '62701' },
		status: { deductible: true, revoked: false, revocation_date: null, reinstatement_date: null },
		filing: {
			form_type: '990',
			tax_year: 2024,
			website: 'warmcoats.org',
			mission: 'Warm coats for every child in Springfield.',
			activity: 'Collects and hands out winter coats through 14 schools.',
			programs: [
				{ description: 'Coat drive', expense: 182000, grants: 40000, revenue: 9000 },
				{ description: 'School closets', expense: 61000, grants: 0, revenue: 0 }
			],
			finances: {
				total_revenue: 912345,
				total_expenses: 876543,
				total_assets: 1234567,
				tax_year: 2024
			},
			...filing
		},
		notes: ['Mission is on Schedule O, not extracted'],
		provenance: { mission: { file: 'index_2025.csv', released: '2025-06-01' } },
		...extra
	};
}

const found = (body: unknown, status = 200) =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

describe('a lookup of a filing on record', () => {
	it('asks for the nine digits and answers its text facts alone', async () => {
		const fetch = answering(found(organisation()));

		const filing = await lookUpFiling(EIN, UPSTREAM);

		expect(fetch.mock.calls[0]?.[0]).toBe('https://irs.test/v1/organizations/123456789');
		expect(filing).toStrictEqual({
			mission: 'Warm coats for every child in Springfield.',
			activity: 'Collects and hands out winter coats through 14 schools.',
			programs: ['Coat drive', 'School closets'],
			notes: ['Mission is on Schedule O, not extracted']
		});
	});
});

describe('a lookup that finds nothing to use', () => {
	it.each([
		['not found', () => found({ error: 'not_found' }, 404)],
		['an error', () => found(organisation(), 500)],
		['a body that is no JSON', () => found('<html>busy</html>')],
		['a body in another shape', () => found({ ein: '123456789', name: 'Fund', notes: 'none' })],
		['an answer about another number', () => found(organisation({}, { ein: '987654321' }))],
		['an answer naming nobody', () => found(organisation({}, { name: ' ' }))],
		['a body past the cap', () => found(organisation({ activity: 'x'.repeat(300_000) }))],
		['no answer at all', () => new TypeError('network connection lost')]
	])('answers nothing for %s', async (_, response) => {
		answering(response());

		expect(await lookUpFiling(EIN, UPSTREAM)).toBeNull();
	});

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

		// nothing resolves this fetch, so the test finishes only on the module's own timeout.
		expect(await lookUpFiling(EIN, UPSTREAM)).toBeNull();
	}, 10_000);
});

describe('the facts a filing answers', () => {
	it('are trimmed, their control characters dropped and their space runs one space', async () => {
		answering(
			found(
				organisation(
					{
						mission: '  Warm coats\u0000 for\u0007 every\n\tchild.  ',
						activity: 'Hands out\r\ncoats.\u001b[31m',
						programs: [{ description: '\u0085Coat drive ' }]
					},
					{ notes: [' 990-N filer:\u0000 no mission on record '] }
				)
			)
		);

		expect(await lookUpFiling(EIN, UPSTREAM)).toStrictEqual({
			mission: 'Warm coats for every child.',
			activity: 'Hands out coats.[31m',
			programs: ['Coat drive'],
			notes: ['990-N filer: no mission on record']
		});
	});

	it('are cut at their caps, three programs and five notes at most', async () => {
		answering(
			found(
				organisation(
					{
						mission: 'm'.repeat(401),
						activity: 'a'.repeat(1001),
						programs: ['one', 'two', 'three', 'four'].map((name) => ({
							description: `${name} ${'p'.repeat(600)}`
						}))
					},
					{ notes: ['1', '2', '3', '4', '5', '6'].map((n) => `${n}${'n'.repeat(250)}`) }
				)
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
		answering(
			found(
				organisation(
					{
						mission: ' \u0000 ',
						activity: null,
						programs: [{ description: null }, { description: '  ' }, { description: 'Coat drive' }]
					},
					{ notes: ['', 'Mission is on Schedule O'] }
				)
			)
		);

		expect(await lookUpFiling(EIN, UPSTREAM)).toStrictEqual({
			mission: null,
			activity: null,
			programs: ['Coat drive'],
			notes: ['Mission is on Schedule O']
		});
	});

	it('are none where the filing is not on record', async () => {
		answering(found({ ...organisation(), filing: null, notes: null }));

		expect(await lookUpFiling(EIN, UPSTREAM)).toStrictEqual({
			mission: null,
			activity: null,
			programs: [],
			notes: []
		});
	});
});
