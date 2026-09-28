import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// the checks `image` carries, each a table rebuild to change once shipped. `STRICT` and the
// `NO ACTION` key from `image_bytes` are read off sqlite's catalogue by ./strict.workers.spec.ts,
// and the bytes' length check is held by ../images/bytes.workers.spec.ts.

type ImageRow = {
	kind: string;
	content_type: string;
	width: number;
	height: number;
	byte_size: number;
	alt: string | null;
};

const PHOTO: ImageRow = {
	kind: 'photo',
	content_type: 'image/webp',
	width: 1600,
	height: 900,
	byte_size: 120_000,
	alt: null
};

async function insertImage(row: ImageRow) {
	await env.DB.prepare(
		`insert into image (id, kind, content_type, width, height, byte_size, alt, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, 0, 0)`
	)
		.bind(
			crypto.randomUUID(),
			row.kind,
			row.content_type,
			row.width,
			row.height,
			row.byte_size,
			row.alt
		)
		.run();
}

/** the message D1 rejected `row` with; throws when it was accepted. */
async function rejection(row: ImageRow): Promise<string> {
	try {
		await insertImage(row);
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this image, but it was stored');
}

describe('image', () => {
	it.each([
		['with no alt, as a decorative image', null],
		['with alt text', 'volunteers sorting coats']
	])('takes a photo %s', async (_, alt) => {
		await expect(insertImage({ ...PHOTO, alt })).resolves.toBeUndefined();
	});

	it('takes an illustration', async () => {
		await expect(insertImage({ ...PHOTO, kind: 'illustration' })).resolves.toBeUndefined();
	});

	it.each([
		['a kind outside the set', { kind: 'logo' }],
		['a content type outside the set', { content_type: 'image/gif' }],
		['a zero width', { width: 0 }],
		['a negative height', { height: -1 }],
		['a zero height', { height: 0 }],
		['a zero byte size', { byte_size: 0 }],
		['an empty alt', { alt: '' }],
		['a whitespace-only alt', { alt: ' \t\n' }]
	] satisfies [string, Partial<ImageRow>][])('refuses %s', async (_, change) => {
		expect(await rejection({ ...PHOTO, ...change })).toContain('SQLITE_CONSTRAINT_CHECK');
	});
});
