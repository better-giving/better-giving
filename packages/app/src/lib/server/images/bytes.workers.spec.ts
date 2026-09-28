import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { IMAGE_BYTES_MAX, image } from '../db/schema';
import { rejectionCode } from '../db/rejection.testing';
import { d1BytesPort } from './bytes';

// the port's contract against real D1: bytes go in once under an image's id and come back by it.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

/** a metadata row with no bytes yet, which only a fixture makes: `createImage` writes both. */
async function metadata(contentType: 'image/webp' | 'image/jpeg' | 'image/png' = 'image/webp') {
	const id = uuidv7();
	await db.insert(image).values({
		id,
		kind: 'photo',
		contentType,
		width: 1600,
		height: 900,
		byteSize: 4
	});
	return id;
}

describe('d1BytesPort()', () => {
	it('gives back by id the bytes put under it, with their content type', async () => {
		const id = await metadata('image/jpeg');
		const port = d1BytesPort(db);
		await port.put(id, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg');
		const got = await port.get(id);
		expect(got?.contentType).toBe('image/jpeg');
		expect([...(got?.bytes ?? [])]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
	});

	it('refuses a second put under the same id and keeps the first bytes', async () => {
		const id = await metadata();
		const port = d1BytesPort(db);
		await port.put(id, new Uint8Array([1, 2, 3, 4]), 'image/webp');
		expect(
			await rejectionCode(() => port.put(id, new Uint8Array([9, 9, 9, 9]), 'image/webp'))
		).toContain('SQLITE_CONSTRAINT_PRIMARYKEY');
		expect([...((await port.get(id))?.bytes ?? [])]).toEqual([1, 2, 3, 4]);
	});

	it('refuses bytes for an id with no metadata row', async () => {
		const id = uuidv7();
		const port = d1BytesPort(db);
		await expect(port.put(id, new Uint8Array([1]), 'image/webp')).rejects.toThrow(id);
		expect(await port.get(id)).toBeNull();
	});

	it('refuses bytes of a type their metadata does not claim', async () => {
		const id = await metadata('image/png');
		const port = d1BytesPort(db);
		await expect(port.put(id, new Uint8Array([1]), 'image/webp')).rejects.toThrow(id);
		expect(await port.get(id)).toBeNull();
	});

	it('takes bytes up to the ceiling and refuses one byte more', async () => {
		const port = d1BytesPort(db);
		const atCeiling = await metadata();
		await port.put(atCeiling, new Uint8Array(IMAGE_BYTES_MAX), 'image/webp');
		expect((await port.get(atCeiling))?.bytes.byteLength).toBe(IMAGE_BYTES_MAX);

		const over = await metadata();
		expect(
			await rejectionCode(() => port.put(over, new Uint8Array(IMAGE_BYTES_MAX + 1), 'image/webp'))
		).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(await port.get(over)).toBeNull();
	});

	it('has nothing under an id it was never given', async () => {
		expect(await d1BytesPort(db).get(uuidv7())).toBeNull();
	});

	it('has nothing under an image whose bytes were never put', async () => {
		expect(await d1BytesPort(db).get(await metadata())).toBeNull();
	});
});
