import { formatOffer } from '@better-giving/form/money';
import type { Page } from '../../page/catalog';
import type { PageMoney } from './types';

// what a gift of a stated amount does. statements, not choices: nothing here is pressable and
// nothing is drawn like the box's amount tiles, so a donor is never left pressing "$50" for nothing.
// the letter lists them in a rail beside the box; the feature stands each on a card of its own.

/** four tiers stand two by two; otherwise up to three abreast. */
const columns = (count: number) => (count === 4 ? 2 : Math.min(count, 3));

export function Tiers({
	tiers,
	money,
	shape
}: {
	readonly tiers: NonNullable<Page['tiers']>;
	readonly money: PageMoney;
	readonly shape: 'list' | 'cards';
}) {
	return (
		<div className="page-tiers" data-shape={shape}>
			<h2 className={shape === 'list' ? 'page-label' : 'page-heading'}>What your gift does</h2>
			<ul className="page-tiers-list" data-columns={columns(tiers.length)}>
				{tiers.map((tier, index) => (
					<li className="page-tier" key={index}>
						<span className="page-tier-amount">
							{formatOffer(tier.amountMinor, money.locale, money.currency)}
						</span>
						<span className="page-tier-buys">{tier.buys}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
