import { Banner } from '../status/Banner.jsx';
import { Button } from '../controls/Button.jsx';

/**
 * @import { ElementType, HTMLAttributes, ReactNode, Ref } from 'react'
 * @import { ButtonProps } from '../controls/Button.jsx'
 * @import { Tone } from '../closed-sets.js'
 */

/* ../controls/Button.jsx read without its generic, which is the only way a spread of props a
   caller handed can reach it. those props are checked where the caller states them — there the
   element type is a real one and `as={Link}` types `to` — and cannot be checked a second time
   here, because tsc holds that element type only as this component's own type parameter and
   leaves `ComponentProps<…>` of it unresolved. ../controls/Button.jsx:57 widens its own spread
   for the same reason. */
const Control = /** @type {(props: Record<string, unknown>) => ReactNode} */ (
	/** @type {unknown} */ (Button)
);

/**
 * the two controls are a label and the rest of what the control is, because what a confirmation
 * has to be is settled by the screen around it and not here: on a screen that archives, the
 * confirming control is a form's submit and the way out is a navigation, and on a screen that
 * clears something in place both are handlers. so each takes ../controls/Button.jsx's own props —
 * `as` for the element type, `type` for the button type, and whatever that element takes.
 *
 * `variant` is stated by this component and can still be overridden, because the spread lands
 * after it. the ranks it states are the pairing /admin draws: one coloured control in an actions
 * row and it is the destructive one, so the way out is the bare secondary rank and never an accent
 * of its own.
 *
 * **the actions row holds controls and never a `form`**, for the reason ./Dialog.jsx's header
 * states about its own row: a confirm that posts is a submit and the `form` element goes around
 * this whole block.
 *
 * @template {ElementType} [C='button']
 * @template {ElementType} [X='button']
 * @typedef {object} DestructiveConfirmProps
 * @property {Tone | undefined} [tone] the register the banner speaks in, defaulting to `blocker`.
 *   the whole set ../status/Banner.jsx takes, unnarrowed: which register a refusal is stated in is
 *   the screen's to settle and no component in this package rules on it. the tone also picks the
 *   aria role there — a blocker interrupts a screen reader and the other three wait their turn.
 * @property {ReactNode} [word]
 * @property {ReactNode} [children]
 * @property {ReactNode} [report] what the last press answered with, between the question and the
 *   answer to it. a confirmation whose write redirects has none; one that can be refused in place
 *   is read where the operator is already standing, and at the top of the screen it would be a
 *   sentence about a press they cannot see reported. it stands outside the banner for the reason
 *   the controls do.
 * @property {ReactNode} [confirm] the label on the control that does it.
 * @property {ButtonProps<C> | undefined} [confirmProps]
 * @property {ReactNode} [cancel] the label on the way out.
 * @property {ButtonProps<X> | undefined} [cancelProps]
 * @property {Ref<HTMLDivElement> | undefined} [ref]
 */

/**
 * the rest reaches the block, which is what a screen opening this by a navigation needs: the block
 * is what a reader is moved to, so it carries the `tabIndex` that makes it a place focus can land
 * and the role and name that make what they land on announce itself. a name is never taken from
 * `word` here — that is a node, and the string a voice user says has to be one the screen states.
 *
 * @template {ElementType} [C='button']
 * @template {ElementType} [X='button']
 * @typedef {DestructiveConfirmProps<C, X>
 *   & Omit<HTMLAttributes<HTMLDivElement>, keyof DestructiveConfirmProps<C, X>>} DestructiveConfirmAllProps
 */

/* the controls sit BENEATH the banner, never inside it. a banner states; it does not act. */
/**
 * @template {ElementType} [C='button']
 * @template {ElementType} [X='button']
 * @param {DestructiveConfirmAllProps<C, X>} props
 */
export function DestructiveConfirm({
	tone = 'blocker',
	word,
	children,
	report,
	confirm,
	confirmProps,
	cancel = 'Keep it',
	cancelProps,
	className,
	...rest
}) {
	return (
		<div className={className ? `adm-destructive ${className}` : 'adm-destructive'} {...rest}>
			<Banner tone={tone} word={word}>
				{children}
			</Banner>
			{report}
			<div className="adm-actions">
				<Control variant="danger" {...(confirmProps ?? {})}>
					{confirm}
				</Control>
				<Control {...(cancelProps ?? {})}>{cancel}</Control>
			</div>
		</div>
	);
}
