import { Mark } from '../status/Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 *
 * @typedef {object} DisclosureProps
 * @property {ReactNode} [summary]
 * @property {boolean | undefined} [open]
 * @property {ReactNode} [children]
 * @property {PointerState | undefined} [state]
 */

/* the state sits on the summary rather than on the `details`, because that is where
   packages/operator/src/styles/adm.css draws it: the caret and the ring are the summary's. */
/** @param {DisclosureProps} props */
export function Disclosure({ summary, open, children, state }) {
	return (
		<details className="adm-disclosure" open={open}>
			<summary className={state ? `is-${state}` : undefined}>
				<Mark name="chevron-right" />
				{summary}
			</summary>
			<div className="adm-disclosure__body">{children}</div>
		</details>
	);
}
