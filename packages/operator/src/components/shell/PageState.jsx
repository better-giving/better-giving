import { useEffect, useRef, useState } from 'react';

/**
 * @import { ReactNode } from 'react'
 */

/**
 * what a page shows in place of its content, on page-state-css, centred in the shell's `<main>` so
 * the navigation stays.
 *
 * - `empty`: a collection with nothing in it yet. its title is an `h2`, under the page's own
 *   header, and it has no code.
 * - `not-found`: the 404. the title is the page's `h1`.
 * - `error`: the 500. the title and body are an alert, and it takes no action: a retry would not
 *   change the cause, so the type has nowhere to put one.
 * - `loading`: a spinner and its line, as a polite status.
 *
 * `focusTitle` moves focus to the title as the state is drawn, which is how a screen reader finds a
 * state a navigation landed on; the caller says when that is. it is the arrival's key (a router
 * location's `key`), and focus moves again whenever the key or the variant changes, so a second
 * failed navigation is found though the component stays mounted and its title reads the same;
 * `true` moves it on the first draw and on a change of variant alone.
 *
 * @typedef {(
 *   | { variant: 'empty' | 'not-found'; title: ReactNode; body?: ReactNode; action?: ReactNode; focusTitle?: string | boolean | undefined }
 *   | { variant: 'error'; title: ReactNode; body?: ReactNode; focusTitle?: string | boolean | undefined }
 *   | { variant: 'loading'; label: string }
 * )} PageStateProps
 */

/** @param {PageStateProps} props */
export function PageState(props) {
	if (props.variant === 'loading') return <Loading label={props.label} />;
	return <Stated {...props} />;
}

/** @param {Exclude<PageStateProps, { variant: 'loading' }>} props */
function Stated(props) {
	const { variant, title, body, focusTitle } = props;
	const action = 'action' in props ? props.action : undefined;
	const heading = useRef(/** @type {HTMLHeadingElement | null} */ (null));
	useEffect(() => {
		if (focusTitle) heading.current?.focus();
	}, [focusTitle, variant]);

	const Title = variant === 'empty' ? 'h2' : 'h1';
	const words = (
		<>
			<Title ref={heading} className="ds-page-state-title" tabIndex={-1}>
				{title}
			</Title>
			{body === undefined ? null : <p className="ds-page-state-body">{body}</p>}
		</>
	);

	if (variant === 'error')
		return (
			<div className="ds-page-state ds-page-state-error">
				<p className="ds-page-state-code">500</p>
				{/* the code stays outside the alert, so it is not read as part of it. */}
				<div className="ds-page-state-message" role="alert">
					{words}
				</div>
			</div>
		);
	return (
		<div className="ds-page-state">
			{variant === 'not-found' ? <p className="ds-page-state-code">404</p> : null}
			{words}
			{action === undefined ? null : <div className="ds-page-state-actions">{action}</div>}
		</div>
	);
}

/* the line is written into the region after the region is on the page, so it is announced
   (page-state-css's note). */
/** @param {{ label: string }} props */
function Loading({ label }) {
	const [said, setSaid] = useState('');
	useEffect(() => setSaid(label), [label]);
	return (
		<div className="ds-page-state ds-page-state-loading" role="status" aria-live="polite">
			<span className="ds-spinner" aria-hidden="true" />
			<span>{said}</span>
		</div>
	);
}
