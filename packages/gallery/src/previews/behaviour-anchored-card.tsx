import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * the mark-triggered card, which is the machine and not the card.
 *
 * ./data-disclosure.tsx already draws `AnchoredCard` and `AnchoredPanelCard` — the boxes, at rest,
 * on the page, at the width the sheet caps them to. what is here is the different thing: the
 * trigger, the portal out of whatever the mark was rendered inside, and the positioner that writes
 * the `--available-width` packages/operator/src/styles/adm.css caps the card by. nothing in this
 * file draws a card at all.
 *
 * **the open card is not reachable from a prop.** the state is the machine's and `AnchoredNote`
 * (packages/operator/src/behaviour/AnchoredCard.tsx) states no `open` or `defaultOpen` of its own,
 * so every specimen below rests closed and a reader opens it with a press. that is the only state
 * this preview cannot pin, and the box that appears is the one ./data-disclosure.tsx already shows.
 *
 * it holds text and no control, which is what makes it a note: a press opens it and a dismissal
 * closes it, and nothing in it is left holding a value on the way out. the panel with controls
 * inside it is ./behaviour-anchored-panel.tsx.
 *
 * the portal is what these are for, so the marks are placed where a card would otherwise be
 * clipped: inline in a running sentence, and after a stated value in a row. the card lands on the
 * document body either way.
 *
 * `mark` is `MarkName`'s whole set and 22 specimens of the same machine would say nothing — the
 * shapes are ./status-mark.tsx's. what is drawn here is the two an operator screen actually hangs a
 * note off: `info` for a note about a value, and `circle-alert` for a value at fault.
 */
export default function BehaviourAnchoredCardPreview() {
	return (
		<div className="adm-stack">
			<p>
				A donation shows here before the money has settled{' '}
				<AnchoredNote mark="info" label="Why a donation appears before it settles">
					A card is authorised in a second and settles overnight. The figure at the top of the
					screen counts what settled, so a gift taken this evening is on the list before it is in
					the total.
				</AnchoredNote>{' '}
				and the total catches up the next morning.
			</p>

			<p>
				Recurring gifts <StatusWord unset>cannot be collected</StatusWord>{' '}
				<AnchoredNote mark="circle-alert" label="Why recurring gifts cannot be collected">
					Stripe tells this deployment that a monthly payment settled by calling the webhook
					endpoint, and the endpoint refuses every call it cannot verify. Without the signing secret
					no commitment is written down, so a donor who has agreed to give every month is charged
					and appears nowhere on these screens.
				</AnchoredNote>
			</p>

			{/* a note with nothing in it: the card opens onto an empty box, which is what a screen ships
			    when the sentence it was going to show was computed and came back blank. */}
			<p>
				The sender address is verified{' '}
				<AnchoredNote mark="info" label="About the verified sender address" />
			</p>
		</div>
	);
}
