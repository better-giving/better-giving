import { Mark } from '@better-giving/operator/components/status/Mark';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ProcessorLink } from './processor-links';

// the donation processor fold's panel: one row per processor, each the way to that processor's own
// screen (./stripe-section.tsx, ./paypal-section.tsx).
//
// **the panel reads nothing about an account.** what a processor's readings say, its keys and its
// presses are on its screen, so a row carries a name, whether the deployment holds its pair, and
// what it takes — all of it known before the deployment is asked anything (./processor-links.ts).
//
// `.adm-linkrows` in packages/operator/src/styles/adm.css draws it; the row's parts are the status
// line's own.

export type ProcessorRowsProps = {
	rows: readonly ProcessorLink[];
};

export function ProcessorRows({ rows }: ProcessorRowsProps): ReactNode {
	return (
		// biome-ignore lint/a11y/noRedundantRoles: the sheet takes the marker off every list, which stops a browser reporting this as one.
		<ul role="list" className="adm-linkrows">
			{rows.map((row) => (
				<li key={row.href}>
					<Link to={row.href} className="adm-linkrows__row">
						<span className="adm-status__body">
							<span className="adm-status__head">
								<span className="adm-status__label">{row.name}</span>
								{row.notSetUp ? <span className="adm-status__word">Not set up</span> : null}
							</span>
							<span className="adm-status__note">{row.takes}</span>
						</span>
						<span className="adm-status__caret">
							<Mark name="chevron-right" />
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
