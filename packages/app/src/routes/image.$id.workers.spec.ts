import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { createImage } from '$lib/server/images/queries';
import { mountRoutes } from '../route-request.testing';
import * as imageRoute from './image.$id';

// a workers spec because the answer is read off a row: the bytes and their type are D1's, written
// here by `createImage`.

const request = mountRoutes([{ path: 'image/:id', module: imageRoute }]);

const ORIGIN = 'https://give.example.workers.dev';

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

describe('GET /image/{id}', () => {
	it('answers a stored image with its bytes, its type and a cache that never revalidates', async () => {
		const id = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/png', width: 1, height: 1, alt: null },
			new Uint8Array([0x89, 0x50, 0x4e, 0x47])
		);

		const response = await request(new Request(`${ORIGIN}/image/${id}`));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('content-disposition')).toBe('inline');
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('answers HEAD from the same loader, with the same type', async () => {
		const id = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 1, height: 1, alt: null },
			new Uint8Array([0x52, 0x49, 0x46, 0x46])
		);

		const response = await request(new Request(`${ORIGIN}/image/${id}`, { method: 'HEAD' }));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
	});

	it.each([
		['an id nothing was stored under', '0192f3a4-5b6c-7d8e-9f01-23456789abcd'],
		['an id that is not a uuid at all', 'not-an-image'],
		['an id spelled as a query', "x' or '1'='1"]
	])('answers %s with a bare 404', async (_, id) => {
		const response = await request(new Request(`${ORIGIN}/image/${encodeURIComponent(id)}`));

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('');
	});
});

/** the pool's env with every statement sent to `DB` counted, over the real binding. */
function countingEnv(): { readonly env: Env; readonly prepared: () => number } {
	let prepared = 0;
	const db = new Proxy(env.DB, {
		get(target, property) {
			if (property === 'prepare') {
				return (query: string) => {
					prepared += 1;
					return target.prepare(query);
				};
			}
			// bound to the target: these are a native class's methods, and a proxy as `this` throws.
			const value = Reflect.get(target, property) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	const counted = new Proxy(env, {
		get: (target, property) => (property === 'DB' ? db : Reflect.get(target, property))
	}) as Env;
	return { env: counted, prepared: () => prepared };
}

describe('GET /image/{id} through the edge cache', () => {
	it('answers a second view from the edge, without reading D1', async () => {
		const id = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/png', width: 1, height: 1, alt: null },
			new Uint8Array([0x89, 0x50, 0x4e, 0x47])
		);
		// an origin of its own, since the edge keeps one store for the whole run.
		const address = `https://edge-1.example/image/${id}`;
		const first = createExecutionContext();
		await request(new Request(address), { ctx: first });
		await waitOnExecutionContext(first);

		const counted = countingEnv();
		const again = await request(new Request(address), { env: counted.env });

		expect(again.status).toBe(200);
		expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(counted.prepared()).toBe(0);
	});
});

describe('the limit on GET /image/{id}', () => {
	/** views `address` from `ip` until refused, or fails loudly rather than asserting nothing. */
	async function untilRefused(address: string, ip: string): Promise<Response> {
		for (let i = 0; i < 50; i++) {
			const response = await request(new Request(address, { headers: { 'cf-connecting-ip': ip } }));
			if (response.status === 429) return response;
			await response.arrayBuffer();
		}
		throw new Error(`50 views from ${ip} and the limiter refused none of them`);
	}

	// an id nothing was stored under is never kept, so every view of it is a miss and is charged.
	it('refuses a miss from a caller who has viewed too often, naming the limit and when to come back', async () => {
		const refused = await untilRefused(
			'https://edge-2.example/image/0192f3a4-5b6c-7d8e-9f01-23456789abcd',
			'203.0.113.80'
		);

		expect(refused.headers.get('retry-after')).toBe('60');
		expect(refused.headers.get('cache-control')).toBe('no-store');
		const body = (await refused.json()) as { message: string; fix: string };
		expect(body.fix).toContain('photo');
		expect(body.fix).toContain('60 seconds');
	});

	it('refuses a miss over the limit before anything is read', async () => {
		const id = '0192f3a4-5b6c-7d8e-9f01-23456789abce';
		await untilRefused(`https://edge-3.example/image/${id}`, '203.0.113.81');
		const counted = countingEnv();

		const refused = await request(
			new Request(`https://edge-3.example/image/${id}`, {
				headers: { 'cf-connecting-ip': '203.0.113.81' }
			}),
			{ env: counted.env }
		);

		expect(refused.status).toBe(429);
		expect(counted.prepared()).toBe(0);
	});

	it('answers a view the edge holds even when the caller is over the limit', async () => {
		const id = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/png', width: 1, height: 1, alt: null },
			new Uint8Array([0x89, 0x50, 0x4e, 0x47])
		);
		const address = `https://edge-5.example/image/${id}`;
		const first = createExecutionContext();
		await request(new Request(address), { ctx: first });
		await waitOnExecutionContext(first);
		await untilRefused(
			'https://edge-5.example/image/0192f3a4-5b6c-7d8e-9f01-23456789abd0',
			'203.0.113.82'
		);

		const kept = await request(
			new Request(address, { headers: { 'cf-connecting-ip': '203.0.113.82' } })
		);

		expect(kept.status).toBe(200);
		expect([...new Uint8Array(await kept.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('counts no view from a caller the edge did not attribute', async () => {
		const id = '0192f3a4-5b6c-7d8e-9f01-23456789abcf';
		const statuses = new Set<number>();
		for (let i = 0; i < 30; i++) {
			statuses.add((await request(new Request(`https://edge-4.example/image/${id}`))).status);
		}

		expect(statuses).toEqual(new Set([404]));
	});
});
