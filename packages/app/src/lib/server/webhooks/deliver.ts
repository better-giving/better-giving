import {
	and,
	count,
	desc,
	eq,
	exists,
	gte,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql
} from 'drizzle-orm';
import { WEBHOOK_TEST_TYPE } from '../../webhooks/catalog';
import type { Db } from '../db/client';
import { webhookDelivery, webhookDestination } from '../db/schema';
import { inPage } from '../db/id-set';
import { MINUTE_RUN, PACE, type Plan } from '../outbox/budget';
import { defineFailing } from '../outbox/failing';
import { defineOutbox, type Outcome } from '../outbox/lease';
import { refusal } from '../outbox/refusal';
import { askedWait } from '../outbox/retry-after';
import { HELD_UNTIL } from './events';
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
//              out the next step of {@link WEBHOOK_RETRY_SCHEDULE_MS}, spread by
//              {@link WEBHOOK_RETRY_JITTER}, or where a 429 or 503 asked with `Retry-After` for
//              longer, what it asked (../outbox/retry-after.ts) up to the schedule's longest step;
//              or it is `failed` after the last step. the destination's run of failures is marked
//              (../outbox/failing.ts) in the row's outcome batch.
//   410      — a failure as above, and the destination paused at once: Standard Webhooks reads a
//              410 as the endpoint withdrawn.
// a failed row is kept, for the destination's recent deliveries. the mark, its clear and the pause
// are each guarded on the run still holding the row (`holds` in ../outbox/lease.ts), so a run
// that lost the row before its post was answered records nothing about the destination.
//
// **a destination failing for {@link DESTINATION_PAUSE_AFTER_MS} is paused**, on
// ../outbox/failing.ts's rule: a failure on a row that had failed before, where the destination's
// `failing_since` is that far behind, pauses it in the row's outcome batch — every post to it for
// that long failed and none was taken. a mark that outlived a quiet spell with nothing owed is
// started afresh rather than counted. the schedule outlasts the pause, so a destination that
// answers nothing is paused by a lone row's own retries, and that row, failed by then, is in the
// window a resume re-sends.
// the pause is a guarded write that answers only where it took, so of the runs that fail on one
// destination at once exactly one learns it paused it, and tells `onPaused` after its batch has
// committed. a hook that throws is logged and never asked again, so no pause is told of twice. the
// destination's rows the run has not yet reached are left leased and unposted, and a post already
// in flight that is taken does not clear `failing_since`, which marks the window a resume re-sends.
//
// **a paused destination's rows are held out of the due set**: every row it is owed carries
// `HELD_UNTIL` (./events.ts) from the batch that pauses it (`holdStatement`), a row queued while
// it is paused from its insert, and a failure landing on it after the pause from that landing. so
// no claim reads past a paused backlog however long it grows, and a resume
// (`resumeDestination` in ./destinations.ts) lets the rows out a few at a time, taken back from any
// run still posting one ({@link requeueHeldStatements}).
//
// **a deleted destination's rows are dropped.** a run reads each destination's address and secret
// once, after its claim, so the rows it already holds when the destination is edited or deleted
// are still posted, to the address it read, until its lease runs out ({@link LEASE_MS} from its
// scheduled time), and each lands the answer it got. a delete drops the rows no run holds
// (`dropOwedStatement`); every row a run held then is dropped by the standing sweep each claim
// commits ahead of itself, once no run holds it. a failure on a deleted destination neither marks
// nor pauses it.
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
 * how long a row waits after each failed post, the first entry after the first, each spread by
 * {@link WEBHOOK_RETRY_JITTER}: about 82 hours from the first post to the tenth and last, and past
 * 73 at the spread's earliest. that is longer than {@link DESTINATION_PAUSE_AFTER_MS}, so a
 * destination that answers nothing is paused, and its rows held for a resume, by a row's own
 * retries before that row runs out of them.
 */
export const WEBHOOK_RETRY_SCHEDULE_MS: readonly number[] = [
	60_000,
	5 * 60_000,
	30 * 60_000,
	2 * 60 * 60_000,
	5 * 60 * 60_000,
	10 * 60 * 60_000,
	10 * 60 * 60_000,
	24 * 60 * 60_000,
	30 * 60 * 60_000
];

/**
 * the part of a step a wait may be longer or shorter by, at random, so the rows one outage failed
 * together do not all come back on one minute.
 */
export const WEBHOOK_RETRY_JITTER = 0.1;

/** the statuses whose `Retry-After` a retry waits out: too many requests, and unavailable. */
const WAITS_ON_RETRY_AFTER = new Set([429, 503]);

/** the longest a `Retry-After` holds a row: the schedule's own longest step. */
const LONGEST_ASK_MS = Math.max(...WEBHOOK_RETRY_SCHEDULE_MS);

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
	lanes: POSTS_AT_ONCE,
	receiver: webhookDelivery.destinationId
});

const failing = defineFailing({
	table: webhookDestination,
	outbox: { table: webhookDelivery, receiver: webhookDelivery.destinationId },
	open: sql`(${webhookDestination.pausedAt} is null and ${webhookDestination.archivedAt} is null)`,
	stopAfterMs: DESTINATION_PAUSE_AFTER_MS
});

/** the destination `destinationId`, where it is paused and not deleted. */
function pausedDestination(db: Db, destinationId: string) {
	return db
		.select({ id: webhookDestination.id })
		.from(webhookDestination)
		.where(
			and(
				eq(webhookDestination.id, destinationId),
				isNotNull(webhookDestination.pausedAt),
				isNull(webhookDestination.archivedAt)
			)
		);
}

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
		const holds = claim.holds(row);
		if (answer.delivered) {
			await db.batch([
				failing.taken(db, row.destinationId, holds),
				claim.landing(row, {
					status: 'delivered',
					attempts,
					lastStatus: answer.status,
					lastError: null,
					deliveredAt: answer.at,
					updatedAt: now
				})
			]);
			return;
		}
		const marked = failing.failed(db, row.destinationId, row, now, holds);
		const landing = claim.landing(row, {
			...afterFailure(db, row.destinationId, attempts, now, answer),
			attempts,
			lastStatus: answer.status,
			lastError: answer.error,
			updatedAt: now
		});
		const pause = pauseFor(row, answer.status, now);
		if (pause === undefined) {
			await db.batch([marked, landing]);
			return;
		}
		const [, [pausedHere]] = await db.batch([
			marked,
			pauseStatement(db, row.destinationId, now, and(holds, pause.guard)),
			holdStatement(db, row.destinationId),
			landing
		]);
		if (pausedHere === undefined) return;
		pausedThisRun.add(row.destinationId);
		await tellPaused(deps.onPaused, { ...pausedHere, reason: pause.reason });
	});
}

/** the status that pauses a destination on its first answer: Standard Webhooks' endpoint withdrawn. */
export const PAUSED_AT_ONCE_ON = 410;

/**
 * why a failed post of `row` at `now` may pause its destination, and the condition the pause is
 * guarded on beside the run still holding the row; undefined where it may not pause it at all.
 */
function pauseFor(
	row: Claimed,
	status: number | null,
	now: Date
): { readonly reason: PauseReason; readonly guard: SQL | undefined } | undefined {
	if (status === PAUSED_AT_ONCE_ON) return { reason: 'gone', guard: undefined };
	const guard = failing.stopGuard(row, now);
	return guard === null ? undefined : { reason: 'failing', guard };
}

/**
 * the destination paused at `now`, only where no run paused it first and `guard` holds. it answers
 * with the destination where it paused it, so one run alone learns of the pause.
 */
function pauseStatement(db: Db, destinationId: string, now: Date, guard: SQL | undefined) {
	return db
		.update(webhookDestination)
		.set({ pausedAt: now })
		.where(
			and(
				eq(webhookDestination.id, destinationId),
				isNull(webhookDestination.pausedAt),
				isNull(webhookDestination.archivedAt),
				guard
			)
		)
		.returning({ id: webhookDestination.id, url: webhookDestination.url });
}

/**
 * every row the destination `destinationId` is still owed held out of the due set, where it is
 * paused: its `next_attempt_at` {@link HELD_UNTIL}, rows a run holds included, so no claim reads
 * past them while it stays paused. `updated_at` is held as it stands: nothing about the row moved.
 */
function holdStatement(db: Db, destinationId: string) {
	return db
		.update(webhookDelivery)
		.set({ nextAttemptAt: HELD_UNTIL, updatedAt: sql`${webhookDelivery.updatedAt}` })
		.where(
			and(
				eq(webhookDelivery.destinationId, pausedDestination(db, destinationId)),
				eq(webhookDelivery.status, 'pending')
			)
		);
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

/**
 * where a row owed to `destinationId` that has now failed `attempts` posts stands: failed after the
 * last step, or waiting out its next — the step spread by {@link WEBHOOK_RETRY_JITTER}, or where a
 * 429 or 503 asked for longer, what it asked up to {@link LONGEST_ASK_MS}. a row whose destination
 * was paused while its post was out is held with the rest (`holdStatement`).
 */
function afterFailure(
	db: Db,
	destinationId: string,
	attempts: number,
	now: Date,
	answer: { readonly asked?: number | undefined }
): Outcome<typeof webhookDelivery> {
	const step = WEBHOOK_RETRY_SCHEDULE_MS[attempts - 1];
	if (step === undefined) return { status: 'failed' };
	const spread = step * (1 + WEBHOOK_RETRY_JITTER * (2 * Math.random() - 1));
	const wait = Math.round(Math.max(spread, Math.min(answer.asked ?? 0, LONGEST_ASK_MS)));
	return {
		nextAttemptAt: sql`case when ${exists(pausedDestination(db, destinationId))} then ${HELD_UNTIL.getTime()} else ${now.getTime() + wait} end`
	};
}

/**
 * the held window of the paused destination `destinationId`: every row still owed, and every
 * `failed` row whose last failure came at or after `failing_since`, the start of the run of
 * failures that paused it — `updated_at` is stamped by that failure's landing. a destination not
 * paused, or deleted, holds nothing.
 */
function heldWindow(db: Db, destinationId: string): SQL {
	const failingSince = db
		.select({ failingSince: webhookDestination.failingSince })
		.from(webhookDestination)
		.where(eq(webhookDestination.id, destinationId));
	return sql`${eq(webhookDelivery.destinationId, pausedDestination(db, destinationId))} and ${or(
		eq(webhookDelivery.status, 'pending'),
		and(eq(webhookDelivery.status, 'failed'), gte(webhookDelivery.updatedAt, failingSince))
	)}`;
}

/**
 * how far apart a resume on `plan` lets its rows out: half this feed's pace a minute, so a
 * resumed backlog takes at most half of each run's claim and the destinations beside it the rest.
 */
function resumedRowsEveryMs(plan: Plan): number {
	return Math.ceil((2 * 60_000) / PACE[plan].webhooks);
}

/**
 * the held window of `destinationId` ({@link heldWindow}) re-queued at `now`, each row starting the
 * schedule afresh under its own id: taken back from any run posting it, so that run's answer lands
 * nothing over the restart, then let out {@link resumedRowsEveryMs} apart in the order the rows
 * were queued, the first at `now`. the first statement answers with the ids it re-queued. they
 * match nothing once the destination is resumed, so they run in front of the write that resumes it.
 */
export function requeueHeldStatements(db: Db, destinationId: string, now: Date, plan: Plan) {
	const gathered = outbox.takeBack(db, {
		where: heldWindow(db, destinationId),
		outcome: { status: 'pending', attempts: 0, nextAttemptAt: HELD_UNTIL, updatedAt: now }
	});
	const ranked = db
		.select({
			id: webhookDelivery.id,
			rank: sql<number>`row_number() over (order by ${webhookDelivery.createdAt}, ${webhookDelivery.id}) - 1`.as(
				'rank'
			)
		})
		.from(webhookDelivery)
		.where(
			and(
				eq(webhookDelivery.destinationId, pausedDestination(db, destinationId)),
				eq(webhookDelivery.status, 'pending'),
				eq(webhookDelivery.nextAttemptAt, HELD_UNTIL)
			)
		)
		.as('ranked');
	const letOut = db
		.update(webhookDelivery)
		.set({
			nextAttemptAt: sql`${now.getTime()} + ${resumedRowsEveryMs(plan)} * ${ranked.rank}`,
			updatedAt: now
		})
		.from(ranked)
		.where(eq(webhookDelivery.id, ranked.id));
	return [gathered, letOut] as const;
}

/** how many rows a resume of `destinationId` would re-queue now. */
export async function countHeld(db: Db, destinationId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(webhookDelivery)
		.where(heldWindow(db, destinationId));
	return row?.n ?? 0;
}

/** what a row owed to a deleted destination is `dropped` with. */
function droppedAsDeleted(now: Date): Outcome<typeof webhookDelivery> {
	return { status: 'dropped', lastError: 'Its destination was deleted.', updatedAt: now };
}

/**
 * every row the destination `destinationId` is still owed and no run holds at `now`, `dropped`
 * because it is being deleted; what was delivered or failed is kept, for its record. a row a run
 * has already claimed is left to it: its post may be on its way, and it lands whatever answer
 * that post gets, and where that leaves it owed, the next claim's standing sweep drops it
 * (`claimDue`). it matches nothing once the destination is archived, so it runs in front of the
 * write that archives it.
 */
export function dropOwedStatement(db: Db, destinationId: string, now: Date) {
	return outbox.sweep(db, now, {
		where: eq(
			webhookDelivery.destinationId,
			db
				.select({ id: webhookDestination.id })
				.from(webhookDestination)
				.where(and(eq(webhookDestination.id, destinationId), isNull(webhookDestination.archivedAt)))
		),
		outcome: droppedAsDeleted(now)
	});
}

/**
 * the due rows, leased to this run, every destination's longest-waiting first. a paused
 * destination's are not due (`holdStatement`); a deleted one's are dropped in the claim's own
 * batch, ahead of it, by a standing sweep over every deleted destination's rows no run holds.
 */
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
		before: [
			outbox.sweep(db, now, {
				where: inArray(
					webhookDelivery.destinationId,
					db
						.select({ id: webhookDestination.id })
						.from(webhookDestination)
						.where(isNotNull(webhookDestination.archivedAt))
				),
				outcome: droppedAsDeleted(now)
			})
		]
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
 * failed, with the status where one came, the words `last_error` keeps and, for a 429 or 503 that
 * said, how long it asked to be left.
 */
type Answer =
	| { readonly delivered: true; readonly status: number; readonly at: Date }
	| {
			readonly delivered: false;
			readonly status: number | null;
			readonly error: string;
			readonly asked?: number | undefined;
	  };

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
		const asked = WAITS_ON_RETRY_AFTER.has(response.status)
			? askedWait(response.headers.get('retry-after'), Date.now())
			: undefined;
		return { delivered: false, status: response.status, error: await refusal(response), asked };
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
