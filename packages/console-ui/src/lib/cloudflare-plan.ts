import { PAID_PLAN_ANSWER, planAnswered } from '@better-giving/operator/delivery-pace';
import type { DeployValueName } from '@better-giving/operator/deploy-split';
import type { FeedsInUse } from '../api/types';
import type { AnswerSwitch } from './answer-switch';
import { switchEdit } from './answer-switch';
import type { HeldValues } from './held-values';

// the value that says the Cloudflare account is on the Workers Paid plan, the two positions the
// screen can put it in, what each of them writes, and when the answer is worth the operator's look.
//
// **it is one of ./answer-switch.ts's switches**, which argues the two positions and the door that
// refuses a third. no call reports the plan, and every spelling but one word reads as Free exactly
// as an absent value does (`planAnswered` in packages/operator/src/delivery-pace.ts). it is an
// answer about the account the deployment runs on, and nothing else is saved with it.
//
// **the plan is a concern only where it slows something down**: read as Free while a feed the
// minute cron paces is in use ({@link planConcern}). no call reports the plan, so the operator is
// the only one who can say the account is on the paid one, and a mark raised on every Free
// deployment would ask that of every organisation that delivers nothing at all.

/** the name whose value is an answer about the Cloudflare account rather than a credential. */
export const PAID_PLAN: DeployValueName = 'CLOUDFLARE_PAID_PLAN';

/** the one word the deployment reads as the paid plan, and the only value the switch ever posts. */
export const PLAN_PAID = PAID_PLAN_ANSWER;

/** what the press posts as its intent, and what its outcome is reported against. */
export const PLAN_INTENT = 'cloudflare:paid-plan';

/** the fetcher both of the plan block's presses post through, which is what their answer is read off. */
export const PLAN_FETCHER = 'cloudflare-plan';

/** the box the switch is drawn as, which is what the press reads its position off. */
export const PLAN_FIELD = 'cloudflare-paid-plan';

/** the paid-plan switch, as ./answer-switch-block.tsx draws it. */
export const PLAN_SWITCH: AnswerSwitch = {
	name: PAID_PLAN,
	word: PLAN_PAID,
	intent: PLAN_INTENT,
	field: PLAN_FIELD
};

/**
 * whether the plan is worth the operator's look: the deployment reads it as Free, and at least one
 * feed is in use, so something is being delivered at the Free plan's pace.
 *
 * read through `planAnswered`, the one reading both surfaces share, rather than against the word
 * this console writes, for the reason `charityApproved` in ./paypal-charity.ts states.
 *
 * **never where the answer is withheld** (./held-values.ts): the deployment reads a value this
 * console cannot, so it may be delivering at the paid pace. **never where `feeds` is `null`** — the
 * deployment did not say which feeds are in use (`HomeReading.feedsInUse` in ../api/types.ts), and a
 * mark standing over a reading that did not land is a claim nothing on this console can back.
 */
export const planConcern = (values: HeldValues, feeds: FeedsInUse | null): boolean =>
	feeds !== null &&
	!values.withheld.includes(PAID_PLAN) &&
	planAnswered(values.seeds[PAID_PLAN]) === 'free' &&
	Object.values(feeds).some((inUse) => inUse);

/** what one press of the switch puts on the deployment (`switchEdit` in ./answer-switch.ts). */
export const planEdit = (posted: FormData): Record<string, string | null> =>
	switchEdit(PLAN_SWITCH, posted);
