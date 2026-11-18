import { useEffect, useState } from 'react';

/**
 * @import { CSSProperties } from 'react'
 */

/**
 * @typedef {object} RouteProgressProps
 * @property {boolean} busy a navigation is running.
 */

/* top-bar-css's note: 5% when a navigation starts, toward 95% while it runs, 100% when it lands,
   and removed once faded. the line grows to each value and fades over `--duration-slow`, so it
   steps at that pace, halving the distance left to 95% each time, and is removed that long after
   landing. a timer cannot read the token, so this restates it and must equal `--duration-slow` in
   ../../registry/styles/variables.css, which RouteProgress.dom.spec.tsx reads and times against. */
const STEP_MS = 300;
const START = 5;
const CEILING = 95;
const LABEL = 'Loading page';

/* the route-load line across the top of the bar, for the top bar's `<header>`, which is its
   positioned ancestor. it is drawn only from a navigation's start until it has faded.

   beside it stands the polite status a screen reader hears a navigation start in, for as long as
   this is mounted: a live region reports a change to its words and not its own arrival, so one
   mounted with the line would be missed. it empties as the navigation lands, so the next start is
   a change again. */
/** @param {RouteProgressProps} props */
export function RouteProgress({ busy }) {
	const [value, setValue] = useState(/** @type {number | null} */ (null));

	useEffect(() => {
		if (busy) {
			setValue(START);
			const step = setInterval(
				() => setValue((at) => (at ?? START) + (CEILING - (at ?? START)) / 2),
				STEP_MS
			);
			return () => clearInterval(step);
		}
		setValue((at) => (at === null ? null : 100));
		const gone = setTimeout(() => setValue(null), STEP_MS);
		return () => clearTimeout(gone);
	}, [busy]);

	return (
		<>
			<span className="ds-sr-only" role="status" aria-live="polite">
				{busy ? LABEL : ''}
			</span>
			{value === null ? null : (
				<div
					className="ds-route-progress"
					role="progressbar"
					aria-label={LABEL}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(value)}
					style={/** @type {CSSProperties} */ ({ '--ds-route-progress': `${value}%` })}
				>
					<div className="ds-route-progress-bar" />
				</div>
			)}
		</>
	);
}
