import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { WEBHOOK_TEST_TYPE } from '../../webhooks/catalog';
import type { Db } from '../db/client';
import { webhookDelivery, webhookDestination } from '../db/schema';
import { inPage } from '../db/id-set';
import { MINUTE_RUN, PACE, type Plan } from '../outbox/budget';
import { defineOutbox, type Outcome } from '../outbox/lease';
import { refusal } from '../outbox/refusal';
import { renderSubjects } from './payload';
import { signedHeaders } from './sign';

// the webhook outbox, delivered: what reads `webhook_delivery` and posts each row to its
// destination, signed (./sign.ts).
//
// **the lease is ../outbox/lease.ts's; the policy is this module's.** which rows a run takes and
// how long they are its alone are the lease's; what an answer means, how long a failure waits and
// when a row is given up on are decided here.
//
// **delivery is at least once.** a post whose answer never came may have arrived, and it is posted
// again under the same `webhook-id`, which is what a receiver dedupes on.
//
// **the body is rendered at send**, from the row's subject (./payload.ts) and, for a recurring
// charge failed, its stored `detail`, which does not move between attempts: `{ type, timestamp,
// data }`, the Standard Webhooks shape (https://www.standardwebhooks.com/), where `timestamp` is
// when the event was recorded — the row's `created_at`, the same on every attempt — and `data` is
// the event's subject with its gift as the read API answers it at that moment. a retry renders
// again, so it carries where the gift stands by then. a row whose destination or subject cannot be
// read, or whose refund no longer stands, is `dropped` unposted, with why in `last_error`: `failed`
// is a delivery failure and nothing else.
//
// where each answer lands:
//   2xx      — `delivered`, with the status and the time, and the destination's run of failures,
//              if it was on one, is over.
//   anything
//   else     — a failure: any other status, a redirect (never followed: the address it points at
//              is not the one the organisation gave), a network fault or a timeout. the row waits
//              out the next step of {@link WEBHOOK_RETRY_SCHEDULE_MS}, or is `failed` after the
//              last, and the destination's `failing_since` is set unless it already was — the mark
//              and the row's outcome in one batch.
//   410      — a failure as above, and the destination paused at once: Standard Webhooks reads a
//              410 as the endpoint withdrawn.
// a failed row is kept, for the destination's recent deliveries.
//
// **a destination failing for {@link DESTINATION_PAUSE_AFTER_MS} is paused.** a failure on a row
// that had already failed before, where the destination's `failing_since` is that far behind,
// pauses it in the row's outcome batch — every post to it for {@link DESTINATION_PAUSE_AFTER_MS}
// failed and none taken. a row's first failure never pauses, since a mark can outlive a quiet
// spell with nothing posted.
// the pause is a guarded write that answers only where it took, so of the runs that fail on one
// destination at once exactly one learns it paused it, and tells `onPaused` after its batch has
// committed. a hook that throws is logged and never asked again, so no pause is told of twice. the
// destination's rows the run has not yet reached are left leased and unposted, and a post already
// in flight that is taken does not clear `failing_since`, which marks the window a resume re-sends.
//
// **a paused or archived destination's rows are not claimed.** a paused one's rows wait, owed,
// until it is resumed (`resumeDestination` in ./destinations.ts). a run reads each destination's
// address and secret once, after its claim, so the rows it already holds when the destination is
// edited or deleted are still posted, to the address it read, until its lease runs out
// ({@link LEASE_MS} from its scheduled time), and each lands the answer it got. a delete drops only
// the rows no run holds (`dropOwedStatement`); a failure on a deleted destination neither marks nor
// pauses it, and its row stays owed with nothing left to claim it.
//
// the run's scheduled time decides what is due and when a failure is next due, so steps line up
// with the cron; the wall clock stamps each attempt's `webhook-timestamp` and `delivered_at`, the
// moment it was actually made.

/**
 * why a destination was paused: every post to it failed for {@link DESTINATION_PAUSE_AFTER_MS}, or
 * it answered 410, which Standard Webhooks reads as the endpoint withdrawn.
 */
export type PauseReason = 'failing' | 'gone';

/** a destination a run has just paused, as the hook told of it receives it. */
export type PausedDestination = {
	readonly id: string;
	readonly url: string;
	readonly reason: PauseReason;
};

/**
 * everything one run needs, per invocation. `fetch` is handed in so a spec can answer for
 * receivers. `onPaused` is told of each pause once, after the batch that made it has committed.
 * `plan` is the Cloudflare plan the invocation runs on, Free where it is not said: a run claims
 * this feed's pace on it, the longest-waiting first (../outbox/budget.ts), and a row no lane
 * reached stays leased, unposted, until the lease runs out and a later run takes it.
 */
export type WebhookDeliveryDeps = {
	readonly db: Db;
	readonly fetch: typeof fetch;
	readonly onPaused: (destination: PausedDestination) => Promise<void>;
	readonly plan?: Plan;
};

/**
 * how long every post to a destination may fail, from the first failure after the last post it
 * took, before a retry's failure pauses it.
 */
export const DESTINATION_PAUSE_AFTER_MS = 72 * 60 * 60_000;

/**
 * how long a row waits after each failed post, the first entry after the first: about 52 hours
 * from the first post to the ninth and last.
 */
export const WEBHOOK_RETRY_SCHEDULE_MS: readonly number[] = [
	60_000,
	5 * 60_000,
	30 * 60_000,
	2 * 60 * 60_000,
	5 * 60 * 60_000,
	10 * 60 * 60_000,
	10 * 60 * 60_000,
	24 * 60 * 60_000
];

/**
 * how long a destination is given to answer before the post counts as failed: the least the
 * Standard Webhooks spec recommends ("Request timeouts").
 */
export const WEBHOOK_POST_TIMEOUT_MS = 15_000;

/** posts in flight at once: this feed's share of the minute cron's connections (../outbox/budget.ts). */
const POSTS_AT_ONCE = MINUTE_RUN.webhooks.lanes;

/** how long a claimed row is the claiming run's alone, from that run's scheduled time. */
const LEASE_MS = 2 * 60_000;

const outbox = defineOutbox({
	table: webhookDelivery,
	key: { id: webhookDelivery.id },
	leaseMs: LEASE_MS,
	attemptMs: WEBHOOK_POST_TIMEOUT_MS,
	lanes: POSTS_AT_ONCE
});

/**
 * one delivery run at `now`, the cron's scheduled time: claim what is due, render it, post it, and
 * write where each row landed. a fault reading or writing the database throws, and the rows it
 * held come back when their lease does.
 */
export async function sendDueWebhooks(deps: WebhookDeliveryDeps, now: Date): Promise<void> {
	const { db } = deps;
	const claim = await claimDue(db, now, PACE[deps.plan ?? 'free'].webhooks);
	if (claim.rows.length === 0) return;

	const destinations = await readDestinations(
		db,
		claim.rows.map((row) => row.destinationId)
	);
	const render = await renderSubjects(db, claim.rows);
	const drop = (row: Claimed, lastError: string) =>
		claim.land(row, { status: 'dropped', lastError, updatedAt: now });

	const pausedThisRun = new Set<string>();

	await claim.each(async (row) => {
		if (pausedThisRun.has(row.destinationId)) return;
		const destination = destinations.get(row.destinationId);
		if (destination === undefined) {
			await drop(
				row,
				`The destination ${row.destinationId} this event was queued for could not be read.`
			);
			return;
		}
		const rendered = render(row);
		if ('dropped' in rendered) {
			await drop(row, rendered.dropped);
			return;
		}

		const answer = await post(deps.fetch, destination, row.id, {
			type: row.event,
			timestamp: row.createdAt,
			data: rendered.data
		});
		const attempts = row.attempts + 1;
		if (answer.delivered) {
			await db.batch([
				claim.landing(row, {
					status: 'delivered',
					attempts,
					lastStatus: answer.status,
					lastError: null,
					deliveredAt: answer.at,
					updatedAt: now
				}),
				db
					.update(webhookDestination)
					.set({ failingSince: null })
					.where(
						and(
							eq(webhookDestination.id, row.destinationId),
							isNotNull(webhookDestination.failingSince),
							isNull(webhookDestination.pausedAt)
						)
					)
			]);
			return;
		}
		const failed = [
			db
				.update(webhookDestination)
				.set({ failingSince: sql`coalesce(${webhookDestination.failingSince}, ${now.getTime()})` })
				.where(
					and(eq(webhookDestination.id, row.destinationId), isNull(webhookDestination.archivedAt))
				),
			claim.landing(row, {
				...afterFailure(attempts, now),
				attempts,
				lastStatus: answer.status,
				lastError: answer.error,
				updatedAt: now
			})
		] as const;
		const reason = pauseReason(row, answer.status);
		if (reason === undefined) {
			await db.batch(failed);
			return;
		}
		const [, , [pausedHere]] = await db.batch([
			...failed,
			pauseStatement(db, row.destinationId, reason, now)
		]);
		if (pausedHere === undefined) return;
		pausedThisRun.add(row.destinationId);
		await tellPaused(deps.onPaused, { ...pausedHere, reason });
	});
}

/** the status that pauses a destination on its first answer: Standard Webhooks' endpoint withdrawn. */
export const PAUSED_AT_ONCE_ON = 410;

/** why a failed post may pause its destination, or undefined where it may not. */
function pauseReason(row: Claimed, status: number | null): PauseReason | undefined {
	if (status === PAUSED_AT_ONCE_ON) return 'gone';
	return row.attempts > 0 ? 'failing' : undefined;
}

/**
 * the destination paused at `now`, only where no run paused it first and, for `failing`, where its
 * run of failures began {@link DESTINATION_PAUSE_AFTER_MS} or more before `now`. it answers with
 * the destination where it paused it, so one run alone learns of the pause.
 */
function pauseStatement(db: Db, destinationId: string, reason: PauseReason, now: Date) {
	return db
		.update(webhookDestination)
		.set({ pausedAt: now })
		.where(
			and(
				eq(webhookDestination.id, destinationId),
				isNull(webhookDestination.pausedAt),
				isNull(webhookDestination.archivedAt),
				reason === 'failing'
					? lte(
							webhookDestination.failingSince,
							new Date(now.getTime() - DESTINATION_PAUSE_AFTER_MS)
						)
					: undefined
			)
		)
		.returning({ id: webhookDestination.id, url: webhookDestination.url });
}

/** `onPaused` told of a pause that has committed, and a throw from it logged. */
async function tellPaused(
	onPaused: WebhookDeliveryDeps['onPaused'],
	destination: PausedDestination
): Promise<void> {
	try {
		await onPaused(destination);
	} catch (error) {
		console.error(
			`telling of paused destination ${destination.id} failed, and is not retried:`,
			error
		);
	}
}

/** where a row that has now failed `attempts` posts stands: waiting out its next step, or failed. */
function afterFailure(attempts: number, now: Date): Outcome<typeof webhookDelivery> {
	const wait = WEBHOOK_RETRY_SCHEDULE_MS[attempts - 1];
	return wait === undefined
		? { status: 'failed' }
		: { nextAttemptAt: new Date(now.getTime() + wait) };
}

/**
 * the held window of the paused destination `destinationId`: every row still owed, and every
 * `failed` row whose last failure came at or after `failing_since`, the start of the run of
 * failures that paused it — `updated_at` is stamped by that failure's landing. a destination not
 * paused, or deleted, holds nothing.
 */
function heldWindow(db: Db, destinationId: string) {
	const paused = db
		.select({ id: webhookDestination.id })
		.from(webhookDestination)
		.where(
			and(
				eq(webhookDestination.id, destinationId),
				isNotNull(webhookDestination.pausedAt),
				isNull(webhookDestination.archivedAt)
			)
		);
	const failingSince = db
		.select({ failingSince: webhookDestination.failingSince })
		.from(webhookDestination)
		.where(eq(webhookDestination.id, destinationId));
	return and(
		eq(webhookDelivery.destinationId, paused),
		or(
			eq(webhookDelivery.status, 'pending'),
			and(eq(webhookDelivery.status, 'failed'), gte(webhookDelivery.updatedAt, failingSince))
		)
	);
}

/**
 * the held window of `destinationId` ({@link heldWindow}) due at `now`, each row starting the
 * schedule afresh under its own id, answered with the ids it re-queued. it matches nothing once the
 * destination is resumed, so it runs in front of the write that resumes it.
 */
export function requeueHeldStatement(db: Db, destinationId: string, now: Date) {
	return db
		.update(webhookDelivery)
		.set({ status: 'pending', attempts: 0, nextAttemptAt: now, updatedAt: now })
		.where(heldWindow(db, destinationId))
		.returning({ id: webhookDelivery.id });
}

/** how many rows a resume of `destinationId` would re-queue now. */
export async function countHeld(db: Db, destinationId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(webhookDelivery)
		.where(heldWindow(db, destinationId));
	return row?.n ?? 0;
}

/**
 * every row the destination `destinationId` is still owed and no run holds at `now`, `dropped`
 * because it is being deleted; what was delivered or failed is kept, for its record. a row a run
 * has already claimed is left to it: its post may be on its way, and it lands whatever answer
 * that post gets. it matches nothing once the destination is archived, so it runs in front of the
 * write that archives it.
 */
export function dropOwedStatement(db: Db, destinationId: string, now: Date) {
	return db
		.update(webhookDelivery)
		.set({ status: 'dropped', lastError: 'Its destination was deleted.', updatedAt: now })
		.where(
			and(
				eq(webhookDelivery.status, 'pending'),
				or(isNull(webhookDelivery.leasedUntil), lte(webhookDelivery.leasedUntil, now)),
				eq(
					webhookDelivery.destinationId,
					db
						.select({ id: webhookDestination.id })
						.from(webhookDestination)
						.where(
							and(eq(webhookDestination.id, destinationId), isNull(webhookDestination.archivedAt))
						)
				)
			)
		);
}

/** the due rows of destinations neither paused nor archived, leased to this run. */
function claimDue(db: Db, now: Date, claims: number) {
	return outbox.claim(db, now, {
		claims,
		set: { updatedAt: now },
		returning: {
			destinationId: webhookDelivery.destinationId,
			event: webhookDelivery.event,
			subjectId: webhookDelivery.subjectId,
			detail: webhookDelivery.detail,
			attempts: webhookDelivery.attempts,
			createdAt: webhookDelivery.createdAt
		},
		where: inArray(
			webhookDelivery.destinationId,
			db
				.select({ id: webhookDestination.id })
				.from(webhookDestination)
				.where(and(isNull(webhookDestination.pausedAt), isNull(webhookDestination.archivedAt)))
		)
	});
}

type Claimed = Awaited<ReturnType<typeof claimDue>>['rows'][number];

type Destination = { readonly url: string; readonly signingSecret: string };

/** each destination's address and secret. */
async function readDestinations(
	db: Db,
	destinationIds: readonly string[]
): Promise<Map<string, Destination>> {
	const rows = await db
		.select({
			id: webhookDestination.id,
			url: webhookDestination.url,
			signingSecret: webhookDestination.signingSecret
		})
		.from(webhookDestination)
		.where(inPage(webhookDestination.id, destinationIds));
	return new Map(rows.map((row) => [row.id, row]));
}

/**
 * what a destination answered: delivered, with the status and the moment the answer came, or
 * failed, with the status where one came and the words `last_error` keeps.
 */
type Answer =
	| { readonly delivered: true; readonly status: number; readonly at: Date }
	| { readonly delivered: false; readonly status: number | null; readonly error: string };

/** an event, serialized once, signed as delivery `id`, and posted as the same string. */
async function post(
	fetcher: typeof fetch,
	destination: Destination,
	id: string,
	event: { readonly type: string; readonly timestamp: Date; readonly data: unknown }
): Promise<Answer> {
	const body = JSON.stringify({
		type: event.type,
		timestamp: event.timestamp.toISOString(),
		data: event.data
	});
	try {
		const signed = await signedHeaders({
			secret: destination.signingSecret,
			id,
			at: new Date(),
			body
		});
		const response = await fetcher(destination.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...signed },
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(WEBHOOK_POST_TIMEOUT_MS)
		});
		if (response.ok) {
			// an unread body holds its connection. the post is taken either way, so a body that will
			// not cancel is not a failure.
			await response.body?.cancel().catch(() => undefined);
			return { delivered: true, status: response.status, at: new Date() };
		}
		return { delivered: false, status: response.status, error: await refusal(response) };
	} catch (error) {
		return { delivered: false, status: null, error: String(error) };
	}
}

/** the `data` of every test post, `WEBHOOK_TEST_TYPE`'s in $lib/webhooks/catalog.ts. */
export const WEBHOOK_TEST_DATA = {
	test: true,
	message: 'A test from your Better Giving dashboard.'
} as const;

/** what a test post was answered with, as the press reports it. */
export type TestAnswer =
	| { readonly outcome: 'sent' | 'refused'; readonly status: number }
	| { readonly outcome: 'unanswered' };

/**
 * a test posted to `destination` at `now`, at once: signed with its secret like any delivery and
 * held to the same timeout and redirect rule, under a `webhook-id` of its own. it writes nothing,
 * so a paused destination is sent it without being resumed, and a failing answer neither pauses
 * the destination nor marks it failing.
 */
export async function sendTestWebhook(
	fetcher: typeof fetch,
	destination: Destination,
	now: Date
): Promise<TestAnswer> {
	const answer = await post(fetcher, destination, `msg_test_${crypto.randomUUID()}`, {
		type: WEBHOOK_TEST_TYPE,
		timestamp: now,
		data: WEBHOOK_TEST_DATA
	});
	if (answer.delivered) return { outcome: 'sent', status: answer.status };
	return answer.status === null
		? { outcome: 'unanswered' }
		: { outcome: 'refused', status: answer.status };
}

/**
 * the latest `limit` rows of the destination `destinationId`, newest first by when each event was
 * recorded: its recent deliveries, as far back as this table keeps them.
 */
export function listDeliveries(db: Db, destinationId: string, limit: number) {
	return db
		.select({
			id: webhookDelivery.id,
			event: webhookDelivery.event,
			status: webhookDelivery.status,
			lastStatus: webhookDelivery.lastStatus,
			attempts: webhookDelivery.attempts,
			createdAt: webhookDelivery.createdAt
		})
		.from(webhookDelivery)
		.where(eq(webhookDelivery.destinationId, destinationId))
		.orderBy(desc(webhookDelivery.createdAt), desc(webhookDelivery.id))
		.limit(limit);
}
