import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { type BytesPort, d1BytesPort } from './bytes';
import { pngHeader } from './headers.testing';
import { createImage } from './queries';
import { type ServeOptions, servedImage } from './served';

// the edge cache in front of an image's bytes, against workerd's own `caches` and real D1.
//
// every case serves under an origin of its own, because the entries live in one store for the whole
// run: a shared address would make each case depend on which ran first.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

/** the D1 port, counting how often its bytes were asked for. */
function countingPort(): { port: BytesPort; reads: () => number } {
	const inner = d1BytesPort(db);
	let reads = 0;
	return {
		reads: () => reads,
		port: {
			put: inner.put,
			async get(id) {
				reads += 1;
				return inner.get(id);
			}
		}
	};
}

/** the headers workerd's cache sets on an answer it kept, whatever the stored response said. */
const CACHE_TRANSPORT = new Set(['age', 'cf-cache-status', 'content-length', 'date']);

let origins = 0;
const freshOrigin = () => `https://served-${++origins}.example`;

/** one answer, with every task it handed to `waitUntil` finished before it is read. */
async function serve(
	port: BytesPort,
	origin: string,
	id: string,
	options?: ServeOptions
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await servedImage(port, ctx, { origin, id }, options);
	await waitOnExecutionContext(ctx);
	return response;
}

const storedPng = () =>
	createImage(
		db,
		{ kind: 'photo', contentType: 'image/png', width: 4, height: 3, alt: null },
		pngHeader(4, 3)
	);

describe('servedImage()', () => {
	it('answers a second view of an id from the edge, without reading the bytes again', async () => {
		const id = await storedPng();
		const { port, reads } = countingPort();
		const origin = freshOrigin();

		const first = await serve(port, origin, id);
		const second = await serve(port, origin, id);

		expect(reads()).toBe(1);
		expect(new Uint8Array(await second.arrayBuffer())).toEqual(pngHeader(4, 3));
		expect(new Uint8Array(await first.arrayBuffer())).toEqual(pngHeader(4, 3));
	});

	it('answers a view from the edge with the headers the read answered with', async () => {
		const id = await storedPng();
		const { port } = countingPort();
		const origin = freshOrigin();

		const miss = await serve(port, origin, id);
		const hit = await serve(port, origin, id);

		// the store adds what describes the copy it kept, and nothing that describes the image.
		const hitOwn = [...hit.headers].filter(([name]) => !CACHE_TRANSPORT.has(name));
		expect(hitOwn).toEqual([...miss.headers]);
		expect(Object.fromEntries(miss.headers)).toMatchObject({
			'content-type': 'image/png',
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		});
	});

	it('answers an id no image has with a bodiless 404, and keeps nothing for it', async () => {
		const { port, reads } = countingPort();
		const origin = freshOrigin();
		const id = '01890000-0000-7000-8000-000000000000';

		const first = await serve(port, origin, id);
		const second = await serve(port, origin, id);

		expect([first.status, second.status]).toEqual([404, 404]);
		expect(await second.text()).toBe('');
		expect(reads()).toBe(2);
	});

	describe('beforeRead', () => {
		it('is asked once on a miss, before the bytes are read', async () => {
			const id = await storedPng();
			const { port, reads } = countingPort();
			const readsWhenAsked: number[] = [];

			await serve(port, freshOrigin(), id, {
				beforeRead: async () => {
					readsWhenAsked.push(reads());
					return null;
				}
			});

			expect(readsWhenAsked).toEqual([0]);
			expect(reads()).toBe(1);
		});

		it('answers with the response it returns, reading nothing and keeping nothing', async () => {
			const id = await storedPng();
			const { port, reads } = countingPort();
			const origin = freshOrigin();

			const refused = await serve(port, origin, id, {
				beforeRead: async () => new Response('slow down', { status: 429 })
			});
			const readsWhileRefused = reads();
			await serve(port, origin, id);

			expect(refused.status).toBe(429);
			expect(await refused.text()).toBe('slow down');
			expect(readsWhileRefused).toBe(0);
			// the view after it is a miss: the refusal left no entry behind.
			expect(reads()).toBe(1);
		});

		it('lets the view go ahead when it returns null: the bytes are answered and kept', async () => {
			const id = await storedPng();
			const { port, reads } = countingPort();
			const origin = freshOrigin();

			const answered = await serve(port, origin, id, { beforeRead: async () => null });
			await serve(port, origin, id);

			expect(answered.status).toBe(200);
			expect(new Uint8Array(await answered.arrayBuffer())).toEqual(pngHeader(4, 3));
			expect(reads()).toBe(1);
		});

		it('is never asked on a hit', async () => {
			const id = await storedPng();
			const { port } = countingPort();
			const origin = freshOrigin();
			let asked = 0;
			const beforeRead = async () => {
				asked += 1;
				return null;
			};

			await serve(port, origin, id, { beforeRead });
			const hit = await serve(port, origin, id, { beforeRead });

			expect(asked).toBe(1);
			expect(new Uint8Array(await hit.arrayBuffer())).toEqual(pngHeader(4, 3));
		});
	});
});
