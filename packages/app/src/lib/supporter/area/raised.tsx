import { longDay, money, ofGoal } from './copy';

// what a page has raised against its goal: the figure, the goal and the gift count beside it, and
// the registry's progress bar (progress-css). the percent is worked out as its usage note says,
// whole and rounded down; past the goal the bar stays full and the label says the real figure.

/** what a page has raised, as the server reads it: a `SUM` at read time, in minor units. */
export type RaisedFigures = {
	readonly raisedMinor: number;
	readonly goalMinor: number;
	readonly gifts: number;
	readonly currency: string;
};

/** `Math.floor(value * 100 / max)`, the progress bar's whole percent. */
export const percentOf = (raisedMinor: number, goalMinor: number): number =>
	goalMinor <= 0 ? 0 : Math.floor((raisedMinor * 100) / goalMinor);

export function Raised({
	figures,
	endedAt
}: {
	readonly figures: RaisedFigures;
	/** where the line also says when the page ended, as a list card does: ISO 8601. */
	readonly endedAt?: string | null | undefined;
}) {
	const { raisedMinor, goalMinor, gifts, currency } = figures;
	const percent = percentOf(raisedMinor, goalMinor);
	const capped = Math.min(percent, 100);
	return (
		<>
			<p className="sa-stat">
				<span className="sa-figure">{money(raisedMinor, currency)}</span>
				<span className="sa-quiet">
					{ofGoal(money(goalMinor, currency), gifts)}
					{endedAt ? ` · ended ${longDay(endedAt)}` : null}
				</span>
			</p>
			<div className="ds-progress">
				<div
					className="ds-progress-track"
					data-state={percent >= 100 ? 'met' : percent === 0 ? 'empty' : undefined}
					role="progressbar"
					aria-label="Amount raised"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={capped}
					aria-valuetext={`${percent}% of goal`}
				>
					<div className="ds-progress-fill" style={{ width: `${capped}%` }} />
				</div>
				<span className="ds-progress-label" aria-hidden="true">
					{percent}%
				</span>
			</div>
		</>
	);
}
