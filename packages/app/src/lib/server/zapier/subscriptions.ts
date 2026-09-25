import { and, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import {
	zapierDelivery,
	zapierKey,
	zapierSubscription,
	type ZapierEndReason,
	type ZapierTrigger
} from '../db/schema';
import { eachAtMost } from './each-at-most';

// the Zaps listening: which hook is subscribed to which trigger, and every way one stops.
//
// a subscription is ended, never deleted (`zapier_subscription`'s header in ../db/schema.ts), and
// **ending one drops what it was still owed in the same batch**. a pending row behind an ended
// subscription is an event queued for nobody, and the delivery run would carry on posting it to a
// hook Zapier has let go of. `endSubscriptionStatements` is the one place that pairs the two, and
// every end — Zapier unsubscribing, a hook answering 410, the key being replaced, a hook moving
// trigger — goes through it.

/** a Zap asking for `trigger`'s events at `hookUrl`, already checked by the route. */
export type SubscribeRequest = { readonly trigger: ZapierTrigger; readonly hookUrl: string };

/** the subscription Zapier stores as `subscribeData.id`, and whether this call opened it. */
export type Subscribed = { readonly id: string; readonly created: boolean };

/** which open subscriptions an end reaches: one by id, or every one — a replaced key. */
export type SubscriptionScope = { readonly id: string } | 'every_open';

/**
 * the subscription for `hookUrl`, opened if it has none — or `null` when `keyHash`, the key the
 * request was verified under, is no longer this deployment's.
 *
 * a hook already open for the same trigger answers with the id it has: Zapier retries a subscribe
 * it never heard back from, and a second row would double every event to that Zap. a hook open
 * under the other trigger has that row ended, `unsubscribed`, and a fresh one opened — one hook
 * hears one trigger, which is what the open-hook index holds.
 *
 * **the insert checks the key in the same statement.** a replace landing between the request's
 * key check and this insert ends every open row, and a row opened after it would be a Zap on the
 * old key receiving gifts that nothing ever ends.
 */
export async function subscribe(
	db: Db,
	request: SubscribeRequest,
	keyHash: string
): Promise<Subscribed | null> {
	const open = await openFor(db, request.hookUrl);
	if (open !== undefined && open.trigger === request.trigger)
		return { id: open.id, created: false };

	const now = new Date();
	const insert = db
		.insert(zapierSubscription)
		.select(
			db
				.select({
					id: sql`${uuidv7()}`.as('id'),
					trigger: sql`${request.trigger}`.as('trigger'),
					hookUrl: sql`${request.hookUrl}`.as('hook_url'),
					endedAt: sql`null`.as('ended_at'),
					endedReason: sql`null`.as('ended_reason'),
					createdAt: sql`${now.getTime()}`.as('created_at'),
					updatedAt: sql`${now.getTime()}`.as('updated_at')
				})
				.from(zapierKey)
				.where(eq(zapierKey.keyHash, keyHash))
		)
		.returning({ id: zapierSubscription.id });
	try {
		const [row] =
			open === undefined
				? await insert
				: (
						await db.batch([...endSubscriptionStatements(db, open, 'unsubscribed', now), insert])
					)[2];
		return row === undefined ? null : { id: row.id, created: true };
	} catch (error) {
		// Zapier's retry of a subscribe it never heard back from can land beside the first: the
		// open-hook index refuses the second insert, and it answers with the row the first opened.
		if (sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
		const winner = await openFor(db, request.hookUrl);
		if (winner === undefined || winner.trigger !== request.trigger) throw error;
		return { id: winner.id, created: false };
	}
}

/** the open subscription for `hookUrl`, if there is one. */
async function openFor(db: Db, hookUrl: string) {
	const [open] = await db
		.select({ id: zapierSubscription.id, trigger: zapierSubscription.trigger })
		.from(zapierSubscription)
		.where(and(eq(zapierSubscription.hookUrl, hookUrl), isNull(zapierSubscription.endedAt)));
	return open;
}

/** how many Zaps are listening to each trigger — what replacing the key would disconnect. */
export async function countListening(
	db: Db
): Promise<{ readonly newGift: number; readonly newDonor: number }> {
	const rows = await db
		.select({ trigger: zapierSubscription.trigger, listening: count() })
		.from(zapierSubscription)
		.where(isNull(zapierSubscription.endedAt))
		.groupBy(zapierSubscription.trigger);
	const of = (trigger: ZapierTrigger) => rows.find((r) => r.trigger === trigger)?.listening ?? 0;
	return { newGift: of('new_gift'), newDonor: of('new_donor') };
}

/**
 * Zapier letting go of subscription `id`. an unknown or already-ended id changes nothing and is no
 * error: Zapier reads a refused unsubscribe as a failure, and there is nothing left to stop.
 */
export async function unsubscribe(db: Db, id: string): Promise<void> {
	await db.batch(endSubscriptionStatements(db, { id }, 'unsubscribed', new Date()));
}

/**
 * the statements that end the subscriptions in `scope` for `reason` at `now`, for one `batch()`.
 * `onlyIf` is a condition both statements also hold to: a replace ends nothing unless its own
 * key write landed.
 *
 * the pending rows are dropped first, while the subscriptions they belong to still read as open —
 * the other order would leave `every_open` naming nothing by the time the drop ran. a row already
 * sent or given up on keeps its status: it is history, not something owed. an already-ended
 * subscription keeps the reason it ended for.
 *
 * the second statement answers with the hook of each subscription it ended, and only those: what
 * {@link pauseZaps} is handed after a replace.
 */
export function endSubscriptionStatements(
	db: Db,
	scope: SubscriptionScope,
	reason: ZapierEndReason,
	now: Date,
	onlyIf?: SQL
) {
	const open = and(
		scope === 'every_open' ? undefined : eq(zapierSubscription.id, scope.id),
		isNull(zapierSubscription.endedAt),
		onlyIf
	);
	return [
		db
			.update(zapierDelivery)
			.set({ status: 'dropped', leasedUntil: null, updatedAt: now })
			.where(
				and(
					eq(zapierDelivery.status, 'pending'),
					inArray(
						zapierDelivery.subscriptionId,
						db.select({ id: zapierSubscription.id }).from(zapierSubscription).where(open)
					)
				)
			),
		db
			.update(zapierSubscription)
			.set({ endedAt: now, endedReason: reason, updatedAt: now })
			.where(open)
			.returning({ hookUrl: zapierSubscription.hookUrl })
	] as const;
}

/** what telling Zapier about ended Zaps came to: `paused` and `notPaused` sum to the hooks asked. */
export type PauseOutcome = { readonly paused: number; readonly notPaused: number };

/**
 * a reverse unsubscribe to each of `hookUrls`: a DELETE to the hook itself, which pauses its Zap
 * in Zapier and tells the Zap's owner to reconnect — "best practices when sending data to a REST
 * hook trigger", https://docs.zapier.com/integrations/build/hook-trigger. without it a Zap this
 * deployment has stopped posting to still reads as on, with no error, in its owner's account.
 *
 * handed only hooks whose ends have already committed, and it never throws: the ends are the truth
 * and this is a courtesy to Zapier on top. a 2xx pauses the Zap; 404 and 410 mean the hook is
 * already gone, which leaves nothing to pause. anything else, a timeout included, is `notPaused`
 * and nothing asks again — the subscription is ended here whatever Zapier heard.
 */
export async function pauseZaps(
	fetcher: typeof fetch,
	hookUrls: readonly string[]
): Promise<PauseOutcome> {
	const pass = AbortSignal.timeout(PAUSE_PASS_MS);
	let paused = 0;
	await eachAtMost(PAUSES_AT_ONCE, hookUrls, async (hookUrl) => {
		if (pass.aborted) return;
		const signal = AbortSignal.any([pass, AbortSignal.timeout(PAUSE_TIMEOUT_MS)]);
		if (await pauseOne(fetcher, hookUrl, signal)) paused += 1;
	});
	return { paused, notPaused: hookUrls.length - paused };
}

/** pauses in flight at once, as ./deliver.ts holds its posts to. */
const PAUSES_AT_ONCE = 6;

/** how long one hook is given to answer a pause. */
const PAUSE_TIMEOUT_MS = 2_000;

/**
 * how long the whole pass may take; a hook not reached by then is `notPaused`. the replace is
 * answered to a console that waits ten seconds (`ReadTimeout` in
 * packages/console/internal/cf/client.go), and the pass is most of that answer.
 */
const PAUSE_PASS_MS = 4_000;

/** a hook Zapier no longer has: nothing is left to pause. */
const ALREADY_GONE = new Set([404, 410]);

async function pauseOne(
	fetcher: typeof fetch,
	hookUrl: string,
	signal: AbortSignal
): Promise<boolean> {
	try {
		const response = await fetcher(hookUrl, { method: 'DELETE', signal });
		await response.body?.cancel().catch(() => undefined);
		return response.ok || ALREADY_GONE.has(response.status);
	} catch {
		return false;
	}
}
