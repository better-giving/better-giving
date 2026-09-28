import { formatOffer } from '@better-giving/form/money';
import type { BlockOf, PageGoal, PageMoney } from './types';

// how far a campaign is toward its goal. the figure is what the route hands over (`PageGoal`), and
// the words carry the whole reading; the track draws the same share and is hidden from a screen
// reader, which would otherwise hear it twice.

export function GoalBarBlock({
	block,
	goal,
	money
}: {
	readonly block: BlockOf<'goal-bar'>;
	readonly goal: PageGoal;
	readonly money: PageMoney;
}) {
	const raised = formatOffer(goal.raisedMinor, money.locale, money.currency);
	const total = formatOffer(goal.goalMinor, money.locale, money.currency);
	const share = Math.min(100, (goal.raisedMinor * 100) / goal.goalMinor);
	const meta = [
		goal.raisedMinor >= goal.goalMinor ? 'Goal reached' : null,
		goal.endsAt === null ? null : `Ends ${goal.endsAt}`
	].filter((part) => part !== null);
	const track = (
		<div className="page-goal-track" aria-hidden="true">
			<div className="page-goal-fill" style={{ inlineSize: `${share.toFixed(1)}%` }} />
		</div>
	);
	return (
		<div className="page-goal" data-variant={block.variant}>
			{block.variant === 'figure' ? (
				<>
					<p className="page-goal-raised">{raised}</p>
					<p className="page-goal-of">raised of {total} goal</p>
				</>
			) : (
				<p className="page-goal-figures">
					<span className="page-goal-raised">{raised}</span>{' '}
					<span className="page-goal-of">raised of {total}</span>
				</p>
			)}
			{track}
			{meta.length === 0 ? null : <p className="page-goal-meta">{meta.join(' · ')}</p>}
		</div>
	);
}
