import { describe, expect, it } from 'vitest';
import { createResponseCache } from './response-cache';

const ORIGIN = 'https://donate.example.org';

/** a response of `bytes` bytes, kept for `maxAge` seconds. */
function body(bytes: number, maxAge = 300) {
	return new Response(new Uint8Array(bytes), {
		headers: { 'content-type': 'application/octet-stream', 'cache-control': `max-age=${maxAge}` }
	});
}

function clock() {
	let now = 0;
	return { now: () => now, advance: (ms: number) => void (now += ms) };
}

describe('createResponseCache', () => {
	it('answers a kept response under the URL it was put under, body and headers intact', async () => {
		const cache = createResponseCache({ maxBytes: 1024 });
		await cache.put(
			new Request(`${ORIGIN}/__offered-rails`),
			new Response('["card"]', {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);

		const hit = await cache.match(`${ORIGIN}/__offered-rails`);
		expect(hit?.headers.get('content-type')).toBe('application/json');
		expect(await hit?.json()).toEqual(['card']);
		// a second read gets a body of its own.
		expect(await (await cache.match(new Request(`${ORIGIN}/__offered-rails`)))?.text()).toBe(
			'["card"]'
		);
	});

	it('misses a key nothing was put under', async () => {
		expect(await createResponseCache({ maxBytes: 1024 }).match(`${ORIGIN}/x`)).toBeUndefined();
	});

	it('stops answering an entry once its max-age has passed', async () => {
		const time = clock();
		const cache = createResponseCache({ maxBytes: 1024, now: time.now });
		await cache.put(`${ORIGIN}/a`, body(10, 300));

		time.advance(299_999);
		expect(await cache.match(`${ORIGIN}/a`)).toBeDefined();
		time.advance(1);
		expect(await cache.match(`${ORIGIN}/a`)).toBeUndefined();
		expect(cache.bytes()).toBe(0);
	});

	it.each([
		['no-store', 'no-store'],
		['private', 'private, max-age=300'],
		['no lifetime', 'public']
	])('keeps nothing whose cache-control says %s', async (_, cacheControl) => {
		const cache = createResponseCache({ maxBytes: 1024 });
		await cache.put(
			`${ORIGIN}/a`,
			new Response('x', { headers: { 'cache-control': cacheControl } })
		);
		expect(await cache.match(`${ORIGIN}/a`)).toBeUndefined();
	});

	it('holds entries up to its bound and evicts the least recently read past it', async () => {
		const cache = createResponseCache({ maxBytes: 300 });
		await cache.put(`${ORIGIN}/a`, body(100));
		await cache.put(`${ORIGIN}/b`, body(100));
		await cache.put(`${ORIGIN}/c`, body(100));
		expect(cache.bytes()).toBe(300);

		// read `a`, so `b` is now the one read longest ago.
		await cache.match(`${ORIGIN}/a`);
		await cache.put(`${ORIGIN}/d`, body(100));

		expect(cache.bytes()).toBeLessThanOrEqual(300);
		expect(await cache.match(`${ORIGIN}/b`)).toBeUndefined();
		for (const kept of ['a', 'c', 'd']) {
			expect(await cache.match(`${ORIGIN}/${kept}`)).toBeDefined();
		}
	});

	it('keeps nothing larger than its bound, and drops nothing for it', async () => {
		const cache = createResponseCache({ maxBytes: 300 });
		await cache.put(`${ORIGIN}/a`, body(100));
		await cache.put(`${ORIGIN}/huge`, body(301));

		expect(await cache.match(`${ORIGIN}/huge`)).toBeUndefined();
		expect(await cache.match(`${ORIGIN}/a`)).toBeDefined();
	});

	it('replaces an entry put again under the same key, counting its bytes once', async () => {
		const cache = createResponseCache({ maxBytes: 300 });
		await cache.put(`${ORIGIN}/a`, body(100));
		await cache.put(`${ORIGIN}/a`, body(50));

		expect(cache.bytes()).toBe(50);
	});

	it('forgets an entry deleted', async () => {
		const cache = createResponseCache({ maxBytes: 300 });
		await cache.put(`${ORIGIN}/a`, body(100));

		expect(await cache.delete(`${ORIGIN}/a`)).toBe(true);
		expect(await cache.match(`${ORIGIN}/a`)).toBeUndefined();
		expect(cache.bytes()).toBe(0);
	});
});
