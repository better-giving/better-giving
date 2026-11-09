import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { BannerCropDialog } from './banner-crop-dialog';

// the band the banner's crop card opens on, and what the keyboard does to it: an arrow moves it 1
// pixel of the box, Shift 10 and Ctrl or ⌘ 50, and Alt with an arrow resizes it with its 4:1 kept.
//
// the band is read off the selection's `aria-valuetext`, the band a save posts in the photo's own
// pixels (`bandWords` in ./banner-crop-dialog.tsx). happy-dom lays nothing out, loads no image and
// fires no resize, and ark's cropper measures all three, so each is played here as
// ./logo-crop-dialog.dom.spec.tsx plays them, with nothing in the cropper stood in for. nothing here
// reads a computed style: what is asserted is the figures said to a reader.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Box = { width: number; height: number };

/** the box the photo is drawn in, as the next measure of it reads. */
let box: Box = { width: 0, height: 0 };

/** the observer ark's cropper builds from the document's window, which never fires here. */
class StillResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(window, { ResizeObserver: StillResizeObserver });

beforeEach(() => {
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:banner');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		const { width, height } = this.matches('.adm-cropper__viewport')
			? box
			: { width: 0, height: 0 };
		return DOMRect.fromRect({ x: 0, y: 0, width, height });
	});
	return () => vi.restoreAllMocks();
});

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

/** the photo under the crop loads at `natural`, drawn in a box of `shown`. */
async function load(natural: Box, shown: Box) {
	box = shown;
	const image = document.querySelector<HTMLImageElement>('img.adm-cropper__image');
	if (image === null) throw new Error('no image under the crop');
	Object.defineProperties(image, {
		complete: { configurable: true, get: () => true },
		naturalWidth: { configurable: true, get: () => natural.width },
		naturalHeight: { configurable: true, get: () => natural.height }
	});
	await act(async () => image.dispatchEvent(new Event('load')));
}

const selection = () => document.querySelector<HTMLElement>('.adm-cropper__selection');
const bandSaid = () => selection()?.getAttribute('aria-valuetext');

async function press(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
	await act(async () =>
		selection()?.dispatchEvent(
			new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
		)
	);
}

/** a square photo of 1600 drawn at 400: four of its pixels to each of the box's. */
async function opened() {
	mount(
		<BannerCropDialog
			file={new File(['png'], 'banner.png', { type: 'image/png' })}
			onSave={vi.fn()}
			onCancel={vi.fn()}
			onSwap={vi.fn()}
		/>
	);
	await load({ width: 1600, height: 1600 }, { width: 400, height: 400 });
}

describe('the banner’s crop card', () => {
	it('opens on the widest centred 4:1 band, and says where it stands', async () => {
		await opened();
		expect(bandSaid()).toBe('1600 pixels across, 0 from the left and 600 from the top');
		expect(document.querySelector('dialog')?.textContent).toContain(
			'1600 pixels across, 0 from the left and 600 from the top'
		);
	});

	it.each([
		['alone', {}, 604],
		['with Shift', { shiftKey: true }, 640],
		['with Ctrl', { ctrlKey: true }, 800],
		['with ⌘', { metaKey: true }, 800]
	])('moves the band down by its step for an arrow %s', async (_, modifiers, top) => {
		await opened();
		await press('ArrowDown', modifiers);
		expect(bandSaid()).toBe(`1600 pixels across, 0 from the left and ${top} from the top`);
	});

	it('resizes the band with Alt and an arrow, keeping it 4:1', async () => {
		await opened();
		await press('ArrowLeft', { altKey: true, shiftKey: true });
		expect(bandSaid()).toBe('1560 pixels across, 0 from the left and 600 from the top');

		await press('ArrowRight', { altKey: true });
		expect(bandSaid()).toBe('1564 pixels across, 0 from the left and 600 from the top');
	});

	it('never shrinks the band under 1200 of the photo’s own pixels', async () => {
		await opened();
		for (let i = 0; i < 3; i++) await press('ArrowLeft', { altKey: true, ctrlKey: true });
		expect(bandSaid()).toMatch(/^1200 pixels across/);
	});
});
