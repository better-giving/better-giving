import type { ElementType } from 'react';
import { Dialog, type DialogProps } from '../components/shell/Dialog.jsx';
import { useTopLayer } from '../components/shell/top-layer.js';

// the same dialog, lifted into the browser's top layer.
//
// it draws no markup of its own: ../components/shell/Dialog.jsx is the whole of what is on the
// screen, and this adds the one thing that file cannot carry — an effect, which needs a document.
// ./Dialog.dom.spec.tsx asserts the two render one interior, so a copy cannot be introduced
// without failing.
//
// **it decides nothing about whether the dialog exists**, and that is the rule the split exists to
// keep. the element arrives open in the server's markup — rendered from an action result or from a
// parameter on the URL — so there is no open flag here and there must not be one. `onDismiss`
// reports the request and the screen answers it, by navigating or by clearing what the dialog was
// rendered from. a dialog that closed itself would take an action result off a page that is still
// holding it.
//
// most of what a modal is arrives with `showModal()` and is not written here, and the lift itself
// is ../components/shell/top-layer.js — the effect that shows the element, puts the card under the
// keyboard and hands the focus back when it goes, shared with ../components/shell/Sheet.jsx so the
// two modals on these surfaces move focus alike. what is below is the two answers: the one handed
// back instead of letting Escape close the element, and the press outside the card that means the
// same thing.

type ModalProps<
	C extends ElementType = 'button',
	X extends ElementType = 'button',
	D extends ElementType = 'button',
	M extends ElementType = 'button'
> = Omit<DialogProps<C, X, D, M>, 'inPage' | 'ref' | 'onCancel' | 'onClick'> & {
	/**
	 * what Escape and a press on the ground answer with.
	 *
	 * it is a request rather than a close: none of these dialogs may take itself off the screen,
	 * so this is handed the control the reader would have pressed, and no key is left dead.
	 */
	readonly onDismiss: () => void;
};

export function Modal<
	C extends ElementType = 'button',
	X extends ElementType = 'button',
	D extends ElementType = 'button',
	M extends ElementType = 'button'
>({ onDismiss, ...interior }: ModalProps<C, X, D, M>) {
	// which presentation the element is drawn in. it starts as the one the server sent — an open,
	// whole, non-modal column in the page — and turns at the moment the same element is lifted, so the
	// modifier and the presentation cannot disagree.
	const { ref: element, lifted } = useTopLayer();

	return (
		<Dialog
			{...(interior as unknown as DialogProps)}
			inPage={!lifted}
			ref={element}
			onCancel={(event) => {
				event.preventDefault();
				onDismiss();
			}}
			onClick={(event) => {
				const node = element.current;
				if (node === null || event.target !== node) return;
				// a press on the card's own padding targets the element too — the card is one box and
				// its padding is inside it — so the point is what separates the ground from the card.
				// there is no second node to aim at: the ground is the element's own `::backdrop`.
				const box = node.getBoundingClientRect();
				if (
					event.clientX < box.left ||
					event.clientX > box.right ||
					event.clientY < box.top ||
					event.clientY > box.bottom
				) {
					onDismiss();
				}
			}}
		/>
	);
}
