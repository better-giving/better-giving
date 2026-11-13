import { formatOffer } from '@better-giving/form/money';
import type { PageMoney } from '../../donate/sections/types';
import * as copy from './copy';
import type { FundraiserTotals } from './types';

// what a live fundraiser has raised, on a plane: the figure, the goal and the gift count beside it,
// and the registry's goal bar (`progress-css`, packages/operator/src/registry/styles). no gift's
// amount is listed. at nothing the bar is `empty` and one line invites the first gift; at the goal
// or past it the bar is `met`, a badge says so over the figure, and one line says gifts are still
// open — the label may pass 100%, the fill and `aria-valuenow` stop there.

/** the whole percent of the goal raised, rounded down, uncapped: the registry's own arithmetic. */
export function percentOfGoal({ raisedMinor, goalMinor }: FundraiserTotals): number {
	return Math.floor((Math.max(0, raisedMinor) * 100) / goalMinor);
}

export function FundraiserRaised({
	totals,
	goalReached,
	money
}: {
	readonly totals: FundraiserTotals;
	readonly goalReached: boolean;
	readonly money: PageMoney;
}) {
	const percent = percentOfGoal(totals);
	const shown = Math.min(100, percent);
	const none = totals.gifts === 0;
	const label = copy.raisedOfGoal(
		formatOffer(totals.goalMinor, money.locale, money.currency),
		totals.gifts,
		money.locale
	);
	return (
		<div className="fundraiser-raised" data-area="raised">
			{goalReached ? (
				<p>
					<span className="ds-badge ds-badge-success">{copy.GOAL_REACHED}</span>
				</p>
			) : null}
			<p className="fundraiser-figures">
				<span className="fundraiser-figure">
					{formatOffer(totals.raisedMinor, money.locale, money.currency)}
				</span>{' '}
				<span className="fundraiser-figure-label">{label}</span>
			</p>
			<div className="ds-progress">
				<div
					className="ds-progress-track"
					data-state={goalReached ? 'met' : shown === 0 ? 'empty' : undefined}
					role="progressbar"
					aria-label={copy.AMOUNT_RAISED}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={shown}
					aria-valuetext={copy.ofGoal(percent)}
				>
					<div className="ds-progress-fill" style={{ width: `${shown}%` }} />
				</div>
				<span className="ds-progress-label" aria-hidden="true">
					{percent}%
				</span>
			</div>
			{none ? <p className="fundraiser-raised-note">{copy.NO_GIFTS_YET}</p> : null}
			{goalReached ? <p className="fundraiser-raised-note">{copy.STILL_OPEN}</p> : null}
		</div>
	);
}
