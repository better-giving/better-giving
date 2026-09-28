import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { webhookDelivery, webhookDestination } from '../db/schema';
import { type ApiGift, readGifts } from '../integrations/gift';
import { defineOutbox, type Outcome } from '../outbox/lease';
import { refusal } from '../outbox/refusal';
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
// **the body is rendered at send**, from the row's subject, through the read API's own projection
// (`readGifts` in ../integrations/gift.ts): `{ type, timestamp, data }`, the Standard Webhooks
// shape (https://www.standardwebhooks.com/), where `timestamp` is when the event was recorded — the
// row's `created_at`, the same on every attempt — and `data` is the gift as the read API answers
// it at that moment. a retry renders again, so it carries where the gift stands by then.
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
// a failed row is kept, for the destination's recent deliveries.
//
// **a paused or archived destination's rows are not claimed.** a paused one's rows wait, owed,
// until it is resumed; an archived one is sent nothing more.
//
// the run's scheduled time decides what is due and when a failure is next due, so steps line up
// with the cron; the wall clock stamps each attempt's `webhook-timestamp` and `delivered_at`, the
// moment it was actually made.

/** everything one run needs, per invocation. `fetch` is handed in so a spec can answer for receivers. */
export type WebhookDeliveryDeps = { readonly db: Db; readonly fetch: typeof fetch };

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
const POST_TIMEOUT_MS = 15_000;

/** posts in flight at once. */
const POSTS_AT_ONCE = 10;

/** how long a claimed row is the claiming run's alone, from that run's scheduled time. */
const LEASE_MS = 2 * 60_000;

/**
 * rows claimed per run, the longest-waiting first: as many as {@link POSTS_AT_ONCE} lanes can each
 * start in turn while every destination times out, with the last post still answered inside
 * {@link LEASE_MS}.
 */
const CLAIMS_PER_RUN = 70;

/**
 * no post starts later than this after the run's scheduled time: long enough for every claimed row
 * to be started when every destination times out, and short enough that the last post it lets
 * start answers or times out before {@link LEASE_MS} runs out.
 */
const RUN_DEADLINE_MS = (CLAIMS_PER_RUN / POSTS_AT_ONCE) * POST_TIMEOUT_MS;

const outbox = defineOutbox({
	table: webhookDelivery,
	key: { id: webhookDelivery.id },
	leaseMs: LEASE_MS,
	deadlineMs: RUN_DEADLINE_MS,
	attemptMs: POST_TIMEOUT_MS,
	claimsPerRun: CLAIMS_PER_RUN,
	lanes: POSTS_AT_ONCE
});

/**
 * one delivery run at `now`, the cron's scheduled time: claim what is due, render it, post it, and
 * write where each row landed. a fault reading or writing the database throws, and the rows it
 * held come back when their lease does.
 */
export async function sendDueWebhooks(deps: WebhookDeliveryDeps, now: Date): Promise<void> {
	const { db } = deps;
	const claim = await claimDue(db, now);
	if (claim.rows.length === 0) return;

	const destinations = await readDestinations(
		db,
		claim.rows.map((row) => row.destinationId)
	);
	const gifts = await readGifts(
		db,
		claim.rows.filter((row) => row.event === 'gift.made').map((row) => row.subjectId)
	);

	await claim.each(async (row) => {
		const destination = destinations.get(row.destinationId);
		const data = row.event === 'gift.made' ? gifts.get(row.subjectId) : undefined;
		if (destination === undefined || data === undefined) {
			const missing =
				destination === undefined
					? `destination ${row.destinationId}`
					: `settled gift ${row.subjectId}`;
			await claim.land(row, {
				status: 'failed',
				lastError: `The ${missing} this event was queued for could not be read.`,
				updatedAt: now
			});
			return;
		}

		const answer = await post(deps.fetch, destination, row, data);
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
							isNotNull(webhookDestination.failingSince)
						)
					)
			]);
			return;
		}
		await db.batch([
			db
				.update(webhookDestination)
				.set({ failingSince: sql`coalesce(${webhookDestination.failingSince}, ${now.getTime()})` })
				.where(eq(webhookDestination.id, row.destinationId)),
			claim.landing(row, {
				...afterFailure(attempts, now),
				attempts,
				lastStatus: answer.status,
				lastError: answer.error,
				updatedAt: now
			})
		]);
	});
}

/** where a row that has now failed `attempts` posts stands: waiting out its next step, or failed. */
function afterFailure(attempts: number, now: Date): Outcome<typeof webhookDelivery> {
	const wait = WEBHOOK_RETRY_SCHEDULE_MS[attempts - 1];
	return wait === undefined
		? { status: 'failed' }
		: { nextAttemptAt: new Date(now.getTime() + wait) };
}

/** the due rows of destinations neither paused nor archived, leased to this run. */
function claimDue(db: Db, now: Date) {
	return outbox.claim(db, now, {
		set: { updatedAt: now },
		returning: {
			destinationId: webhookDelivery.destinationId,
			event: webhookDelivery.event,
			subjectId: webhookDelivery.subjectId,
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

/** each destination's address and secret. the ids are one run's claims, under D1's 100 bound. */
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
		.where(inArray(webhookDestination.id, [...new Set(destinationIds)]));
	return new Map(rows.map((row) => [row.id, row]));
}

/**
 * what a destination answered: delivered, with the status and the moment the answer came, or
 * failed, with the status where one came and the words `last_error` keeps.
 */
type Answer =
	| { readonly delivered: true; readonly status: number; readonly at: Date }
	| { readonly delivered: false; readonly status: number | null; readonly error: string };

/** the row's event, serialized once, signed, and posted as the same string. */
async function post(
	fetcher: typeof fetch,
	destination: Destination,
	row: Claimed,
	data: ApiGift
): Promise<Answer> {
	const body = JSON.stringify({
		type: row.event,
		timestamp: row.createdAt.toISOString(),
		data
	});
	try {
		const signed = await signedHeaders({
			secret: destination.signingSecret,
			id: row.id,
			at: new Date(),
			body
		});
		const response = await fetcher(destination.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...signed },
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(POST_TIMEOUT_MS)
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
