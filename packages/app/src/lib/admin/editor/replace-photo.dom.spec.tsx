import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
	ReplacePhotoControl,
	type ReplacePhotoControlProps,
	replaceRefusal
} from './replace-photo';

// what a placed photo's replace press does: its name and its box's, what it refuses, and how it
// reports the upload the route runs. the resize itself is ../../images/resize.spec.ts's; happy-dom
// decodes no image, so every pick here is one the control refuses before a decode.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `appendChild` rather than `append`: see ../chat/chat-sheet.dom.spec.tsx's `mount`.
function mount(node: ReactElement) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return { host, redraw: (next: ReactElement) => act(() => root.render(next)) };
}

const ALT = 'Children at Eastside School trying on new winter coats';

/** the control with its description box, as a block's sheet draws it. */
type Described = Extract<ReplacePhotoControlProps, { readonly alt: string }>;

function props(over: Partial<Described> = {}): Described {
	return {
		imageSrc: '/image/0192a4c1',
		alt: ALT,
		onResized: () => {},
		onAltChange: () => {},
		...over
	};
}

function one<T extends Element>(host: HTMLElement, selector: string): T {
	const found = host.querySelector<T>(selector);
	if (found === null) throw new Error(`nothing on the page matches ${selector}`);
	return found;
}

const press = (host: HTMLElement) => one<HTMLButtonElement>(host, 'button');
const status = (host: HTMLElement) => one<HTMLElement>(host, '[role="status"]');

describe('the replace press', () => {
	it('names the press, the photo and the box that describes it', () => {
		const { host } = mount(<ReplacePhotoControl {...props()} />);
		const box = one<HTMLInputElement>(host, 'input:not([type="file"])');

		expect(press(host).textContent).toBe('Replace photo');
		expect(one<HTMLImageElement>(host, 'img').alt).toBe(ALT);
		expect(one(host, `label[for="${box.id}"]`).textContent).toContain('Describe the photo');
		expect(box.value).toBe(ALT);
		expect(one<HTMLInputElement>(host, 'input[type="file"]').accept).toBe('image/*');
	});

	it('draws a photo with no description as decoration', () => {
		const { host } = mount(<ReplacePhotoControl {...props({ alt: '' })} />);
		expect(one(host, 'img').getAttribute('alt')).toBe('');
	});

	it('reports what is typed into the box', () => {
		const onAltChange = vi.fn();
		const { host } = mount(<ReplacePhotoControl {...props({ onAltChange })} />);
		const box = one<HTMLInputElement>(host, 'input:not([type="file"])');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

		act(() => {
			setter?.call(box, 'Coats on a rack');
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});

		expect(onAltChange).toHaveBeenCalledWith('Coats on a rack');
	});

	it('refuses a file that is not a photo, and reports it', async () => {
		const onResized = vi.fn();
		const { host } = mount(<ReplacePhotoControl {...props({ onResized })} />);
		const input = one<HTMLInputElement>(host, 'input[type="file"]');
		Object.defineProperty(input, 'files', {
			value: [new File(['%PDF-1.7'], 'budget.pdf', { type: 'application/pdf' })]
		});

		await act(async () => {
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});

		expect(onResized).toHaveBeenCalledExactlyOnceWith({ ok: false, reason: 'not-an-image' });
	});

	it('says it is uploading and opens nothing until the upload lands, keeping the focus', async () => {
		const open = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
		const { host } = mount(<ReplacePhotoControl {...props({ state: 'uploading' })} />);

		await act(async () => {
			press(host).focus();
			press(host).click();
		});

		expect(press(host).textContent).toBe('Uploading');
		expect(press(host).getAttribute('aria-busy')).toBe('true');
		expect(press(host).getAttribute('aria-disabled')).toBe('true');
		expect(open).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(press(host));
	});

	it('draws a refusal of the description under its box', () => {
		const words = 'a photo’s description holds at most 250 characters';
		const { host } = mount(
			<ReplacePhotoControl {...props({ altId: 'alt-box', altError: words })} />
		);
		const box = one<HTMLInputElement>(host, '#alt-box');
		const said = box.getAttribute('aria-describedby')?.split(' ') ?? [];
		expect(said.map((id) => document.getElementById(id)?.textContent)).toContain(words);
		expect(box.getAttribute('aria-invalid')).toBe('true');
	});

	it('speaks a refusal from a region that was there before it, and describes the press by it', () => {
		const { host, redraw } = mount(<ReplacePhotoControl {...props()} />);
		const region = status(host);
		expect(region.textContent).toBe('');
		expect(press(host).hasAttribute('aria-describedby')).toBe(false);

		const words = replaceRefusal('not-an-image');
		redraw(<ReplacePhotoControl {...props({ state: { refused: words } })} />);

		expect(status(host)).toBe(region);
		expect(region.textContent).toBe('That file isn’t a photo. Choose a JPEG, PNG, WebP or HEIC.');
		expect(press(host).getAttribute('aria-describedby')).toBe(region.id);
		expect(press(host).textContent).toBe('Replace photo');
	});
});

describe('a block with no photo yet', () => {
	const empty = (over: Partial<Described> = {}) => props({ imageSrc: undefined, alt: '', ...over });

	it('offers Add photo alone: no photo drawn and no box describing one', () => {
		const { host } = mount(<ReplacePhotoControl {...empty()} />);
		expect(press(host).textContent).toBe('Add photo');
		expect(host.querySelector('img')).toBeNull();
		expect(host.querySelector('input:not([type="file"])')).toBeNull();
	});

	it('opens the picker and reports the pick as a replace does', async () => {
		const open = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
		onTestFinished(() => open.mockRestore());
		const onResized = vi.fn();
		const { host } = mount(<ReplacePhotoControl {...empty({ onResized })} />);

		act(() => press(host).click());
		expect(open).toHaveBeenCalledOnce();

		const input = one<HTMLInputElement>(host, 'input[type="file"]');
		Object.defineProperty(input, 'files', {
			value: [new File(['%PDF-1.7'], 'budget.pdf', { type: 'application/pdf' })]
		});
		await act(async () => {
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(onResized).toHaveBeenCalledExactlyOnceWith({ ok: false, reason: 'not-an-image' });
	});

	it('says it is uploading, then draws the photo it was handed with its box', async () => {
		const { host, redraw } = mount(<ReplacePhotoControl {...empty({ state: 'uploading' })} />);
		expect(press(host).textContent).toBe('Uploading');

		redraw(<ReplacePhotoControl {...empty({ imageSrc: '/image/0192a4c1' })} />);

		expect(press(host).textContent).toBe('Replace photo');
		expect(one(host, 'img').getAttribute('src')).toBe('/image/0192a4c1');
		expect(host.querySelector('input:not([type="file"])')).not.toBeNull();
	});
});

/** the control with no description box, as the logo and a program's photo draw it. */
const bare = (over: Partial<Extract<ReplacePhotoControlProps, { describe: false }>> = {}) =>
	({
		imageSrc: '/image/0192a4c1',
		describe: false,
		onResized: () => {},
		...over
	}) as const;

describe('an image whose words stand beside it', () => {
	it('draws no description box, and the art as decoration', () => {
		const { host } = mount(<ReplacePhotoControl {...bare()} />);
		expect(host.querySelector('input:not([type="file"])')).toBeNull();
		expect(one(host, 'img').getAttribute('alt')).toBe('');
	});

	it('names the press for what the image is', () => {
		const { host, redraw } = mount(<ReplacePhotoControl {...bare({ noun: 'logo' })} />);
		expect(press(host).textContent).toBe('Replace logo');

		redraw(<ReplacePhotoControl {...bare({ noun: 'logo', imageSrc: undefined })} />);
		expect(press(host).textContent).toBe('Add logo');
	});

	it('frames the art whole or square, and as the sheet crops it by default', () => {
		const art = (frame?: 'whole' | 'square') =>
			one(mount(<ReplacePhotoControl {...bare({ frame })} />).host, 'img').className;
		expect(art()).toBe('adm-placed__art');
		expect(art('whole')).toBe('adm-placed__art adm-placed__art--whole');
		expect(art('square')).toBe('adm-placed__art adm-placed__art--square');
	});
});

describe('Remove', () => {
	const remove = (host: HTMLElement) =>
		[...host.querySelectorAll('button')].find((button) => button.textContent === 'Remove');

	it('stands beside the press, named for what it takes away, and reports the press', () => {
		const onRemove = vi.fn();
		const { host } = mount(<ReplacePhotoControl {...bare({ noun: 'logo', onRemove })} />);
		const button = remove(host);

		expect(button?.getAttribute('aria-label')).toBe('Remove the logo');
		act(() => button?.click());
		expect(onRemove).toHaveBeenCalledOnce();
	});

	it('is not drawn without a handler, with nothing placed, or while a photo is in flight', () => {
		expect(remove(mount(<ReplacePhotoControl {...bare()} />).host)).toBeUndefined();
		const onRemove = () => {};
		expect(
			remove(mount(<ReplacePhotoControl {...bare({ onRemove, imageSrc: undefined })} />).host)
		).toBeUndefined();
		expect(
			remove(mount(<ReplacePhotoControl {...bare({ onRemove, state: 'uploading' })} />).host)
		).toBeUndefined();
	});

	it('hands the focus to the press once the image it removed is gone', () => {
		const onRemove = vi.fn();
		const { host, redraw } = mount(<ReplacePhotoControl {...bare({ noun: 'logo', onRemove })} />);
		const button = remove(host);
		act(() => {
			button?.focus();
			button?.click();
		});
		redraw(<ReplacePhotoControl {...bare({ noun: 'logo', onRemove, imageSrc: undefined })} />);

		expect(document.activeElement).toBe(press(host));
		expect(press(host).textContent).toBe('Add logo');
	});
});

describe('the flag', () => {
	it('stands over the art as a plain word', () => {
		const { host } = mount(<ReplacePhotoControl {...props({ flag: 'Illustration' })} />);
		const flag = one<HTMLElement>(host, '.adm-placed > .adm-actions:first-child');
		expect(flag.textContent).toBe('Illustration');
		expect(one(flag, '.adm-state').className).toBe('adm-state');
		expect(flag.nextElementSibling?.tagName).toBe('IMG');
	});

	it('is not drawn without it, nor over no art', () => {
		expect(mount(<ReplacePhotoControl {...props()} />).host.querySelector('.adm-state')).toBeNull();
		expect(
			mount(
				<ReplacePhotoControl {...props({ flag: 'Illustration', imageSrc: undefined })} />
			).host.querySelector('.adm-state')
		).toBeNull();
	});
});
