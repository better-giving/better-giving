import { and, asc, desc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { payment } from '../db/schema';
import type { EmailProvider } from '../email/provider';
import type { Processors } from '../payments/factory';
import { settleTransaction } from './settle';

// the scheduled read that settles a crypto gift no IPN settled: src/worker.ts's `scheduled` handler,
// on the cron `triggers` in wrangler.jsonc.
//
// NOWPayments sends an IPN on each status change and sends none once an address expires, and a
// non-2xx IPN is sent again only the number of times set in its dashboard — so a gift whose address
// expired, or whose IPN was lost, is otherwise pending forever. every pending crypto payment old
// enough is read back through `settleTransaction` in ./settle.ts, the write the IPN takes: an expired
// address with nothing sent leaves its gift not given, anything that arrived is settled at its value.
//
// a read racing an IPN posts once: `entry_group_source_idx` and `payment_provider_txn_idx` in
// ../db/schema.ts refuse the second write, and nothing here locks.
//
// a payment NOWPayments does not find — the key replaced with another account's since it was minted —
// stays pending and is logged, never alerted, and nothing on the console surfaces it; a day after its
// address closed it is no longer read. any other refusal alerts an operator, as an IPN's does. a read
// NOWPayments did not answer — unreachable, rate limited, or a key it refuses outright, which the
// console's NOWPayments page reports — is logged and ends the run, and what is left is read on the
// next one.
//
// a later deposit to an expired address sends no IPN and has no row to read; the organisation enters
// it through Add donation.

/** how long a payment has had for its IPN before it is read. */
const IPN_GRACE_MS = 30 * 60_000;

/**
 * how long after its address closes a payment is still read. one still pending a day on is one the
 * reads cannot settle, and reading it every run would crowd out the gifts behind it. `valid_until` is
 * on every pending NOWPayments row: `depositProblem` in ./record.ts refuses a crypto gift without it,
 * and a repeat deposit, which carries none, is written settled.
 */
const READ_AFTER_CLOSE_MS = 24 * 60 * 60_000;

/**
 * payments read per run, one after another, closed addresses first and then open ones, each oldest
 * first. a read costs a status call, an estimate where no dollar value came with it, a handful of D1
 * statements and the mail a settlement sends — far inside the paid plan's 10,000 subrequests per
 * invocation. what bounds a run is time rather than count: see `RUN_DEADLINE_MS`.
 */
const READS_PER_RUN = 100;

/**
 * no read starts this long after the run's scheduled time. a cron invocation is killed at fifteen
 * minutes of wall clock, and one read can wait out NOWPayments' timeout twice and SMTP's on each
 * message, so the margin is for the read already under way. CPU is the other limit — thirty seconds
 * for a cron under an hourly interval (https://developers.cloudflare.com/workers/platform/limits/) —
 * and a run spends it on little but awaiting I/O.
 */
const RUN_DEADLINE_MS = 10 * 60_000;

type PendingCryptoReadDeps = {
	readonly db: Db;
	readonly processors: Processors;
	readonly email: EmailProvider;
};

/**
 * reads back every pending crypto payment minted at least thirty minutes before `now` whose address
 * closed less than a day before it, and settles each. `now` is the run's scheduled time. one payment's
 * fault does not stop the rest; a read NOWPayments did not answer does.
 */
export async function readPendingCryptoGifts(
	deps: PendingCryptoReadDeps,
	now: Date
): Promise<void> {
	if (!deps.processors.configured.includes('nowpayments')) return;

	const provider = deps.processors.for('nowpayments');
	const settleDeps = {
		db: deps.db,
		provider,
		processors: deps.processors,
		email: deps.email,
		// the adapter keeps the account's coin lists for its life, a failed read included, so a run
		// reads them once and a run whose read failed names every coin by its code.
		payableCoins: async () => {
			const read = await provider.listPayableCoins();
			return read.ok ? read.value : null;
		}
	};

	const due = await deps.db
		.select({ providerTxnId: sql<string>`${payment.providerTxnId}` })
		.from(payment)
		.where(
			and(
				eq(payment.method, 'crypto'),
				eq(payment.direction, 'inbound'),
				eq(payment.status, 'pending'),
				eq(payment.provider, 'nowpayments'),
				isNotNull(payment.providerTxnId),
				lte(payment.createdAt, new Date(now.getTime() - IPN_GRACE_MS)),
				gt(payment.validUntil, new Date(now.getTime() - READ_AFTER_CLOSE_MS))
			)
		)
		.orderBy(desc(lte(payment.validUntil, now)), asc(payment.createdAt), asc(payment.id))
		.limit(READS_PER_RUN);

	const deadline = now.getTime() + RUN_DEADLINE_MS;
	for (const { providerTxnId } of due) {
		if (Date.now() >= deadline) return;
		try {
			// not an IPN's `payment_id:status:amount`, so an operator can tell which one reached it.
			const eventId = `scheduled:${providerTxnId}:${now.toISOString()}`;
			const result = await settleTransaction(settleDeps, {
				providerTxnId,
				eventId,
				quietWhenUnreadable: true
			});
			if (!result.ok) {
				report(
					`NOWPayments did not answer for payment ${providerTxnId}; the run stopped:`,
					result.detail
				);
				return;
			}
			if (result.outcome === 'unactionable') {
				report(`payment ${providerTxnId} was not settled:`, result.detail);
			}
		} catch (error) {
			report(`reading payment ${providerTxnId} faulted:`, error);
		}
	}
}

function report(message: string, detail: unknown): void {
	try {
		console.error(message, detail);
	} catch {
		// nothing to report it to, and nothing here may throw.
	}
}
