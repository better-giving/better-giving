import type { ImageContentType } from '../db/schema';

/** what an image's own first bytes say it is. */
export interface Sniffed {
	readonly contentType: ImageContentType;
	readonly width: number;
	readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
	return prefix.every((byte, i) => bytes[at + i] === byte);
}

function png(bytes: Uint8Array, view: DataView): Sniffed | null {
	if (!startsWith(bytes, PNG_SIGNATURE) || !startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) {
		return null;
	}
	if (bytes.byteLength < 24) return null;
	return { contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
}

/** the start-of-frame markers, each carrying the frame's size; 0xc4, 0xc8 and 0xcc share the range. */
const isStartOfFrame = (marker: number) =>
	marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** walks the segments to the first start of frame. a start of scan before one is no size to read. */
function jpeg(bytes: Uint8Array, view: DataView): Sniffed | null {
	if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null;
	let at = 2;
	while (at + 4 <= bytes.byteLength) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1] ?? 0;
		// fill bytes: a run of 0xff before the marker.
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		if (marker === 0xda || marker === 0xd9) return null;
		if (isStartOfFrame(marker)) {
			if (at + 9 > bytes.byteLength) return null;
			return {
				contentType: 'image/jpeg',
				height: view.getUint16(at + 5),
				width: view.getUint16(at + 7)
			};
		}
		at += 2 + view.getUint16(at + 2);
	}
	return null;
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * the size from the first chunk after the RIFF header, in whichever of its three encodings
 * (https://developers.google.com/speed/webp/docs/riff_container): lossy `VP8 ` after its frame
 * tag, lossless `VP8L` as two 14-bit fields, extended `VP8X` as the canvas in two 24-bit fields.
 */
function webp(bytes: Uint8Array, view: DataView): Sniffed | null {
	if (!startsWith(bytes, ascii('RIFF')) || !startsWith(bytes, ascii('WEBP'), 8)) return null;
	const size = (width: number, height: number): Sniffed => ({
		contentType: 'image/webp',
		width,
		height
	});
	if (startsWith(bytes, ascii('VP8 '), 12)) {
		if (bytes.byteLength < 30 || !startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
		return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
	}
	if (startsWith(bytes, ascii('VP8L'), 12)) {
		if (bytes.byteLength < 25 || bytes[20] !== 0x2f) return null;
		const bits = view.getUint32(21, true);
		return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (startsWith(bytes, ascii('VP8X'), 12)) {
		if (bytes.byteLength < 30) return null;
		const u24 = (at: number) => view.getUint16(at, true) | ((bytes[at + 2] ?? 0) << 16);
		return size(u24(24) + 1, u24(27) + 1);
	}
	return null;
}

/**
 * the type and size `bytes` declare in their own header, or null where they are none of the three
 * or claim no area — which `image`'s size check would refuse, and nothing can draw.
 */
export function sniffImage(bytes: Uint8Array): Sniffed | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const sniffed = webp(bytes, view) ?? jpeg(bytes, view) ?? png(bytes, view);
	return sniffed !== null && sniffed.width > 0 && sniffed.height > 0 ? sniffed : null;
}
