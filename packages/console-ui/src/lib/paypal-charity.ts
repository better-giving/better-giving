import type { DeployValueName } from '@better-giving/operator/deploy-split';

// the one PayPal value that holds an answer rather than a credential, the two positions the screen
// can put it in, and what each of them writes.
//
// **it is a switch with two positions and there is no third.** PayPal reports on no call which rate
// an account is on, so the stored value is the whole of the answer — and every spelling but one word
// is the standard rate, `false` and `no` and `1` alike, exactly as an absent value is
// (`paypalFeeRules` in packages/app/src/lib/server/payments/fees.ts). so off is the name taken away
// rather than a stored no: a word stored for off would be a value this console draws a filled box
// over on a deployment priced at the standard rate, and a third shape to word with nothing true to
// say in it.
//
// **the console's door refuses every other spelling before cloudflare is asked** (`charityRate` in
// packages/console/internal/server/values.go). {@link charityEdit} is what makes a refusal there
// unreachable from this page rather than merely unlikely: the payload is composed from the switch's
// two positions, so no third thing can be carried whatever a box holds.
//
// **it is a press of its own and not part of the credentials group.** the three PayPal credentials
// are one press because an operator holds them off one PayPal app (`PAYPAL_GROUP` in
// ./secret-groups.ts); this is an answer about the organisation, given months after the keys are,
// and folding it into that press would make changing it a re-commit of every credential beside it.
//
// it is a module and not a literal in the section for ./stripe-confirm.ts's reason: this package has
// no DOM pool (../../vite.config.ts), so a reading left inside a component is one no case can hold.

/** the name whose value is an answer about the organisation rather than a credential. */
export const CHARITY_RATE: DeployValueName = 'PAYPAL_CHARITY_RATE_APPROVED';

/** the one word the deployment reads as yes, and the only value the switch ever posts. */
export const CHARITY_APPROVED = 'true';

/** what the press posts as its intent, and what its outcome is reported against. */
export const CHARITY_INTENT = 'paypal:charity-rate';

/** the box the switch is drawn as, which is what the press reads its position off. */
export const CHARITY_FIELD = 'paypal-charity-rate';

/**
 * whether the switch is drawn on, from the value the deployment is holding.
 *
 * read the way the deployment reads it rather than against the word this console writes: `True` is
 * an operator answering the question from a terminal rather than a different answer, and a screen
 * that drew it off would say standard rate over a deployment quoting the charity one. a save made
 * with the switch left on then stores the word in this console's own spelling, which is a
 * normalisation of the answer already on the screen rather than a change to it.
 */
export const charityApproved = (seed: string): boolean => seed.toLowerCase() === CHARITY_APPROVED;

/**
 * what one press of the switch puts on the deployment.
 *
 * **it is composed from the two positions and never from what the box holds**, which is what keeps
 * a third thing off the wire: a ticked box carries the one word and an unticked one carries nothing,
 * and anything else a body claimed lands on the same two answers this screen has.
 *
 * `null` is what deletes a name, so off is the same one call on as.
 */
export const charityEdit = (posted: FormData): Record<string, string | null> => ({
	[CHARITY_RATE]: posted.get(CHARITY_FIELD) === CHARITY_APPROVED ? CHARITY_APPROVED : null
});
