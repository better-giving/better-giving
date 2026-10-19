import { sendDueEntries } from '$lib/server/accounting/deliver';
import { createAccountingProvider } from '$lib/server/accounting/factory';
import { pinnedOrigin, readAuthEnv } from '$lib/server/auth/env';
import { sweepConnectorLeftovers } from '$lib/server/connector/keys';
import type { Db } from '$lib/server/db/client';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { sendOwedRefundNotices } from '$lib/server/donations/refund-notice';
import { createEmailProvider } from '$lib/server/email/factory';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { sendDueWebhooks } from '$lib/server/webhooks/deliver';
import { mailPause } from '$lib/server/webhooks/paused-mail';
import { sendDueZapierEvents } from '$lib/server/zapier/deliver';

/**
 * this deployment's whole schedule: each expression, the work it runs, keyed by that expression.
 * $lib/server/runtime/scheduler.ts fires each key on the UTC minutes it matches, and
 * ./server/app.ts's `startCron` hands it this table.
 *
 * every thirty minutes, the crypto gifts no IPN settled are read back. at a quarter past and a
 * quarter to, in a run of their own, the donor notices of refunds that did not send are sent
 * again. every minute, in one run, what this deployment owes is sent: the organisation's books, its
 * Zaps and its webhook destinations — a minute because a gift is meant to arrive while it is still
 * the thing somebody is looking at, and a run on a deployment owing nothing is an indexed read of
 * each outbox and no call to anybody. what a row that has already failed waits is the backoff on
 * the row rather than this interval.
 *
 * the keys are the schedule, so a schedule with no work cannot be written; ./cron-runs.spec.ts
 * holds every key to one the scheduler reads and some minute matches.
 *
 * each run builds what it needs from the env and the database handle that run was handed, the way
 * a request's handles are built per request (./request-context.ts) — nothing built from
 * configuration is a module-scope singleton (CLAUDE.md).
 */
export const CRON_RUNS: Readonly<Record<string, (env: Env, db: Db, now: Date) => Promise<void>>> = {
	'*/30 * * * *': (env, db, now) =>
		readPendingCryptoGifts(
			{
				db,
				processors: createPaymentProviders(env),
				email: createEmailProvider(env)
			},
			now
		),

	'15 * * * *': (env, db, now) =>
		allRun([owedRefundNotices(env, db, now), sweepConnectorLeftovers(db, now)]),
	'45 * * * *': (env, db, now) => owedRefundNotices(env, db, now),

	'* * * * *': (env, db, now) => {
		// the three jobs below run in one invocation and spend its connections, subrequests and D1
		// queries together; ./lib/server/outbox/budget.ts is each one's share, and a job added here
		// takes a share there.
		//
		// one handle, shared by every delivery and by the connection the accounting provider reads
		// its tokens through: the store the factory builds is over this same database.
		return allRun([
			sendDueEntries(
				{
					db,
					provider: createAccountingProvider(env, db),
					email: createEmailProvider(env)
				},
				now
			),
			sendDueZapierEvents({ db, fetch }, now),
			sendDueWebhooks(
				{
					db,
					fetch,
					// the pin is read when a pause is mailed, so one that names no http(s) origin costs that
					// mail and not the run: `pinnedOrigin` throws on it, and ./lib/server/webhooks/deliver.ts
					// logs a throw from the hook.
					onPaused: (destination) =>
						mailPause({
							db,
							email: createEmailProvider(env),
							origin: pinnedOrigin(readAuthEnv(env))
						})(destination)
				},
				now
			)
		]);
	}
};

function owedRefundNotices(env: Env, db: Db, now: Date): Promise<void> {
	return sendOwedRefundNotices({ db, email: createEmailProvider(env) }, now);
}

/**
 * every job run to its end, a throw in one stopping none of the others, and then every throw
 * rethrown: one alone as itself, several as an `AggregateError` in the order the jobs were given.
 * the rethrow is what reaches whoever fired the run, and so the logs.
 */
export async function allRun(jobs: readonly Promise<void>[]): Promise<void> {
	const thrown = (await Promise.allSettled(jobs)).flatMap((settled) =>
		settled.status === 'rejected' ? [settled.reason as unknown] : []
	);
	if (thrown.length === 1) throw thrown[0];
	if (thrown.length > 1) throw new AggregateError(thrown, 'more than one scheduled job threw');
}
