import { inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { zapierDelivery, zapierSubscription, type ZapierTrigger } from '../db/schema';
import { inPage } from '../db/id-set';
import { REFUND_NO_LONGER_STANDS, readStandingRefunds } from '../integrations/refund';
import { MINUTE_RUN, PACE } from '../outbox/budget';
import { defineFailing } from '../outbox/failing';
import { defineOutbox, type Outcome } from '../outbox/lease';
import { refusal } from '../outbox/refusal';
import { askedWait } from '../outbox/retry-after';
import {
	donorEventOf,
	type GiftEvent,
	readGiftEvents,
	readRefundEvents,
	type RefundEvent,
	type ZapierEvent
} from './payload';
import { endSubscriptionStatements, pauseZaps } from './subscriptions';

// the Zapier outbox, delivered: what reads `zapier_delivery` and posts each row to its Zap's hook.
//
// **the lease is ../outbox/lease.ts's; the policy is this module's.** which rows a run takes, how
// long they are its alone, when it may start a post, and the guarded write that lets each go are
// the lease module's, and two runs over one backlog post each row once because of it. a claim
// takes every Zap's longest-waiting row before any Zap's next among the due rows that have waited
// longest, `CANDIDATES_PER_CLAIMED_ROW` of them per row claimed (../outbox/lease.ts): a Zap's
// backlog shares a claim with another's gifts while it is shorter than that window, and one that
// fills it holds them up until it drains below it. when a hook has been failing long enough to end
// is ../outbox/failing.ts's. what each answer means, how long a failure waits, and when a row is
// given up on are decided here.
// ../accounting/deliver.ts shares none of that policy on purpose: a gift owed to the books stays
// owed, while a notification to a Zap that has been down for three days is given up on. one
// backoff serving both would be one policy bent two ways.
//
// **delivery is at least once.** a post whose answer never came may have reached Zapier, and it is
// posted again, and the Zap runs again on it: Zapier dedupes a polling trigger's items on `id`,
// never a REST hook's posts (https://docs.zapier.com/integrations/build/deduplication). the
// payload's `id` is the same on every retry.
//
// where each answer lands:
//   2xx      — `sent`, and the hook's run of failures, if it was on one, is over.
//   410      — the Zap is off or deleted (Zapier's REST-hook convention). its subscription is ended
//              `gone` and everything still owed to it dropped, in one batch; no retry.
//   429      — a failure, below, except that the row waits at least as long as the hook's
//              `Retry-After` asks (../outbox/retry-after.ts), and never past the moment the row is
//              given up on. the hook's rows this run has not yet posted wait for the same time,
//              unposted.
//   anything
//   else     — a failure: any other status, a network fault or a timeout. `attempts` goes up, the
//              row waits out {@link backoffMs}, and the hook's `failing_since` marks the start of
//              its run of failures — the mark and the row's outcome in one batch. a hook that
//              never answers is as dead as one that refuses.
// **a hook that fails a post is posted nothing more in that run.** the rows it is owed that the run
// holds and has not yet started are given back unposted, due as they were and their attempts as
// they stand, so a hook answering at {@link POST_TIMEOUT_MS} costs the run a post per lane rather
// than the run's time, and the hooks beside it in the claim are still posted. a row given back is
// no failed post: it neither marks the hook nor counts toward ending it, and it is posted by the
// next run that claims it.
// a hook ends the way a 410 ends it once every post to it has failed for {@link GIVE_UP_AFTER_MS}
// and none was taken, on the failure of a row that had failed before. when a mark counts toward
// that, and when a failure starts a run of its own instead, is ../outbox/failing.ts's: a mark left
// by rows that all left the outbox untaken never ends a hook that has since recovered.
// `ended_reason` has no value of its own for that end, so it reads `gone`, and each row dropped
// with it says why in `last_error`. Zapier, unlike after a 410, does not know, so the Zap is then
// paused the way a replaced key pauses every Zap (`pauseZaps` in ./subscriptions.ts).
//
// **a row still owed {@link GIVE_UP_AFTER_MS} after it was queued is `failed`**, without another
// post, in the claim's own batch ahead of it (a standing sweep, ../outbox/lease.ts); ./report.ts
// counts those and nothing re-queues one. one hook failing never stops the rest: every row's
// outcome is its own write.
//
// **a `gift_refunded` row is sent only while its refund still stands**, read at send
// (`readStandingRefunds` in ../integrations/refund.ts) as well as at queueing. a refund that
// failed after it was queued, or a dispute whose loss no longer holds, is `dropped` unposted, with
// the reason in `last_error`: no event follows it, so posting it would leave a Zap acting on money
// that came back. what already went out stays out. a `new_gift` row is sent as it happened,
// because a refund of it since is an event of its own.

/**
 * everything one run needs, per invocation. `fetch` is handed in so a spec can answer for Zapier.
 * a run claims this feed's pace (../outbox/budget.ts), each Zap's longest-waiting row first
 * within the claim's window (../outbox/lease.ts), and a row no lane reached stays leased,
 * unposted, until the lease runs out and a later run takes it.
 */
export type ZapierDeliveryDeps = {
	readonly db: Db;
	readonly fetch: typeof fetch;
};

/** posts in flight at once: this feed's share of the minute cron's connections (../outbox/budget.ts). */
const POSTS_AT_ONCE = MINUTE_RUN.zapier.lanes;

/** how long a hook is given to answer before the post counts as failed. */
export const POST_TIMEOUT_MS = 10_000;

/** how long a claimed row is the claiming run's alone, from that run's scheduled time. */
const LEASE_MS = 2 * 60_000;

const BACKOFF_FIRST_MS = 60_000;

const BACKOFF_CEILING_MS = 60 * 60_000;

/**
 * how long after it was queued a row still owed is given up on, and how long every post to a hook
 * may fail before it is ended. three days, the window the processors themselves redeliver a
 * webhook in.
 */
const GIVE_UP_AFTER_MS = 72 * 60 * 60_000;

const outbox = defineOutbox({
	table: zapierDelivery,
	key: { subscriptionId: zapierDelivery.subscriptionId, eventId: zapierDelivery.eventId },
	leaseMs: LEASE_MS,
	attemptMs: POST_TIMEOUT_MS,
	lanes: POSTS_AT_ONCE,
	receiver: zapierDelivery.subscriptionId
});

const failing = defineFailing({
	table: zapierSubscription,
	outbox: { table: zapierDelivery, receiver: zapierDelivery.subscriptionId },
	open: isNull(zapierSubscription.endedAt),
	stopAfterMs: GIVE_UP_AFTER_MS
});

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
	const claim = await claimDue(deps.db, now, PACE.zapier);
	const claimed = claim.rows;
	if (claimed.length === 0) return;

	const hooks = await readHooks(
		deps.db,
		claimed.map((c) => c.subscriptionId)
	);
	const isRefund = (row: Claimed) => hooks.get(row.subscriptionId)?.trigger === 'gift_refunded';
	const refundIds = claimed.filter(isRefund).map((c) => c.paymentId);
	const events: Events = {
		gifts: await readGiftEvents(
			deps.db,
			claimed.filter((c) => !isRefund(c)).map((c) => c.paymentId)
		),
		refunds: await readRefundEvents(deps.db, refundIds)
	};
	const standing = await readStandingRefunds(deps.db, refundIds);
	const gone = new Set<string>();
	// each hook that answered 429 with a time, and when its rows this run holds are next due.
	const throttled = new Map<string, Date>();
	const failedThisRun = new Set<string>();
	const landing = (row: Claimed, outcome: Outcome<typeof zapierDelivery>) =>
		claim.landing(row, { ...outcome, attempts: row.attempts + 1, updatedAt: now });
	const land = (row: Claimed, outcome: Outcome<typeof zapierDelivery>) =>
		deps.db.batch([landing(row, outcome)]);

	await claim.each(async (row) => {
		if (gone.has(row.subscriptionId)) return;
		const heldUntil = throttled.get(row.subscriptionId);
		if (heldUntil !== undefined) {
			await claim.land(row, { nextAttemptAt: heldUntil, updatedAt: now });
			return;
		}
		if (failedThisRun.has(row.subscriptionId)) {
			await claim.land(row, { updatedAt: now });
			return;
		}
		const hook = hooks.get(row.subscriptionId);
		const event = hook === undefined ? undefined : eventFor(hook.trigger, row.paymentId, events);
		if (hook === undefined || event === undefined) {
			const missing =
				hook === undefined ? `subscription ${row.subscriptionId}` : `payment ${row.paymentId}`;
			await land(row, {
				status: 'failed',
				lastError: `The ${missing} this event was queued for could not be read.`
			});
			return;
		}
		if (hook.trigger === 'gift_refunded' && !standing.has(row.paymentId)) {
			await land(row, { status: 'dropped', lastError: REFUND_NO_LONGER_STANDS });
			return;
		}

		const answer = await post(deps.fetch, hook.url, event);
		if (answer === 'gone') {
			gone.add(row.subscriptionId);
			await deps.db.batch(
				endSubscriptionStatements(deps.db, { id: row.subscriptionId }, 'gone', now)
			);
			return;
		}
		if (answer === 'taken') {
			// the hook took a post, whoever the row now belongs to: its run of failures is over.
			await deps.db.batch([
				landing(row, { status: 'sent', lastError: null }),
				failing.taken(deps.db, row.subscriptionId)
			]);
			return;
		}
		const nextAttemptAt = nextAttempt(row, answer.retryAt, now);
		if (answer.retryAt !== undefined) throttled.set(row.subscriptionId, nextAttemptAt);
		else failedThisRun.add(row.subscriptionId);
		const failed = [
			failing.failed(deps.db, row.subscriptionId, row, now),
			landing(row, { nextAttemptAt, lastError: answer.error })
		] as const;
		const stopGuard = failing.stopGuard(row, now);
		if (stopGuard === null) {
			await deps.db.batch(failed);
			return;
		}
		// `ended` is the end's second statement: the subscription it ended, where the guard held.
		const [, , , ended] = await deps.db.batch([
			...failed,
			...endSubscriptionStatements(deps.db, { id: row.subscriptionId }, 'gone', now, {
				onlyIf: stopGuard,
				lastError: FAILED_FOR_THREE_DAYS
			})
		]);
		if (ended.length > 0) {
			gone.add(row.subscriptionId);
			// so the Zap reads as off in its owner's account. the end has committed and stands
			// whatever the pause answers, and a pause that fails is never asked again.
			await pauseZaps(
				deps.fetch,
				ended.map((e) => e.hookUrl)
			);
		}
	});
}

/** the `last_error` of each row dropped with a hook ended for failing. */
const FAILED_FOR_THREE_DAYS =
	'Not sent: every post to its hook had failed for three days, and its subscription was ended.';

/**
 * when a row that just failed is next due: its backoff, or later where the hook asked for later —
 * but never past the moment it is given up on, where waiting any longer would only be a later
 * give-up.
 */
function nextAttempt(row: Claimed, retryAt: Date | undefined, now: Date): Date {
	const backoff = now.getTime() + backoffMs(row.attempts + 1);
	if (retryAt === undefined) return new Date(backoff);
	const givenUp = row.createdAt.getTime() + GIVE_UP_AFTER_MS;
	return new Date(Math.max(backoff, Math.min(retryAt.getTime(), givenUp)));
}

/**
 * every row still owed {@link GIVE_UP_AFTER_MS} after it was queued, `failed` without another post
 * — a standing sweep, committed in the claim's own batch ahead of it (../outbox/lease.ts), so a row
 * whose runs never reach the post still ends. the last failure's words stay; a row never tried gets
 * its own. `indexed by` holds it to `zapier_delivery_due_idx`, whose head is `status`, so it reads
 * the rows still owed and none of the history whatever statistics sqlite plans by, and a statement
 * naming an index that is gone fails to prepare.
 */
function giveUpOnStale(db: Db, now: Date) {
	const stale = lte(zapierDelivery.createdAt, new Date(now.getTime() - GIVE_UP_AFTER_MS));
	return outbox.sweep(db, now, {
		where: sql`"rowid" in (select "rowid" from ${zapierDelivery} indexed by "zapier_delivery_due_idx" where ${zapierDelivery.status} = 'pending' and ${stale})`,
		outcome: {
			status: 'failed',
			lastError: sql`coalesce(${zapierDelivery.lastError}, ${NEVER_DELIVERED})`,
			updatedAt: now
		}
	});
}

const NEVER_DELIVERED = 'Not delivered within 72 hours of being queued.';

/**
 * the due rows, leased to this run, once {@link giveUpOnStale} has written off what it covers. the
 * subscription filter keeps a Zap that has ended from being posted to even if a row of its was
 * somehow left pending; it sits inside the claim's candidates, so it reads no more than they do.
 */
function claimDue(db: Db, now: Date, claims: number) {
	return outbox.claim(db, now, {
		claims,
		before: [giveUpOnStale(db, now)],
		set: { updatedAt: now },
		returning: {
			paymentId: zapierDelivery.paymentId,
			attempts: zapierDelivery.attempts,
			createdAt: zapierDelivery.createdAt
		},
		where: inArray(
			zapierDelivery.subscriptionId,
			db
				.select({ id: zapierSubscription.id })
				.from(zapierSubscription)
				.where(isNull(zapierSubscription.endedAt))
		)
	});
}

type Claimed = Awaited<ReturnType<typeof claimDue>>['rows'][number];

type Hook = { readonly url: string; readonly trigger: ZapierTrigger };

/** each subscription's hook and trigger. */
async function readHooks(db: Db, subscriptionIds: readonly string[]): Promise<Map<string, Hook>> {
	const rows = await db
		.select({
			id: zapierSubscription.id,
			url: zapierSubscription.hookUrl,
			trigger: zapierSubscription.trigger
		})
		.from(zapierSubscription)
		.where(inPage(zapierSubscription.id, subscriptionIds));
	return new Map(rows.map((row) => [row.id, { url: row.url, trigger: row.trigger }]));
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
 * what a hook answered: taken, gone — Zapier's 410 for a Zap switched off or deleted — or failed,
 * with the words `last_error` keeps and, for a 429 that said, the time it asked to be left until.
 */
type HookAnswer =
	| 'taken'
	| 'gone'
	| { readonly error: string; readonly retryAt?: Date | undefined };

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
			// an unread body holds its connection open. the post is taken either way, so a body that
			// will not cancel is not a failure.
			await response.body?.cancel().catch(() => undefined);
			return 'taken';
		}
		if (response.status === 410) return 'gone';
		const answeredAt = Date.now();
		const wait =
			response.status === 429
				? askedWait(response.headers.get('retry-after'), answeredAt)
				: undefined;
		return {
			error: await refusal(response),
			retryAt: wait === undefined ? undefined : new Date(answeredAt + wait)
		};
	} catch (error) {
		return { error: String(error) };
	}
}
