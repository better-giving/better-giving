import { describe, expect, it } from 'vitest';
import {
	centredSquare,
	cropRefusal,
	droppedFile,
	type KeyPress,
	NUDGE,
	naturalSquare,
	shownMinimum,
	squareResize,
	takesLogo,
	unloaded
} from './logo-crop';
import { LOGO_FROM_FILE, LOGO_FROM_STORED } from './org-fields';
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

describe('a resize from the keyboard', () => {
	const press = (key: string, held: Partial<KeyPress> = {}): KeyPress => ({
		key,
		altKey: true,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		...held
	});

	// the cropper's own Alt+arrow moves one side: Alt+↓ would draw 250 × 251 out of a 250 square.
	it('grows the whole side for Alt with the arrow the cropper would grow one side by', () => {
		expect(squareResize(press('ArrowDown'))).toBe(NUDGE.step);
		expect(squareResize(press('ArrowRight'))).toBe(NUDGE.step);
	});

	it('shrinks the whole side for Alt with the arrow the cropper would shrink one side by', () => {
		expect(squareResize(press('ArrowUp'))).toBe(-NUDGE.step);
		expect(squareResize(press('ArrowLeft'))).toBe(-NUDGE.step);
	});

	it('takes the cropper’s longer steps under Shift and under Ctrl or ⌘', () => {
		expect(squareResize(press('ArrowDown', { shiftKey: true }))).toBe(NUDGE.shift);
		expect(squareResize(press('ArrowUp', { ctrlKey: true }))).toBe(-NUDGE.ctrl);
		expect(squareResize(press('ArrowRight', { metaKey: true, shiftKey: true }))).toBe(NUDGE.ctrl);
	});

	it('leaves a bare arrow, which moves the square, and any other key to the cropper', () => {
		expect(squareResize(press('ArrowDown', { altKey: false }))).toBe(null);
		expect(squareResize(press('+'))).toBe(null);
	});
});

describe('the files a logo is taken in', () => {
	const typed = (type: string) => new File(['x'], 'logo', { type });

	it.each(['image/png', 'image/jpeg', 'image/webp'])('takes %s', (type) => {
		expect(takesLogo(typed(type))).toBe(true);
	});

	it.each(['image/svg+xml', 'image/gif', 'application/pdf', ''])('refuses %s', (type) => {
		expect(takesLogo(typed(type))).toBe(false);
	});
});

describe('an image that would not draw in the crop', () => {
	it('is a chosen file that could not be read', () => {
		expect(unloaded(LOGO_FROM_FILE)).toBe('unreadable');
	});

	// the operator chose nothing, so the chosen file's sentence would send them to choose it again.
	it('is the stored logo, which could not be loaded, for the stored source', () => {
		expect(unloaded(LOGO_FROM_STORED)).toBe('stored-unloaded');
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
