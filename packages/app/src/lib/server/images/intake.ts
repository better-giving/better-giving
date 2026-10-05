import { IMAGE_BYTES_MAX } from '../db/schema';
import type { Db } from '../db/client';
import { type NewImageStatements, newImageStatements } from './queries';
import { sniffImage } from './sniff';

// a photo posted as `multipart/form-data` with the photo in `file`, stored — the one intake every
// route taking a photo runs (src/routes/_app.admin.images.ts from the dashboard,
// src/routes/console.org.logo.ts from the console), so the bounds are written once.
//
// the photo is resized in the browser first (`@better-giving/operator/images/resize`), which is why
// everything here is a refusal rather than a repair. each bound is checked again because a route
// takes a post from anything holding its credential, not only from the resize:
//
// - size. a declared `content-length` past `UPLOAD_MAX` is refused before a byte is read, and the
//   body is read no further than `UPLOAD_MAX` whether declared or not, so a post that lies or
//   declares nothing costs at most that much. `UPLOAD_MAX` is the photo's own cap plus room for the
//   multipart framing around it; the photo itself is then held to `IMAGE_BYTES_MAX`.
// - type. the bytes' own header decides it (./sniff.ts), and the label the post gave the file is
//   not read at all: the image route serves a photo under its stored type with `nosniff`, so the
//   stored type must be what the bytes are.
// - pixels. the width and height the same header states are held to `SIDE_MAX`.
//
// the body is read once, here, for the route that owns it (CLAUDE.md → Bans → Runtime). each
// refusal's `error` names the limit; what status it answers is the route's.
//
// `takePostedPhoto` stores the photo on its own. `readPostedPhoto` stores nothing and hands back the
// statements that would, for a route whose write names the photo to put them in the same `batch()`,
// so the photo lands only with that write.

/**
 * the most a whole post may be: the photo's cap plus 64 KiB of room for the boundary lines and part
 * headers around the one file. a literal over `IMAGE_BYTES_MAX`, so a test outside this language
 * can read it from this line.
 */
export const UPLOAD_MAX = IMAGE_BYTES_MAX + 65_536;

/**
 * the longest side a stored photo may have, in pixels. well over the resize's `LONG_SIDE_MAX`
 * (`@better-giving/operator/images/resize`), so only a post that skipped the resize meets it: a
 * small file can claim a huge canvas, and every donor phone that draws it decodes the canvas.
 */
const SIDE_MAX = 4096;

/** why a post is no photo this takes: `too-large` over a size bound, `refused` for anything else. */
type PhotoRefusal = {
	readonly ok: false;
	readonly refusal: 'too-large' | 'refused';
	readonly error: string;
};

/** a posted photo checked and not yet stored: its id, its size and the statements storing it. */
export type PostedPhoto =
	| {
			readonly ok: true;
			readonly id: string;
			readonly width: number;
			readonly height: number;
			readonly statements: NewImageStatements;
	  }
	| PhotoRefusal;

/** a photo stored, or why not: a refusal, or `failed` where the store threw. */
export type PhotoIntake =
	| { readonly ok: true; readonly id: string; readonly width: number; readonly height: number }
	| PhotoRefusal
	| { readonly ok: false; readonly refusal: 'failed'; readonly error: string };

const tooLarge = (what: string): PhotoRefusal => ({
	ok: false,
	refusal: 'too-large',
	error: `${what}; a photo is at most ${IMAGE_BYTES_MAX} bytes (${(IMAGE_BYTES_MAX / 1_000_000).toFixed(1)} MB) once resized`
});

const refused = (error: string): PhotoRefusal => ({ ok: false, refusal: 'refused', error });

/** the body's bytes, or null once it runs past `max` — the rest is never read. */
async function readUpTo(body: ReadableStream<Uint8Array> | null, max: number) {
	const chunks: Uint8Array[] = [];
	let length = 0;
	if (body !== null) {
		const reader = body.getReader();
		for (let next = await reader.read(); !next.done; next = await reader.read()) {
			length += next.value.byteLength;
			if (length > max) {
				await reader.cancel();
				return null;
			}
			chunks.push(next.value);
		}
	}
	const bytes = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

/** the photo `request` posts in `file`, checked, with the statements storing it as a `photo`. */
export async function readPostedPhoto(db: Db, request: Request): Promise<PostedPhoto> {
	const declared = Number(request.headers.get('content-length'));
	if (declared > UPLOAD_MAX) return tooLarge(`the upload is ${declared} bytes`);
	const body = await readUpTo(request.body, UPLOAD_MAX);
	if (body === null) return tooLarge(`the upload is over ${IMAGE_BYTES_MAX} bytes`);

	let file: FormDataEntryValue | null;
	try {
		file = (
			await new Response(body, {
				headers: { 'content-type': request.headers.get('content-type') ?? '' }
			}).formData()
		).get('file');
	} catch {
		return refused('the body is not multipart/form-data; post the photo as `file`');
	}
	if (!(file instanceof Blob)) {
		return refused('file is required: the photo, as the multipart body’s one file');
	}
	if (file.size > IMAGE_BYTES_MAX) return tooLarge(`file is ${file.size} bytes`);

	const bytes = new Uint8Array(await file.arrayBuffer());
	const sniffed = sniffImage(bytes);
	if (sniffed === null) {
		return refused('file is not a WebP, JPEG or PNG image: its first bytes are none of the three');
	}
	if (Math.max(sniffed.width, sniffed.height) > SIDE_MAX) {
		return refused(
			`file is ${sniffed.width} × ${sniffed.height} pixels; a photo is at most ${SIDE_MAX} pixels on its longer side once resized`
		);
	}

	const { id, statements } = newImageStatements(
		db,
		{ kind: 'photo', ...sniffed, alt: null },
		bytes
	);
	return { ok: true, id, width: sniffed.width, height: sniffed.height, statements };
}

/** the photo `request` posts in `file`, stored as a `photo` with no alt text. */
export async function takePostedPhoto(db: Db, request: Request): Promise<PhotoIntake> {
	const photo = await readPostedPhoto(db, request);
	if (!photo.ok) return photo;
	try {
		await db.batch(photo.statements);
		return { ok: true, id: photo.id, width: photo.width, height: photo.height };
	} catch (e) {
		console.error('storing a posted photo failed:', e);
		return { ok: false, refusal: 'failed', error: 'the photo was not stored; post it again' };
	}
}
