import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import type { Db } from '../db/client';
import { entryGroup, quickbooksSync } from '../db/schema';
import { alert } from '../donations/delivery';
import type { EmailProvider } from '../email/provider';
import type {
	AccountingFailure,
	AccountingFailureReason,
	AccountingProvider,
	SendAttempt
} from './provider';
import { readSendable } from './record';

// the outbox, delivered: what reads `quickbooks_sync` and sends what it names.
//
// it is ../donations/pending-crypto-read.ts for the books — the same shape, for the same reasons: a
// bound on what one run reads, a deadline measured against the run's own scheduled time, one row's
// fault not stopping the rest, and a fault the whole backlog is behind ending the run. what is
// different is that this table is a queue rather than a recovery read, so a row here carries where
// it got to, and every run that moves it is this one.
//
// **it builds no provider and holds no credential.** an `AccountingProvider` is handed in, the way
// ../donations/pending-crypto-read.ts takes one off `Processors` — so every case below can be run
// against a provider written in a test file, and the client id, the secret and the API address
// reach this module through nobody.
//
// ---------------------------------------------------------------------------
// a run sends only what it claimed, and that is the whole of why a gift is posted once.
//
// the cron fires every minute and a run can outlast a minute, so two runs over one backlog is
// ordinary. `leased_until` is what keeps them apart (../db/schema.ts): a row is taken by the
// update's own `where` — due, and held by nobody — and only what that update *returns* is sent.
// the second run's update matches nothing and it sends nothing. there is no read of the row in
// front of that write, because the ledger's rule is that no invariant is enforced by an atomic
// read-then-write (../ledger/posting.ts), and this one could not be: Intuit's request id is kept
// for a period it does not publish (./quickbooks.ts), so a gift posted twice can be two records in
// the company's books, and a correcting entry in *this* app's ledger cannot settle it.
//
// the claim counts an attempt as it takes the row, so every row that ever left for Intuit reads
// `attempts > 0` whatever happened after. it is given back the moment the row is written — sent,
// given up on, or waiting — so nothing waits out a lease it no longer needs. a run that died
// mid-send writes nothing more, and its rows come back once the lease passes, counted, so the next
// send looks before it posts.
//
// ---------------------------------------------------------------------------
// the three statuses, and every one a *run* writes is written here.
//
// the one other writer is ./backlog.ts, and it writes one transition: `failed` back to `pending`,
// when an operator presses retry on the console. so a status moves by a run or by a person and by
// nothing else. moving the start date (./outbox.ts) adds `pending` rows and removes rows no run
// has ever sent, and changes the status of none.
//
//   pending — owed and not finished, whether or not it has failed before. `attempts` counts the
//             tries and `last_error` holds the last one's words.
//   sent    — finished. `remote_id` is written by the same statement, so a row cannot read as sent
//             with nothing to point at; a row holding one is never sent again, whatever an
//             accountant does to that record afterwards (../db/schema.ts).
//   failed  — given up on, and reached only from a row-level terminal refusal. it is what the
//             console counts, and a retry there is that row put back to `pending`.
//
// ---------------------------------------------------------------------------
// where a refusal lands, and it is not `retryable` alone.
//
// five of the port's reasons are one fault the whole backlog is behind — no company connected, the
// three accounts not picked, a dead credential, a throttled provider, a provider that cannot be
// reached. none of them is about the row being sent, so none of them marks a row: the claim and
// its attempt are given back, nothing else is written, and the backlog is read again next time.
// marking a hundred gifts over one revoked credential would leave an operator repairing rows
// instead of the one thing that is wrong. the one exception is the attempt on a provider that
// could not be reached, which stays, because that call may have created the record before the wait
// ran out — and `attempts` is what the next send reads to know it has to look before it posts
// (./quickbooks.ts).
//
// four are about this row and no later run answers them differently — an id nothing carries, an
// account outside the three, a payload the provider refused, a record this app should never have
// queued. the row becomes `failed` and the run carries on to the row behind it.
//
// `provider_error` is the one that waits: the row stays `pending`, keeps the claim's attempt,
// and the backoff below decides when it is read again.
//
// ---------------------------------------------------------------------------
// no attempt cap, and that is deliberate.
//
// a gift owed to the books stays owed. a row abandoned after n tries is money in the ledger that
// nothing will ever send, with nothing anywhere saying so — `attempts` is a diagnostic and never a
// countdown. what keeps a row nothing can fix cheap is the backoff, not a limit.
//
// ---------------------------------------------------------------------------
// the notice re-arms on a cooldown, and there are two of them.
//
// a run with something to report sends one alert and stamps `notified_at` on every row of the set
// it reported. a set holding a stamp newer than `NOTICE_COOLDOWN_MS` is quiet, so the run a minute
// later says nothing and a backlog still stuck tomorrow is told about again. **what re-arms it is
// the clock and not the rows**: a gift given up on that nobody retries never leaves the failing
// set, so a notice suppressed on a stamp existing at all would be one row silencing every outage
// behind it for good.
//
// **rows failing.** a run that ends with rows given up on, or waiting after a failure, reports the
// whole of that set. a row that reaches `sent` leaves it, so a backlog that clears and then fails
// again is a fresh outage and is reported whatever the cooldown says.
//
// **the run blocked.** a run that stopped has failed no row, so row state says nothing at all
// about a backlog piling up behind a dead credential — which is the outage most worth an email. it
// is reported off the blocking reason instead, over every unfinished row and stamped the same way.
// two of the five reasons say nothing here: a throttled provider clears itself within a run or
// two, and a deployment nobody has connected is a deliberate act the console's connection screen
// already shows. a provider that could not be reached waits an hour, so a blip between two runs
// costs no email.
//
// one notice a run, never two. a blocked run marked nothing, so whatever the failing-set arm would
// have said is about a backlog some earlier run has already reported.

/** everything one run needs, all per request: the books, the company to send to, and the mail. */
export type AccountingDeliveryDeps = {
	readonly db: Db;
	readonly provider: AccountingProvider;
	/** the mail transport the failure notice rides. its failures are reported, never raised. */
	readonly email: EmailProvider;
};

/**
 * entry groups sent per run, in the order {@link dueRows} takes them.
 *
 * a send costs a handful of D1 statements — the entry and its lines, the cut posted beside it, the
 * donor it names — three to five calls to the provider, and one write. ten of those finish well
 * inside {@link RUN_DEADLINE_MS} and inside what Intuit meters per realm per minute, and a run a
 * minute drains a backlog steadily rather than in one invocation that cannot finish.
 */
const SENDS_PER_RUN = 10;

/**
 * no send starts this long after the run's scheduled time.
 *
 * the schedule is every minute, and a cron invocation at a cadence under an hour is killed at
 * thirty seconds of CPU — the fifteen-minute figure is the wall-clock row, for an hourly or longer
 * trigger, and does not apply here. the margin left is for the send already under way. what is not
 * reached is read on the next run, because nothing here is finished by a run ending — the row is
 * still `pending` and still owed.
 */
const RUN_DEADLINE_MS = 20_000;

/**
 * how long a claimed row is the claiming run's alone, measured from that run's scheduled time.
 *
 * it covers a send still in flight and nothing longer: this is what a gift waits when the run
 * holding it died before it could write anything.
 */
const LEASE_MS = 5 * 60_000;

/** what a row that has failed once waits before it is tried again. */
const BACKOFF_FIRST_MS = 60_000;

/**
 * the longest a row ever waits. a day-long outage costs a row about one attempt an hour, which is
 * what makes a cap on attempts unnecessary rather than merely unkind.
 */
const BACKOFF_CEILING_MS = 60 * 60_000;

/**
 * how long a provider that could not be reached is given before a stopped run is worth an email.
 *
 * a timeout between two runs is not an outage. the two faults that never clear on their own — a
 * dead credential, and accounts nobody has picked — wait for nothing.
 */
const BLIP_GRACE_MS = 60 * 60_000;

/**
 * how long one notice keeps the next one over the same set quiet.
 *
 * what it buys is the second outage being reported at all. a notice suppressed on a stamp existing
 * anywhere in the set is a notice one row can end for good: a gift given up on that nobody ever
 * retries keeps its stamp and never leaves the failing set, so every later backlog — a revoked
 * credential, a hundred gifts piling up — goes out to nobody. a day is long enough that an outage
 * nobody is repairing costs one email a day rather than one a minute, and short enough that the
 * next one is told about while it is still news.
 */
const NOTICE_COOLDOWN_MS = 24 * 60 * 60_000;

/**
 * how long a row that has failed `attempts` times waits, doubling from a minute to the ceiling.
 *
 * zero at zero: a row nobody has tried is due the moment it is queued, which is what makes the
 * sweep the delivery rather than a delay in front of one.
 */
export function backoffMs(attempts: number): number {
	if (attempts <= 0) return 0;
	return Math.min(BACKOFF_CEILING_MS, BACKOFF_FIRST_MS * 2 ** (attempts - 1));
}

/**
 * every rung up to the ceiling, read out of {@link backoffMs} itself.
 *
 * the query below has to express the same ladder in SQL, and a ladder written twice is two ladders:
 * generating the `case` from the function is what keeps the row a run reads and the row a test
 * calls `backoffMs` for the same row. it terminates because the ladder saturates.
 */
const LADDER: readonly number[] = (() => {
	const rungs: number[] = [];
	for (let attempts = 0; ; attempts++) {
		const wait = backoffMs(attempts);
		rungs.push(wait);
		if (wait === BACKOFF_CEILING_MS) return rungs;
	}
})();

/** the rows whose wait is over at `now`, as a condition on `updated_at` and `attempts`. */
function waitIsOver(now: Date): SQL {
	const rungs = LADDER.map(
		(wait, attempts) => sql`when ${quickbooksSync.attempts} = ${attempts} then ${wait}`
	);
	return sql`${quickbooksSync.updatedAt} + (case ${sql.join(rungs, sql` `)} else ${BACKOFF_CEILING_MS} end) <= ${now.getTime()}`;
}

/**
 * the rows a run may take: owed, and held by nobody.
 *
 * a lease that has run out is no lease — the run that wrote it is gone and the gift is owed either
 * way. `pending` and no other status: a row given up on waits for a person, and a sent one is
 * finished.
 */
function unclaimed(now: Date) {
	return and(
		eq(quickbooksSync.status, 'pending'),
		or(isNull(quickbooksSync.leasedUntil), lte(quickbooksSync.leasedUntil, now))
	);
}

/**
 * the rows an operator is told about at `now`: given up on, or waiting after a failure.
 *
 * a `pending` row with no attempt behind it is a gift queued a moment ago and is nobody's problem,
 * which is what keeps an ordinary minute’s gifts out of an outage’s count. a row under a live claim
 * is not waiting either: the claim counted its attempt before any answer came, so it is a send in
 * flight. once that lease is out, the run holding it died, and the row is counted.
 */
function failing(now: Date) {
	return or(
		eq(quickbooksSync.status, 'failed'),
		and(
			eq(quickbooksSync.status, 'pending'),
			gt(quickbooksSync.attempts, 0),
			or(isNull(quickbooksSync.leasedUntil), lte(quickbooksSync.leasedUntil, now))
		)
	);
}

/**
 * the backlog: every row still owed to QuickBooks, whatever it has been through.
 *
 * `in` rather than "not sent", so the read is one the status index can answer. it is what a blocked
 * run counts, because such a run marked nothing and row state says nothing about what is stuck.
 */
const UNFINISHED = inArray(quickbooksSync.status, ['pending', 'failed']);

/**
 * where a refusal lands.
 *
 *   run     — the whole backlog is behind this one fault. no row is touched and the run ends.
 *   row     — this row will be refused the same way forever. it becomes `failed`.
 *   attempt — worth asking again. the row stays `pending` and waits out its backoff.
 */
export type FailureLanding = 'run' | 'row' | 'attempt';

/**
 * total over the port's reasons, so one added to ./provider.ts is a compile error here rather than
 * a row quietly given up on. ./deliver.spec.ts holds the same table a second time, which is what
 * makes the decision somebody's rather than the default's.
 */
const LANDING_OF: Readonly<Record<AccountingFailureReason, FailureLanding>> = {
	not_connected: 'run',
	accounts_not_chosen: 'run',
	reconnect_needed: 'run',
	rate_limited: 'run',
	unreachable: 'run',
	not_found: 'row',
	unmapped_account: 'row',
	invalid_record: 'row',
	internal_error: 'row',
	provider_error: 'attempt'
};

export function landingOf(reason: AccountingFailureReason): FailureLanding {
	return LANDING_OF[reason];
}

/**
 * whether a run stopped by a reason tells an operator, and how soon.
 *
 *   at_once       — nothing clears this without somebody acting, so a backlog behind it is a
 *                   backlog nobody will otherwise notice.
 *   after_a_while — worth an email only once the oldest gift has waited out {@link BLIP_GRACE_MS}.
 *   never         — a throttled provider comes back on its own, and a deployment nobody has
 *                   connected is a deliberate act the console's connection screen shows.
 */
export type BlockedNotice = 'at_once' | 'after_a_while' | 'never';

/**
 * total over the port's reasons the way {@link LANDING_OF} is, so a reason added to ./provider.ts
 * is a compile error rather than one that silently never tells anybody.
 *
 * the row-level reasons are `never` because they cannot arrive here at all — `landingOf` is what
 * decides whether a refusal stops a run — and they are written out rather than left to a default,
 * because a default is how a reason that *should* stop a run comes to say nothing.
 */
const BLOCKED_NOTICE_OF: Readonly<Record<AccountingFailureReason, BlockedNotice>> = {
	reconnect_needed: 'at_once',
	accounts_not_chosen: 'at_once',
	unreachable: 'after_a_while',
	rate_limited: 'never',
	not_connected: 'never',
	not_found: 'never',
	unmapped_account: 'never',
	invalid_record: 'never',
	internal_error: 'never',
	provider_error: 'never'
};

export function blockedNoticeOf(reason: AccountingFailureReason): BlockedNotice {
	return BLOCKED_NOTICE_OF[reason];
}

/**
 * what one queued entry group came to, and what it asks of the caller.
 *
 *   sent         — it is in the company's books, under `remoteId`.
 *   nothing_owed — nothing for this call to send: no queue row carries that id, the row is
 *                  finished or given up on, or another run is holding it. nothing was sent.
 *   given_up     — the row is `failed`. a person decides whether it is ever sent.
 *   waiting      — the row is still `pending` and is read again once its backoff is over.
 *   blocked      — nothing about this row: the deployment cannot send at all. **a caller working
 *                  through a backlog stops here**, because every row behind it answers the same.
 */
export type QueuedEntryResult =
	| { readonly disposition: 'sent'; readonly remoteId: string }
	| { readonly disposition: 'nothing_owed'; readonly detail: string }
	| {
			readonly disposition: 'given_up' | 'waiting' | 'blocked';
			readonly failure: AccountingFailure;
	  };

/**
 * one queued entry group sent, and its row written to say so.
 *
 * **the row is claimed before anything is sent**, by the update's own `where` — so a second run
 * over the same row claims nothing and sends nothing, and this one posts the gift once.
 *
 * `now` is the run's scheduled time and is what the row's `updated_at` is set to, so the backoff is
 * measured against the clock the next run reads rather than against whenever the write landed.
 *
 * the sweep below is what calls it. a retry on the console does not: ./backlog.ts puts every
 * given-up row back to `pending`, and the next sweep is what sends them.
 */
export async function sendQueuedEntry(
	deps: AccountingDeliveryDeps,
	entryGroupId: string,
	now: Date
): Promise<QueuedEntryResult> {
	const [claimed] = await deps.db
		.update(quickbooksSync)
		.set({
			leasedUntil: new Date(now.getTime() + LEASE_MS),
			// counted as the row is taken, not once the answer is in: a run can die between the post
			// landing and writing it down, and the count it left is what tells the next send to look
			// before it posts, and a start-date move not to drop the row (./outbox.ts).
			attempts: sql`${quickbooksSync.attempts} + 1`,
			// held where it is, the way `stamp` below holds it: `updated_at` is what the backoff is
			// measured from, and it moves when a row-level answer is written.
			updatedAt: sql`${quickbooksSync.updatedAt}`
		})
		.where(and(eq(quickbooksSync.entryGroupId, entryGroupId), unclaimed(now)))
		.returning({ attempts: quickbooksSync.attempts, updatedAt: quickbooksSync.updatedAt });

	if (claimed === undefined) return unclaimable(deps.db, entryGroupId);

	const sendable = await readSendable(deps.db, entryGroupId);
	if (!sendable.ok) return land(deps.db, entryGroupId, sendable, 'unsent', now);

	// what the adapter spends on looking for a record it may already have posted (./quickbooks.ts):
	// one attempt is this claim's own, so a row claimed at one is a row nothing has ever sent.
	const attempt: SendAttempt = claimed.attempts > 1 ? 'again' : 'first';
	// held by the claim, so it is the `updated_at` the last row-level answer or retry wrote: the same
	// after a call that never answered, a stopped run or a run that died.
	const revision = String(claimed.updatedAt.getTime());
	const sent =
		sendable.value.kind === 'gift'
			? await deps.provider.sendGift(sendable.value.gift, attempt, revision)
			: await deps.provider.sendCorrection(sendable.value.correction, attempt, revision);
	if (!sent.ok) return land(deps.db, entryGroupId, sent, 'sent', now);

	await deps.db
		.update(quickbooksSync)
		.set({
			status: 'sent',
			remoteId: sent.value.remoteId,
			lastError: null,
			leasedUntil: null,
			updatedAt: now
		})
		.where(eq(quickbooksSync.entryGroupId, entryGroupId));
	return { disposition: 'sent', remoteId: sent.value.remoteId };
}

/** why nothing was claimed, in the words a person reads. nothing was sent on any of these paths. */
async function unclaimable(db: Db, entryGroupId: string): Promise<QueuedEntryResult> {
	const [queued] = await db
		.select({ status: quickbooksSync.status })
		.from(quickbooksSync)
		.where(eq(quickbooksSync.entryGroupId, entryGroupId));

	if (queued === undefined) {
		return {
			disposition: 'nothing_owed',
			detail: `No journal entry is queued for QuickBooks under the id ${entryGroupId}.`
		};
	}
	if (queued.status === 'sent') {
		// finished is finished: re-sending would duplicate a hand-edit or resurrect a record
		// somebody deleted in QuickBooks on purpose (../db/schema.ts).
		return {
			disposition: 'nothing_owed',
			detail: `The journal entry ${entryGroupId} is already in QuickBooks.`
		};
	}
	if (queued.status === 'failed') {
		return {
			disposition: 'nothing_owed',
			detail: `The journal entry ${entryGroupId} was given up on, and reaches QuickBooks only if somebody retries it.`
		};
	}
	return {
		disposition: 'nothing_owed',
		detail: `Another delivery run is sending the journal entry ${entryGroupId}.`
	};
}

/**
 * the refusal written where it belongs, or left alone where it is not about this row.
 *
 * `unsent` is a refusal from before anything was handed to the provider. a run or row landing
 * gives the claim's attempt back for it, since nothing left for Intuit; a waiting row keeps it,
 * because its wait is read off the count.
 */
async function land(
	db: Db,
	entryGroupId: string,
	failure: AccountingFailure,
	handed: 'sent' | 'unsent',
	now: Date
): Promise<QueuedEntryResult> {
	const landing = landingOf(failure.reason);
	// the four run-level answers other than `unreachable` say nothing was made. `unreachable` keeps
	// the attempt: a call whose answer never came may have created the record, and the count is
	// what tells the next send to look before it posts.
	const givenBack =
		handed === 'unsent' || (landing === 'run' && failure.reason !== 'unreachable')
			? { attempts: sql`${quickbooksSync.attempts} - 1` }
			: {};
	if (landing === 'run') {
		// the row is left exactly as it stands, minus the claim: nothing about it is why the run
		// stopped, and the next run has to be free to read it again.
		await db
			.update(quickbooksSync)
			.set({
				...givenBack,
				leasedUntil: null,
				updatedAt: sql`${quickbooksSync.updatedAt}`
			})
			.where(eq(quickbooksSync.entryGroupId, entryGroupId));
		return { disposition: 'blocked', failure };
	}

	if (landing === 'row') {
		await db
			.update(quickbooksSync)
			.set({
				...givenBack,
				status: 'failed',
				lastError: failure.detail,
				leasedUntil: null,
				updatedAt: now
			})
			.where(eq(quickbooksSync.entryGroupId, entryGroupId));
		return { disposition: 'given_up', failure };
	}

	await db
		.update(quickbooksSync)
		.set({
			lastError: failure.detail,
			// given back rather than left to expire: the backoff is what decides when this row is
			// read again, and a lease outliving it would be a second, longer wait nobody asked for.
			leasedUntil: null,
			updatedAt: now
		})
		.where(eq(quickbooksSync.entryGroupId, entryGroupId));
	return { disposition: 'waiting', failure };
}

/**
 * every entry group whose wait is over, sent, and an operator told where the backlog is stuck.
 *
 * `now` is the run's scheduled time. one row's fault does not stop the rest; a fault the whole
 * backlog is behind does, and leaves every row unsent for the next run to read again.
 */
export async function sendDueEntries(deps: AccountingDeliveryDeps, now: Date): Promise<void> {
	const due = await dueRows(deps.db, now);

	const deadline = now.getTime() + RUN_DEADLINE_MS;
	let blocked: AccountingFailure | null = null;
	for (const { entryGroupId } of due) {
		if (Date.now() >= deadline) break;
		try {
			const result = await sendQueuedEntry(deps, entryGroupId, now);
			if (result.disposition === 'blocked') {
				blocked = result.failure;
				report('the QuickBooks delivery stopped:', result.failure.detail);
				break;
			}
		} catch (error) {
			// the row is left as the claim wrote it, lease and attempt: what throws here is the
			// database or a defect in the adapter, either can come after the post landed, and the row
			// is read again once the lease is out.
			report(`sending the journal entry ${entryGroupId} to QuickBooks faulted:`, error);
		}
	}

	if (blocked !== null) {
		await notifyBlocked(deps, blocked, now);
		return;
	}
	await notifyFailing(deps, now);
}

/**
 * whether a row was queued by its own settlement rather than by a start-date move.
 *
 * a settlement's row copies its entry group's `created_at` and a move's is stamped later
 * (./outbox.ts's `pendingRow`), so equality is the whole test.
 */
const QUEUED_AS_SETTLED = sql`${quickbooksSync.createdAt} = ${entryGroup.createdAt}`;

/**
 * what one run reads: entry groups nobody is holding whose wait is over, gifts queued as they
 * settled first and oldest queued first, then history a move queued in date order.
 *
 * gifts first because a move earlier can queue the whole of a deployment's history at ten a run,
 * and a gift that settles after it would otherwise wait for all of it. the sort is over every due
 * row rather than read off `quickbooks_sync_status_due_idx`, which answers the filter only — the
 * tier comes from the entry group, and the table has no column of its own that carries it.
 *
 * exported for its query rather than its rows, so ./deliver.workers.spec.ts can read sqlite's plan
 * for this statement and ./outbox.workers.spec.ts the order a move leaves. a second copy of the
 * query written there would be a second query.
 */
export function dueRows(db: Db, now: Date) {
	return db
		.select({ entryGroupId: quickbooksSync.entryGroupId })
		.from(quickbooksSync)
		.innerJoin(entryGroup, eq(entryGroup.id, quickbooksSync.entryGroupId))
		.where(and(unclaimed(now), waitIsOver(now)))
		.orderBy(
			sql`case when ${QUEUED_AS_SETTLED} then 0 else 1 end`,
			sql`case when ${QUEUED_AS_SETTLED} then ${quickbooksSync.createdAt} else ${entryGroup.occurredAt} end`,
			asc(quickbooksSync.entryGroupId)
		)
		.limit(SENDS_PER_RUN);
}

/** one alert for the whole failing backlog, and no second one until the cooldown is out. */
async function notifyFailing(deps: AccountingDeliveryDeps, now: Date): Promise<void> {
	const [tally] = await deps.db
		.select({
			waiting: sql<number>`count(case when ${quickbooksSync.status} = 'pending' then 1 end)`,
			givenUp: sql<number>`count(case when ${quickbooksSync.status} = 'failed' then 1 end)`,
			reported: reportedSince(now)
		})
		.from(quickbooksSync)
		.where(failing(now));

	if (tally === undefined || tally.waiting + tally.givenUp === 0) return;
	if (tally.reported > 0) return;

	const [latest] = await deps.db
		.select({ lastError: quickbooksSync.lastError })
		.from(quickbooksSync)
		.where(and(failing(now), isNotNull(quickbooksSync.lastError)))
		.orderBy(desc(quickbooksSync.updatedAt))
		.limit(1);

	await alert(deps, {
		headline: 'QuickBooks would not take some of this deployment’s gifts',
		body:
			'Journal entries this deployment owes to QuickBooks were refused. The gifts are in this ' +
			'app’s own books and nothing has been lost. What is waiting is sent again on its own; what ' +
			'has been given up on is sent only if somebody retries it. This is sent once a day while the ' +
			'backlog stands, not once per gift.',
		facts: [
			{ label: 'Waiting to be sent', value: String(tally.waiting) },
			{ label: 'Given up on', value: String(tally.givenUp) },
			{ label: 'Last error', value: latest?.lastError ?? 'none recorded' }
		],
		action:
			'Open the console (`better-giving start`) and look at what QuickBooks refused. A gift given ' +
			'up on reaches the books only when it is retried there.'
	});

	await stamp(deps.db, failing(now), now);
}

/**
 * one alert for a run that could not send anything at all, and no second one until the cooldown
 * is out.
 *
 * the count is every unfinished row rather than the rows this run read: what is waiting is the
 * whole backlog, and the run stopped before reading most of it.
 */
async function notifyBlocked(
	deps: AccountingDeliveryDeps,
	failure: AccountingFailure,
	now: Date
): Promise<void> {
	const notice = blockedNoticeOf(failure.reason);
	if (notice === 'never') return;

	const [backlog] = await deps.db
		.select({
			waiting: sql<number>`count(*)`,
			oldest: sql<number | null>`min(${quickbooksSync.createdAt})`,
			reported: reportedSince(now)
		})
		.from(quickbooksSync)
		.where(UNFINISHED);

	if (backlog === undefined || backlog.waiting === 0 || backlog.oldest === null) return;
	if (notice === 'after_a_while' && backlog.oldest > now.getTime() - BLIP_GRACE_MS) return;
	if (backlog.reported > 0) return;

	await alert(deps, {
		headline: 'Nothing is reaching QuickBooks at all',
		body:
			'Every gift this deployment owes to QuickBooks is behind one fault, and no journal entry ' +
			'was sent. Nothing has been lost: the gifts are in this app’s own books and the whole ' +
			'backlog goes over once the fault is put right. This is sent once a day, not once per run.',
		facts: [
			{ label: 'Reason', value: failure.detail },
			{ label: 'Waiting to be sent', value: String(backlog.waiting) },
			{ label: 'Oldest has waited', value: waited(now.getTime() - backlog.oldest) }
		],
		action:
			'Open the console (`better-giving start`) and put the QuickBooks connection right: whether ' +
			'a company is still connected, and which accounts gifts are posted to.'
	});

	await stamp(deps.db, UNFINISHED, now);
}

/** how many rows of the set were reported inside {@link NOTICE_COOLDOWN_MS} of `now`. */
function reportedSince(now: Date): SQL<number> {
	const since = now.getTime() - NOTICE_COOLDOWN_MS;
	return sql<number>`count(case when ${quickbooksSync.notifiedAt} > ${since} then 1 end)`;
}

/**
 * `notified_at` written on every row of `set`, whatever it carried.
 *
 * every row and not only the unstamped ones, because the stamp is what the next cooldown is
 * measured from: a row left holding an older one would put the set back over the rung the moment
 * that one aged out, and report a backlog already reported.
 *
 * `updated_at` is held where it is, because it is what the wait is measured from: a row costed
 * another interval for having been reported is a gift that reaches the books later for no reason.
 * `attempts` is untouched for the same reason — being reported is not an attempt.
 */
async function stamp(db: Db, set: SQL | undefined, now: Date): Promise<void> {
	await db
		.update(quickbooksSync)
		.set({ notifiedAt: now, updatedAt: sql`${quickbooksSync.updatedAt}` })
		.where(set);
}

/** how long the oldest gift has waited, in the words somebody reading it would use. */
function waited(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 90) return counted(minutes, 'minute');
	const hours = Math.round(minutes / 60);
	return hours < 48 ? counted(hours, 'hour') : counted(Math.round(hours / 24), 'day');
}

function counted(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function report(message: string, detail: unknown): void {
	try {
		console.error(message, detail);
	} catch {
		// nothing to report it to, and nothing here may throw.
	}
}
