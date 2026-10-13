import { useEffect, useRef, useState } from 'react';

/**
 * @import { RefObject } from 'react'
 */

/**
 * a `dialog` element lifted into the browser's top layer for as long as the caller is mounted, and
 * the focus handed back to whatever put it there when it goes. ./Sheet.jsx lifts a sheet with it.
 *
 * most of what a modal is arrives with `showModal()` and is not written here. the top layer keeps
 * the tab ring inside the element and the page behind it inert, and Escape reaches the element as a
 * `cancel` event before it is a dismissal — what a `cancel` is answered with is the caller's.
 *
 * it runs in an effect and nowhere else, so a server render draws the element exactly as the caller
 * wrote it and nothing here needs a document until the browser has one.
 *
 * `lifted` is whether the element is in the top layer, for a caller whose markup differs once it
 * is. ./Sheet.jsx draws the same markup either way and reads only `ref`.
 *
 * @returns {{ ref: RefObject<HTMLDialogElement | null>, lifted: boolean }}
 */
export function useTopLayer() {
	const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
	const [lifted, setLifted] = useState(false);

	useEffect(() => {
		const node = ref.current;
		if (node === null) return;
		// what the reader was on when the element went up, held so the cleanup can put them back. it
		// is read before the focus is moved and never after: `showModal()` and the call below are what
		// take it away. an element that arrived in the server's markup was opened by nobody and this
		// is the body, which is where focus already is and where it would go anyway.
		const opener = document.activeElement;
		// `showModal()` throws InvalidStateError on a dialog that is already open non-modally, which
		// is exactly what arrives from the server, so the close is what makes the upgrade legal
		// rather than a way out of anything.
		if (node.open) node.close();
		node.showModal();
		// the element itself, and never the first control inside it — which on a confirm with a
		// `danger` is the control that does the damage (./Dialog.jsx draws it first), so a reader
		// would land on the answer before the question. it is imperative because the platform's own
		// dialog focusing steps look for the `autofocus` *attribute* and react writes none: it strips
		// the prop and focuses at mount, which this call is after and would override either way. the
		// element's `tabIndex={-1}` is what makes it a thing focus can land on at all.
		node.focus();
		setLifted(true);
		return () => {
			setLifted(false);
			// the close is what ends the top layer's hold on the page: while the element is a shown
			// modal everything outside it is inert, so a control out there cannot take the focus until
			// this has run. it is also the only `close()` that fires a `close` event, and nothing on
			// these surfaces listens for one — the dismissal was already reported to the caller and
			// answered by whatever unmounted this.
			if (node.open) node.close();
			// and then back to the control that put the element up. the browser would do this itself on
			// a `close()` of an element still on the page, but this one is being removed in the same
			// commit, so the restoration is written here or it does not happen.
			if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
				opener.focus();
			}
		};
	}, []);

	return { ref, lifted };
}
