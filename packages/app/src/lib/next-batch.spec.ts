import { describe, expect, it, vi } from 'vitest';
import { readNextBatch } from './next-batch';

// how every answer a Show more read can get resolves for the screen. the seam is `fetch` and
// `location`, the two globals the module touches in the browser.

type Batch = { readonly kind: 'gifts'; readonly gifts: readonly string[]; readonly total: number };

/** the answer `fetch` gives after following a gate's 303 to the sign-in page on its own. */
function redirectedToSignIn(): Response {
	const response = new Response('<!doctype html><title>Sign in</title>', {
		headers: { 'content-type': 'text/html' }
	});
	Object.defineProperty(response, 'redirected', { value: true });
	return response;
}

function answering(response: Response) {
	const fetch = vi.fn(async () => response);
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

const PENDING = Symbol('pending');

/** what `promise` has settled to after every queued task has run, or `PENDING`. */
async function settled<T>(promise: Promise<T>): Promise<T | typeof PENDING> {
	return Promise.race([promise, new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING)))]);
}

describe('readNextBatch', () => {
	it('reloads the screen when the read was redirected, and never settles', async () => {
		answering(redirectedToSignIn());
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });

		const read = readNextBatch<Batch>('/fundraise/pages/p1/gifts', '1700000000000.g1', 'gifts');

		expect(await settled(read)).toBe(PENDING);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('answers a good batch as it arrived, without reloading', async () => {
		const fetch = answering(
			Response.json({ kind: 'gifts', gifts: ['g1', 'g2'], total: 52, next: '1690000000000.g2' })
		);
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });

		const batch = await readNextBatch<Batch>(
			'/fundraise/pages/p1/gifts',
			'1700000000000.g1',
			'gifts'
		);

		expect(batch).toEqual({
			kind: 'gifts',
			gifts: ['g1', 'g2'],
			total: 52,
			next: '1690000000000.g2'
		});
		expect(fetch).toHaveBeenCalledWith('/fundraise/pages/p1/gifts?after=1700000000000.g1', {
			headers: { accept: 'application/json' }
		});
		expect(reload).not.toHaveBeenCalled();
	});

	it.each([
		['a refusal', Response.json({ kind: 'refused' }, { status: 404 })],
		[
			'a failure answered as a batch',
			Response.json({ kind: 'gifts', gifts: [], total: 0 }, { status: 500 })
		],
		['another kind', Response.json({ kind: 'pages', pages: [], gifts: [], total: 0, next: null })],
		[
			'a total that is not a number',
			Response.json({ kind: 'gifts', gifts: [], total: '0', next: null })
		],
		[
			'a body that is not JSON',
			new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
		]
	])('answers null for %s', async (_, response) => {
		answering(response);

		expect(await readNextBatch<Batch>('/fundraise/pages/p1/gifts', 'c', 'gifts')).toBeNull();
	});

	it('answers null where the server was never reached', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
		);

		expect(await readNextBatch<Batch>('/fundraise/pages/p1/gifts', 'c', 'gifts')).toBeNull();
	});

	it('answers null where the list its kind names is not an array', async () => {
		answering(Response.json({ kind: 'gifts', gifts: { 0: 'g1' }, total: 1, next: null }));

		expect(await readNextBatch<Batch>('/fundraise/pages/p1/gifts', 'c', 'gifts')).toBeNull();
	});
});
