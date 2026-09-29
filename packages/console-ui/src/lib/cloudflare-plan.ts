import type { Feed, Pace } from '@better-giving/operator/delivery-pace';
import {
	DELIVERY_PACE,
	PAID_PLAN_ANSWER,
	planAnswered
} from '@better-giving/operator/delivery-pace';
import type { DeployValueName } from '@better-giving/operator/deploy-split';
import type { AnswerSwitch } from './answer-switch';
import { switchEdit } from './answer-switch';
import type { HeldValues } from './held-values';

// the value that says the Cloudflare account is on the Workers Paid plan, the two positions the
// screen can put it in, what each of them writes, and the pace a screen states while it is off.
//
// **it is one of ./answer-switch.ts's switches**, which argues the two positions and the door that
// refuses a third. no call reports the plan, and every spelling but one word reads as Free exactly
// as an absent value does (`planAnswered` in packages/operator/src/delivery-pace.ts). it is an
// answer about the account the deployment runs on, and nothing else is saved with it.
//
// **the pace is the table the minute cron claims at**, read from packages/operator rather than
// typed here, so a number a screen states is the number the deployment delivers at.
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
 * the Free plan's pace where the value the deployment is holding reads as Free, and `null` where
 * it reads as paid — which is when a notice naming that pace goes.
 *
 * read through `planAnswered`, the one reading both surfaces share, rather than against the word
 * this console writes, for the reason `charityApproved` in ./paypal-charity.ts states.
 *
 * **`null` as well where the value is withheld** (./held-values.ts): the deployment reads a value
 * this console cannot, so the pace it delivers at is not one a screen can state.
 */
export const freePlanPace = (values: HeldValues): Pace | null => {
	if (values.withheld.includes(PAID_PLAN)) return null;
	return planAnswered(values.seeds[PAID_PLAN]) === 'free' ? DELIVERY_PACE.free : null;
};

/**
 * whether each feed the minute cron paces is in use on this deployment, and `null` for one this
 * console could not read.
 */
export type FeedsInUse = Readonly<Record<Feed, boolean | null>>;

/**
 * whether the plan is worth the operator's look: the deployment reads it as Free, and at least one
 * feed is in use, so something is being delivered at the Free plan's pace.
 *
 * a withheld answer is never a concern, for the reason {@link freePlanPace} states, and a feed that
 * could not be read never raises one: a mark standing over a reading that did not land is a claim
 * nothing on this console can back.
 */
export const planConcern = (values: HeldValues, feeds: FeedsInUse): boolean =>
	freePlanPace(values) !== null && Object.values(feeds).some((inUse) => inUse === true);

/** what one press of the switch puts on the deployment (`switchEdit` in ./answer-switch.ts). */
export const planEdit = (posted: FormData): Record<string, string | null> =>
	switchEdit(PLAN_SWITCH, posted);
