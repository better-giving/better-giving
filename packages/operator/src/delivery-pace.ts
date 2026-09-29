// how fast this deployment delivers to Zapier, to webhook destinations and to QuickBooks, on the
// Cloudflare plan its account is on — and how the operator's answer about that plan is read.
//
// **it is here rather than beside the cron because both ends need it.** the minute cron claims at
// this pace (`PACE` in packages/app/src/lib/server/outbox/budget.ts), and the console states it to
// an operator deciding whether to say the account is on the paid plan — and the console reaches
// no module of the app. one table, in the leaf the two already share, for the reason
// ./deploy-split.ts is here.
//
// **the numbers are what the cron's shares of one invocation pay for, and not a preference.** each
// is the lesser of what the feed's share of the plan's published per-invocation limits pays for at
// its costliest and what its lanes answer in a minute (`claimsWithin` and `paceOf` in
// packages/app/src/lib/server/outbox/budget.ts), and `budget.spec.ts` beside it holds this table
// equal to them — so a feed whose run starts spending more per row fails there until the number
// here comes down with it.
//
// **the answer is `CLOUDFLARE_PAID_PLAN`** (./deploy-split.ts), a fact about the account no call
// the deployment makes reports. {@link planAnswered} is the one reading of it, on both surfaces.

/** the Cloudflare plan the deployment's account is on, as the operator answered. */
export type Plan = 'free' | 'paid';

/** a feed the minute cron delivers: Zapier's hooks, webhook destinations, and QuickBooks. */
export type Feed = 'zapier' | 'webhooks' | 'books';

/** rows each feed claims in one run, which the minute schedule makes its rate a minute. */
export type Pace = Readonly<Record<Feed, number>>;

/** each feed's pace on each plan. */
export const DELIVERY_PACE: Readonly<Record<Plan, Pace>> = {
	free: { zapier: 5, webhooks: 4, books: 1 },
	paid: { zapier: 40, webhooks: 40, books: 10 }
};

/** the one word the deployment reads as the paid plan, and the only one the console stores. */
export const PAID_PLAN_ANSWER = 'true';

/**
 * the plan `answer` names. {@link PAID_PLAN_ANSWER} in any case is Paid, the way the charity-rate
 * answer is read (`paypalFeeRules` in packages/app/src/lib/server/payments/fees.ts); every other
 * value, and none, is Free.
 *
 * it trims before it compares, whatever the caller did: the deployment hands it a value
 * `readConfigEnv` (packages/app/src/lib/server/config/env.ts) has already trimmed and the console
 * hands it the raw seed, so a `true ` left by a hand edit reads as one plan on both surfaces.
 *
 * read as Paid on a Free account, a run claims past what the invocation may spend and its posts past
 * the fiftieth fail as the receiver's; read as Free on a Paid one, deliveries go at the slower pace.
 * so an answer that is not the word falls to the plan that cannot overrun.
 */
export function planAnswered(answer: string | undefined): Plan {
	return answer?.trim().toLowerCase() === PAID_PLAN_ANSWER ? 'paid' : 'free';
}
