import type { ElementType, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
// **an answer is this card's only when the event is its own element's.** a card may be drawn inside
// another — a confirm inside a panel — and react hands both a `cancel` and a click up through every
// dialog its fiber sits under, so the outer card would answer the inner one's Escape too. a press
// is held to it by `onGround`, and no `close` is listened for.
//
// **where focus lands is this module's, because the call is.** `showModal()` moves focus itself and
// overrides anything a mount already did, so the card is put under the keyboard in the same effect
// that lifts it — the reason is beside the call. where it goes back to is this module's for the
// same reason and is the harder half: react takes the element off the page while it is still in the
// top layer, so the browser's own restoration — which runs on `close()` — never happens and the
// reader is left on the body. so what is below is that pair, and the two answers: the one handed
// back instead of letting Escape close the element, and the press outside the card that means the
// same thing.
//
// **what the reader was on counts as the opener only when it is a control.** safari, and firefox on
// macos, do not focus a button or a link a pointer presses: focus goes to the nearest focusable
// thing around it instead, which under the shell is `main` — focusable as the skip link's landing
// (../components/shell/AppShell.jsx). a press on Revoke would then record the whole page as what
// put the card up, and focus would go back to it rather than to the target the screen named. the
// box is still where the reader was, so it is the last place focus goes back to: the opener
// control, then the target the screen named, then that box while it is on the page, then the body.
//
// **a press on the ground counts only when it went down there after the card was lifted.** a
// question that arrived in the server's markup is pressable before this runs, and a press begun
// then ends after the lift: one that went down on the page under the in-page ground would end on
// the `::backdrop` and dismiss a question nobody answered. the in-page card stands in the box the
// lifted one does (`.adm-dialog--inline` in ../styles/adm.css), which is what keeps a press begun
// on one of its controls ending on the same control. the same rule keeps a drag that starts
// inside the card and ends outside it from reading as a press on the ground.

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
	/**
	 * where focus lands when there is no opener to go back to: the answer took it off the page — a
	 * made key remounting the form that asked for it, a revoked row taking its Revoke with it — or
	 * the card arrived in the server's markup and nobody opened it, or what held the focus when it
	 * went up was a box and not a control (the header's safari paragraph). the screen names it
	 * because only the screen knows what is still standing once its answer is drawn. read when the
	 * card comes down, so it is the element on the page then; it has to be one that takes focus.
	 */
	readonly fallbackFocus?: RefObject<HTMLElement | null> | undefined;
};

/** what a pointer press or a key can have put focus on, as opposed to a box that only holds it. */
const CONTROL =
	'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

/** whether a press at this point, targeting the element itself, is outside the card's box. */
function onGround(node: HTMLDialogElement, event: MouseEvent | ReactMouseEvent): boolean {
	if (event.target !== node) return false;
	// a press on the card's own padding targets the element too — the card is one box and its
	// padding is inside it — so the point is what separates the ground from the card. there is no
	// second node to aim at: the ground is the element's own `::backdrop`.
	const box = node.getBoundingClientRect();
	return (
		event.clientX < box.left ||
		event.clientX > box.right ||
		event.clientY < box.top ||
		event.clientY > box.bottom
	);
}

export function Modal<
	C extends ElementType = 'button',
	X extends ElementType = 'button',
	D extends ElementType = 'button'
>({ onDismiss, fallbackFocus, ...interior }: ModalProps<C, X, D>) {
	// which presentation the element is drawn in. it starts as the one the server sent — an open,
	// whole, non-modal card where the lifted one will stand — and the effect turns it off at the
	// moment the same element is lifted, so the modifier and the presentation cannot disagree.
	const [inPage, setInPage] = useState(true);
	const element = useRef<HTMLDialogElement>(null);
	// the effect below runs once per card and reads this when the card comes down, so it takes the
	// target the screen names at that moment rather than the one it named when the card went up.
	const fallback = useEffectEvent(() => fallbackFocus?.current ?? null);
	// set by a press that went down on the ground while the card was lifted, and spent by the click
	// that press ends in.
	const groundPress = useRef(false);

	useEffect(() => {
		const node = element.current;
		if (node === null) return;
		// what the reader was on when the card went up, held so the cleanup can put them back. it is
		// read before the focus is moved and never after: `showModal()` and the call below are what
		// take it away. a dialog that arrived in the server's markup was opened by nobody and focus is
		// on the body, which is no control; nor is a box that only holds focus, for the header's reason,
		// and that box is kept apart as the last place to go back to.
		const focused =
			document.activeElement instanceof HTMLElement && document.activeElement !== document.body
				? document.activeElement
				: null;
		const opener = focused?.matches(CONTROL) ? focused : null;
		const holder = opener === null ? focused : null;
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
		// listened for from here on and not before, which is the whole of the rule: a press that went
		// down before the card was lifted is never recorded.
		const pressDown = (event: PointerEvent) => {
			groundPress.current = onGround(node, event);
		};
		node.addEventListener('pointerdown', pressDown);
		return () => {
			node.removeEventListener('pointerdown', pressDown);
			groundPress.current = false;
			setInPage(true);
			// the close is what ends the top layer's hold on the page: while the element is a shown
			// modal everything outside the card is inert, so a control out there cannot take the focus
			// until this has run. it is also the only `close()` that fires a `close` event, and nothing
			// on these surfaces listens for one — the dismissal was already reported through
			// `onDismiss` and answered by whatever unmounted this.
			if (node.open) node.close();
			// and then back to the control that put the card up. the browser would do this itself on a
			// `close()` of an element still on the page, but this one is being removed in the same
			// commit, so the restoration is written here or it does not happen. with that control gone
			// the reader goes where the screen said, with nothing said to the box that held the focus,
			// and with neither they are left on the body.
			const landing = [opener, fallback(), holder].find((target) => target?.isConnected);
			landing?.focus();
		};
	}, []);

	return (
		<Dialog
			{...(interior as unknown as DialogProps)}
			inPage={inPage}
			ref={element}
			onCancel={(event) => {
				// a card drawn inside this one hands its own Escape up through here (the header says why).
				if (event.target !== element.current) return;
				event.preventDefault();
				onDismiss();
			}}
			onClick={(event) => {
				const node = element.current;
				const wentDown = groundPress.current;
				groundPress.current = false;
				if (node !== null && wentDown && onGround(node, event)) onDismiss();
			}}
		/>
	);
}
