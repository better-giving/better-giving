import { formatOffer } from '@better-giving/form/money';
import type { BlockOf, PageMoney } from './types';

// what a gift of a stated amount does. statements, not choices: nothing here is pressable and
// nothing is drawn like the box's amount tiles, so a donor is never left pressing "$50" for nothing.

/** four tiers stand two by two; otherwise up to three abreast. */
const columns = (count: number) => (count === 4 ? 2 : Math.min(count, 3));

export function ImpactTiersBlock({
	block,
	money
}: {
	readonly block: BlockOf<'impact-tiers'>;
	readonly money: PageMoney;
}) {
	return (
		<div className="page-tiers" data-variant={block.variant}>
			<h2 className="page-heading">What your gift does</h2>
			<ul className="page-tiers-list" data-columns={columns(block.tiers.length)}>
				{block.tiers.map((tier, index) => (
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
