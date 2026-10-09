import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	CANCEL_CROP,
	CROP_TITLE,
	CROP_WORDS,
	type CropImage,
	LogoCropCard,
	type LogoCropCardProps,
	LogoCropDialog,
	SAVE_LOGO,
	squareWords
} from './logo-crop-dialog';
import {
	LOGO_CROP_SIZE,
	LOGO_CROP_X,
	LOGO_CROP_Y,
	LOGO_FILE,
	LOGO_FROM_FILE,
	LOGO_FROM_STORED,
	LOGO_SOURCE
} from './org-fields';
import { LOGO_REFUSED } from './org-logo';

// the logo's crop card as drawn in each state, the dialog's first draw around it, and the words the
// cropper says. ../../vite.config.ts pins `node` and there is no dom, so what a save posts is read
// off the boxes the card draws into the logo form, what the cropper says off the markup the server
// draws and off the words themselves; the arithmetic of the square is ./logo-crop.spec.ts's, and
// the cropper's drag is ark's.

const FORM = 'org-logo-upload';

function drawn(over: Partial<LogoCropCardProps>): string {
	return renderToStaticMarkup(
		createElement(LogoCropCard, {
			source: LOGO_FROM_FILE,
			form: FORM,
			square: { x: 120, y: 0, size: 640 },
			refusal: null,
			onCancel: () => {},
			onSwap: () => {},
			...over
		})
	);
}

/** every box the card hands the logo form, as `name=value`, in document order. */
const posted = (markup: string): string[] =>
	[...markup.matchAll(/<input\b([^>]*)>/g)].flatMap(([, attributes = '']) => {
		if (!attributes.includes(`form="${FORM}"`)) return [];
		const name = attributes.match(/\bname="([^"]*)"/)?.[1];
		const value = attributes.match(/\bvalue="([^"]*)"/)?.[1] ?? '';
		return name === undefined ? [] : [`${name}=${value}`];
	});

/** a button's own tag, found by the words on it. */
const press = (markup: string, words: string): string => {
	const found = markup.match(new RegExp(`<button([^>]*)><span[^>]*>${words}</span></button>`));
	expect(found).not.toBeNull();
	return found?.[1] ?? '';
};

describe('the logo’s crop card', () => {
	it('is the dialog the operator crops the logo in', () => {
		expect(drawn({})).toMatch(new RegExp(`<dialog[^>]*>.*<h2[^>]*>${CROP_TITLE}</h2>`, 's'));
	});

	it('saves a chosen file’s square, in whole pixels of the image, under the file source', () => {
		const markup = drawn({ source: LOGO_FROM_FILE });

		expect(posted(markup)).toEqual([
			`${LOGO_SOURCE}=${LOGO_FROM_FILE}`,
			`${LOGO_CROP_X}=120`,
			`${LOGO_CROP_Y}=0`,
			`${LOGO_CROP_SIZE}=640`
		]);
		// the file is the logo form's own box; the card draws none.
		expect(markup).not.toContain(`name="${LOGO_FILE}"`);
	});

	it('saves the stored logo’s square under the stored source, with no file', () => {
		const markup = drawn({ source: LOGO_FROM_STORED, square: { x: 0, y: 40, size: 300 } });

		expect(posted(markup)).toEqual([
			`${LOGO_SOURCE}=${LOGO_FROM_STORED}`,
			`${LOGO_CROP_X}=0`,
			`${LOGO_CROP_Y}=40`,
			`${LOGO_CROP_SIZE}=300`
		]);
		expect(markup).not.toContain('type="file"');
	});

	it('submits the logo form from Save, in the primary rank', () => {
		const save = press(drawn({}), SAVE_LOGO);

		expect(save).toContain('type="submit"');
		expect(save).toContain(`form="${FORM}"`);
		expect(save).toContain('adm-btn--primary');
		expect(save).not.toContain('aria-disabled');
	});

	// Cancel is a plain button in no form, so pressing it sends nothing.
	it('posts nothing from Cancel', () => {
		const cancel = press(drawn({}), CANCEL_CROP);

		expect(cancel).toContain('type="button"');
		expect(cancel).not.toContain('form=');
		expect(cancel).not.toContain('name=');
	});

	it('keeps Save closed, and says why, over an image too small to keep a logo from', () => {
		const markup = drawn({ refusal: 'crop-too-small' });
		const save = press(markup, SAVE_LOGO);

		expect(markup).toContain(`id="${FORM}-crop-err"`);
		expect(markup).toContain(LOGO_REFUSED['crop-too-small']);
		// closed by `aria-disabled`, so a reader standing on it keeps the focus.
		expect(save).toContain('aria-disabled="true"');
		expect(save).not.toMatch(/\bdisabled=""/);
		expect(save).toContain(`aria-describedby="${FORM}-crop-err"`);
	});

	it('says why, and keeps Save closed, over a file of a type a logo is not taken in', () => {
		const markup = drawn({ refusal: 'not-a-logo-type', square: null });

		expect(markup).toContain(LOGO_REFUSED['not-a-logo-type']);
		expect(press(markup, SAVE_LOGO)).toContain('aria-disabled="true"');
	});

	it('keeps Save closed and posts no square before the image is measured', () => {
		const markup = drawn({ square: null });

		expect(posted(markup)).toEqual([`${LOGO_SOURCE}=${LOGO_FROM_FILE}`]);
		expect(press(markup, SAVE_LOGO)).toContain('aria-disabled="true"');
		expect(markup).not.toContain('-crop-err');
	});
});

describe('the logo’s crop, as it opens', () => {
	function opened(image: CropImage): string {
		return renderToStaticMarkup(
			createElement(LogoCropDialog, {
				image,
				form: FORM,
				onCancel: () => {},
				onSwap: () => {}
			})
		);
	}
	const file = (name: string, type: string): CropImage => ({
		from: LOGO_FROM_FILE,
		file: new File(['x'], name, { type })
	});

	// each is an image, or may be one, so the sentence is about the type and never that it is none.
	it.each([
		['an SVG', 'logo.svg', 'image/svg+xml'],
		['a HEIC photo', 'IMG_0412.HEIC', 'image/heic'],
		['a GIF', 'logo.gif', 'image/gif'],
		['a file with no type', 'logo', '']
	])('refuses %s by its type before any cropping, with Save closed on it', (_, name, type) => {
		const markup = opened(file(name, type));
		const save = press(markup, SAVE_LOGO);

		expect(markup).toContain(LOGO_REFUSED['not-a-logo-type']);
		expect(markup).not.toContain(LOGO_REFUSED['not-an-image']);
		expect(save).toContain('aria-disabled="true"');
		expect(save).toContain(`aria-describedby="${FORM}-crop-err"`);
	});

	it('refuses nothing as a PNG opens', () => {
		expect(opened(file('logo.png', 'image/png'))).not.toContain('-crop-err');
	});

	/** the cropper's square, as the machine draws it for a reader. */
	const selection = (markup: string): string => {
		const found = markup.match(/<div[^>]*class="adm-cropper__selection"[^>]*>/);
		expect(found).not.toBeNull();
		return found?.[0] ?? '';
	};

	// the machine's own value text is handed the box's pixels already rounded; the square says the
	// one a save posts, which is nothing until the image is measured.
	it('says where the square stands in its own words, not the machine’s', () => {
		const square = selection(
			opened({ from: LOGO_FROM_STORED, url: 'https://give.riverside.org/images/img_1' })
		);

		expect(square).toContain(`aria-valuetext="${squareWords(null)}"`);
	});

	it('names a square and says nothing of zoom to a reader', () => {
		const markup = opened({
			from: LOGO_FROM_STORED,
			url: 'https://give.riverside.org/images/img_1'
		});
		const square = selection(markup);

		expect(square).toMatch(/aria-label="[^"]*[Ss]quare[^"]*"/);
		expect(square).toMatch(/aria-description="[^"]*arrow keys[^"]*Alt[^"]*"/);
		// the machine's own words are for a rectangle that zooms.
		const said = [...markup.matchAll(/\baria-[a-z]+="([^"]*)"/g)].map(([, words = '']) => words);
		expect(said.filter((words) => /rectangle|zoom/i.test(words))).toEqual([]);
	});
});

describe('what the cropper says to a reader', () => {
	const crop = { x: 0, y: 0, width: 100, height: 100 };

	it('describes the image as the square kept from it, with no zoom or turn', () => {
		const said = CROP_WORDS.previewDescription?.({ crop, zoom: 2, rotation: 90 }) ?? '';

		expect(said).toMatch(/square/i);
		expect(said).not.toMatch(/zoom|rotation|degrees|rectangle/i);
	});

	it('names the selection a square, whatever shape the machine passes', () => {
		const named = CROP_WORDS.selectionLabel?.({ shape: 'rectangle' }) ?? '';

		expect(named).toMatch(/square/i);
		expect(named).not.toMatch(/rectangle|crop selection/i);
	});

	it('says which arrows grow the square and which shrink it, and names the key on a Mac', () => {
		const told = CROP_WORDS.selectionInstructions ?? '';

		expect(told).toMatch(/Alt \(Option on a Mac\)/);
		expect(told).toMatch(/right or down arrow to make it larger/);
		expect(told).toMatch(/left or up to make it smaller/);
		expect(told).not.toMatch(/zoom|plus|minus/i);
	});

	it('says the size and place of the square a save posts, in the image’s own pixels', () => {
		expect(squareWords({ x: 120, y: 0, size: 640 })).toBe(
			'640 pixels across, 120 from the left and 0 from the top'
		);
	});
});
