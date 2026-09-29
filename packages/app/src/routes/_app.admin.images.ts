import { data } from 'react-router';
import { IMAGE_BYTES_MAX } from '$lib/server/db/schema';
import { createImage } from '$lib/server/images/queries';
import { sniffImage } from '$lib/server/images/sniff';
import { database } from '../context';
import type { Route } from './+types/_app.admin.images';

// a photo posted from the dashboard, stored: an `action` with no component, which the editor asks
// by fetcher and which answers `{ id, width, height }`. under the protected layout by its name, so
// anyone signed in may store one; the photo belongs to nothing until a chat turn or a block names
// its id, and $lib/server/pages/draft.ts refuses an id no stored image has.
//
// the body is `multipart/form-data` with the photo in `file`, resized in the browser first
// ($lib/images/resize.ts) — which is why everything here is a refusal rather than a repair. the
// server checks each bound again, because the action takes a post from anything holding a
// session, not only from the resize:
//
// - size. a declared `content-length` past `UPLOAD_MAX` is refused before a byte is read, and the
//   body is read no further than `UPLOAD_MAX` whether declared or not, so a post that lies or
//   declares nothing costs at most that much. `UPLOAD_MAX` is the photo's own cap plus room for the
//   multipart framing around it; the photo itself is then held to `IMAGE_BYTES_MAX`.
// - type. the bytes' own header decides it ($lib/server/images/sniff.ts), and the label the post
//   gave the file is not read at all: the image route serves a photo under its stored type with
//   `nosniff`, so the stored type must be what the bytes are.
// - pixels. the width and height the same header states are held to `SIDE_MAX`.
//
// the body is read once, here (CLAUDE.md → Bans → Runtime). a refusal is a 400, or a 413 for size,
// whose `error` names the limit; a store that throws is caught into a 500 marked `failed`, because
// a fetcher's thrown error lands on the editor's error boundary and takes the editor with it.

/** room for the boundary lines and part headers around the one file. */
const MULTIPART_FRAMING_MAX = 64 * 1024;
const UPLOAD_MAX = IMAGE_BYTES_MAX + MULTIPART_FRAMING_MAX;

/**
 * the longest side a stored photo may have, in pixels. well over the resize's `LONG_SIDE_MAX`
 * ($lib/images/resize.ts), so only a post that skipped the resize meets it: a small file can claim
 * a huge canvas, and every donor phone that draws it decodes the canvas.
 */
const SIDE_MAX = 4096;

const tooLarge = (what: string) =>
	data(
		{
			error: `${what}; a photo is at most ${IMAGE_BYTES_MAX} bytes (${(IMAGE_BYTES_MAX / 1_000_000).toFixed(1)} MB) once resized`
		},
		413
	);

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

export async function action({ context, request }: Route.ActionArgs) {
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
		return data({ error: 'the body is not multipart/form-data; post the photo as `file`' }, 400);
	}
	if (!(file instanceof Blob)) {
		return data({ error: 'file is required: the photo, as the multipart body’s one file' }, 400);
	}
	if (file.size > IMAGE_BYTES_MAX) return tooLarge(`file is ${file.size} bytes`);

	const bytes = new Uint8Array(await file.arrayBuffer());
	const sniffed = sniffImage(bytes);
	if (sniffed === null) {
		return data(
			{ error: 'file is not a WebP, JPEG or PNG image: its first bytes are none of the three' },
			400
		);
	}
	if (Math.max(sniffed.width, sniffed.height) > SIDE_MAX) {
		return data(
			{
				error: `file is ${sniffed.width} × ${sniffed.height} pixels; a photo is at most ${SIDE_MAX} pixels on its longer side once resized`
			},
			400
		);
	}

	try {
		const id = await createImage(
			context.get(database),
			{ kind: 'photo', ...sniffed, alt: null },
			bytes
		);
		return { id, width: sniffed.width, height: sniffed.height };
	} catch (e) {
		console.error('storing a posted photo failed:', e);
		return data({ error: 'the photo was not stored; post it again', reason: 'failed' }, 500);
	}
}
