import { describe, expect, it } from 'vitest';
import { centredSquare, cropRefusal, droppedFile, naturalSquare, shownMinimum } from './logo-crop';
import { LOGO_CROP_MIN } from './org-logo';

// the arithmetic between the square dragged on the screen and the square a logo press posts. the
// dialog that draws it is ./logo-crop-dialog.spec.ts's, and what the crop does with the square is
// ./org-logo.spec.ts's.

describe('the square a crop opens on', () => {
	it('is the largest square that fits, centred across a wide image', () => {
		expect(centredSquare({ width: 400, height: 250 })).toEqual({
			x: 75,
			y: 0,
			width: 250,
			height: 250
		});
	});

	it('is the largest square that fits, centred down a tall image', () => {
		expect(centredSquare({ width: 300, height: 420 })).toEqual({
			x: 0,
			y: 60,
			width: 300,
			height: 300
		});
	});
});

describe('the smallest square the cropper may be dragged to', () => {
	it(`is ${LOGO_CROP_MIN} of the image's own pixels, at the scale the image is drawn at`, () => {
		// a 2000 × 1000 photo drawn 500 wide is a quarter of its size on the screen.
		expect(shownMinimum({ width: 500, height: 250 }, { width: 2000, height: 1000 })).toBe(
			LOGO_CROP_MIN / 4
		);
	});

	it('is never more than the short side the image is drawn at', () => {
		// an image under the floor is drawn larger than itself, and the square still fits in it.
		expect(shownMinimum({ width: 480, height: 320 }, { width: 60, height: 40 })).toBe(320);
	});
});

describe('the square a press posts', () => {
	const shown = { width: 500, height: 250 };
	const natural = { width: 2000, height: 1000 };

	it('is the dragged square in the image’s own pixels, in whole numbers', () => {
		expect(
			naturalSquare({ x: 10.2, y: 20.4, width: 100.3, height: 100.3 }, shown, natural)
		).toEqual({
			x: 41,
			y: 82,
			size: 401
		});
	});

	it('keeps a square dragged to the edge inside the image when it rounds', () => {
		// a square image drawn at a quarter: the corner and the side are 999.5 and 1000.5 of its own
		// pixels and reach its edge, and each rounded on its own would put the square a pixel past it.
		const whole = { width: 2000, height: 2000 };
		expect(
			naturalSquare(
				{ x: 249.875, y: 0, width: 250.125, height: 250.125 },
				{ width: 500, height: 500 },
				whole
			)
		).toEqual({ x: 999, y: 0, size: 1001 });
	});

	it(`keeps a square dragged down to the floor at ${LOGO_CROP_MIN}`, () => {
		const least = shownMinimum(shown, natural);
		expect(naturalSquare({ x: 0, y: 0, width: least, height: least }, shown, natural).size).toBe(
			LOGO_CROP_MIN
		);
	});
});

describe('why a crop cannot be saved', () => {
	it(`refuses an image whose short side is under ${LOGO_CROP_MIN}`, () => {
		expect(cropRefusal({ width: 400, height: LOGO_CROP_MIN - 1 }, null)).toBe('crop-too-small');
	});

	it(`takes one whose short side is ${LOGO_CROP_MIN}`, () => {
		expect(cropRefusal({ width: LOGO_CROP_MIN, height: 400 }, null)).toBe(null);
	});

	it('refuses nothing before the image is measured', () => {
		expect(cropRefusal(null, null)).toBe(null);
	});

	it('refuses an image that would not open by why it would not', () => {
		expect(cropRefusal(null, 'not-an-image')).toBe('not-an-image');
	});
});

describe('the file a drop puts on the logo', () => {
	const file = (name: string, type: string) => new File(['x'], name, { type });

	it('is the first file dropped', () => {
		const first = file('logo.png', 'image/png');
		expect(droppedFile([first, file('other.png', 'image/png')])).toBe(first);
	});

	// a file that is no image is refused in the crop, in the press's own words, rather than lost.
	it('is a file that is no image as well', () => {
		const brief = file('brief.pdf', 'application/pdf');
		expect(droppedFile([brief])).toBe(brief);
	});

	it('is nothing where nothing was dropped', () => {
		expect(droppedFile([])).toBe(null);
		expect(droppedFile(null)).toBe(null);
	});
});
