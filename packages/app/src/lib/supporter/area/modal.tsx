import { type ReactNode, type RefObject, useEffect, useEffectEvent, useRef } from 'react';

// a card over a supporter screen, lifted into the browser's top layer with `showModal()`, as
// /admin's cards are (packages/operator/src/behaviour/Dialog.tsx). the top layer is what holds the
// tab ring inside the card and makes the page behind it inert, and Escape reaches the element as a
// `cancel` event, which is answered here with `onDismiss` rather than a close: whether the card is
// up is the screen's state, never the element's.
//
// focus lands on `initialFocus` — a confirm's Cancel, so Enter never does the act by accident — and
// goes back to the control that opened the card when the card comes down, or to the first of
// `fallbackFocus` still on the page where that control went with it. react removes the element
// while it is still in the top layer, so the browser's own restoration on `close()` never runs and
// is written here instead. what held focus counts as the opener only when it is a control: safari,
// and firefox on macos, do not focus a button a pointer presses, and a card opened by a drop or
// after an await was opened by none, so focus is then on the body or a box around it, and goes to
// `fallbackFocus` instead.
//
// registry gap: the registry's dialog is React-only (its `dialog` item) and draws no plain-CSS
// surface, so `.sa-dialog` in ./area.css is the card: `--popover` on the card corner, the one
// floating shadow, over the registry's `--overlay`.

export type ModalProps = {
	readonly role: 'dialog' | 'alertdialog';
	readonly labelledBy: string;
	readonly describedBy?: string | undefined;
	readonly onDismiss: () => void;
	readonly initialFocus: RefObject<HTMLElement | null>;
	/**
	 * where focus goes when the card comes down and no control that opened it is on the page, the
	 * first of them still there, read then: the screen's answer may have removed the opener with the
	 * card.
	 */
	readonly fallbackFocus?: readonly RefObject<HTMLElement | null>[] | undefined;
	readonly className?: string | undefined;
	readonly children: ReactNode;
};

/** what a pointer press or a key can have put focus on, as /admin's Dialog.tsx counts it. */
const CONTROL =
	'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

export function Modal({
	role,
	labelledBy,
	describedBy,
	onDismiss,
	initialFocus,
	fallbackFocus,
	className,
	children
}: ModalProps) {
	const element = useRef<HTMLDialogElement>(null);
	const landing = useEffectEvent(() => initialFocus.current);
	const fallback = useEffectEvent(() => (fallbackFocus ?? []).map((target) => target.current));
	useEffect(() => {
		const node = element.current;
		if (node === null) return;
		const focused = document.activeElement;
		const opener = focused instanceof HTMLElement && focused.matches(CONTROL) ? focused : null;
		if (!node.open) node.showModal();
		(landing() ?? node).focus();
		return () => {
			if (node.open) node.close();
			[opener, ...fallback()].find((target) => target?.isConnected)?.focus();
		};
	}, []);
	return (
		<dialog
			ref={element}
			role={role}
			aria-modal="true"
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}
			tabIndex={-1}
			className={className === undefined ? 'sa-dialog' : `sa-dialog ${className}`}
			onCancel={(event) => {
				if (event.target !== element.current) return;
				event.preventDefault();
				onDismiss();
			}}
		>
			{children}
		</dialog>
	);
}
