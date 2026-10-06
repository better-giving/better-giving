import { type CropSquare, LOGO_FROM_FILE, type LogoSource } from './org-fields';
import { LOGO_CROP_MIN, type LogoRefusal } from './org-logo';

// the arithmetic between the square an operator drags over a logo on the screen and the square the
// press posts (./logo-crop-dialog.tsx draws the one, ./org-fields.ts's `LOGO_CROP_*` boxes carry
// the other, and ./org-logo.ts's `putLogo` crops by it), and which files a crop takes at all.
//
// **the image is drawn whole, at no zoom, filling the box the square is dragged in.** so a point on
// the screen and a pixel of the image are one scale apart on each axis, and that scale is the whole
// of the conversion: the cropper's own geometry is in the box's pixels, the post is in the image's.
//
// **the square stays square from the keyboard as well as from a pointer.** the cropper holds a drag
// of a grip to one to one, but its own Alt+arrow resize moves one side alone, so the dialog turns
// that press into a change of the whole side (`squareResize` below) before the cropper reads it.

/**
 * the types a logo is taken in, which `LOGO_REFUSED['not-an-image']` (./org-logo.ts) names. an SVG
 * is none of them — a drawing has no pixels of its own to keep a square of — and is refused when
 * the card opens, before any square is chosen.
 */
export const LOGO_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

/** the file chooser's `accept`, which offers only those. */
export const LOGO_ACCEPT = LOGO_TYPES.join(',');

/** whether a file chosen or dropped is one a logo is taken in, by the type the browser gives it. */
export const takesLogo = (file: Blob): boolean => LOGO_TYPES.includes(file.type);

/**
 * how far one arrow press moves or resizes the square, in the box's pixels: alone, with Shift, and
 * with Ctrl or ⌘. the dialog hands the same steps to the cropper, so a move and a resize step alike.
 */
export const NUDGE = { step: 1, shift: 10, ctrl: 50 } as const;

/** the keys and modifiers of one key press, as a keyboard event carries them. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>;

/** which way each arrow takes the square's side under Alt: right and down grow it. */
const GROWS: ReadonlyMap<string, 1 | -1> = new Map([
	['ArrowRight', 1],
	['ArrowDown', 1],
	['ArrowLeft', -1],
	['ArrowUp', -1]
]);

/**
 * the change in the square's side an Alt+arrow press asks for, in the box's pixels, or `null` for
 * any other press — a bare arrow moves the square and is the cropper's own. the cropper would grow
 * the width alone for Alt+→ and the height alone for Alt+↓; this is the one change made to both.
 */
export function squareResize(press: KeyPress): number | null {
	const way = press.altKey ? GROWS.get(press.key) : undefined;
	if (way === undefined) return null;
	if (press.ctrlKey || press.metaKey) return way * NUDGE.ctrl;
	return way * (press.shiftKey ? NUDGE.shift : NUDGE.step);
}

/** a width and a height, in whichever pixels the caller is speaking in. */
export type Size = { readonly width: number; readonly height: number };

/** a rectangle in the box the image is drawn in, as the cropper reports one. */
export type Rect = Size & { readonly x: number; readonly y: number };

/** the largest square that fits a box of `size`, centred in it: the square a crop opens on. */
export function centredSquare(size: Size): Rect {
	const side = Math.min(size.width, size.height);
	return {
		x: (size.width - side) / 2,
		y: (size.height - side) / 2,
		width: side,
		height: side
	};
}

/**
 * the smallest square the cropper may be dragged down to, in the box's pixels: `LOGO_CROP_MIN` of
 * the image's own, drawn at `shown`. never more than the box's short side, so an image too small to
 * keep a logo from still opens on a square that fits it — the press stays closed over it instead
 * ({@link cropRefusal}).
 */
export function shownMinimum(shown: Size, natural: Size): number {
	return Math.min((LOGO_CROP_MIN * shown.width) / natural.width, shown.width, shown.height);
}

/**
 * the square `crop` keeps, in the image's own pixels, written as the whole numbers the press posts.
 * the corner is held inside the image, so a square dragged to the edge never rounds to one a pixel
 * past it — which the crop would refuse (`crop-outside` in ./org-logo.ts).
 */
export function naturalSquare(crop: Rect, shown: Size, natural: Size): CropSquare {
	const across = natural.width / shown.width;
	const down = natural.height / shown.height;
	const size = Math.min(Math.round(crop.width * across), natural.width, natural.height);
	const within = (at: number, room: number) => Math.min(Math.max(Math.round(at), 0), room - size);
	return {
		x: within(crop.x * across, natural.width),
		y: within(crop.y * down, natural.height),
		size
	};
}

/** why an image that opened, or failed to, cannot be saved as the logo, or `null` where it can. */
export function cropRefusal(natural: Size | null, failed: LogoRefusal | null): LogoRefusal | null {
	if (failed !== null) return failed;
	if (natural !== null && Math.min(natural.width, natural.height) < LOGO_CROP_MIN) {
		return 'crop-too-small';
	}
	return null;
}

/**
 * what an image that would not draw in the crop is refused as: a file the operator chose, of a type
 * a logo is taken in, could not be read; the stored logo could not be fetched, and nothing was
 * chosen to choose again.
 */
export const unloaded = (from: LogoSource['from']): LogoRefusal =>
	from === LOGO_FROM_FILE ? 'unreadable' : 'stored-unloaded';

/**
 * the one file a drop carries: the first one dropped, whatever its type. dropped on the logo, a
 * file of a type the logo is not taken in opens the crop refused, in the words the press would
 * refuse it in, rather than being dropped on the floor; dropped on the open crop, only one it takes
 * ({@link takesLogo}) replaces the image there.
 */
export function droppedFile(files: ArrayLike<File> | null | undefined): File | null {
	return files?.[0] ?? null;
}
