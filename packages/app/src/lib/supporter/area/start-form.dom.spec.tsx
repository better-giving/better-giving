import { parseWithZod } from '@conform-to/zod/v4';
import { act } from 'react';
import { useActionData } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTER_START_INPUT } from '$lib/supporters/input';
import { boxLabelled, button, mountScreen, ORG, one, submit, submitTwice } from './area.testing';
import type { StartRefusal } from './copy';
import { PHOTO_FILE_FIELD, START_FORM } from './forms';
import { StartFundraiser, type StartFundraiserProps } from './start-form';
import type { FormResult } from './supporter-form';

// /fundraise in each state it is drawn in: empty, refused box by box, refused as a whole, sending,
// a photo turned down, a photo carried with the start, and switched off.

/** the crop's bytes, as `cropImage` hands them back. */
const CROPPED = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' });

// happy-dom lays nothing out, so the crop card's frame is never measured: Use this photo here hands
// back a frame as the card would, and the crop is the bytes above.
vi.mock(import('./photo-crop-dialog'), () => ({
	PhotoCropDialog: ({ onSave }) => (
		<button type="button" onClick={() => onSave({ x: 0, y: 0, width: 1600, height: 900 })}>
			Use this photo
		</button>
	)
}));
vi.mock(import('$lib/admin/settings/crop-image'), async (original) => ({
	...(await original()),
	cropImage: async () => ({ ok: true, blob: CROPPED })
}));

const BASE: StartFundraiserProps = {
	org: ORG,
	open: true,
	donateHref: '/donate',
	signInHref: '/fundraise/sign-in',
	sending: false
};

/** the photo's empty dropzone, the control a press or a drop adds a photo through. */
const photoArea = (root: HTMLElement) => one(root, '.ds-dropzone');

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
	story: 'I drive the Thursday route.'
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
		const sign = one(root, '.ds-field-input-container > .ds-field-affix.ds-field-prefix');
		expect(sign.textContent).toBe('$');
		expect(sign.getAttribute('aria-hidden')).toBe('true');
		expect(sign.nextElementSibling).toBe(goal);
		const story = boxLabelled(root, 'Your story');
		expect(story.getAttribute('aria-describedby')).toContain(`${story.id}-count`);
		const count = one(root, `.ds-field-meta > .ds-field-counter#${story.id}-count`);
		expect(count.textContent).toBe('0 of 1,500');
		expect(count.getAttribute('aria-hidden')).toBe('true');
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
		expect(root.querySelector('input[name="photo_id"]')).toBeNull();
		expect(one<HTMLInputElement>(root, `input[name="${PHOTO_FILE_FIELD}"]`).files).toHaveLength(0);
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

	it('posts once on a double press, before the router says the first is out', async () => {
		const { root, posted } = start();
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		for (const [name, value] of Object.entries(FILLED)) {
			const box = form.elements.namedItem(name);
			if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) box.value = value;
		}
		await submitTwice(form);
		expect(posted).toHaveLength(1);
	});

	it('posts after a press the form itself refused', async () => {
		const { root, posted } = start();
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		await submit(form);
		expect(posted).toHaveLength(0);
		for (const [name, value] of Object.entries(FILLED)) {
			const box = form.elements.namedItem(name);
			if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) box.value = value;
		}
		await submit(form);
		expect(posted).toHaveLength(1);
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

	it('says a photo that was not stored under the photo’s area', () => {
		const { root } = start({ refused: 'photo_missing' });
		const press = photoArea(root);
		expect(one(root, `#${press.id}-err`).textContent).toBe(
			'That photo didn’t upload. Add it again.'
		);
		expect(press.getAttribute('aria-describedby')).toContain(`${press.id}-err`);
		expect(root.querySelector('.sa-refused')).toBeNull();
	});
});

describe('the photo', () => {
	it('turns down an image too narrow before any crop, under its area', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 640, height: 480, close() {} }))
		);
		const { root } = start();
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]:not([name])');
		expect(chooser.accept).toBe('image/png,image/jpeg,image/webp');
		const file = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		const press = photoArea(root);
		expect(press.getAttribute('aria-invalid')).toBe('true');
		const refusal = one(root, `#${press.id}-err`);
		expect(refusal.textContent).toBe(
			'That image is only 640 pixels wide. A photo needs at least 1200. Choose a larger one.'
		);
		expect(refusal.getAttribute('role')).toBe('alert');
		expect(root.querySelector('dialog')).toBeNull();
	});

	it('turns down a file that is no PNG, JPEG or WebP', async () => {
		const { root } = start();
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]:not([name])');
		const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(root.querySelector('.ds-field-err')?.textContent).toContain('isn’t a PNG, JPEG or WebP');
	});
});

describe('a photo dropped on its area', () => {
	/** whether the crop card is up: the stand-in above draws Use this photo, and only the crop draws it. */
	const cropOpen = (root: HTMLElement) =>
		[...root.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Use this photo');

	/** a drop of `files` on the area, as a browser sends one. */
	async function drop(area: HTMLElement, files: File[]) {
		const event = new Event('drop', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'dataTransfer', { value: { files } });
		await act(async () => {
			area.dispatchEvent(event);
		});
	}

	it('refuses a drop of more than one file, every file of it', async () => {
		const { root } = start();
		const area = photoArea(root);
		const pantry = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		await drop(area, [pantry, pantry]);
		expect(one(root, `#${area.id}-err`).textContent).toBe('Drop one file at a time.');
		expect(cropOpen(root)).toBe(false);
	});

	it('refuses a dropped file that is no PNG, JPEG or WebP, with no crop', async () => {
		const { root } = start();
		const area = photoArea(root);
		await drop(area, [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })]);
		expect(one(root, `#${area.id}-err`).textContent).toContain('isn’t a PNG, JPEG or WebP');
		expect(cropOpen(root)).toBe(false);
	});

	it('takes an empty drop for nothing: no refusal, no crop', async () => {
		const { root } = start();
		const area = photoArea(root);
		await drop(area, []);
		expect(area.getAttribute('aria-invalid')).not.toBe('true');
		expect(root.querySelector(`#${area.id}-err`)?.textContent ?? '').toBe('');
		expect(cropOpen(root)).toBe(false);
	});

	it('crops a single dropped photo', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 1600, height: 900, close() {} }))
		);
		const { root } = start();
		await drop(photoArea(root), [new File(['x'], 'pantry.jpg', { type: 'image/jpeg' })]);
		expect(button(root, 'Use this photo')).toBeTruthy();
	});
});

describe('a photo posted with the start', () => {
	/** choose a photo wide enough for a page and press Use this photo on its crop. */
	async function addPhoto(root: HTMLElement) {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 1600, height: 900, close() {} }))
		);
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]:not([name])');
		const file = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await act(async () => button(root, 'Use this photo').click());
	}

	function fill(form: HTMLFormElement) {
		for (const [name, value] of Object.entries(FILLED)) {
			const box = form.elements.namedItem(name);
			if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) box.value = value;
		}
	}

	it('posts the cropped photo as the start’s photo file, beside the boxes', async () => {
		const { root, posted } = start();
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		expect(form.getAttribute('enctype')).toBe('multipart/form-data');
		await addPhoto(root);
		expect(one<HTMLImageElement>(root, '.ds-dropzone-img > img').getAttribute('src')).toMatch(
			/^blob:/
		);
		expect(button(root, 'Replace photo')).toBeTruthy();
		fill(form);
		await submit(form);
		expect(posted).toHaveLength(1);
		const photo = posted[0]?.get(PHOTO_FILE_FIELD);
		expect(photo).toBeInstanceOf(File);
		expect((photo as File).name).toBe('photo.png');
		expect((photo as File).type).toBe('image/png');
		expect(new Uint8Array(await (photo as File).arrayBuffer())).toEqual(
			new Uint8Array(await CROPPED.arrayBuffer())
		);
		expect(posted[0]?.has('photo_id')).toBe(false);
		expect(posted[0]?.get('title')).toBe(FILLED.title);
	});

	it('empties the box under its refusal when the start refuses the photo, and keeps it otherwise', async () => {
		const { root } = mountScreen(
			function Answered() {
				const answer = useActionData<{ result: FormResult; refused: StartRefusal | null }>();
				return <StartFundraiser {...BASE} lastResult={answer?.result} refused={answer?.refused} />;
			},
			(body) => ({
				result: serverResult(FILLED),
				refused: body.get('goal') === '20' ? null : 'photo_missing'
			})
		);
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		await addPhoto(root);
		fill(form);
		boxLabelled(root, 'Goal').value = '20';
		await submit(form);
		expect(button(root, 'Replace photo')).toBeTruthy();
		expect(one<HTMLInputElement>(root, `input[name="${PHOTO_FILE_FIELD}"]`).files).toHaveLength(1);

		boxLabelled(root, 'Goal').value = FILLED.goal;
		await submit(form);
		const press = photoArea(root);
		expect(one(root, `#${press.id}-err`).textContent).toBe(
			'That photo didn’t upload. Add it again.'
		);
		expect(one<HTMLInputElement>(root, `input[name="${PHOTO_FILE_FIELD}"]`).files).toHaveLength(0);

		await addPhoto(root);
		expect(root.querySelector(`#${press.id}-err`)?.textContent ?? '').toBe('');
		await submit(form);
		expect(one(root, `#${photoArea(root).id}-err`).textContent).toBe(
			'That photo didn’t upload. Add it again.'
		);
	});

	// file-dropzone-css.usage.md, States: a file picked from the focused area unmounts what held
	// focus, and focus moves to the new preview's Replace.
	it('puts the keyboard on Replace photo once the photo picked from the focused area is in', async () => {
		const { root } = start();
		act(() => photoArea(root).focus());
		await addPhoto(root);
		expect(document.activeElement).toBe(button(root, 'Replace photo'));
	});

	it('keeps the keyboard on the area when the photo picked from it is turned down', async () => {
		const { root } = start();
		act(() => photoArea(root).focus());
		await addPhoto(root);
		vi.stubGlobal(
			'createImageBitmap',
			vi
				.fn()
				.mockResolvedValueOnce({ width: 1600, height: 900, close() {} })
				.mockResolvedValueOnce({ width: 1000, height: 562, close() {} })
		);
		act(() => button(root, 'Remove').click());
		const chooser = one<HTMLInputElement>(root, 'input[type="file"]:not([name])');
		const file = new File(['x'], 'pantry.jpg', { type: 'image/jpeg' });
		Object.defineProperty(chooser, 'files', { value: [file], configurable: true });
		await act(async () => {
			chooser.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await act(async () => button(root, 'Use this photo').click());
		expect(photoArea(root).getAttribute('role')).toBe('button');
		expect(document.activeElement).toBe(photoArea(root));
	});

	it('posts no photo once Remove empties the box', async () => {
		const { root, posted } = start();
		const form = one<HTMLFormElement>(root, `form#${START_FORM.id}`);
		await addPhoto(root);
		act(() => button(root, 'Remove').click());
		expect(photoArea(root).getAttribute('role')).toBe('button');
		expect(one<HTMLInputElement>(root, `input[name="${PHOTO_FILE_FIELD}"]`).files).toHaveLength(0);
		fill(form);
		await submit(form);
		// a browser posts an empty file box as a nameless file of no bytes, and happy-dom posts none:
		// the start reads both as no photo (`isPosted` in $lib/server/supporters/start.ts).
		const photo = posted[0]?.get(PHOTO_FILE_FIELD) ?? null;
		expect(photo === null || (photo instanceof File && photo.size === 0)).toBe(true);
	});
});

describe('sending', () => {
	it('keeps the press in place, busy, and says to wait', () => {
		const { root } = start({ sending: true });
		const press = one<HTMLButtonElement>(root, 'button[type="submit"]');
		expect(press.getAttribute('aria-busy')).toBe('true');
		expect(press.textContent).toBe('Creating your page…');
		expect(one(root, '.sa-submit > [role="status"]').textContent).toBe(
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
