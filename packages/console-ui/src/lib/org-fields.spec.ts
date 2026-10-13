import { describe, expect, it } from 'vitest';
import {
	LOGO_CROP_SIZE,
	LOGO_CROP_X,
	LOGO_CROP_Y,
	LOGO_FILE,
	LOGO_FROM_FILE,
	LOGO_FROM_STORED,
	LOGO_SOURCE,
	logoPress,
	orgEdits
} from './org-fields';

// what a press of the Organisation fold asks the binary to store, read off the form it submitted.

describe('what a press posts', () => {
	it('carries the statements and the brand colour as typed', () => {
		const posted = new FormData();
		posted.set('legal_name', 'Hope Foundation');
		posted.set('mission', 'Clean water for every school.\n\nAnd every clinic.');
		posted.set('vision', '');
		posted.set('brand_colour', '#1F6FEB');

		const { values } = orgEdits(posted);

		expect(values.mission).toBe('Clean water for every school.\n\nAnd every clinic.');
		expect(values.vision).toBe('');
		expect(values.brand_colour).toBe('#1F6FEB');
	});

	it('carries the link boxes in the order they stand, blanks included', () => {
		// blanks are the deployment's to skip (`readSocialLinks`), so a row left empty is sent as it is.
		const posted = new FormData();
		posted.set('legal_name', 'Hope Foundation');
		posted.set('social_links[0]', 'instagram.com/hope');
		posted.set('social_links[1]', '');
		posted.set('social_links[2]', 'https://x.com/hope');

		expect(orgEdits(posted).socialLinks).toEqual(['instagram.com/hope', '', 'https://x.com/hope']);
	});

	it('carries no links where the form holds no link box', () => {
		const posted = new FormData();
		posted.set('legal_name', 'Hope Foundation');

		expect(orgEdits(posted).socialLinks).toEqual([]);
	});
});

describe('what a logo press posts', () => {
	/** a press carrying a source and a square, as the crop dialog posts one. */
	const posting = (source: string, square: Record<string, string>) => {
		const posted = new FormData();
		posted.set(LOGO_SOURCE, source);
		for (const [name, value] of Object.entries(square)) posted.set(name, value);
		return posted;
	};
	const SQUARE = { [LOGO_CROP_X]: '40', [LOGO_CROP_Y]: '0', [LOGO_CROP_SIZE]: '320' };

	it('reads a chosen file and the square to crop it to', () => {
		const photo = new File(['raw'], 'logo.png', { type: 'image/png' });
		const posted = posting(LOGO_FROM_FILE, SQUARE);
		posted.set(LOGO_FILE, photo);

		expect(logoPress(posted)).toEqual({
			source: { from: 'file', file: photo },
			crop: { x: 40, y: 0, size: 320 }
		});
	});

	it('reads a re-crop of the stored logo, which carries no file', () => {
		expect(logoPress(posting(LOGO_FROM_STORED, SQUARE))).toEqual({
			source: { from: 'stored' },
			crop: { x: 40, y: 0, size: 320 }
		});
	});

	it('reads no source where the press named neither', () => {
		expect(logoPress(posting('', SQUARE)).source).toBeNull();
		const unnamed = posting(LOGO_FROM_STORED, SQUARE);
		unnamed.delete(LOGO_SOURCE);
		expect(logoPress(unnamed).source).toBeNull();
	});

	it('reads no square where any of its three boxes did not arrive', () => {
		for (const missing of [LOGO_CROP_X, LOGO_CROP_Y, LOGO_CROP_SIZE]) {
			const posted = posting(LOGO_FROM_STORED, SQUARE);
			posted.delete(missing);

			expect(logoPress(posted).crop).toBeNull();
		}
	});

	it.each([
		['blank', ''],
		['a fraction', '320.5'],
		['not a number', 'wide'],
		['padded', ' 320']
	])('reads no square where a box holds %s', (_, held) => {
		expect(
			logoPress(posting(LOGO_FROM_STORED, { ...SQUARE, [LOGO_CROP_SIZE]: held })).crop
		).toBeNull();
	});

	it('reads a negative corner as it was posted, for the crop to refuse', () => {
		expect(logoPress(posting(LOGO_FROM_STORED, { ...SQUARE, [LOGO_CROP_X]: '-4' })).crop).toEqual({
			x: -4,
			y: 0,
			size: 320
		});
	});
});
