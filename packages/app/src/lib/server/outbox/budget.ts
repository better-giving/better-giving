// what the minute cron's one invocation may spend, and each feed's share of it. src/worker.ts runs
// ../accounting/deliver.ts, ../zapier/deliver.ts and ../webhooks/deliver.ts side by side in that
// invocation, so every limit below is theirs together, and a feed sized alone is sized wrong.
//
// **the limits are the Workers Free plan's**, the plan DEPLOY.md says runs this deployment, and a
// Paid plan's are higher on each: 50 external subrequests and 50 D1 queries per invocation
// (https://developers.cloudflare.com/workers/platform/limits/#subrequests,
// https://developers.cloudflare.com/d1/platform/limits/), and six requests waiting on their
// response headers at once, a seventh queueing with its timeout already running
// (https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections).
// a subrequest past the fiftieth throws inside the feed's post, where it reads as the receiver
// failing, so the shares are what keep a healthy receiver from being marked for this run's spend.
//
// **a `batch()` is one D1 query**: one call to the database, however many statements it carries.
// a post that is not a `fetch` — the SMTP connection a pause mail opens — is counted as an
// external subrequest and as a connection.
//
// **each outbox claims what its share pays for at its worst**: {@link claimsWithin} over the
// feed's {@link RunCost}, every row claimed posted and failing in the way that costs most. a feed
// whose run starts spending more per row changes its cost here in the same change, or its claims
// overrun its share.

/** requests an invocation may have waiting on their response headers at once. */
export const CONNECTIONS_AT_ONCE = 6;

/** of {@link CONNECTIONS_AT_ONCE}, kept for D1 and SMTP, so a query or a mail never queues behind posts. */
export const CONNECTIONS_KEPT = 1;

/** external subrequests one Free-plan invocation may make. */
export const EXTERNAL_SUBREQUESTS_PER_INVOCATION = 50;

/** D1 queries one Free-plan invocation may make. */
export const D1_QUERIES_PER_INVOCATION = 50;

/** of each per-invocation limit, left unspent by every share together. */
export const HEADROOM = 10;

/** one feed's share of the minute cron's invocation. */
export type Share = {
	/** posts in flight at once. */
	readonly lanes: number;
	/** external subrequests its run may make. */
	readonly external: number;
	/** D1 queries its run may make. */
	readonly queries: number;
};

/** every feed the minute cron runs, and its share. */
export const MINUTE_RUN = {
	zapier: { lanes: 2, external: 12, queries: 12 },
	webhooks: { lanes: 2, external: 12, queries: 17 },
	accounting: { lanes: 1, external: 16, queries: 11 }
} as const satisfies Readonly<Record<string, Share>>;

/** what one outbox run spends at its worst. */
export type RunCost = {
	/** D1 queries the run makes whatever it claims: its sweeps, its claim, its reads. */
	readonly queries: number;
	/** D1 queries per row claimed. */
	readonly queriesPerRow: number;
	/** external subrequests per row claimed. */
	readonly externalPerRow: number;
};

/** rows one claim may take and still keep its run inside `share`, at least one. */
export function claimsWithin(share: Share, cost: RunCost): number {
	return Math.max(
		1,
		Math.min(
			Math.floor(share.external / cost.externalPerRow),
			Math.floor((share.queries - cost.queries) / cost.queriesPerRow)
		)
	);
}

/**
 * `sendDueZapierEvents` in ../zapier/deliver.ts: the give-up sweep, the claim, the hooks, the gift
 * events, the refund events and their gifts, and the refunds still standing; per row, its outcome's
 * one batch, its post, and the pause sent to a Zap its failure ended.
 */
export const ZAPIER_RUN_COST: RunCost = { queries: 7, queriesPerRow: 1, externalPerRow: 2 };

/**
 * `sendDueWebhooks` in ../webhooks/deliver.ts: the claim, the destinations, and `renderSubjects`
 * in ../webhooks/payload.ts, seven reads at most; per row, its outcome's one batch, its post, and
 * the pause mail its failure sent — the organisation profile read and the SMTP connection.
 */
export const WEBHOOK_RUN_COST: RunCost = { queries: 9, queriesPerRow: 2, externalPerRow: 2 };

export const ZAPIER_CLAIMS_PER_RUN = claimsWithin(MINUTE_RUN.zapier, ZAPIER_RUN_COST);

export const WEBHOOK_CLAIMS_PER_RUN = claimsWithin(MINUTE_RUN.webhooks, WEBHOOK_RUN_COST);
