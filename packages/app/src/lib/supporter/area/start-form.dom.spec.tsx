import { parseWithZod } from '@conform-to/zod/v4';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTER_START_INPUT } from '$lib/supporters/input';
import { boxLabelled, button, mountScreen, ORG, one, submit } from './area.testing';
import { START_FORM } from './forms';
import { StartFundraiser, type StartFundraiserProps } from './start-form';

// /fundraise in each state it is drawn in: empty, refused box by box, refused as a whole, sending,
// a photo turned down, and switched off.

const BASE: StartFundraiserProps = {
	org: ORG,
	open: true,
	donateHref: '/donate',
	signInHref: '/fundraise/sign-in',
	uploadUrl: '/fundraise/photos',
	sending: false
};

const start = (props: Partial<StartFundraiserProps> = {}) =>
	mountScreen(() => <StartFundraiser {...BASE} {...props} />);

/** what the server answers a body with, through the statement the action parses with. */
function serverResult(values: Record<string, string>) {
	const body = new FormData();
	for (const [key, value] of Object.entries(values)) body.set(key, value);
	return parseWithZod(body, { schema: SUPPORTER_START_INPUT }).reply();
}

const FILLED = {
	name: 'Maya Reyes',
	email: 'maya@example.org',
	title: 'Keep the pantry trucks running this winter',
	goal: '5,000',
	story: 'I drive the Thursday route.',
	photo_id: ''
};

describe('the start form, empty', () => {
	it('draws the boxes in order, each label above its box', () => {
		const { root } = start();
		const labels = [...root.querySelectorAll('form .ds-label')].map((label) =>
			label.textContent?.trim()
		);
		expect(labels).toEqual([
			'Your name',
			'Email',
			'Page title',
			'Goal',
			'Your story',
			'Photo (optional)'
		]);
		expect(root.querySelectorAll('[data-required]')).toHaveLength(0);
	});

	it('describes each box by its hint and marks none refused', () => {
		const { root } = start();
		const name = boxLabelled(root, 'Your name');
		expect(name.getAttribute('aria-describedby')).toBe(`${name.id}-hint`);
		expect(root.querySelector('[aria-invalid]')).toBeNull();
	});

	it('takes the goal after a $ and as a decimal, and counts the story', () => {
		const { root } = start();
		const goal = boxLabelled(root, 'Goal');
		expect(goal.inputMode).toBe('decimal');
		expect(goal.parentElement?.textContent).toContain('$');
		const story = boxLabelled(root, 'Your story');
		expect(story.getAttribute('aria-describedby')).toContain(`${story.id}-count`);
		expect(one(root, `#${story.id}-count`).textContent).toBe('0 of 1,500');
		act(() => {
			story.value = 'Fuel and repairs';
			story.dispatchEvent(new Event('input', { bubbles: true }));
		});
		expect(one(root, `#${story.id}-count`).textContent).toBe('16 of 1,500');
	});

	it('says how to confirm, and links to sign in', () => {
		const { root } = start();
		expect(root.textContent).toContain(
			'We’ll email you a link to confirm. Nothing is public until you open it.'
		);
		expect(one<HTMLAnchorElement>(root, 'a[href="/fundraise/sign-in"]').textContent).toBe(
			'Get a sign-in link'
		);
		expect(one(root, 'input[name="intent"]').getAttribute('value')).toBe('start');
		expect(one(root, 'input[name="photo_id"]').getAttribute('value')).toBe('');
	});

	it('puts the public and the private in one paragraph', () => {
		const { root } = start();
		const said = [...root.querySelectorAll('p')].filter((p) => p.textContent?.includes('Public:'));
		expect(said).toHaveLength(1);
		expect(said[0]?.textContent).toContain('Private: your email.');
	});
});

describe('a start', () => {
	it('posts every box with the intent', async () => {
		const { root, posted } = start();
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		for (const [name, value] of Object.entries(FILLED)) {
			const box = form.elements.namedItem(name);
			if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) box.value = value;
		}
		await submit(form);
		expect(posted).toHaveLength(1);
		expect(posted[0]?.get('intent')).toBe('start');
		expect(posted[0]?.get('goal')).toBe('5,000');
		expect(posted[0]?.get('email')).toBe('maya@example.org');
	});
});

describe('a refused start', () => {
	it('says why under each wrong box, ties it on, and lands on the first', async () => {
		const { root, posted } = start();
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		await submit(form);
		expect(posted).toHaveLength(0);
		const expected: [string, string][] = [
			['Your name', 'Enter your name.'],
			['Email', 'Enter an email address like maya@example.org.'],
			['Goal', 'Enter a goal of at least $50.'],
			['Your story', 'Tell people why you’re raising money.']
		];
		for (const [label, sentence] of expected) {
			const box = boxLabelled(root, label);
			expect(box.getAttribute('aria-invalid')).toBe('true');
			expect(box.getAttribute('aria-describedby')?.split(' ')).toContain(`${box.id}-err`);
			expect(one(root, `#${box.id}-err`).textContent).toBe(sentence);
			expect(one(root, `#${box.id}-err`).className).toBe('ds-field-err');
		}
		expect(document.activeElement).toBe(boxLabelled(root, 'Your name'));
	});

	it('draws the server’s refusal of one box, keeping what was typed', () => {
		const { root } = start({ lastResult: serverResult({ ...FILLED, goal: '20' }) });
		const goal = boxLabelled(root, 'Goal');
		expect(goal.value).toBe('20');
		expect(goal.getAttribute('aria-invalid')).toBe('true');
		expect(one(root, `#${goal.id}-err`).textContent).toBe('Enter a goal of at least $50.');
		expect(boxLabelled(root, 'Your name').value).toBe('Maya Reyes');
		expect(boxLabelled(root, 'Your name').hasAttribute('aria-invalid')).toBe(false);
	});

	it('says a rate limit once, above the press, with the boxes kept', () => {
		const { root } = start({ lastResult: serverResult(FILLED), refused: 'too_many' });
		const refusal = one(root, '.sa-refused');
		expect(refusal.textContent).toBe('Too many tries. Wait a few minutes, then try again.');
		expect(refusal.getAttribute('role')).toBe('alert');
		const press = button(root, 'Create my page');
		expect(press.getAttribute('aria-describedby')).toBe(refusal.id);
		expect(refusal.nextElementSibling).toBe(press);
		expect(boxLabelled(root, 'Email').value).toBe('maya@example.org');
		expect(root.querySelector('[aria-invalid]')).toBeNull();
	});

	it('says a photo that was not stored under the photo’s press', () => {
		const { root } = start({ refused: 'photo_missing' });
		const press = button(root, 'Add photo');
		expect(one(root, `#${press.id}-err`).textContent).toBe(
			'That photo didn’t upload. Add it again.'
		);
		expect(press.getAttribute('aria-describedby')).toContain(`${press.id}-err`);
		expect(root.querySelector('.sa-refused')).toBeNull();
	});
});

describe('the photo', () => {
	it('turns down an image too narrow before any crop, under its press', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 640, height: 480, close() {} }))
		);
		const { root } = start();
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]');
		expect(chooser.accept).toBe('image/png,image/jpeg,image/webp');
		const file = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		const press = button(root, 'Add photo');
		const refusal = one(root, `#${press.id}-err`);
		expect(refusal.textContent).toBe(
			'That image is only 640 pixels wide. A photo needs at least 1200. Choose a larger one.'
		);
		expect(refusal.getAttribute('role')).toBe('alert');
		expect(root.querySelector('dialog')).toBeNull();
	});

	it('turns down a file that is no PNG, JPEG or WebP', async () => {
		const { root } = start();
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]');
		const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(root.querySelector('.ds-field-err')?.textContent).toContain('isn’t a PNG, JPEG or WebP');
	});

	it('shows a stored photo with Replace photo and Remove, and Remove empties the box', () => {
		const { root } = start({ lastResult: serverResult({ ...FILLED, photo_id: 'img-1' }) });
		expect(one<HTMLImageElement>(root, 'img.sa-photo-frame').getAttribute('src')).toBe(
			'/image/img-1'
		);
		expect(one(root, 'input[name="photo_id"]').getAttribute('value')).toBe('img-1');
		act(() => button(root, 'Remove').click());
		expect(one(root, 'input[name="photo_id"]').getAttribute('value')).toBe('');
		expect(button(root, 'Add photo')).toBeTruthy();
	});
});

describe('sending', () => {
	it('keeps the press in place, busy, and says to wait', () => {
		const { root } = start({ sending: true });
		const press = one<HTMLButtonElement>(root, 'button[type="submit"]');
		expect(press.getAttribute('aria-busy')).toBe('true');
		expect(press.textContent).toBe('Creating your page…');
		expect(one(root, '[role="status"]').textContent).toBe(
			'Keep this tab open. It takes a few seconds.'
		);
	});

	it('posts nothing on a second press', async () => {
		const { root, posted } = start({ sending: true });
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		for (const [name, value] of Object.entries(FILLED)) {
			const box = form.elements.namedItem(name);
			if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) box.value = value;
		}
		await submit(form);
		expect(posted).toHaveLength(0);
	});

	it('stands the spam check just above the press', () => {
		const { root } = start({ challenge: <div data-testid="challenge" /> });
		const challenge = one(root, '[data-testid="challenge"]');
		expect(challenge.nextElementSibling?.querySelector('button[type="submit"]')).not.toBeNull();
	});
});

describe('fundraisers switched off', () => {
	it('draws the state card with the one way to give, and no form', () => {
		const { root } = start({ open: false });
		expect(root.querySelector('form#supporter-start')).toBeNull();
		expect(one(root, '.ds-state-card-title').textContent).toBe('Fundraisers aren’t open right now');
		const give = one<HTMLAnchorElement>(root, '.ds-state-card a');
		expect(give.textContent).toBe('Donate to Harbor Light');
		expect(give.getAttribute('href')).toBe('/donate');
		expect(give.className).toBe('ds-btn ds-btn-primary');
	});
});
