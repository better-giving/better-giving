import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentProps, ElementType, ReactNode } from 'react'
 */

/**
 * @typedef {object} CreateCardOwnProps
 * @property {ReactNode} [children] the word beside the plus, and it names what is created rather
 *   than the act: a list of these cards down a screen all saying Create is a list a reader has to
 *   walk to reach the one they came for.
 * @property {ReactNode} [ghost] a sample of the record this list holds, drawn hidden so the card
 *   takes a record's height. it carries no interactive element of its own: it stands under the
 *   press, and an anchor or a button inside it is a focusable node inside an `aria-hidden` subtree.
 *   a sample rather than a real record: an empty list has nothing to take a height from, which is
 *   the page this card matters most on.
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
   to add to it. the press is the registry's `ds-card-create`
   (../../registry/styles/card-css.css), and ../../styles/adm.css's `.adm-create` is the holder that
   stands it at the ghost's height.

   the ghost is a prop and not something this part builds, because what a record looks like is the
   list's: a programme is a name and a sentence, and a form is a name and a foot of presses. a
   sample built in here would be one of the two and wrong on the other.

   the plus is hidden from a reader. the word beside it is the press's name, and a mark that also
   announced itself would say it twice. */
/**
 * @template {ElementType} [T='a']
 * @param {CreateCardProps<T>} props
 */
export function CreateCard({ children, ghost, as, ...rest }) {
	/* widened on the way out of the generic, as ../controls/Button.jsx widens its own: `rest` is
	   this element type's own props and tsc cannot check a spread it only knows as
	   `ComponentProps<T>` against a tag it only knows as `T`. */
	const Tag = /** @type {ElementType<Record<string, unknown>>} */ (as ?? 'a');
	return (
		<div className="adm-create">
			<div className="adm-create__ghost" aria-hidden="true">
				{ghost}
			</div>
			<Tag className="ds-card-create" {...rest}>
				<Mark name="plus" />
				{children}
			</Tag>
		</div>
	);
}
