import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentProps, ElementType, ReactNode } from 'react'
 * @import { MarkName } from '../status/Mark.jsx'
 * @import { PointerState } from '../closed-sets.js'
 *
 * @typedef {'default' | 'primary' | 'danger' | 'quiet' | 'soft'} ButtonVariant
 * @typedef {'md' | 'sm'} ButtonSize
 *
 * @typedef {object} ButtonOwnProps
 * @property {ReactNode} [children]
 * @property {ButtonVariant | undefined} [variant]
 * @property {ButtonSize | undefined} [size]
 * @property {MarkName | undefined} [mark]
 * @property {MarkName | undefined} [markAfter]
 * @property {PointerState | 'active' | 'disabled' | undefined} [state] two members past the
 *   shared set, and they are the button's alone: packages/operator/src/styles/adm.css draws a
 *   pressed twin and an unavailable twin for `.adm-btn` and for no other class in the sheet.
 * @property {string | undefined} [className]
 */

/**
 * the rest reaches whatever `as` names, typed as that element's own props: `as="a"` takes `href`
 * and a router's link takes `to`.
 *
 * **`as` is an element type and not a tag name, because this package declares no router and cannot.**
 * it is a leaf that imports from nothing in this app, so a router's link component is not
 * something it can import — there would be no router above it to find. so the caller hands the
 * element in: `as={Link}` from a screen that has one, and the plain tag names from a screen that
 * does not. a bare `<a>` to an internal destination takes the whole document with it, and
 * packages/app/src/lib/admin/button-navigates.dom.spec.tsx is where the difference is asserted.
 *
 * `aria-busy` is the one platform attribute this button reads on its way past: it says a press of
 * this button's own is in flight, and it reaches the element unchanged as well as drawing the dots.
 * only `true` and `'true'` are busy, which is what the attribute means — `'false'` is a non-empty
 * string, so a button reading the prop rather than its value would pulse over every finished press.
 * it is written out here rather than left to `ComponentProps<T>` because an element type that is
 * not a host tag carries no aria attributes at all, and a router's link would then refuse it.
 *
 * @template {ElementType} T
 * @typedef {ButtonOwnProps & { 'aria-busy'?: boolean | 'true' | 'false' | undefined } & { as?: T } &
 *   Omit<ComponentProps<T>, 'as' | 'aria-busy' | keyof ButtonOwnProps>} ButtonProps
 */

/* the five ranks packages/operator/src/styles/adm.css draws. the bare `.adm-btn` is the
   secondary rank and takes no modifier: `variant="default"` is that button.
   there is deliberately no pending or done state here — a button that reports its own write is
   ./SaveButton.jsx, which is a second component and therefore still a second word in the markup.

   what this button does draw for a press in flight is the three dots ./BusyDots below is, over a
   label that stays in the box, and the whole of what turns them on is `aria-busy` — the attribute a
   caller states anyway, not a state of this component's. a caller says a press is going once, to
   the platform, and the drawing follows from it. */
/**
 * @template {ElementType} [T='button']
 * @param {ButtonProps<T>} props
 */
export function Button({
	children,
	variant = 'default',
	size = 'md',
	mark,
	markAfter,
	as,
	state,
	'aria-busy': ariaBusy,
	className = '',
	...rest
}) {
	/* widened on the way out of the generic: `rest` is this element type's own props and tsc cannot
	   check a spread it only knows as `ComponentProps<T>` against a tag it only knows as `T`. */
	const Tag = /** @type {ElementType<Record<string, unknown>>} */ (as ?? 'button');
	const cls = [
		'adm-btn',
		variant !== 'default' ? `adm-btn--${variant}` : '',
		size === 'sm' ? 'adm-btn--sm' : '',
		state ? `is-${state}` : '',
		className
	]
		.filter(Boolean)
		.join(' ');
	return (
		<Tag className={cls} aria-busy={ariaBusy} {...rest}>
			{/* the span is drawn whether or not anything is busy, and it is what keeps the two
			    layouts the same: the dots stand over this box rather than in place of it, so the
			    button's width and height are the resting label's in both states. */}
			<span className="adm-btn__label">
				{mark ? <Mark name={mark} /> : null}
				{children}
				{markAfter ? <Mark name={markAfter} /> : null}
			</span>
			{ariaBusy === true || ariaBusy === 'true' ? <BusyDots /> : null}
		</Tag>
	);
}

/* the three dots a control that is working draws over its own label, drawn by
   packages/operator/src/styles/adm.css and animated there. it is exported because ./SaveButton.jsx
   and a press a screen draws by hand need the same three spans in the same order: a second spelling
   of them is how one of the two comes to pulse at a different rate than the other.

   `aria-hidden` and no text of its own: what a reader is told about the wait is the `aria-busy` on
   the button, and a mark that also announced itself would say it twice. the spans are empty because
   the dots are the sheet's — three boxes with a radius, which is a shape and not a glyph, so no
   entry in ../status/glyphs.js belongs to them. */
export function BusyDots() {
	return (
		<span className="adm-btn__dots" aria-hidden="true">
			<span />
			<span />
			<span />
		</span>
	);
}
