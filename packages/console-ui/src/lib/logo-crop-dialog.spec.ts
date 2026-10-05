import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	CANCEL_CROP,
	CROP_TITLE,
	LogoCropCard,
	type LogoCropCardProps,
	SAVE_LOGO
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

// the logo's crop card as drawn in each state. ../../vite.config.ts pins `node` and there is no
// dom, so what a save posts is read off the boxes the card draws into the logo form; the
// arithmetic of the square is ./logo-crop.spec.ts's, and the cropper's drag is ark's.

const FORM = 'org-logo-upload';

function drawn(over: Partial<LogoCropCardProps>): string {
	return renderToStaticMarkup(
		createElement(LogoCropCard, {
			source: LOGO_FROM_FILE,
			form: FORM,
			square: { x: 120, y: 0, size: 640 },
			refusal: null,
			onCancel: () => {},
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

	it('says why, and keeps Save closed, over a file that is no image', () => {
		const markup = drawn({ refusal: 'not-an-image', square: null });

		expect(markup).toContain(LOGO_REFUSED['not-an-image']);
		expect(press(markup, SAVE_LOGO)).toContain('aria-disabled="true"');
	});

	it('keeps Save closed and posts no square before the image is measured', () => {
		const markup = drawn({ square: null });

		expect(posted(markup)).toEqual([`${LOGO_SOURCE}=${LOGO_FROM_FILE}`]);
		expect(press(markup, SAVE_LOGO)).toContain('aria-disabled="true"');
		expect(markup).not.toContain('-crop-err');
	});
});
