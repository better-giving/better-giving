import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { IMAGE_BYTES_MAX, image } from '../db/schema';
import { d1BytesPort } from './bytes';
import { createImage, illustrationsAmong } from './queries';

// a new image is its metadata row and its bytes, written together or not at all.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

const PHOTO = { kind: 'photo', contentType: 'image/webp', width: 1600, height: 1067 } as const;

describe('createImage()', () => {
	it('stores the metadata, sized from the bytes, and the bytes under one new id', async () => {
		const id = await createImage(
			db,
			{ ...PHOTO, alt: 'volunteers at the food bank' },
			new Uint8Array([7, 7, 7])
		);

		const [row] = await db.select().from(image).where(eq(image.id, id));
		expect(row).toMatchObject({ ...PHOTO, byteSize: 3, alt: 'volunteers at the food bank' });
		const stored = await d1BytesPort(db).get(id);
		expect(stored?.contentType).toBe('image/webp');
		expect([...(stored?.bytes ?? [])]).toEqual([7, 7, 7]);
	});

	it('leaves no metadata row when the bytes are refused', async () => {
		const before = await db.$count(image);
		expect(
			await rejectionCode(() => createImage(db, PHOTO, new Uint8Array(IMAGE_BYTES_MAX + 1)))
		).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(await db.$count(image)).toBe(before);
	});
});

describe('illustrationsAmong()', () => {
	it('names the illustrations among more ids than one query may bind', async () => {
		const drawn = await createImage(
			db,
			{ ...PHOTO, kind: 'illustration', alt: 'a van' },
			new Uint8Array([1])
		);
		const photo = await createImage(db, PHOTO, new Uint8Array([2]));
		const absent = Array.from(
			{ length: 150 },
			(_, index) => `01926f3e-0000-7b2e-9d4f-${String(index).padStart(12, '0')}`
		);

		const found = await illustrationsAmong(db, [drawn, photo, ...absent, drawn, drawn]);

		expect([...found]).toEqual([drawn]);
	});
});
