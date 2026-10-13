import { describe, expect, it } from 'vitest';
import { jpegHeader, pngHeader, type WebpVariant, webpHeader } from './headers.testing';
import { sniffImage } from './sniff';

// what a posted file's own header says it is. what the upload route does with the answer is
// src/routes/_app.admin.images.workers.spec.ts's.

describe('sniffImage()', () => {
	it('reads a jpeg’s size from its start-of-frame, past the segments before it', () => {
		expect(sniffImage(jpegHeader(1200, 800))).toEqual({
			contentType: 'image/jpeg',
			width: 1200,
			height: 800
		});
	});

	it('reads a progressive jpeg’s size the same way', () => {
		expect(sniffImage(jpegHeader(640, 480, 0xc2))).toMatchObject({ width: 640, height: 480 });
	});

	it.each<WebpVariant>(['VP8 ', 'VP8L', 'VP8X'])('reads a %s webp’s size', (variant) => {
		expect(sniffImage(webpHeader(1600, 900, variant))).toEqual({
			contentType: 'image/webp',
			width: 1600,
			height: 900
		});
	});

	it('reads a png’s size from its IHDR', () => {
		expect(sniffImage(pngHeader(300, 200))).toEqual({
			contentType: 'image/png',
			width: 300,
			height: 200
		});
	});

	it('is null for bytes that are text, whatever they were labelled', () => {
		expect(sniffImage(new TextEncoder().encode('this is not a photo'))).toBeNull();
	});

	it('is null for a header cut off before its size', () => {
		expect(sniffImage(pngHeader(300, 200).subarray(0, 20))).toBeNull();
		expect(sniffImage(webpHeader(300, 200, 'VP8X').subarray(0, 26))).toBeNull();
		expect(sniffImage(jpegHeader(300, 200).subarray(0, 30))).toBeNull();
	});

	it('is null for a header claiming no width or no height', () => {
		expect(sniffImage(pngHeader(0, 200))).toBeNull();
		expect(sniffImage(jpegHeader(300, 0))).toBeNull();
	});
});
