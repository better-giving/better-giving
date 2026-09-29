import {
	DELIVERY_PACE,
	type Feed,
	type Pace,
	type Plan,
	planAnswered
} from '@better-giving/operator/delivery-pace';
import { type ConfigEnv, readConfigEnv } from '../config/env';

// what the minute cron's one invocation may spend, each feed's share of it, and the pace each feed
// claims at on the plan the deployment runs on. src/worker.ts runs ../accounting/deliver.ts,
// ../zapier/deliver.ts and ../webhooks/deliver.ts side by side in that invocation, so every limit
// below is theirs together, and a feed sized alone is sized wrong.
//
// **the plan is the operator's answer, `CLOUDFLARE_PAID_PLAN`**: whether the Cloudflare account
// is on Workers Paid, a fact about the account that no call this deployment makes reports. unset,
// and any value but `true`, is Free — the plan that cannot be overrun by reading it wrong (see
// `planAnswered` in packages/operator/src/delivery-pace.ts). src/worker.ts reads it off each
// invocation's env, never once at module scope.
//
// **the per-invocation limits** (https://developers.cloudflare.com/workers/platform/limits/ and
// https://developers.cloudflare.com/d1/platform/limits/):
//
//   subrequests            — 50 on Free, 10,000 on Paid. a D1 query is a subrequest to an internal
//                            service too, and those are 1,000 on Free, so the tighter bound on
//                            queries is D1's own row below.
//   D1 queries             — 50 on Free, 1,000 on Paid.
//   connections at once    — six waiting on their response headers on either plan, a seventh
//                            queueing with its timeout already running.
//   CPU, a cron invocation — 10 ms on Free; 30 seconds on Paid at an interval under an hour.
//
// a subrequest past the limit throws inside the feed's post, where it reads as the receiver
// failing, so the shares are what keep a healthy receiver from being marked for this run's spend.
//
// **a `batch()` is counted as one D1 query**, and that is an assumption rather than a documented
// fact. D1's docs call a batch "a single call to the database"
// (https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), and say only that the
// per-query limits on size and length apply to each statement inside one
// (https://developers.cloudflare.com/d1/platform/limits/); whether the queries-per-invocation row
// counts the call or its statements they do not say. ./budget.workers.spec.ts counts on the same
// assumption. a post that is not a `fetch` — the SMTP connection a notice opens — is counted as an
// external subrequest and as a connection.
//
// **CPU is not budgeted.** posts, reads and mail are waits, which the CPU limit does not count;
// what a row costs in CPU — rendering, signing, the query builder — is unmeasured, so no run sized
// here is held to either plan's CPU limit, and Free's ten milliseconds are the one a Free run is
// likeliest to meet first.
//
// **each feed's share is of the Free invocation**, hand-set so the shares together leave
// {@link HEADROOM} of each limit unspent; on Paid each share is the same part of Paid's larger
// limits. a feed claims what its share pays for at its worst — {@link RunCost}, every row claimed
// taking the path that costs most — and never more than its {@link paceOf}: what its lanes answer
// in the minute before the next run, at {@link ANSWER_MS} an answer. on Free the share is what
// binds; on Paid the pace is.
//
// **the claims are {@link PACE}, a table in packages/operator** (`DELIVERY_PACE` in
// packages/operator/src/delivery-pace.ts), because the console states the same numbers and reaches
// no module here. ./budget.spec.ts holds that table equal to the lesser of {@link claimsWithin} and
// {@link paceOf} on each plan, so a feed whose run starts spending more per row changes its cost
// here and its number there in the same change, or the spec fails.

export type { Plan };

/** one invocation's limits on one plan. */
export type Limits = {
	/** external subrequests. */
	readonly external: number;
	/** D1 queries. */
	readonly queries: number;
};

export const PLAN_LIMITS: Readonly<Record<Plan, Limits>> = {
	free: { external: 50, queries: 50 },
	paid: { external: 10_000, queries: 1_000 }
};

/** requests an invocation may have waiting on their response headers at once, on either plan. */
export const CONNECTIONS_AT_ONCE = 6;

/** of {@link CONNECTIONS_AT_ONCE}, kept for D1 and SMTP, so a query or a mail never queues behind posts. */
export const CONNECTIONS_KEPT = 1;

/** of each Free limit, left unspent by every share together. */
export const HEADROOM = 5;

/** how long an answer a pace is sized for takes. */
export const ANSWER_MS = 3_000;

/** how often the cron runs, and so how long a run's claim has before the next run claims. */
const RUN_EVERY_MS = 60_000;

/** one feed's share of the minute cron's invocation on the Free plan. */
export type Share = {
	/** requests in flight at once. */
	readonly lanes: number;
	/** external subrequests its run may make. */
	readonly external: number;
	/** D1 queries its run may make. */
	readonly queries: number;
};

/** what one run of a feed spends at its worst, and what its ordinary row waits on. */
export type RunCost = {
	/** D1 queries the run makes whatever it claims: its sweeps, its claim, its reads, its notice. */
	readonly queries: number;
	/** external subrequests the run makes whatever it claims. */
	readonly external: number;
	/** D1 queries per row claimed. */
	readonly queriesPerRow: number;
	/** external subrequests per row claimed. */
	readonly externalPerRow: number;
	/** answers an ordinary row waits on, one after another: what its pace is sized for. */
	readonly answersPerRow: number;
};

/**
 * `sendDueZapierEvents` in ../zapier/deliver.ts: the give-up sweep, the claim, the hooks, the gift
 * events, the refund events and their gifts, and the refunds still standing; per row, its outcome's
 * one batch, its post, and the pause sent to a Zap its failure ended.
 */
export const ZAPIER_RUN_COST: RunCost = {
	queries: 7,
	external: 0,
	queriesPerRow: 1,
	externalPerRow: 2,
	answersPerRow: 1
};

/**
 * `sendDueWebhooks` in ../webhooks/deliver.ts: the claim, the destinations, and `renderSubjects`
 * in ../webhooks/payload.ts, seven reads at most; per row, its outcome's one batch, its post, and
 * the pause mail its failure sent — the organisation profile read and the SMTP connection.
 */
export const WEBHOOK_RUN_COST: RunCost = {
	queries: 9,
	external: 0,
	queriesPerRow: 2,
	externalPerRow: 2,
	answersPerRow: 1
};

/**
 * `sendDueEntries` in ../accounting/deliver.ts, against the QuickBooks adapter in
 * ../accounting/quickbooks.ts: the due read, the credential renewed and stored, the company's
 * currency read once, and the failing notice — its two reads, the organisation profile, its stamp
 * and the SMTP connection; per entry sent, its claim, `readSendable`'s reads in
 * ../accounting/record.ts, the credential read and the answer's write, and a retry's search of the
 * day's journal entries and deposits, a donor found by neither email nor name whose name is taken,
 * the customer made under a name of its own, and the journal entry. an ordinary gift waits on two
 * answers: its donor found by email, and its journal entry.
 *
 * the costliest path it leaves out: a day holding more than a thousand of the company's records,
 * which pages the retry's search, and a token refused mid-run, which renews once and asks again.
 */
export const ACCOUNTING_RUN_COST: RunCost = {
	queries: 6,
	external: 3,
	queriesPerRow: 10,
	externalPerRow: 8,
	answersPerRow: 2
};

/** every feed the minute cron runs: its share, and what its run costs. */
export const MINUTE_RUN = {
	zapier: { lanes: 2, external: 10, queries: 12 },
	webhooks: { lanes: 2, external: 8, queries: 17 },
	books: { lanes: 1, external: 11, queries: 16 }
} as const satisfies Readonly<Record<Feed, Share>>;

/** `share` of the Free invocation, as the same part of `plan`'s. */
export function shareOn(plan: Plan, share: Share): Share {
	const on = PLAN_LIMITS[plan];
	const free = PLAN_LIMITS.free;
	return {
		lanes: share.lanes,
		external: Math.floor((share.external * on.external) / free.external),
		queries: Math.floor((share.queries * on.queries) / free.queries)
	};
}

/** rows one run may take and still keep inside `share` at `cost`'s worst. */
export function claimsWithin(share: Share, cost: RunCost): number {
	return Math.min(
		Math.floor((share.external - cost.external) / cost.externalPerRow),
		Math.floor((share.queries - cost.queries) / cost.queriesPerRow)
	);
}

/** rows `share`'s lanes finish before the next run, each waiting on `cost`'s ordinary answers. */
export function paceOf(share: Share, cost: RunCost): number {
	return Math.floor((share.lanes * RUN_EVERY_MS) / (ANSWER_MS * cost.answersPerRow));
}

/** each feed's claim in one run on each plan, which the minute schedule makes its rate a minute. */
export const PACE: Readonly<Record<Plan, Pace>> = DELIVERY_PACE;

/** the plan `env` says the account is on (`planAnswered` in packages/operator/src/delivery-pace.ts). */
export function planOf(env: ConfigEnv): Plan {
	return planAnswered(env.CLOUDFLARE_PAID_PLAN);
}

/** what a screen tells an operator of how fast this deployment delivers. */
export type DeliveryPace = {
	readonly plan: Plan;
	readonly zapierPerMinute: number;
	readonly webhooksPerMinute: number;
	readonly booksPerMinute: number;
};

/** the plan the platform env `source` names, and each feed's deliveries a minute on it. */
export function deliveryPace(source: unknown): DeliveryPace {
	const plan = planOf(readConfigEnv(source));
	const pace = PACE[plan];
	return {
		plan,
		zapierPerMinute: pace.zapier,
		webhooksPerMinute: pace.webhooks,
		booksPerMinute: pace.books
	};
}
