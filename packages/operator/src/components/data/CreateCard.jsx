import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentProps, ElementType, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * @typedef {object} CreateCardOwnProps
 * @property {ReactNode} [children] the word under the plus, and it names what is created rather
 *   than the act: a list of these cards down a screen all saying Create is a list a reader has to
 *   walk to reach the one they came for.
 * @property {ReactNode} [ghost] a sample of the record this list holds, drawn hidden so the card
 *   takes a record's height. it carries no interactive element of its own — this card is one press
 *   and an anchor or a button inside another closes it early in the parser and is a focusable node
 *   inside an `aria-hidden` subtree either way. a sample rather than a real record: an empty list
 *   has nothing to take a height from, which is the page this card matters most on.
 * @property {PointerState | undefined} [state]
 */

/**
 * the rest reaches whatever `as` names, typed as that element's own props, and the escape is
 * ../controls/Button.jsx's for that file's own reason: this package declares no router and cannot,
 * so a screen that has one hands its link in — `as={Link}` — and a bare `<a>` to an internal
 * destination takes the whole document with it.
 *
 * @template {ElementType} T
 * @typedef {CreateCardOwnProps & { as?: T } &
 *   Omit<ComponentProps<T>, 'as' | keyof CreateCardOwnProps>} CreateCardProps
 */

/* the press that leads a list of records, drawn as a card of its own so a list opens with the way
   to add to it. ../../styles/adm.css draws it and argues the dashes and the ghost.

   the ghost is a prop and not something this part builds, because what a record looks like is the
   list's: a programme is a name and a sentence, and a form is a name and a foot of presses. a
   sample built in here would be one of the two and wrong on the other.

   the plus is hidden from a reader. the word beside it is the press's name, and a mark that also
   announced itself would say it twice. */
/**
 * @template {ElementType} [T='a']
 * @param {CreateCardProps<T>} props
 */
export function CreateCard({ children, ghost, state, as, ...rest }) {
	/* widened on the way out of the generic, as ../controls/Button.jsx widens its own: `rest` is
	   this element type's own props and tsc cannot check a spread it only knows as
	   `ComponentProps<T>` against a tag it only knows as `T`. */
	const Tag = /** @type {ElementType<Record<string, unknown>>} */ (as ?? 'a');
	return (
		<Tag className={state ? `adm-create is-${state}` : 'adm-create'} {...rest}>
			{/* a div and not a span: what it holds is a whole record, which is flow content, and an
			    anchor takes flow content as long as nothing inside it is interactive. */}
			<div className="adm-create__ghost" aria-hidden="true">
				{ghost}
			</div>
			<span className="adm-create__body">
				<span className="adm-create__plus">
					<Mark name="plus" />
				</span>
				<span className="adm-create__word">{children}</span>
			</span>
		</Tag>
	);
}
