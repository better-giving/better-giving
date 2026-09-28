import { env } from 'cloudflare:test';
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
