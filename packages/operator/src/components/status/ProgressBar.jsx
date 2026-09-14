import { useEffect, useRef, useSyncExternalStore } from 'react';

import { endsWithin } from '../../motion-end';
import { progressBarFinishing, progressBarLanded, subscribeProgressBar } from '../../progress-bar';

/**
 * @typedef {object} ProgressBarProps
 * @property {string} label what is loading, and the status region's alone in both shapes: the line
 *   has no room for words, and the document's own bar has nothing on the screen to name.
 * @property {boolean} overMove the thin line over the page being left, rather than the braille
 *   cells a document draws as its own waiting face.
 */

/**
 * an operator screen's one progress bar, wherever it stands: filling while a reading is in flight,
 * and rushing to its end once the reading has landed.
 *
 * it takes two shapes, off packages/operator/src/styles/adm.css: the braille cells on the document's
 * own screen, and over a move (`overMove`) a thin line along the viewport's top edge, which the
 * page being left keeps its whole layout under. the rush puts the bar at full on its own last
 * instant, so its end is the bar arriving and the dwell after it is the bar being seen.
 * ../../progress-bar.ts is the signal between this and the loader waiting on it, because the screen
 * the reading is for has not rendered and there are no props between them.
 *
 * **it finishes, and is seen full, before the page changes.** the console's document mounts it
 * (packages/console-ui/src/root.tsx), and so does the dashboard's frame
 * (packages/app/src/routes/_app.tsx).
 *
 * @param {ProgressBarProps} props
 */
export function ProgressBar({ label, overMove }) {
	const finishing = useSyncExternalStore(
		subscribeProgressBar,
		progressBarFinishing,
		// a document rendered ahead of any reading has nothing read and nothing finished — the
		// console's build rendering index.html once (packages/console-ui/vite.config.ts).
		progressBarFinishing
	);
	const bar = useRef(/** @type {HTMLSpanElement | null} */ (null));

	useEffect(() => {
		const cells = bar.current;
		if (!finishing || cells === null) return;
		let landed = false;
		const land = () => {
			if (landed) return;
			landed = true;
			progressBarLanded();
		};
		/* the rush and the dwell after it are both drawn on `::before` and both dispatch their
		   `animationend` at the span, so the name is what tells them apart. `adm-dwell` is the
		   hold, and its end is the one that says the bar has been seen full
		   (packages/operator/src/styles/adm.css). */
		/** @param {AnimationEvent} e */
		const ended = (e) => {
			if (e.animationName === 'adm-dwell') land();
		};
		cells.addEventListener('animationend', ended);
		/* the backstop, for a hold no sheet reached this pseudo-element to run. it covers the rush
		   in front of the dwell as well as the dwell itself, which is why the delay is read beside
		   the duration (../../motion-end.ts). */
		const step = getComputedStyle(cells, '::before');
		const capped = setTimeout(land, endsWithin(step.animationDuration, step.animationDelay));
		return () => {
			cells.removeEventListener('animationend', ended);
			clearTimeout(capped);
		};
	}, [finishing]);

	return (
		/* polite, and the label is the one thing a reader of the tree gets: what the bar's rush
		   reports is that the wait is over, which the screen it is replaced by states in its own
		   words a moment later. the bar itself is decorative — its cells or its line are drawn by the
		   sheet and say nothing a reader could read — so it is hidden from the tree and the wrapper speaks
		   for it. */
		<div
			role="status"
			aria-label={overMove ? undefined : label}
			className={overMove ? 'adm-navigation-bar' : undefined}
		>
			{overMove ? <span className="adm-vh">{label}</span> : null}
			<span
				ref={bar}
				className={`${overMove ? 'adm-navigation-bar__line' : 'adm-braille-bar'}${finishing ? ' is-finishing' : ''}`}
				aria-hidden="true"
			/>
		</div>
	);
}
