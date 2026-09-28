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

function props(over: Partial<ReplacePhotoControlProps> = {}): ReplacePhotoControlProps {
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
