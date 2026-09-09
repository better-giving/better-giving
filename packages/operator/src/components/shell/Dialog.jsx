import { useId } from 'react';
import { Button } from '../controls/Button.jsx';

/**
 * @import { ComponentProps, ElementType, ReactNode, Ref } from 'react'
 * @import { ButtonProps } from '../controls/Button.jsx'
 */

/* ../controls/Button.jsx read without its generic, which is the only way a spread of props a
   caller handed can reach it. those props are checked where the caller states them — there the
   element type is a real one and `as={Link}` types `to` — and cannot be checked a second time
   here. ./DestructiveConfirm.jsx:16 widens for the same reason and says it at more length. */
const Control = /** @type {(props: Record<string, unknown>) => ReactNode} */ (
	/** @type {unknown} */ (Button)
);

/**
 * @template {ElementType} [C='button']
 * @template {ElementType} [X='button']
 * @template {ElementType} [D='button']
 * @typedef {object} DialogProps
 * @property {ReactNode} [title]
 * @property {string | undefined} [titleId] the heading's id, which the element is labelled by. a
 *   caller states it where something else on the screen has to name the same heading; left off, one
 *   is minted here, and either way the label is the heading a reader can see rather than a second
 *   string beside it.
 * @property {ReactNode} [children]
 * @property {boolean | undefined} [inPage] which of the two presentations
 *   packages/operator/src/styles/adm.css draws this in, defaulting to the one the server sends: an
 *   open, whole, non-modal column in the page. ../../behaviour/Dialog.tsx is what turns it off, at
 *   the moment the same element is lifted into the top layer.
 * @property {ReactNode} [exit] the one way out of the "once" arrangement.
 * @property {ButtonProps<C> | undefined} [exitProps]
 * @property {ReactNode} [cancel] the label on the way out.
 * @property {ButtonProps<X> | undefined} [cancelProps]
 * @property {ReactNode} [danger] the label on the control that does the destructive thing.
 * @property {ButtonProps<D> | undefined} [dangerProps]
 * @property {Ref<HTMLDialogElement> | undefined} [ref]
 * @property {ComponentProps<'dialog'>['onCancel'] | undefined} [onCancel]
 * @property {ComponentProps<'dialog'>['onClick'] | undefined} [onClick]
 */

/* the card, in the two presentations one element has.
 *
 * **nothing here decides whether the dialog exists.** it is a `dialog` the server renders `open`,
 * so a screen puts one in its markup from an action result or from a parameter on the URL and
 * there is no open flag to hold: that is what makes a dialog survive a navigation and a refused
 * submit. what ../../behaviour/Dialog.tsx adds is the presentation and nothing the question
 * depends on.
 *
 * the three controls are a label and the rest of what the control is, as ./DestructiveConfirm.jsx's
 * pair are and for the reason stated there: what a dialog's confirm has to be is settled by the
 * screen around it — a form's submit on one, a handler on the next — and never here.
 *
 * **the actions row holds controls and never a `form`.** a confirm that posts is a submit in this
 * row and the `form` element goes around the whole dialog, which is what the platform already
 * arranges for: a submit belongs to the form that encloses it, and `showModal()` changes where the
 * element paints rather than where it sits in the tree. a `form` between the row and a control
 * would be a flex item of its own, so the row's gap stops reaching the controls inside it and a
 * second one put there stops wrapping with the rest at the 375px floor —
 * `.adm-dialog__actions` in packages/operator/src/styles/adm.css is the row being described.
 *
 * **the element takes the focus itself, and it is ../../behaviour/Dialog.tsx that puts it there.**
 * `showModal()` focuses the first focusable thing inside the card, and the first focusable thing
 * inside this one is always a control in the actions row it draws — on a dialog with a `danger` it
 * is the control that does the damage. so the reader would land on the answer before the question,
 * and it is the row above that puts them there rather than anything a screen wrote. what this file
 * carries is the `tabIndex` that makes the card a thing focus can land on at all; the call that
 * lands it is beside the `showModal()` it has to come after.
 *
 * **so this element carries no `autoFocus`, and a caller's own box may not rely on one either.**
 * react strips the prop and focuses imperatively at mount, which the modal path then overrides —
 * and in the non-modal presentation the card is a column in the page, which is not a thing that
 * takes the reader off whatever they were reading.
 *
 * `ref`, `onCancel` and `onClick` are the seam ../../behaviour/Dialog.tsx reaches through and are
 * the whole of it. a screen rendering this on its own passes none of the three: with no script
 * there is no cancel to intercept and nothing to hold the element by.
 *
 * the "once" arrangement has exactly one way out: no close mark, no cancel — used for a secret
 * shown once and never again. */
/**
 * @template {ElementType} [C='button']
 * @template {ElementType} [X='button']
 * @template {ElementType} [D='button']
 * @param {DialogProps<C, X, D>} props
 */
export function Dialog({
	title,
	titleId,
	children,
	inPage = true,
	exit = 'Done',
	exitProps,
	cancel,
	cancelProps,
	danger,
	dangerProps,
	ref,
	onCancel,
	onClick
}) {
	const minted = useId();
	const heading = titleId ?? minted;
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: what this carries is a press on the ground outside the card, and the keyboard already spells that act — Escape reaches this element as `cancel`, which ../../behaviour/Dialog.tsx answers with the same dismissal.
		<dialog
			ref={ref}
			open
			tabIndex={-1}
			className={inPage ? 'adm-dialog adm-dialog--inline' : 'adm-dialog'}
			aria-labelledby={heading}
			onCancel={onCancel}
			onClick={onClick}
		>
			<h2 id={heading}>{title}</h2>
			{children}
			<div className="adm-dialog__actions">
				{danger ? (
					<Control variant="danger" {...(dangerProps ?? {})}>
						{danger}
					</Control>
				) : null}
				{cancel ? <Control {...(cancelProps ?? {})}>{cancel}</Control> : null}
				{!danger ? (
					<Control variant="primary" {...(exitProps ?? {})}>
						{exit}
					</Control>
				) : null}
			</div>
		</dialog>
	);
}
