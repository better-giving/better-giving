import { Disclosure } from '@better-giving/operator/components/data/Disclosure';

/*
 * the summary that opens in place.
 *
 * a collapsible is worth nothing shut, so it is drawn both ways — and the open one is the only
 * specimen that shows the caret turned and `.adm-disclosure__body` at all.
 *
 * the two pointer states are pinned by class rather than reached.
 * packages/operator/src/styles/adm.css draws `.adm-disclosure > summary` a hover twin and a focus
 * twin and stops there, and a summary has no unavailable state behind it to draw a third from.
 *
 * `summary` and `children` may each be absent. the empty-bodied one is the state a screen ships
 * when the thing it was going to reveal turned out to be nothing: a caret that opens onto a gap.
 */
export default function DataDisclosurePreview() {
	return (
		<div className="adm-stack">
			<Disclosure summary="What a receipt says">
				<p>
					Every receipt carries the amount, the date, the organisation&rsquo;s registered name and
					number, and the reference a donor quotes if they ask about the gift.
				</p>
			</Disclosure>
			<Disclosure summary="What a receipt says" open>
				<p>
					Every receipt carries the amount, the date, the organisation&rsquo;s registered name and
					number, and the reference a donor quotes if they ask about the gift.
				</p>
			</Disclosure>
			<Disclosure
				open
				summary="Why a donation can appear here before the money has settled and what that means for the figure at the top of this screen"
			>
				<p>
					A card is authorised in a second and settles overnight. The figure counts what settled, so
					a gift taken this evening is on the list before it is in the total.
				</p>
			</Disclosure>
			<Disclosure summary="A disclosure whose body turned out to be empty" open />
			<Disclosure open>
				<p>No summary, so the caret stands alone and nothing names what it opens.</p>
			</Disclosure>
			<Disclosure summary="hover" state="hover" />
			<Disclosure summary="focus" state="focus" />
		</div>
	);
}
