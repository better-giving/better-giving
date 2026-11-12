import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
	ACCOUNT,
	boxLabelled,
	button,
	mountScreen,
	ORG,
	one,
	submit,
	submitTwice
} from './area.testing';
import { EditFundraiser, type EditFundraiserProps, SAVED_FOR_MS } from './edit-form';
import { EDIT_FORM, PHOTO_FILE_FIELD } from './forms';

// /fundraise/pages/:id/edit: seeded from the page, posted as a save, Saved said beside the press.

// happy-dom lays nothing out, so the crop card's frame is never measured: Use this photo here hands
// back a frame as the card would, and the crop is a few bytes.
vi.mock(import('./photo-crop-dialog'), () => ({
	PhotoCropDialog: ({ onSave }) => (
		<button type="button" onClick={() => onSave({ x: 0, y: 0, width: 1600, height: 900 })}>
			Use this photo
		</button>
	)
}));
vi.mock(import('$lib/admin/settings/crop-image'), async (original) => ({
	...(await original()),
	cropImage: async () => ({
		ok: true,
		blob: new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })
	})
}));

const STORY =
	'I drive the Thursday route for Harbor Light’s pantry, and I’ve seen what a full truck does for a street.';

const BASE: EditFundraiserProps = {
	org: ORG,
	account: ACCOUNT,
	page: {
		name: 'Maya Reyes',
		title: 'Keep the pantry trucks running this winter',
		goalMinor: 500_000,
		story: STORY,
		photoId: 'img-1'
	},
	backTitle: 'Keep the pantry trucks running this winter',
	backHref: '/fundraise/pages/p1',
	uploadUrl: '/fundraise/photos',
	photoMissing: false,
	savedAt: null,
	sending: false
};

const edit = (props: Partial<EditFundraiserProps> = {}) =>
	mountScreen(() => <EditFundraiser {...BASE} {...props} />);

describe('editing a page', () => {
	it('seeds every box from the page, the goal grouped as a box draws it', () => {
		const { root } = edit();
		expect(boxLabelled(root, 'Your name').value).toBe('Maya Reyes');
		expect(boxLabelled(root, 'Page title').value).toBe(BASE.page.title);
		expect(boxLabelled(root, 'Goal').value).toBe('5,000');
		expect(boxLabelled(root, 'Your story').value).toBe(STORY);
		expect(one(root, `#${boxLabelled(root, 'Your story').id}-count`).textContent).toBe(
			`${STORY.length} of 1,500`
		);
		expect(one(root, 'input[name="photo_id"]').getAttribute('value')).toBe('img-1');
		expect(button(root, 'Replace photo')).toBeTruthy();
		expect(button(root, 'Remove')).toBeTruthy();
	});

	it('has no box for the address or the email, and no gift-mail switch', () => {
		const { root } = edit();
		const names = [...one<HTMLFormElement>(root, `form#${EDIT_FORM.id}`).elements]
			.map((element) => (element as HTMLInputElement).name)
			.filter(Boolean);
		expect(names.sort()).toEqual(['goal', 'intent', 'name', 'photo_id', 'story', 'title']);
		expect(root.querySelector('[role="switch"], .ds-switch')).toBeNull();
		expect(root.textContent).not.toContain('Email me when a gift arrives');
	});

	it('posts a save, and Cancel goes back to the page without one', async () => {
		const { root, posted } = edit();
		const cancel = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Cancel');
		expect(cancel?.getAttribute('href')).toBe('/fundraise/pages/p1');
		await submit(one<HTMLFormElement>(root, `form#${EDIT_FORM.id}`));
		expect(posted).toHaveLength(1);
		expect(posted[0]?.get('intent')).toBe('save');
		expect(posted[0]?.get('goal')).toBe('5,000');
		expect(posted[0]?.get('photo_id')).toBe('img-1');
		expect(posted[0]?.has(PHOTO_FILE_FIELD)).toBe(false);
	});

	it('uploads a new crop to the upload address and posts the id it answers', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 1600, height: 900, close() {} }))
		);
		const uploaded: FormData[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				expect(url).toBe('/fundraise/photos');
				uploaded.push(init.body as FormData);
				return Response.json({ id: 'img-2' });
			})
		);
		const { root, posted } = edit();
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]');
		const file = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await act(async () => button(root, 'Use this photo').click());
		expect(uploaded).toHaveLength(1);
		expect(uploaded[0]?.get('file')).toBeInstanceOf(File);
		expect(one<HTMLImageElement>(root, 'img.sa-photo-frame').getAttribute('src')).toBe(
			'/image/img-2'
		);
		await submit(one<HTMLFormElement>(root, `form#${EDIT_FORM.id}`));
		expect(posted[0]?.get('photo_id')).toBe('img-2');
		expect(posted[0]?.has(PHOTO_FILE_FIELD)).toBe(false);
	});

	it('says Saved beside the press for a few seconds, focus staying on the press', () => {
		vi.useFakeTimers();
		try {
			const { root } = edit({ savedAt: 1 });
			const save = button(root, 'Save changes');
			save.focus();
			const status = one(root, '.sa-saved');
			expect(status.getAttribute('role')).toBe('status');
			expect(status.textContent).toBe('Saved');
			expect(document.activeElement).toBe(save);
			act(() => vi.advanceTimersByTime(SAVED_FOR_MS));
			expect(status.textContent).toBe('');
			expect(document.activeElement).toBe(save);
		} finally {
			vi.useRealTimers();
		}
	});

	it('says a photo that was not stored under the photo’s press', () => {
		const { root } = edit({ photoMissing: true });
		const press = button(root, 'Replace photo');
		expect(one(root, `#${press.id}-err`).textContent).toBe(
			'That photo didn’t upload. Add it again.'
		);
	});

	it('posts once on a double press of Save changes', async () => {
		const { root, posted } = edit();
		await submitTwice(one<HTMLFormElement>(root, `form#${EDIT_FORM.id}`));
		expect(posted).toHaveLength(1);
	});

	it.each([
		[401, 'Sign in to add a photo.', 'Sign in to add a photo.'],
		[
			429,
			'You’ve added as many photos as we can take today.',
			'You’ve added as many photos as we can take today.'
		],
		[500, 'the photo was not stored; post it again', 'That photo didn’t upload. Add it again.']
	])('says a %i upload answer under the photo’s press', async (status, error, said) => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 1600, height: 900, close() {} }))
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error }, { status }))
		);
		const { root } = edit();
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]');
		const file = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await act(async () => button(root, 'Use this photo').click());
		const press = button(root, 'Replace photo');
		expect(one(root, `#${press.id}-err`).textContent).toBe(said);
		expect(one<HTMLInputElement>(root, 'input[name="photo_id"]').value).toBe('img-1');
	});

	it('marks Save changes busy while the save is in flight', () => {
		const { root } = edit({ sending: true });
		expect(button(root, 'Save changes').getAttribute('aria-busy')).toBe('true');
	});
});
