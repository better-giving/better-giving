import { DestructiveConfirm } from '@better-giving/operator/components/shell/DestructiveConfirm';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * the in-the-page destructive grammar: a banner that states the consequence and, beneath it, the
 * two controls that answer it.
 *
 * beneath and never inside, which is the rule this component exists to keep — a button drawn inside
 * the sentence explaining the consequence is a button pressed before the sentence is finished. the
 * specimens are all one shape for that reason, and what varies is the register and what is missing.
 *
 * `tone` is ../status/Banner.jsx's whole set, unnarrowed, so all four are drawn. the default is
 * `blocker` rather than `note`, which is the one place this component overrides the banner's own
 * default, and the two are next to each other here so the difference is visible. the tone also
 * picks the aria role and nothing on the screen shows it: a blocker is `role="alert"` and
 * interrupts a reader mid-sentence, the other three are `role="status"` and wait their turn
 * (packages/operator/src/components/status/Banner.jsx:37).
 *
 * `report` is what the last press answered with, between the question and the answer to it. it is
 * drawn only where the write can be refused in place — a confirmation whose write redirects has
 * none — so the specimen carrying one is a refusal, which is the case it exists for.
 *
 * `confirm` and `cancel` are a label each and the rest of what the control is, because what a
 * confirmation has to be is settled by the screen around it: a form's submit on one screen and a
 * navigation on the next. so one specimen hands both controls an element and an address through
 * `confirmProps` / `cancelProps`, and the ranks stay this component's — one coloured control in the
 * row and it is the destructive one.
 *
 * `cancel` has a default and `confirm` does not, so the specimen with neither label stated is a
 * "Keep it" beside an empty danger button, which is what a screen ships having wired the act and
 * forgotten to name it.
 *
 * the block takes whatever else is handed to it, which is what a screen opening this by a
 * navigation needs: the last specimen carries the `tabIndex`, role and name that make it a place
 * focus can land on and announce itself, and none of that is drawn.
 */
export default function ShellDestructiveConfirmPreview() {
	return (
		<div className="adm-stack">
			<DestructiveConfirm word="This will archive the winter appeal" confirm="Archive the form">
				The snippet stops working on every site it is pasted into. Donations already taken are kept,
				and so are the receipts.
			</DestructiveConfirm>

			<DestructiveConfirm
				tone="attention"
				word="This will end 42 recurring gifts"
				confirm="End the commitments"
			>
				Every donor giving monthly through this form stops being charged. Nothing is refunded and
				nobody is told — you would need to email them yourself.
			</DestructiveConfirm>

			<DestructiveConfirm
				tone="note"
				word="This removes an allowed origin"
				confirm="Remove the origin"
				cancel="Leave it"
			>
				The form stops loading on that site. Every other site keeps working.
			</DestructiveConfirm>

			<DestructiveConfirm tone="done" word="The form is archived" confirm="Undo" cancel="Done">
				It was archived a moment ago and can still be put back.
			</DestructiveConfirm>

			{/* the write that can be refused in place, read where the operator is standing rather than
			    at the top of the screen. */}
			<DestructiveConfirm
				word="This will replace the Stripe secret key"
				confirm="Replace the key"
				report={
					<StatusWord register="momentary" blocked mark="circle-alert">
						Stripe refused that key
					</StatusWord>
				}
			>
				The old key stops working the moment this deploys. A key that turns out to be wrong leaves
				this deployment unable to charge anything until a good one is set.
			</DestructiveConfirm>

			{/* both controls handed an element and an address, which is the pairing a screen that
			    confirms by navigating draws. */}
			<DestructiveConfirm
				word="This will delete the test deployment"
				confirm="Delete it"
				confirmProps={{ as: 'a', href: '#' }}
				cancel="Back to the deployment"
				cancelProps={{ as: 'a', href: '#' }}
			>
				The worker and its database are both removed. There is no test data on it worth keeping.
			</DestructiveConfirm>

			{/* nothing named. the banner draws both paragraphs whatever it was handed, and the
			    destructive control is a coloured box with no word in it. */}
			<DestructiveConfirm />

			<DestructiveConfirm
				tone="attention"
				word="This will turn off recurring gifts for the whole deployment"
				confirm="Turn recurring gifts off"
				cancel="Keep taking them"
			>
				Donors currently giving every month keep giving: their commitments are held at Stripe and
				are collected exactly as before. What changes is the form — the monthly and yearly choices
				stop being offered, so nobody new can start one. The served form config is cached at the
				edge, so a page a donor already has open may still show the choice for a few minutes, and a
				submission that arrives from one of those pages is charged rather than refused.
			</DestructiveConfirm>

			{/* the block as a place a navigation can move focus to: everything past the named props
			    reaches the outer element. */}
			<DestructiveConfirm
				tabIndex={-1}
				role="group"
				aria-label="Confirm archiving the kitchen fund"
				word="This will archive the kitchen fund"
				confirm="Archive the form"
			>
				Nothing has been given to this form yet, so nothing is lost.
			</DestructiveConfirm>
		</div>
	);
}
