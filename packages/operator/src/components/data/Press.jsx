import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentProps, ElementType, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * @typedef {object} PressOwnProps
 * @property {ReactNode} [children]
 * @property {boolean | undefined} [words] the press is said in the surface's own voice rather than
 *   spelled as a literal, and it opens a page. the two are one decision in the drawing and not two
 *   props that would only ever be passed together: a press holding words is a destination, and the
 *   arrow is what says the destination is a page rather than something that happens here. a press
 *   holding a literal opens what that literal can be set to and takes no arrow.
 * @property {PointerState | undefined} [state]
 */

/**
 * the rest reaches whatever `as` names, typed as that element's own props, and the escape is
 * ../controls/Button.jsx's for that file's own reason: this package declares no router and cannot,
 * so a screen that has one hands its link in — `as={Link}` — and a bare `<a>` to an internal
 * destination takes the whole document with it.
 *
 * the default is a button, because the press that does not navigate is the common one: a site at
 * the foot of a form's record opens what that site can be set to, and only the form's own page is
 * somewhere to go.
 *
 * @template {ElementType} T
 * @typedef {PressOwnProps & { as?: T } & Omit<ComponentProps<T>, 'as' | keyof PressOwnProps>} PressProps
 */

/* one press at the foot of a record card, and the `<li>` around it is this part rather than the
   caller's: the foot is a list because each press is one of a run the reader counts, and a screen
   assembling its own items is a screen that can drop the element a browser reports that run by.
   ../../styles/adm.css draws the foot and `.adm-press` on it.

   it draws the chip as well as the press, because what is pressed is the literal the chip is — a
   host, a form's own address. the two classes are spelled here together for that reason and never
   apart: `.adm-press` alone is a press with no ground, corner or face of its own.

   the mark is the closed set's `arrow-up-right` and is hidden from a reader: the words beside it
   already say where the press goes, and a mark that also announced itself would say it twice. */
/**
 * @template {ElementType} [T='button']
 * @param {PressProps<T>} props
 */
export function Press({ children, words = false, state, as, ...rest }) {
	/* widened on the way out of the generic, as ../controls/Button.jsx widens its own: `rest` is
	   this element type's own props and tsc cannot check a spread it only knows as
	   `ComponentProps<T>` against a tag it only knows as `T`. */
	const Tag = /** @type {ElementType<Record<string, unknown>>} */ (as ?? 'button');
	return (
		<li>
			{/* the class list is spelled at the element rather than assembled above it, for
			    ../status/Mark.jsx's reason: a name built into a variable is a name
			    packages/app/src/lib/admin/styles/conformance.spec.ts cannot see, and `.adm-press` then
			    reads there as a rule the sheets draw and nothing wears. */}
			<Tag
				className={`adm-chip adm-press${words ? ' adm-press--words' : ''}${state ? ` is-${state}` : ''}`}
				{...rest}
			>
				{children}
				{words ? <Mark name="arrow-up-right" className="adm-press__arrow" /> : null}
			</Tag>
		</li>
	);
}
