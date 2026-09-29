import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { zapierDelivery, zapierSubscription, type ZapierTrigger } from '../db/schema';
import { inPage } from '../integrations/paging';
import { REFUND_NO_LONGER_STANDS, readStandingRefunds } from '../integrations/refund';
import { MINUTE_RUN, PACE, type Plan } from '../outbox/budget';
import { defineOutbox, type Outcome } from '../outbox/lease';
import { refusal } from '../outbox/refusal';
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
// the lease module's, and two runs over one backlog post each row once because of it. what each
// answer means, how long a failure waits, and when a row or a hook is given up on are decided here.
// ../accounting/deliver.ts shares none of that policy on purpose: a gift owed to the books stays
// owed, while a notification to a Zap that has been down for three days is given up on. one
// backoff serving both would be one policy bent two ways — an argument against sharing a backoff,
// not a lease.
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
//              `Retry-After` asks, and never past the moment the row is given up on. the hook's
//              rows this run has not yet posted wait for the same time, unposted.
//   anything
//   else     — a failure: any other status, a network fault or a timeout. `attempts` goes up, the
//              row waits out {@link backoffMs}, and the hook's `failing_since` is set unless it
//              already was — the mark and the row's outcome in one batch. a hook that never
//              answers is as dead as one that refuses.
// a failure on a hook whose `failing_since` is {@link GIVE_UP_AFTER_MS} or more behind, of a row
// that had already failed before, ends it the way a 410 does: every post to it for three days
// failed and none taken. a row's first failure never ends a hook, since a mark can outlive a quiet
// spell with nothing posted. `ended_reason` has no value of its own for that end, so it reads
// `gone`, and each row dropped with it says why in `last_error`. Zapier, unlike after a 410, does
// not know, so the Zap is then paused the way a replaced key pauses every Zap (`pauseZaps` in
// ./subscriptions.ts).
//
// a row still owed {@link GIVE_UP_AFTER_MS} after it was queued is `failed` at the next run's
// start, without another post; ./report.ts counts those and nothing re-queues one. one hook
// failing never stops the rest: every row's outcome is its own write.
//
// **a `gift_refunded` row is sent only while its refund still stands**, read at send
// (`readStandingRefunds` in ../integrations/refund.ts) as well as at queueing. a refund that
// failed after it was queued, or a dispute whose loss no longer holds, is `dropped` unposted, with
// the reason in `last_error`: no event follows it, so posting it would leave a Zap acting on money
// that came back. what already went out stays out. a `new_gift` row is sent as it happened,
// because a refund of it since is an event of its own.

/**
 * everything one run needs, per invocation. `fetch` is handed in so a spec can answer for Zapier.
 * `plan` is the Cloudflare plan the invocation runs on, Free where it is not said: a run claims
 * this feed's pace on it, the longest-waiting first (../outbox/budget.ts), and a row no lane
 * reached stays leased, unposted, until the lease runs out and a later run takes it.
 */
export type ZapierDeliveryDeps = {
	readonly db: Db;
	readonly fetch: typeof fetch;
	readonly plan?: Plan;
};

/** posts in flight at once: this feed's share of the minute cron's connections (../outbox/budget.ts). */
const POSTS_AT_ONCE = MINUTE_RUN.zapier.lanes;

/** how long a hook is given to answer before the post counts as failed. */
const POST_TIMEOUT_MS = 10_000;

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
	lanes: POSTS_AT_ONCE
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
	await giveUpOnStale(deps.db, now);
	const claim = await claimDue(deps.db, now, PACE[deps.plan ?? 'free'].zapier);
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
				deps.db
					.update(zapierSubscription)
					.set({ failingSince: null })
					.where(
						and(
							eq(zapierSubscription.id, row.subscriptionId),
							isNotNull(zapierSubscription.failingSince)
						)
					)
			]);
			return;
		}
		const nextAttemptAt = nextAttempt(row, answer.retryAt, now);
		if (answer.retryAt !== undefined) throttled.set(row.subscriptionId, nextAttemptAt);
		const failed = [
			markFailing(deps.db, row.subscriptionId, now),
			landing(row, { nextAttemptAt, lastError: answer.error })
		] as const;
		if (row.attempts === 0) {
			await deps.db.batch(failed);
			return;
		}
		const [, , , ended] = await deps.db.batch([
			...failed,
			...endAfterFailing(deps.db, row.subscriptionId, now)
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

/** a failed post to a hook at `now`: the start of its run of failures, where none is marked. */
function markFailing(db: Db, subscriptionId: string, now: Date) {
	return db
		.update(zapierSubscription)
		.set({ failingSince: sql`coalesce(${zapierSubscription.failingSince}, ${now.getTime()})` })
		.where(and(eq(zapierSubscription.id, subscriptionId), isNull(zapierSubscription.endedAt)));
}

/**
 * the subscription ended and everything still owed to it dropped, as a 410 does — only where its
 * run of failures began {@link GIVE_UP_AFTER_MS} or more before `now`. the second statement
 * answers with the subscription it ended, if it did.
 */
function endAfterFailing(db: Db, subscriptionId: string, now: Date) {
	return endSubscriptionStatements(db, { id: subscriptionId }, 'gone', now, {
		onlyIf: lte(zapierSubscription.failingSince, new Date(now.getTime() - GIVE_UP_AFTER_MS)),
		lastError: FAILED_FOR_THREE_DAYS
	});
}

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
 * every row still owed {@link GIVE_UP_AFTER_MS} after it was queued, `failed` without another post.
 * checked here rather than after a failed post, so a row whose runs never reach the post still
 * ends. the last failure's words stay; a row never tried gets its own. a leased row is left to the
 * run holding it.
 */
async function giveUpOnStale(db: Db, now: Date): Promise<void> {
	await outbox.sweep(db, now, {
		where: lte(zapierDelivery.createdAt, new Date(now.getTime() - GIVE_UP_AFTER_MS)),
		outcome: {
			status: 'failed',
			lastError: sql`coalesce(${zapierDelivery.lastError}, ${NEVER_DELIVERED})`,
			updatedAt: now
		}
	});
}

const NEVER_DELIVERED = 'Not delivered within 72 hours of being queued.';

/**
 * the due rows, leased to this run. the subscription filter keeps a Zap that has ended from being
 * posted to even if a row of its was somehow left pending.
 */
function claimDue(db: Db, now: Date, claims: number) {
	return outbox.claim(db, now, {
		claims,
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
		const retryAt =
			response.status === 429 ? retryAfter(response.headers.get('retry-after')) : undefined;
		return { error: await refusal(response), retryAt };
	} catch (error) {
		return { error: String(error) };
	}
}

/**
 * a `Retry-After` value as a time: delay-seconds from the answer, or an HTTP-date
 * (https://www.rfc-editor.org/rfc/rfc9110#field.retry-after). anything else, or a time past what
 * a `Date` holds, is no ask.
 */
function retryAfter(value: string | null): Date | undefined {
	if (value === null) return undefined;
	const trimmed = value.trim();
	const at = /^\d+$/.test(trimmed) ? Date.now() + Number(trimmed) * 1_000 : Date.parse(trimmed);
	const asked = new Date(at);
	return Number.isFinite(asked.getTime()) ? asked : undefined;
}
