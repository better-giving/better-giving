import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import { IMAGE_BYTES_MAX, image } from '../db/schema';
import { d1BytesPort } from '../images/bytes';
import { jpegHeader } from '../images/headers.testing';
import { illustrate } from './illustrate';

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

/** the model's own answer shape: the picture as base64 under `image`. */
function answer(bytes: Uint8Array) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return { image: btoa(binary) };
}

/** a binding whose one call answers `reply`, or throws it when it is an `Error`. */
function answering(reply: unknown) {
	return {
		run: vi.fn(async () => {
			if (reply instanceof Error) throw reply;
			return reply;
		})
	};
}

const ASK = { prompt: 'a watercolour of a food bank at dawn', alt: 'a food bank at dawn' } as const;

describe('an illustration the model draws', () => {
	it('is stored as an illustration with its alt and the size its bytes declare, and its id returned', async () => {
		const bytes = jpegHeader(1024, 768);

		const result = await illustrate({ AI: answering(answer(bytes)) }, db, ASK);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [row] = await db.select().from(image).where(eq(image.id, result.imageId));
		expect(row).toMatchObject({
			kind: 'illustration',
			contentType: 'image/jpeg',
			width: 1024,
			height: 768,
			alt: 'a food bank at dawn',
			byteSize: bytes.byteLength
		});
		const stored = await d1BytesPort(db).get(result.imageId);
		expect([...(stored?.bytes ?? [])]).toEqual([...bytes]);
	});
});

describe('a deployment with no model to call', () => {
	it('is refused as unbound when the worker has no Workers AI binding', async () => {
		const result = await illustrate({}, db, ASK);

		expect(result).toEqual({ ok: false, reason: 'unbound' });
	});

	// what a local dev server binds when no remote session was opened (miniflare's
	// remote-proxy-client worker).
	it('is refused as unbound when the binding is the local stand-in', async () => {
		const AI = answering(new Error('Binding AI needs to be run remotely'));

		const result = await illustrate({ AI }, db, ASK);

		expect(result).toEqual({ ok: false, reason: 'unbound' });
	});
});

describe('a model that does not draw', () => {
	it('is refused as failed when the call throws, and stores nothing', async () => {
		const before = await db.$count(image);

		const result = await illustrate({ AI: answering(new Error('3040: capacity')) }, db, ASK);

		expect(result).toEqual({ ok: false, reason: 'failed' });
		expect(await db.$count(image)).toBe(before);
	});

	it.each([
		['no image', {}],
		['an empty image', { image: '' }],
		['nothing at all', null]
	])('is refused as failed when the answer holds %s', async (_, reply) => {
		const result = await illustrate({ AI: answering(reply) }, db, ASK);

		expect(result).toEqual({ ok: false, reason: 'failed' });
	});
});

describe('a picture the database refuses', () => {
	// a blank alt is refused by `image_alt_check`, which makes D1's own write throw.
	it('is refused as failed, and stores nothing', async () => {
		const before = await db.$count(image);

		const result = await illustrate({ AI: answering(answer(jpegHeader(1024, 1024))) }, db, {
			...ASK,
			alt: '   '
		});

		expect(result).toEqual({ ok: false, reason: 'failed' });
		expect(await db.$count(image)).toBe(before);
	});
});

describe('an answer that is not a picture', () => {
	it.each([
		['bytes no image header opens', answer(new TextEncoder().encode('not a picture at all'))],
		['text that is not base64', { image: 'not base64 at all!' }]
	])('is refused as unreadable when it is %s, and stores nothing', async (_, reply) => {
		const before = await db.$count(image);

		const result = await illustrate({ AI: answering(reply) }, db, ASK);

		expect(result).toEqual({ ok: false, reason: 'unreadable' });
		expect(await db.$count(image)).toBe(before);
	});
});

describe('a picture past the cap on a stored image', () => {
	it('is refused as too large, and stores nothing', async () => {
		const header = jpegHeader(1024, 1024);
		const bytes = new Uint8Array(IMAGE_BYTES_MAX + 1);
		bytes.set(header);
		const before = await db.$count(image);

		const result = await illustrate({ AI: answering(answer(bytes)) }, db, ASK);

		expect(result).toEqual({ ok: false, reason: 'too-large' });
		expect(await db.$count(image)).toBe(before);
	});
});
