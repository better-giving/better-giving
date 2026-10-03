import { useEffect, useRef } from 'react';
import { Button } from '../controls/Button.jsx';
import { PanelRoute } from './AppShell.jsx';

/**
 * @import { ElementType, ReactNode } from 'react'
 * @import { ButtonProps } from '../controls/Button.jsx'
 */

/* ../controls/Button.jsx read without its generic, for the reason ./Dialog.jsx states about its
   own three controls: the props are checked where the caller states them, and the element type is
   only a type parameter here. */
const Control = /** @type {(props: Record<string, unknown>) => ReactNode} */ (
	/** @type {unknown} */ (Button)
);

/**
 * the way out is a label plus the rest of what the control is, and this package states neither the
 * element nor the destination. it is a leaf that declares no router, and the addresses a surface
 * can send someone to are that surface's: a route table named here is a route table the other
 * surface has to work around, which is how two operator surfaces come to draw two different shapes for the
 * same failure.
 *
 * @template {ElementType} [W='button']
 * @typedef {object} ErrorPanelProps
 * @property {`${number}` | undefined} [code] the HTTP status the panel prints.
 * @property {string | undefined} [title] the heading. words rather than markup, because the code
 *   and the heading together are the face, and the panel moves the reader whenever the face changes:
 *   a node built afresh on every render would read as a new face each time.
 * @property {ReactNode} [children]
 * @property {ReactNode} [wayOut] the label on the way out. absent, the panel offers none.
 * @property {ButtonProps<W> | undefined} [wayOutProps] the element and where it goes.
 */

/* the panel a route outside the shell is: ./AppShell.jsx's `PanelRoute` is the composition, drawn
   once there and reached from here, so signing in and failing are the same centred panel rather
   than two that only look alike.

   three faces. a 404 on a working deployment has somewhere to send anybody. a 500 has no way out at
   all — deliberately: the deployment that would serve the next screen is the thing that failed, so
   a link would be a lie. a refused request prints its own 4xx and, like the 404, has somewhere to
   send anybody, because the deployment refusing it is still answering.
   which face gets one is the caller's, because it is the caller that knows the address;
   packages/app/src/root.tsx is where they are chosen between. */
/**
 * @template {ElementType} [W='button']
 * @param {ErrorPanelProps<W>} props
 */
export function ErrorPanel({ code = '404', title, children, wayOut, wayOutProps }) {
	/** @type {import('react').RefObject<HTMLHeadingElement | null>} */
	const heading = useRef(null);

	/* a client navigation that ends here leaves focus on a press that is no longer drawn, so the
	   reader is put on the heading, which a screen reader then reads out. keyed on the face and not
	   on mounting: packages/app/src/root.tsx draws its faces at one place in the tree, so a 404 that
	   turns into a 500 under the same boundary is this panel redrawn, and the press the reader was
	   on went with the 404. a redraw of the same face finds the reader wherever they have since
	   gone, and leaves them there. the heading is a place to land and no stop in the tab order,
	   hence `-1`. */
	useEffect(() => {
		heading.current?.focus();
	}, [code, title]);

	return (
		<PanelRoute>
			<p className="adm-caption adm-num">{code}</p>
			<h1 ref={heading} tabIndex={-1}>
				{title}
			</h1>
			<p className="adm-prose">{children}</p>
			{wayOut ? (
				<Control variant="primary" {...(wayOutProps ?? {})}>
					{wayOut}
				</Control>
			) : null}
		</PanelRoute>
	);
}
