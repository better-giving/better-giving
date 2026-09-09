import { part } from '@better-giving/form/parts';
import type { RefObject } from 'react';
import * as copy from './copy';

// the box the payment provider paints its own fields into, and the sentence written under it.
//
// the provider's fields are drawn in a frame on its own origin, so nothing here can reach one, name
// one or say which of them is unfinished. what this box owns is everything around that: a role and
// a name so the caret landing on it announces something, the sentence a refused press is given, and
// the tie between the two.
//
// the box carries no react children and never will. the provider's script appends into it, and a
// child rendered here would be a node react reconciles against a subtree it did not write.
// `createPaymentSurface` in ./machine.ts is what mounts into it; this file hands over the node.
//
// `aria-invalid` is deliberately absent: it is not a global attribute and `group` does not support
// it, so it would read as coverage and state nothing. the sentence reaches the box through
// `aria-describedby`, which is global — and that is one of the two channels a refusal travels,
// never the whole of it: a host that took the box off the screen and a browser that focuses no
// button on a click both leave the caret somewhere else, which is why the card says it out loud too.

const PROBLEM_ID = 'payment-problem';

export type PaymentBoxProps = {
	/** the node the provider mounts into, handed to the checkout rather than looked up. */
	readonly mount: RefObject<HTMLDivElement | null>;
	/**
	 * whether a provider is being prepared for this card at all.
	 *
	 * two empty rows above the button that spends the money read as a form still loading something,
	 * so the box is off the layout until the checkout has started. it is not narrower than that:
	 * `focus()` on a box with no layout box is a no-op the platform reports to nobody, and the review
	 * step's refusal announces itself by putting the caret here.
	 */
	readonly prepared: boolean;
	/** what the box says about itself: a refused press, or the reason a rail gave for the last try. */
	readonly words: string;
};

export function PaymentBox({ mount, prepared, words }: PaymentBoxProps) {
	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` is a grouping of this
			    document's own form controls, and what lands in this box is a payment provider's frame on
			    its own origin — there is no control of ours in it to group. the role and the name are
			    here because the caret is sent to this box by a refused press, and a generic with no name
			    announces nothing at all. */}
			<div
				ref={mount}
				part={part('payment')}
				role="group"
				aria-label={copy.PAYMENT_DETAILS}
				aria-describedby={words === '' ? undefined : PROBLEM_ID}
				tabIndex={-1}
				hidden={!prepared}
			/>
			<p className="message" id={PROBLEM_ID} hidden={words === ''}>
				{words}
			</p>
		</>
	);
}
