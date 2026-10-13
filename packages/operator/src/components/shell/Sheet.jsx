import { useId } from 'react';
import { Button } from '../controls/Button.jsx';
import { useTopLayer } from './top-layer.js';

/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {object} SheetProps
 * @property {ReactNode} [title] the heading, which the sheet is labelled by.
 * @property {ReactNode} [children] the body. it is the one part that scrolls.
 * @property {ReactNode} [foot] the row under the body — a sheet's Done, or its save. absent, none is
 *   drawn: a sheet whose picks apply as they are made has nothing to finish.
 * @property {() => void} onDismiss what the X and Escape answer with. a request rather than a close:
 *   the sheet exists while the caller renders it, so the caller answers by rendering it no longer.
 * @property {boolean | undefined} [wide] the dialog's measure at the right edge rather than the
 *   panel's, for a sheet holding two groups of fields side by side.
 * @property {boolean | undefined} [tall] the whole height a phone leaves it, whatever the body holds —
 *   for a body that grows while it is open, so the sheet does not climb the screen as it does.
 * @property {boolean | undefined} [stacked] opened from inside another sheet and standing over it. on
 *   a phone it stops a step lower, so the sheet it came from still shows above it, and it lays no
 *   second ground over the first.
 */

/* a modal panel: bottom on a phone, at the right edge from the wide breakpoint. the heading and its
   X across the top, the body under them, and the foot when there is one.

   **the sheet exists while it is rendered, and there is no open flag.** a caller mounts it on the
   press that opens it and unmounts it on `onDismiss`, which is what ./top-layer.js keys the lift and
   the focus return off — the control that opened the sheet is the one the reader is put back on.

   the way out is the X and Escape, and nothing else closes it: a press on the ground outside is not
   read as one, because a sheet holds typed values and a stray tap above a phone's keyboard would
   take them with it. there is no Back either — a sheet opened over another is closed back to it,
   which is the same X.

   the X is the last thing in the head so the heading is what a reader meets first, and the sheet
   takes the focus itself (./top-layer.js) rather than landing it on the X. */
/** @param {SheetProps} props */
export function Sheet({
	title,
	children,
	foot,
	onDismiss,
	wide = false,
	tall = false,
	stacked = false
}) {
	const heading = useId();
	const { ref } = useTopLayer();
	return (
		<dialog
			ref={ref}
			open
			tabIndex={-1}
			className={[
				'adm-sheet',
				wide ? 'adm-sheet--wide' : '',
				tall ? 'adm-sheet--tall' : '',
				stacked ? 'adm-sheet--stacked' : ''
			]
				.filter(Boolean)
				.join(' ')}
			aria-labelledby={heading}
			onCancel={(event) => {
				event.preventDefault();
				onDismiss();
			}}
		>
			<div className="adm-sheet__head">
				<h2 id={heading}>{title}</h2>
				<Button
					type="button"
					variant="quiet"
					size="sm"
					mark="x"
					aria-label="Close"
					onClick={onDismiss}
				/>
			</div>
			<div className="adm-sheet__body">{children}</div>
			{foot === undefined || foot === null ? null : <div className="adm-sheet__foot">{foot}</div>}
		</dialog>
	);
}
