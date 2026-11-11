import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT, boxLabelled, button, mountScreen, ORG, one, submit } from './area.testing';
import { EditFundraiser, type EditFundraiserProps, SAVED_FOR_MS } from './edit-form';
import { EDIT_FORM } from './forms';

// /fundraise/pages/:id/edit: seeded from the page, posted as a save, Saved said beside the press.

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

	it('marks Save changes busy while the save is in flight', () => {
		const { root } = edit({ sending: true });
		expect(button(root, 'Save changes').getAttribute('aria-busy')).toBe('true');
	});
});
