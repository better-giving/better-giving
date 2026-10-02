// how fast this deployment delivers to Zapier, to webhook destinations and to QuickBooks.
//
// the minute cron claims at this pace (`PACE` in packages/app/src/lib/server/outbox/budget.ts),
// its one reader.
//
// **the numbers are what the cron's shares of one invocation pay for, and not a preference.** each
// is the lesser of what the feed's share of the Workers Paid per-invocation limits pays for at its
// costliest and what its lanes answer in a minute (`claimsWithin` and `paceOf` in
// packages/app/src/lib/server/outbox/budget.ts), and `budget.spec.ts` beside it holds this table
// equal to them — so a number here comes down when a feed's restated cost leaves its share unable
// to pay for it.

/** a feed the minute cron delivers: Zapier's hooks, webhook destinations, and QuickBooks. */
export type Feed = 'zapier' | 'webhooks' | 'books';

/** rows each feed claims in one run, which the minute schedule makes its rate a minute. */
export type Pace = Readonly<Record<Feed, number>>;

/** each feed's pace. */
export const DELIVERY_PACE: Pace = { zapier: 40, webhooks: 40, books: 10 };
