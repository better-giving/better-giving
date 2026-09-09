/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {object} EmptyStateProps
 * @property {ReactNode} [children]
 */

/* a sentence. sometimes with a link inside the sentence. nothing else — no illustration, no
   bordered box, no centred graphic with a call to action under it. dressing up a normal state
   tells the reader something went wrong. */
/** @param {EmptyStateProps} props */
export function EmptyState({ children }) {
	return <p className="adm-empty">{children}</p>;
}
