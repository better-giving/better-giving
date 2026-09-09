import type { ElementType } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, type DialogProps } from '../components/shell/Dialog.jsx';

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
// most of what a modal is arrives with `showModal()` and is not written here. the top layer keeps
// the tab ring inside the card and the page behind it inert, and Escape reaches the element as a
// `cancel` event before it is a dismissal.
//
// **where focus lands is this module's, because the call is.** `showModal()` moves focus itself and
// overrides anything a mount already did, so the card is put under the keyboard in the same effect
// that lifts it — the reason is beside the call. where it goes back to is this module's for the
// same reason and is the harder half: react takes the element off the page while it is still in the
// top layer, so the browser's own restoration — which runs on `close()` — never happens and the
// reader is left on the body. so what is below is that pair, and the two answers: the one handed
// back instead of letting Escape close the element, and the press outside the card that means the
// same thing.

type ModalProps<
	C extends ElementType = 'button',
	X extends ElementType = 'button',
	D extends ElementType = 'button'
> = Omit<DialogProps<C, X, D>, 'inPage' | 'ref' | 'onCancel' | 'onClick'> & {
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
	D extends ElementType = 'button'
>({ onDismiss, ...interior }: ModalProps<C, X, D>) {
	// which presentation the element is drawn in. it starts as the one the server sent — an open,
	// whole, non-modal column in the page — and the effect turns it off at the moment the same
	// element is lifted, so the modifier and the presentation cannot disagree.
	const [inPage, setInPage] = useState(true);
	const element = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const node = element.current;
		if (node === null) return;
		// what the reader was on when the card went up, held so the cleanup can put them back. it is
		// read before the focus is moved and never after: `showModal()` and the call below are what
		// take it away. a dialog that arrived in the server's markup was opened by nobody and this is
		// the body, which is where focus already is and where it would go anyway.
		const opener = document.activeElement;
		// `showModal()` throws InvalidStateError on a dialog that is already open non-modally, which
		// is exactly what arrives from the server, so the close is what makes the upgrade legal
		// rather than a way out of anything.
		if (node.open) node.close();
		node.showModal();
		// the card, and never the first control in the actions row — which on a dialog with a
		// `danger` is the control that does the damage (../components/shell/Dialog.jsx draws it
		// first), so a reader would land on the answer before the question. it is imperative because
		// the platform's own dialog focusing steps look for the `autofocus` *attribute* and react
		// writes none: it strips the prop and focuses at mount, which this call is after and would
		// override either way. `tabIndex={-1}` over there is what makes the card a thing focus can
		// land on at all.
		node.focus();
		setInPage(false);
		return () => {
			setInPage(true);
			// the close is what ends the top layer's hold on the page: while the element is a shown
			// modal everything outside the card is inert, so a control out there cannot take the focus
			// until this has run. it is also the only `close()` that fires a `close` event, and nothing
			// on these surfaces listens for one — the dismissal was already reported through
			// `onDismiss` and answered by whatever unmounted this.
			if (node.open) node.close();
			// and then back to the control that put the card up. the browser would do this itself on a
			// `close()` of an element still on the page, but this one is being removed in the same
			// commit, so the restoration is written here or it does not happen.
			if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
				opener.focus();
			}
		};
	}, []);

	return (
		<Dialog
			{...(interior as unknown as DialogProps)}
			inPage={inPage}
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
