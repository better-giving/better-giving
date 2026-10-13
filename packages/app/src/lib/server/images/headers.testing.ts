// the first bytes of each format the image table stores, as ./sniff.ts reads them, and nothing an
// image decoder would draw: a stored fixture claims a size, not a picture.

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const zeros = (n: number) => new Array<number>(n).fill(0);

/** a png's signature and IHDR chunk. */
export function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
	return new Uint8Array([
		...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		...be32(13),
		...ascii('IHDR'),
		...be32(width),
		...be32(height),
		...[8, 6, 0, 0, 0],
		...zeros(4)
	]);
}

/**
 * a jpeg's start, a JFIF APP0 and a quantisation table, then a start-of-frame of the given marker
 * (0xc0 baseline, 0xc2 progressive), and a start of scan.
 */
export function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array<ArrayBuffer> {
	return new Uint8Array([
		...[0xff, 0xd8],
		...[0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
		...[0xff, 0xdb, ...be16(67), 0, ...zeros(64)],
		...[0xff, sof, ...be16(17), 8, ...be16(height), ...be16(width), 3, ...zeros(9)],
		...[0xff, 0xda, ...be16(12), 3, ...zeros(9)]
	]);
}

export type WebpVariant = 'VP8 ' | 'VP8L' | 'VP8X';

/** a webp's RIFF header and its first chunk, in the variant's own encoding of the size. */
export function webpHeader(
	width: number,
	height: number,
	variant: WebpVariant
): Uint8Array<ArrayBuffer> {
	const chunk = (() => {
		switch (variant) {
			case 'VP8 ':
				return [
					...zeros(3),
					0x9d,
					0x01,
					0x2a,
					width & 255,
					width >>> 8,
					height & 255,
					height >>> 8
				];
			case 'VP8L': {
				const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
				return [0x2f, ...le32(bits), ...zeros(5)];
			}
			case 'VP8X':
				return [...zeros(4), ...le24(width - 1), ...le24(height - 1)];
		}
	})();
	const body = [...ascii('WEBP'), ...ascii(variant), ...le32(chunk.length), ...chunk];
	return new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
}
