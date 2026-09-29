import type { DeployValueName } from '@better-giving/operator/deploy-split';
import type { AnswerSwitch } from './answer-switch';
import { switchEdit } from './answer-switch';

// the one PayPal value that holds an answer rather than a credential, the two positions the screen
// can put it in, and what each of them writes.
//
// **it is one of ./answer-switch.ts's switches**, which argues the two positions and the door that
// refuses a third. PayPal reports on no call which rate an account is on, and the deployment reads
// every spelling but one word as the standard rate, `false` and `no` and `1` alike, exactly as an
// absent value (`paypalFeeRules` in packages/app/src/lib/server/payments/fees.ts).
//
// **it is a press of its own and not part of the credentials group.** the PayPal credentials and
// their address are one press because an operator holds them off one PayPal app (`PAYPAL_GROUP` in
// ./secret-groups.ts); this is an answer about the organisation, given months after the keys are.
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

/** the charity-rate switch, as ./answer-switch-block.tsx draws it. */
export const CHARITY_SWITCH: AnswerSwitch = {
	name: CHARITY_RATE,
	word: CHARITY_APPROVED,
	intent: CHARITY_INTENT,
	field: CHARITY_FIELD
};

/**
 * whether the switch is drawn on, from the value the deployment is holding.
 *
 * read the way the deployment reads it rather than against the word this console writes — trimmed
 * (`readConfigEnv` in packages/app/src/lib/server/config/env.ts) and in any case: `True` is an
 * operator answering the question from a terminal rather than a different answer, and a screen that
 * drew it off would say standard rate over a deployment quoting the charity one. a save made with
 * the switch left on then stores the word in this console's own spelling, which is a normalisation
 * of the answer already on the screen rather than a change to it.
 */
export const charityApproved = (seed: string): boolean =>
	seed.trim().toLowerCase() === CHARITY_APPROVED;

/** what one press of the switch puts on the deployment (`switchEdit` in ./answer-switch.ts). */
export const charityEdit = (posted: FormData): Record<string, string | null> =>
	switchEdit(CHARITY_SWITCH, posted);
