import { PageState } from '@better-giving/operator/components/shell/PageState';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type ReactNode, useEffect, useRef } from 'react';
import { LOGS_SAY_WHY } from '$lib/deployment-logs';

// what a failed answer draws in place of its page, inside the operator shell
// (../routes/_app.tsx) or on its own (../root.tsx): page-state-css's 404 and 500, and for any other
// refusal the same error layout under the status the answer carried, since `PageState` states
// no code but 404 and 500.
//
// a boundary draws this only where a navigation landed on the failure, so drawn is landed: the
// title takes focus as it is drawn, and again on each arrival the boundary stays mounted for, or
// focus would stay on the link that was pressed and a screen reader would say nothing changed.

/** the tab's words for `status`, which are the state's title. */
export function errorTitle(status: number, donor: boolean): string {
	if (status === 404) return 'No such page';
	if (status >= 400 && status < 500) return 'This request was refused';
	return donor ? 'This donation page couldn’t load' : 'This deployment could not answer';
}

/**
 * the state for `status`. `message` is the answer's own sentence where it carried one, read as
 * marked text; `way` is the 404's action, absent on a donor's page; `donor` swaps the 500's
 * operator words for a donor's; `arrival` is the landed location's `key`, and the title takes
 * focus whenever it changes.
 */
export function ErrorState({
	status,
	message,
	arrival,
	way,
	donor = false
}: {
	readonly status: number;
	readonly message: string;
	readonly arrival: string;
	readonly way?: ReactNode;
	readonly donor?: boolean;
}) {
	const title = errorTitle(status, donor);
	if (status === 404)
		return (
			<PageState
				variant="not-found"
				title={title}
				body="It may have been deleted, or the address may be wrong."
				action={way}
				focusTitle={arrival}
			/>
		);

	if (status >= 400 && status < 500)
		return <Refused status={status} title={title} message={message} arrival={arrival} />;

	return (
		<PageState
			variant="error"
			title={title}
			body={
				donor ? (
					'Please try again in a moment.'
				) : (
					<MarkedText text={message || `Nothing more is known here. ${LOGS_SAY_WHY}`} />
				)
			}
			focusTitle={arrival}
		/>
	);
}

/**
 * page-state-css's error layout under the answer's own status: `PageState`'s error variant is the
 * 500 alone. its title takes focus as `PageState`'s does, on each arrival.
 */
function Refused({
	status,
	title,
	message,
	arrival
}: {
	readonly status: number;
	readonly title: string;
	readonly message: string;
	readonly arrival: string;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	// keyed on the arrival, so a second refusal in the same boundary moves focus again.
	useEffect(() => {
		heading.current?.focus();
	}, [arrival]);
	return (
		<div className="ds-page-state ds-page-state-error">
			<p className="ds-page-state-code">{status}</p>
			<div className="ds-page-state-message" role="alert">
				<h1 ref={heading} className="ds-page-state-title" tabIndex={-1}>
					{title}
				</h1>
				<p className="ds-page-state-body">
					<MarkedText text={message || 'Nothing more is known about why. Go back and try again.'} />
				</p>
			</div>
		</div>
	);
}
