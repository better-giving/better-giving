import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import { LogoCropDialog } from './logo-crop-dialog';

// the square the crop card opens on, for the image it opens with and for one dropped on it after.
//
// the square is read off the selection's `aria-valuetext`, which is the square a save posts in the
// image's own pixels (`squareWords` in ./logo-crop-dialog.tsx), so a square opened off-centre
// reads as different figures rather than as a different look.
//
// happy-dom lays nothing out, loads no image and fires no resize, and ark's cropper measures all
// three: the box from `getBoundingClientRect`, the image's own size from its `load`, and a change
// of box from a `ResizeObserver`. each is played here in the order a browser plays it, with the
// box and image a case names, and nothing in the cropper or ./logo-crop.ts is stood in for.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style or a class's paint. what is asserted is the figures said to a reader.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Box = { width: number; height: number };

/** the box the image is drawn in, as the next measure of it reads. */
let box: Box = { width: 0, height: 0 };

/** every element a resize observer is watching, and what it calls when one changes size. */
const watched = new Map<Element, ResizeObserverCallback>();

/**
 * the observer ark's cropper builds from the document's window. zag builds one for the module and
 * keeps it, so it is installed once for the file rather than per case.
 */
class PlayedResizeObserver {
	readonly #callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.#callback = callback;
	}
	observe(target: Element) {
		watched.set(target, this.#callback);
	}
	unobserve(target: Element) {
		watched.delete(target);
	}
	disconnect() {}
}
Object.assign(window, { ResizeObserver: PlayedResizeObserver });

/** the box changes size, and every observer watching it hears so. */
function resize(target: Element) {
	const callback = watched.get(target);
	if (callback === undefined) throw new Error('nothing is watching the box');
	callback([{ target } as ResizeObserverEntry], {} as ResizeObserver);
}

/** a file the card takes, one of the types a logo is. */
const logoFile = (name: string) => new File(['logo'], name, { type: 'image/png' });

function mount(tree: ReactNode): { root: HTMLElement; render: Root['render'] } {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, render: (next) => act(() => mounted.render(next)) };
}

/** the image under the crop loads at `natural`, drawn in a box of `shown`. */
async function load(root: HTMLElement, natural: Box, shown: Box) {
	box = shown;
	const image = root.ownerDocument.querySelector<HTMLImageElement>('img.adm-cropper__image');
	if (image === null) throw new Error('no image under the crop');
	Object.defineProperties(image, {
		complete: { configurable: true, get: () => true },
		naturalWidth: { configurable: true, get: () => natural.width },
		naturalHeight: { configurable: true, get: () => natural.height }
	});
	await act(async () => image.dispatchEvent(new Event('load')));
}

const viewport = (root: HTMLElement) =>
	root.ownerDocument.querySelector('.adm-cropper__viewport') as HTMLElement;

const squareSaid = (root: HTMLElement) =>
	root.ownerDocument.querySelector('.adm-cropper__selection')?.getAttribute('aria-valuetext');

it('opens a dropped image on the largest centred square of its own, as it opens the first', async () => {
	let made = 0;
	vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:logo-${++made}`);
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		const { width, height } = this.matches('.adm-cropper__viewport')
			? box
			: { width: 0, height: 0 };
		return DOMRect.fromRect({ x: 0, y: 0, width, height });
	});
	const props = { onSave: vi.fn(), onCancel: vi.fn(), onSwap: vi.fn() };

	const { root, render } = mount(<LogoCropDialog file={logoFile('wide.png')} {...props} />);
	await load(root, { width: 800, height: 400 }, { width: 400, height: 200 });
	expect(squareSaid(root)).toBe('400 pixels across, 200 from the left and 0 from the top');

	// a tall image dropped on the card: the box takes its shape, and the browser reports the image's
	// size before it reports the box's.
	render(<LogoCropDialog file={logoFile('tall.png')} {...props} />);
	await load(root, { width: 300, height: 600 }, { width: 100, height: 200 });
	await act(async () => resize(viewport(root)));
	expect(squareSaid(root)).toBe('300 pixels across, 0 from the left and 150 from the top');
});
