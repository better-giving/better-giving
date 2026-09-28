import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { IMAGE_BYTES_MAX, image } from '$lib/server/db/schema';
import { d1BytesPort } from '$lib/server/images/bytes';
import { jpegHeader, pngHeader, webpHeader } from '$lib/server/images/headers.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as images from './_app.admin.images';

// a workers spec because an upload writes an image and its bytes. the chain is mounted, for
// ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx. how each
// format's size is read is $lib/server/images/sniff.spec.ts's; here, what the edge takes, what it
// stores and what it answers.

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/images', module: images }
	]);
	session = await signIn(db);
});

function post(file: Blob | string | null, cookie = session) {
	const body = new FormData();
	if (file !== null) body.set('file', file);
	return request(
		new Request(`${ORIGIN}/admin/images`, { method: 'POST', headers: { cookie }, body }),
		{ env }
	);
}

async function stored(id: string) {
	const [row] = await db.select().from(image).where(eq(image.id, id));
	return { row, bytes: await d1BytesPort(db).get(id) };
}

const PHOTOS = [
	{ type: 'image/webp', bytes: webpHeader(1600, 1067, 'VP8 ') },
	{ type: 'image/jpeg', bytes: jpegHeader(1600, 1067) },
	{ type: 'image/png', bytes: pngHeader(1600, 1067) }
] as const;

describe('a photo posted to the images route', () => {
	it.each(PHOTOS)(
		'stores a $type as a photo, and answers its id and size',
		async ({ type, bytes }) => {
			const response = await post(new Blob([bytes], { type }));

			expect(response.status).toBe(200);
			const answer = (await response.json()) as { id: string; width: number; height: number };
			expect(answer).toEqual({ id: expect.any(String), width: 1600, height: 1067 });
			const { row, bytes: kept } = await stored(answer.id);
			expect(row).toMatchObject({
				kind: 'photo',
				contentType: type,
				width: 1600,
				height: 1067,
				byteSize: bytes.byteLength,
				alt: null
			});
			expect([...(kept?.bytes ?? [])]).toEqual([...bytes]);
		}
	);

	it('files a photo under the type its bytes say, not the type it was labelled', async () => {
		const response = await post(new Blob([pngHeader(40, 30)], { type: 'image/webp' }));

		const { id } = (await response.json()) as { id: string };
		expect((await stored(id)).row?.contentType).toBe('image/png');
	});
});

describe('a post the images route refuses', () => {
	it('is a 400 naming the three types when the bytes are no image, whatever the label', async () => {
		const before = await db.$count(image);

		const response = await post(new Blob(['not a photo at all'], { type: 'image/webp' }));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'file is not a WebP, JPEG or PNG image: its first bytes are none of the three'
		});
		expect(await db.$count(image)).toBe(before);
	});

	it('is a 413 naming the cap and the photo’s own size when the photo is over it', async () => {
		const over = new Uint8Array(IMAGE_BYTES_MAX + 1);
		over.set(pngHeader(4000, 3000));

		const response = await post(new Blob([over], { type: 'image/png' }));

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: `file is ${IMAGE_BYTES_MAX + 1} bytes; a photo is at most ${IMAGE_BYTES_MAX} bytes (1.9 MB) once resized`
		});
	});

	it('is a 413 naming the declared size when the upload says it is far over', async () => {
		const response = await request(
			new Request(`${ORIGIN}/admin/images`, {
				method: 'POST',
				headers: {
					cookie: session,
					'content-type': 'multipart/form-data; boundary=x',
					'content-length': '2400000'
				},
				body: 'x'.repeat(2_400_000)
			}),
			{ env }
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: `the upload is 2400000 bytes; a photo is at most ${IMAGE_BYTES_MAX} bytes (1.9 MB) once resized`
		});
	});

	it('is a 413 when an upload that declares no size runs past the cap', async () => {
		const chunk = new Uint8Array(100_000);
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent >= 3_000_000) return controller.close();
				sent += chunk.byteLength;
				controller.enqueue(chunk);
			}
		});

		const response = await request(
			new Request(`${ORIGIN}/admin/images`, {
				method: 'POST',
				headers: { cookie: session, 'content-type': 'multipart/form-data; boundary=x' },
				body
			}),
			{ env }
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: `the upload is over ${IMAGE_BYTES_MAX} bytes; a photo is at most ${IMAGE_BYTES_MAX} bytes (1.9 MB) once resized`
		});
		expect(sent).toBeLessThan(3_000_000);
	});

	it('is a 400 naming the box when no file came', async () => {
		const response = await post('a photo, as words');

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'file is required: the photo, as the multipart body’s one file'
		});
	});
});

it('sends a photo from someone signed out to sign in, and stores nothing', async () => {
	const before = await db.$count(image);

	const response = await post(new Blob([pngHeader(40, 30)], { type: 'image/png' }), '');

	expect([response.status, response.headers.get('Location')]).toEqual([
		303,
		expect.stringMatching(/^\/login\?/)
	]);
	expect(await db.$count(image)).toBe(before);
});
