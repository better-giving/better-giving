import { useEffect, useState } from 'react';

/**
 * @import { CSSProperties } from 'react'
 */

/**
 * @typedef {object} RouteProgressProps
 * @property {boolean} busy a navigation is running.
 */

/* top-bar-css's note: 5% when a navigation starts, toward 95% while it runs, 100% when it lands,
   and removed 300ms later. the line grows to each value over `--duration-slow`, which is 300ms, so
   it steps at that pace too, halving the distance left to 95% each time. */
const STEP_MS = 300;
const START = 5;
const CEILING = 95;

/* the route-load line across the top of the bar, for the top bar's `<header>`, which is its
   positioned ancestor. it is drawn only from a navigation's start until it has faded. */
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

	if (value === null) return null;
	return (
		<div
			className="ds-route-progress"
			role="progressbar"
			aria-label="Loading page"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(value)}
			style={/** @type {CSSProperties} */ ({ '--ds-route-progress': `${value}%` })}
		>
			<div className="ds-route-progress-bar" />
		</div>
	);
}
