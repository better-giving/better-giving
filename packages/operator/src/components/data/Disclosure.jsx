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
 *
 * @typedef {object} AnchoredCardProps
 * @property {ReactNode} [children]
 *
 * @typedef {object} AnchoredPanelCardProps
 * @property {ReactNode} [children]
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

/* a card anchored to a mark inside a row: a terminal command, a copy control and an explanation. */
/** @param {AnchoredCardProps} props */
export function AnchoredCard({ children }) {
	return <div className="adm-anchored">{children}</div>;
}

/* the same card holding controls rather than an explanation, which is why it stands on the surface
   instead of the sunken band: a control drawing a ground of its own against the band is a box
   inside a box. what places it is ../../behaviour/AnchoredPanel.tsx. */
/** @param {AnchoredPanelCardProps} props */
export function AnchoredPanelCard({ children }) {
	return <div className="adm-anchored adm-anchored--panel">{children}</div>;
}
