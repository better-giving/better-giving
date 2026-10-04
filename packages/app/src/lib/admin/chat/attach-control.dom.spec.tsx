import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { AttachControl, type AttachControlProps, attachRefusal } from './attach-control';

// what the attach press does: its name, what it opens, what it refuses, and what it reports. the
// resize itself is `packages/operator/src/images/resize.spec.ts`'s; happy-dom decodes no image, so
// every pick here is one the control refuses before a decode.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `appendChild` rather than `append`: see ./ai-panel.dom.spec.tsx's `mount`.
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

function props(over: Partial<AttachControlProps> = {}): AttachControlProps {
	return { held: false, onPicked: () => {}, onResized: () => {}, ...over };
}

const press = (host: HTMLElement) => {
	const button = host.querySelector('button');
	if (button === null) throw new Error('no press');
	return button;
};
const picker = (host: HTMLElement) => {
	const input = host.querySelector<HTMLInputElement>('input[type="file"]');
	if (input === null) throw new Error('no picker');
	return input;
};

/** hands the picker `file` the way the device does: its list changes and the element says so. */
async function choose(host: HTMLElement, file: File) {
	const input = picker(host);
	Object.defineProperty(input, 'files', { configurable: true, value: [file] });
	await act(async () => {
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});
}

describe('the attach press', () => {
	it('is named Attach photo and opens a picker for images', () => {
		const { host } = mount(<AttachControl {...props()} />);
		expect(press(host).textContent).toBe('Attach photo');
		expect(press(host).type).toBe('button');
		expect(picker(host).accept).toBe('image/*');
	});

	it('refuses a file that is not a photo, and reports it', async () => {
		const onPicked = vi.fn();
		const onResized = vi.fn();
		const { host } = mount(<AttachControl {...props({ onPicked, onResized })} />);
		const pdf = new File(['%PDF-1.7'], 'budget.pdf', { type: 'application/pdf' });

		await choose(host, pdf);

		expect(onPicked).toHaveBeenCalledWith(pdf);
		expect(onResized).toHaveBeenCalledExactlyOnceWith({ ok: false, reason: 'not-an-image' });
		expect(attachRefusal('not-an-image')).toBe('Not a photo. Attach a JPEG, PNG, WebP or HEIC.');
	});

	it('is pressed while the picker is open, and lets go when it closes with nothing', async () => {
		const open = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
		const { host } = mount(<AttachControl {...props()} />);

		await act(async () => press(host).click());
		expect(open).toHaveBeenCalledOnce();
		expect(press(host).classList.contains('is-active')).toBe(true);

		await act(async () => {
			picker(host).dispatchEvent(new Event('cancel'));
		});
		expect(press(host).classList.contains('is-active')).toBe(false);
	});

	it('opens nothing while a reply is written, and keeps the focus on the press', async () => {
		const open = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
		const { host } = mount(<AttachControl {...props({ held: true })} />);

		await act(async () => {
			press(host).focus();
			press(host).click();
		});

		expect(open).not.toHaveBeenCalled();
		expect(press(host).getAttribute('aria-disabled')).toBe('true');
		expect(document.activeElement).toBe(press(host));
	});
});
