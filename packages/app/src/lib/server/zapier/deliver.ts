import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { zapierDelivery, zapierSubscription, type ZapierTrigger } from '../db/schema';
import { eachAtMost } from './each-at-most';
import {
	donorEventOf,
	type GiftEvent,
	readGiftEvents,
	readRefundEvents,
	type RefundEvent,
	type ZapierEvent
} from './payload';
import { endSubscriptionStatements } from './subscriptions';

// the Zapier outbox, delivered: what reads `zapier_delivery` and posts each row to its Zap's hook.
//
// ../accounting/deliver.ts is the same shape for the books and shares nothing with it on purpose:
// a gift owed to the books stays owed, while a notification to a Zap that has been down for three
// days is given up on. one backoff helper serving both would be one policy bent two ways.
//
// **a run posts only what it claimed.** the cron fires every minute and a run can outlast one, so
// two runs over one backlog is ordinary. the claim is a single UPDATE whose own `where` takes rows
// due and held by nobody, and only what it *returns* is posted — a second run's claim matches none
// of them. the lease is given back the moment the row's outcome is written; a run that died
// mid-post writes nothing, and its rows come back once the lease runs out.
//
// **delivery is at least once.** a post whose answer never came may have reached Zapier, and it is
// posted again, and the Zap runs again on it: Zapier dedupes a polling trigger's items on `id`,
// never a REST hook's posts (https://docs.zapier.com/integrations/build/deduplication). the
// payload's `id` is the same on every retry.
//
// where each answer lands:
//   2xx      — `sent`.
//   410      — the Zap is off or deleted (Zapier's REST-hook convention). its subscription is ended
//              `gone` and everything still owed to it dropped, in one batch; no retry.
//   anything
//   else     — a refusal, a network fault or a timeout. `attempts` goes up and the row waits out
//              {@link backoffMs}.
// a row still owed {@link GIVE_UP_AFTER_MS} after it was queued is `failed` at the next run's
// start, without another post; the console counts those and nothing re-queues one. one hook
// failing never stops the rest: every row's outcome is its own write.

/** everything one run needs, per invocation. `fetch` is handed in so a spec can answer for Zapier. */
export type ZapierDeliveryDeps = { readonly db: Db; readonly fetch: typeof fetch };

/** rows claimed per run, the longest-waiting first. */
const CLAIMS_PER_RUN = 50;

/** posts in flight at once. */
const POSTS_AT_ONCE = 6;

/** how long a hook is given to answer before the post counts as failed. */
const POST_TIMEOUT_MS = 10_000;

/**
 * how long a claimed row is the claiming run's alone, from that run's scheduled time. a claim of
 * hooks all timing out can take longer than this, and the run after may then take the row over, so
 * a run starts no post it cannot finish inside its lease and writes no outcome to a row it no
 * longer holds.
 */
const LEASE_MS = 2 * 60_000;

const BACKOFF_FIRST_MS = 60_000;

const BACKOFF_CEILING_MS = 60 * 60_000;

/**
 * how long after it was queued a row still owed is given up on. three days, the window the
 * processors themselves redeliver a webhook in.
 */
const GIVE_UP_AFTER_MS = 72 * 60 * 60_000;

/** how much of a refusal's body `last_error` keeps. */
const ERROR_BODY_CHARS = 200;

/**
 * how long a row that has failed `attempts` times, one or more, waits: doubling from a minute to
 * the ceiling.
 */
export function backoffMs(attempts: number): number {
	return Math.min(BACKOFF_CEILING_MS, BACKOFF_FIRST_MS * 2 ** (attempts - 1));
}

/**
 * one delivery run at `now`, the cron's scheduled time: claim what is due, render it, post it, and
 * write where each row landed. a fault reading or writing the database throws, and the rows it
 * held come back when their lease does.
 */
export async function sendDueZapierEvents(deps: ZapierDeliveryDeps, now: Date): Promise<void> {
	await giveUpOnStale(deps.db, now);
	const lease = new Date(now.getTime() + LEASE_MS);
	const claimed = await claimDue(deps.db, now, lease);
	if (claimed.length === 0) return;

	const hooks = await readHooks(deps.db, [...new Set(claimed.map((c) => c.subscriptionId))]);
	const isRefund = (row: Claimed) => hooks.get(row.subscriptionId)?.trigger === 'gift_refunded';
	const events: Events = {
		gifts: await readGiftEvents(
			deps.db,
			claimed.filter((c) => !isRefund(c)).map((c) => c.paymentId)
		),
		refunds: await readRefundEvents(
			deps.db,
			claimed.filter(isRefund).map((c) => c.paymentId)
		)
	};
	const gone = new Set<string>();

	await eachAtMost(POSTS_AT_ONCE, claimed, async (row) => {
		if (gone.has(row.subscriptionId)) return;
		const hook = hooks.get(row.subscriptionId);
		const event = hook === undefined ? undefined : eventFor(hook.trigger, row.paymentId, events);
		if (hook === undefined || event === undefined) {
			const missing =
				hook === undefined ? `subscription ${row.subscriptionId}` : `payment ${row.paymentId}`;
			await land(deps.db, row, lease, now, {
				status: 'failed',
				lastError: `The ${missing} this event was queued for could not be read.`
			});
			return;
		}

		// the wall clock, not `now`: what matters is whether a post started now can finish before
		// the next run may take the row. one that cannot is left for that run.
		if (lease.getTime() - Date.now() < POST_TIMEOUT_MS) return;
		const answer = await post(deps.fetch, hook.url, event);
		if (answer === 'gone') {
			gone.add(row.subscriptionId);
			await deps.db.batch(
				endSubscriptionStatements(deps.db, { id: row.subscriptionId }, 'gone', now)
			);
			return;
		}
		if (answer === 'taken') {
			await land(deps.db, row, lease, now, { status: 'sent', lastError: null });
			return;
		}
		await land(deps.db, row, lease, now, {
			nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts + 1)),
			lastError: answer.error
		});
	});
}

/**
 * every row still owed {@link GIVE_UP_AFTER_MS} after it was queued, `failed` without another post.
 * checked here rather than after a failed post, so a row whose runs never reach the post still
 * ends. the last failure's words stay; a row never tried gets its own. a leased row is left to the
 * run holding it.
 */
async function giveUpOnStale(db: Db, now: Date): Promise<void> {
	await db
		.update(zapierDelivery)
		.set({
			status: 'failed',
			lastError: sql`coalesce(${zapierDelivery.lastError}, ${NEVER_DELIVERED})`,
			leasedUntil: null,
			updatedAt: now
		})
		.where(
			and(
				eq(zapierDelivery.status, 'pending'),
				lte(zapierDelivery.createdAt, new Date(now.getTime() - GIVE_UP_AFTER_MS)),
				unleased(now)
			)
		);
}

const NEVER_DELIVERED = 'Not delivered within 72 hours of being queued.';

/** held by nobody: never leased, or the run that leased it is past its lease. */
function unleased(now: Date) {
	return or(isNull(zapierDelivery.leasedUntil), lte(zapierDelivery.leasedUntil, now));
}

type Claimed = Awaited<ReturnType<typeof claimDue>>[number];

/**
 * the due rows, leased to this run. a row value `in` because D1 has no `UPDATE … LIMIT`; the
 * subscription filter keeps a Zap that has ended from being posted to even if a row of its was
 * somehow left pending.
 */
function claimDue(db: Db, now: Date, lease: Date) {
	const due = db
		.select({ subscriptionId: zapierDelivery.subscriptionId, eventId: zapierDelivery.eventId })
		.from(zapierDelivery)
		.where(
			and(
				eq(zapierDelivery.status, 'pending'),
				lte(zapierDelivery.nextAttemptAt, now),
				unleased(now),
				inArray(
					zapierDelivery.subscriptionId,
					db
						.select({ id: zapierSubscription.id })
						.from(zapierSubscription)
						.where(isNull(zapierSubscription.endedAt))
				)
			)
		)
		.orderBy(asc(zapierDelivery.nextAttemptAt))
		.limit(CLAIMS_PER_RUN);

	return db
		.update(zapierDelivery)
		.set({ leasedUntil: lease, updatedAt: now })
		.where(sql`(${zapierDelivery.subscriptionId}, ${zapierDelivery.eventId}) in ${due}`)
		.returning({
			subscriptionId: zapierDelivery.subscriptionId,
			eventId: zapierDelivery.eventId,
			paymentId: zapierDelivery.paymentId,
			attempts: zapierDelivery.attempts
		});
}

type Hook = { readonly url: string; readonly trigger: ZapierTrigger };

/** each subscription's hook and trigger: at most `CLAIMS_PER_RUN` ids, under D1's parameter cap. */
async function readHooks(db: Db, ids: readonly string[]): Promise<Map<string, Hook>> {
	const rows = await db
		.select({
			id: zapierSubscription.id,
			url: zapierSubscription.hookUrl,
			trigger: zapierSubscription.trigger
		})
		.from(zapierSubscription)
		.where(inArray(zapierSubscription.id, [...ids]));
	return new Map(rows.map((r) => [r.id, { url: r.url, trigger: r.trigger }]));
}

/** the events one run renders, each keyed by the payment its row names. */
type Events = {
	readonly gifts: ReadonlyMap<string, GiftEvent>;
	readonly refunds: ReadonlyMap<string, RefundEvent>;
};

/** what a `trigger` Zap is posted about the payment its row names, or undefined where it could not be read. */
function eventFor(
	trigger: ZapierTrigger,
	paymentId: string,
	events: Events
): ZapierEvent[ZapierTrigger] | undefined {
	switch (trigger) {
		case 'new_gift':
			return events.gifts.get(paymentId);
		case 'new_donor': {
			const gift = events.gifts.get(paymentId);
			return gift === undefined ? undefined : donorEventOf(gift);
		}
		case 'gift_refunded':
			return events.refunds.get(paymentId);
	}
}

/**
 * one row's outcome, its lease given back — only while this run still holds that lease, and only
 * while the row is still `pending`. a run that overran its lease has lost the row to the run that
 * took it over, and a 410 on another of this Zap's rows can drop it while its own post is in
 * flight; either way the write is not this run's to make.
 */
async function land(
	db: Db,
	row: Claimed,
	lease: Date,
	now: Date,
	outcome:
		| { readonly status: 'sent' | 'failed'; readonly lastError: string | null }
		| { readonly nextAttemptAt: Date; readonly lastError: string }
): Promise<void> {
	await db
		.update(zapierDelivery)
		.set({ ...outcome, attempts: row.attempts + 1, leasedUntil: null, updatedAt: now })
		.where(
			and(
				eq(zapierDelivery.subscriptionId, row.subscriptionId),
				eq(zapierDelivery.eventId, row.eventId),
				eq(zapierDelivery.status, 'pending'),
				eq(zapierDelivery.leasedUntil, lease)
			)
		);
}

/**
 * what a hook answered: taken, gone — Zapier's 410 for a Zap switched off or deleted — or failed,
 * with the words `last_error` keeps.
 */
type HookAnswer = 'taken' | 'gone' | { readonly error: string };

/** the bare event, unsigned: the hook url is Zapier's own capability. */
async function post(fetcher: typeof fetch, hookUrl: string, event: unknown): Promise<HookAnswer> {
	try {
		const response = await fetcher(hookUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(event),
			signal: AbortSignal.timeout(POST_TIMEOUT_MS)
		});
		if (response.ok) {
			// an unread body holds its connection, and a run posts as many at once as a worker may
			// open. the post is taken either way, so a body that will not cancel is not a failure.
			await response.body?.cancel().catch(() => undefined);
			return 'taken';
		}
		if (response.status === 410) return 'gone';
		return { error: await refusal(response) };
	} catch (error) {
		return { error: String(error) };
	}
}

/** the status line and the head of the body a hook refused with. */
async function refusal(response: Response): Promise<string> {
	const line = `${response.status} ${response.statusText}`.trim();
	const body = (await response.text()).slice(0, ERROR_BODY_CHARS).trim();
	return body === '' ? line : `${line} — ${body}`;
}
