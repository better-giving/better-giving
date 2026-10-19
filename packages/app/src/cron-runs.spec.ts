import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDueEntries } from '$lib/server/accounting/deliver';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { sendOwedRefundNotices } from '$lib/server/donations/refund-notice';
import { parseCron } from '$lib/server/runtime/scheduler';
import { sendDueWebhooks } from '$lib/server/webhooks/deliver';
import { mailPause } from '$lib/server/webhooks/paused-mail';
import { sendDueZapierEvents } from '$lib/server/zapier/deliver';
import { CRON_RUNS } from './cron-runs';
import type { Db } from '$lib/server/db/client';

// the join between the schedule and the work ./cron-runs.ts runs for it.
//
// the table's keys are the schedule: the scheduler ($lib/server/runtime/scheduler.ts) fires each
// key and nothing else, so a schedule with no job cannot be written. what can is a job behind a key
// that never fires — one the scheduler's parser refuses, or one no minute matches — and that is
// what the first block holds out.
//
// the jobs are mocked, because what is under test is which ones an expression reaches and with
// what time — their own behaviour is held by
// $lib/server/donations/pending-crypto-read.workers.spec.ts,
// $lib/server/donations/refund-notice.workers.spec.ts,
// $lib/server/accounting/deliver.workers.spec.ts, $lib/server/zapier/deliver.workers.spec.ts and
// $lib/server/webhooks/deliver.workers.spec.ts, against a real database.

vi.mock('$lib/server/donations/pending-crypto-read', () => ({
	readPendingCryptoGifts: vi.fn(async () => {})
}));
vi.mock('$lib/server/donations/refund-notice', () => ({
	sendOwedRefundNotices: vi.fn(async () => {})
}));
vi.mock('$lib/server/accounting/deliver', () => ({
	sendDueEntries: vi.fn(async () => {})
}));
vi.mock('$lib/server/zapier/deliver', () => ({
	sendDueZapierEvents: vi.fn(async () => {})
}));
vi.mock('$lib/server/webhooks/deliver', () => ({
	sendDueWebhooks: vi.fn(async () => {})
}));
vi.mock('$lib/server/webhooks/paused-mail', () => ({
	mailPause: vi.fn(() => async () => {})
}));

const SCHEDULED = Object.keys(CRON_RUNS);

/** every UTC minute of 2028, a leap year, so a February 29th schedule meets its day. */
function* minutesOf2028(): Generator<Date> {
	const end = Date.UTC(2029, 0, 1);
	for (let at = Date.UTC(2028, 0, 1); at < end; at += 60_000) yield new Date(at);
}

const SCHEDULED_AT = new Date('2026-09-20T12:30:00.000Z');

/** the env a run is handed. nothing below reaches configuration: every job is mocked. */
const env = {} as Env;

/** the database handle a run is handed, never read: every job is mocked. */
const db = {} as Db;

/** one cron firing, run to its end. */
async function fires(cron: string, runEnv = env): Promise<void> {
	await CRON_RUNS[cron]?.(runEnv, db, SCHEDULED_AT);
}

/** every job a cron can reach, for the cases asserting on none of them or all. */
const JOBS = [
	readPendingCryptoGifts,
	sendOwedRefundNotices,
	sendDueEntries,
	sendDueZapierEvents,
	sendDueWebhooks
] as const;

// `restoreMocks` in ../vitest.config.ts restores a spy's implementation and leaves a module mock's
// call history and a rejection a case set on it alone, so a case would be reading every case
// before it.
beforeEach(() => {
	for (const job of JOBS) vi.mocked(job).mockReset().mockResolvedValue(undefined);
	vi.mocked(mailPause).mockClear();
});

describe('the schedule', () => {
	it('has runs', () => {
		expect(SCHEDULED.length).toBeGreaterThan(0);
	});

	it.each(SCHEDULED)('fires %s in a year', (cron) => {
		const matches = parseCron(cron);
		let fired = false;
		for (const at of minutesOf2028()) {
			if (matches(at)) {
				fired = true;
				break;
			}
		}

		expect(fired).toBe(true);
	});

	it.each(SCHEDULED)('runs work on %s', async (cron) => {
		await fires(cron);

		expect(JOBS.some((job) => vi.mocked(job).mock.calls.length > 0)).toBe(true);
	});
});

describe('which run an expression reaches', () => {
	it('reads back the crypto gifts no IPN settled every half hour, from the run’s own time', async () => {
		await fires('*/30 * * * *');

		expect(readPendingCryptoGifts).toHaveBeenCalledWith(expect.anything(), SCHEDULED_AT);
		expect(sendDueEntries).not.toHaveBeenCalled();
	});

	it.each(['15 * * * *', '45 * * * *'])(
		'sends the refund notices still owed on %s, from the run’s own time',
		async (cron) => {
			await fires(cron);

			expect(sendOwedRefundNotices).toHaveBeenCalledWith(
				{ db: expect.anything(), email: expect.anything() },
				SCHEDULED_AT
			);
			expect(readPendingCryptoGifts).not.toHaveBeenCalled();
			expect(sendDueEntries).not.toHaveBeenCalled();
		}
	);

	it('sends what the books, the Zaps and the destinations are owed every minute, from the run’s own time', async () => {
		await fires('* * * * *');

		expect(sendDueEntries).toHaveBeenCalledWith(expect.anything(), SCHEDULED_AT);
		expect(sendDueZapierEvents).toHaveBeenCalledWith(
			{ db: expect.anything(), fetch: expect.any(Function) },
			SCHEDULED_AT
		);
		expect(sendDueWebhooks).toHaveBeenCalledWith(
			{
				db: expect.anything(),
				fetch: expect.any(Function),
				onPaused: expect.any(Function)
			},
			SCHEDULED_AT
		);
		expect(readPendingCryptoGifts).not.toHaveBeenCalled();
	});

	it('hands every feed the same deps on a deployment holding an unlisted var set to true', async () => {
		await fires('* * * * *', { SOME_OLD_VAR: 'true' } as unknown as typeof env);

		// no pace rides in the deps, so each feed claims the one it declares (outbox/budget.ts).
		expect(sendDueZapierEvents).toHaveBeenCalledWith(
			{ db: expect.anything(), fetch: expect.any(Function) },
			SCHEDULED_AT
		);
		expect(sendDueWebhooks).toHaveBeenCalledWith(
			{ db: expect.anything(), fetch: expect.any(Function), onPaused: expect.any(Function) },
			SCHEDULED_AT
		);
		const booksDeps = vi.mocked(sendDueEntries).mock.calls[0]?.[0] ?? {};
		expect(Object.keys(booksDeps).sort()).toEqual(['db', 'email', 'provider']);
	});

	/** the `onPaused` the minute run handed the destinations' delivery, told of one pause. */
	async function pauseTold(runEnv = env) {
		await fires('* * * * *', runEnv);
		const onPaused = vi.mocked(sendDueWebhooks).mock.calls[0]?.[0].onPaused;
		await onPaused?.({ id: 'd1', url: 'https://crm.example.org/hooks', reason: 'gone' });
	}

	it('mails a paused destination to the operator, linking the deployment’s pinned address', async () => {
		await pauseTold({ BETTER_AUTH_URL: 'https://donate.example.org/' } as typeof env);

		expect(mailPause).toHaveBeenCalledExactlyOnceWith({
			db: expect.anything(),
			email: expect.anything(),
			origin: 'https://donate.example.org'
		});
	});

	it('mails a paused destination with no link where no address is pinned', async () => {
		await pauseTold();

		expect(mailPause).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ origin: null }));
	});

	it('runs every minute job where the pinned address does not parse', async () => {
		await fires('* * * * *', { BETTER_AUTH_URL: 'donate.example.org' } as typeof env);

		for (const job of [sendDueEntries, sendDueZapierEvents, sendDueWebhooks]) {
			expect(job).toHaveBeenCalledOnce();
		}
	});

	it.each([
		['the books', sendDueEntries, [sendDueZapierEvents, sendDueWebhooks]],
		['the Zaps', sendDueZapierEvents, [sendDueEntries, sendDueWebhooks]],
		['the destinations', sendDueWebhooks, [sendDueEntries, sendDueZapierEvents]]
	] as const)(
		'still runs the other minute jobs when %s one throws, and reports the throw',
		async (_, failing, others) => {
			const fault = new Error('the database went away');
			vi.mocked(failing).mockRejectedValue(fault);

			await expect(fires('* * * * *')).rejects.toBe(fault);
			for (const other of others) {
				expect(other).toHaveBeenCalledWith(expect.anything(), SCHEDULED_AT);
			}
		}
	);

	it('reports every throw when more than one minute job throws', async () => {
		const books = new Error('books');
		const zaps = new Error('zaps');
		const destinations = new Error('destinations');
		vi.mocked(sendDueEntries).mockRejectedValue(books);
		vi.mocked(sendDueZapierEvents).mockRejectedValue(zaps);
		vi.mocked(sendDueWebhooks).mockRejectedValue(destinations);

		const thrown = await fires('* * * * *').catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(AggregateError);
		expect((thrown as AggregateError).errors).toEqual([books, zaps, destinations]);
	});
});
