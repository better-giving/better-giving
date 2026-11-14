import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentProps, ElementType, ReactNode } from 'react'
 * @import { MarkName } from '../status/Mark.jsx'
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
 * `aria-busy` is written out rather than left to `ComponentProps<T>` because an element type that
 * is not a host tag carries no aria attributes at all, and a router's link would then refuse it. it
 * reaches the element unchanged, and the registry's button-css draws the press in flight off it.
 *
 * @template {ElementType} T
 * @typedef {ButtonOwnProps & { 'aria-busy'?: boolean | 'true' | 'false' | undefined } & { as?: T } &
 *   Omit<ComponentProps<T>, 'as' | 'aria-busy' | keyof ButtonOwnProps>} ButtonProps
 */

/**
 * the registry's button-css class each rank is drawn by (../../registry/styles/button-css.css).
 *
 * @type {Record<ButtonVariant, string>}
 */
export const BUTTON_VARIANT_CLASS = {
	default: 'ds-btn-secondary',
	primary: 'ds-btn-primary',
	danger: 'ds-btn-destructive',
	quiet: 'ds-btn-ghost',
	soft: 'ds-btn-soft'
};

/* the look is the registry's: `ds-btn`, one rank and the small tier, the gap between a mark and its
   words, and every state a press states with an attribute — closed, in flight, held open.
   `adm-btn` and its two modifiers are packages/operator/src/styles/adm.css's hooks and draw no rank
   of their own: where a screen places a press, and a press held open by a machine's `data-state`.

   there is deliberately no pending or done state here — a button that reports its own write is
   ./SaveButton.jsx. a press in flight is `aria-busy`, the attribute a caller states anyway, and the
   registry draws it. */
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
	'aria-busy': ariaBusy,
	className = '',
	...rest
}) {
	/* widened on the way out of the generic: `rest` is this element type's own props and tsc cannot
	   check a spread it only knows as `ComponentProps<T>` against a tag it only knows as `T`. */
	const Tag = /** @type {ElementType<Record<string, unknown>>} */ (as ?? 'button');
	/* a mark and no words is a press named by its `aria-label`, squared on its tier's height. */
	const iconOnly =
		mark && !markAfter && (children === undefined || children === null || children === false);
	return (
		<Tag
			className={[
				'ds-btn',
				BUTTON_VARIANT_CLASS[variant],
				size === 'sm' ? 'ds-btn-sm' : '',
				iconOnly ? 'ds-btn-icon' : '',
				'adm-btn',
				variant === 'quiet' ? 'adm-btn--quiet' : '',
				size === 'sm' ? 'adm-btn--sm' : '',
				className
			]
				.filter(Boolean)
				.join(' ')}
			aria-busy={ariaBusy}
			{...rest}
		>
			{mark ? <Mark name={mark} /> : null}
			{children}
			{markAfter ? <Mark name={markAfter} /> : null}
		</Tag>
	);
}
