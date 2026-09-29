import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { replaceRefusal } from '../editor/replace-photo';
import { ProgramPhotoControl, type ProgramPhotoControlProps } from './photo-control';

// a program's photo on its own screen in each state it can stand in: none, a pick uploading, a pick
// refused, a photo set, and one removed and not yet saved. Save program writes the id the hidden box
// holds; the press, the refusal and the resize are ../editor/replace-photo.dom.spec.tsx's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactElement) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const PHOTO = '0192a4c1-0000-7000-8000-00000000000b';

const props = (over: Partial<ProgramPhotoControlProps> = {}): ProgramPhotoControlProps => ({
	imageId: PHOTO,
	name: 'photo_id',
	onResized: () => {},
	onRemove: () => {},
	...over
});

const buttons = (host: HTMLElement) =>
	[...host.querySelectorAll('button')].map((button) => button.textContent);
const posted = (host: HTMLElement) =>
	host.querySelector<HTMLInputElement>('input[type="hidden"][name="photo_id"]')?.value;

it('is named Photo, optional, and described by where donors see it', () => {
	const host = mount(<ProgramPhotoControl {...props()} />);
	const group = host.querySelector('fieldset');
	expect(group?.querySelector('legend')?.textContent).toBe('Photo (optional)');
	expect(document.getElementById(group?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
		'Beside the name on the Donation page’s program chooser, cropped square.'
	);
});

describe('each state', () => {
	it('none: offers Add photo alone, and posts no id', () => {
		const host = mount(<ProgramPhotoControl {...props({ imageId: null })} />);
		expect(buttons(host)).toEqual(['Add photo']);
		expect(host.querySelector('img')).toBeNull();
		expect(posted(host)).toBe('');
	});

	it('uploading: says so at the press, held', () => {
		const host = mount(<ProgramPhotoControl {...props({ imageId: null, state: 'uploading' })} />);
		expect(buttons(host)).toEqual(['Uploading']);
		expect(host.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
	});

	it('refused: says why under the press', () => {
		const words = replaceRefusal('too-large-after-resize');
		const host = mount(<ProgramPhotoControl {...props({ state: { refused: words } })} />);
		const press = host.querySelector('button');
		expect(
			document.getElementById(press?.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe(words);
	});

	it('set: draws the photo square by its id, posts the id, and offers Replace photo and Remove', () => {
		const host = mount(<ProgramPhotoControl {...props()} />);
		const art = host.querySelector('img');
		expect(art?.getAttribute('src')).toBe(`/image/${PHOTO}`);
		expect(art?.getAttribute('alt')).toBe('');
		expect(art?.className).toBe('adm-placed__art adm-placed__art--square');
		expect(buttons(host)).toEqual(['Replace photo', 'Remove']);
		expect(posted(host)).toBe(PHOTO);
		expect(host.querySelector('input:not([type="file"]):not([type="hidden"])')).toBeNull();
	});

	it('removed: Remove reports the press, and the group then posts no id', () => {
		const onRemove = vi.fn();
		const host = mount(<ProgramPhotoControl {...props({ onRemove })} />);
		const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove the photo"]');
		act(() => remove?.click());
		expect(onRemove).toHaveBeenCalledOnce();

		const after = mount(<ProgramPhotoControl {...props({ imageId: null })} />);
		expect(posted(after)).toBe('');
		expect(buttons(after)).toEqual(['Add photo']);
	});
});
