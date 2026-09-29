import type { Pace } from '@better-giving/operator/delivery-pace';
import {
	DELIVERY_PACE,
	PAID_PLAN_ANSWER,
	planAnswered
} from '@better-giving/operator/delivery-pace';
import type { DeployValueName } from '@better-giving/operator/deploy-split';

// the value that says the Cloudflare account is on the Workers Paid plan, the two positions the
// screen can put it in, what each of them writes, and the pace a screen states while it is off.
//
// **it is a switch with two positions and there is no third**, on the terms ./paypal-charity.ts
// states for the charity rate: no call reports the plan, so the stored value is the whole of the
// answer, every spelling but one word reads as Free exactly as an absent value does (`planAnswered`
// in packages/operator/src/delivery-pace.ts), and off is the name taken away rather than a stored
// no. the console's door refuses every other spelling before cloudflare is asked
// (`answerSwitches` in packages/console/internal/server/values.go), and {@link planEdit} composes
// the payload from the two positions so no third thing can be carried whatever a box holds.
//
// **it is a press of its own and in no group** (./deploy-vars.ts): it is an answer about the
// account the deployment runs on, and nothing else is saved with it.
//
// **the pace is the table the minute cron claims at**, read from packages/operator rather than
// typed here, so a number a screen states is the number the deployment delivers at.

/** the name whose value is an answer about the Cloudflare account rather than a credential. */
export const PAID_PLAN: DeployValueName = 'CLOUDFLARE_PAID_PLAN';

/** the one word the deployment reads as the paid plan, and the only value the switch ever posts. */
export const PLAN_PAID = PAID_PLAN_ANSWER;

/** what the press posts as its intent, and what its outcome is reported against. */
export const PLAN_INTENT = 'cloudflare:paid-plan';

/** the box the switch is drawn as, which is what the press reads its position off. */
export const PLAN_FIELD = 'cloudflare-paid-plan';

/**
 * the Free plan's pace where `seed` — the value the deployment is holding — reads as Free, and
 * `null` once it reads as paid, which is when a notice naming that pace goes.
 *
 * read the way the deployment reads it rather than against the word this console writes, for the
 * reason `charityApproved` in ./paypal-charity.ts states.
 */
export const freePlanPace = (seed: string): Pace | null =>
	planAnswered(seed) === 'free' ? DELIVERY_PACE.free : null;

/**
 * what one press of the switch puts on the deployment: the one word where it is ticked, and `null`
 * — the name taken off — where it is not.
 */
export const planEdit = (posted: FormData): Record<string, string | null> => ({
	[PAID_PLAN]: posted.get(PLAN_FIELD) === PLAN_PAID ? PLAN_PAID : null
});
