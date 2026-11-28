import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDueEntries } from '$lib/server/accounting/deliver';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { sendOwedRefundNotices } from '$lib/server/donations/refund-notice';
import { refreshTickers } from '$lib/server/donations/ticker-refresh';
import { sendUnsentPacks } from '$lib/server/matching/pack';
import { sendDueReminders } from '$lib/server/matching/reminders';
import { sweepSupporterLeftovers } from '$lib/server/supporters/sweep';
import { parseCron } from '$lib/server/runtime/scheduler';
import { sendDueWebhooks } from '$lib/server/webhooks/deliver';
import { mailPause } from '$lib/server/webhooks/paused-mail';
import { sendDueZapierEvents } from '$lib/server/zapier/deliver';
import { pullSponsorEvents } from '$lib/server/payouts/pull';
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
// $lib/server/donations/pending-crypto-read.db.spec.ts,
// $lib/server/donations/refund-notice.db.spec.ts, $lib/server/supporters/sweep.db.spec.ts,
// $lib/server/matching/reminders.db.spec.ts, $lib/server/matching/pack.db.spec.ts,
// $lib/server/accounting/deliver.db.spec.ts, $lib/server/zapier/deliver.db.spec.ts,
// $lib/server/webhooks/deliver.db.spec.ts and $lib/server/donations/ticker-refresh.db.spec.ts,
// against a real database; the hourly sponsor pull is ./routes/api.sponsor.events.db.spec.ts.

vi.mock('$lib/server/donations/pending-crypto-read', () => ({
	readPendingCryptoGifts: vi.fn(async () => {})
}));
vi.mock('$lib/server/donations/refund-notice', () => ({
	sendOwedRefundNotices: vi.fn(async () => {})
}));
vi.mock('$lib/server/donations/ticker-refresh', () => ({
	refreshTickers: vi.fn(async () => {})
}));
vi.mock('$lib/server/payouts/pull', () => ({
	pullSponsorEvents: vi.fn(async () => {})
}));
vi.mock('$lib/server/matching/reminders', () => ({
	sendDueReminders: vi.fn(async () => {})
}));
vi.mock('$lib/server/matching/pack', () => ({
	sendUnsentPacks: vi.fn(async () => {})
}));
vi.mock('$lib/server/supporters/sweep', () => ({
	sweepSupporterLeftovers: vi.fn(async () => {})
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
const env = { SPONSOR_API_KEY: 'spk_test' } as Env;

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
	sweepSupporterLeftovers,
	sendDueReminders,
	sendUnsentPacks,
	sendDueEntries,
	sendDueZapierEvents,
	sendDueWebhooks,
	refreshTickers,
	pullSponsorEvents
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

	it('sweeps the supporter links and sessions that admit nothing at a quarter past, from the run’s own time', async () => {
		await fires('15 * * * *');

		expect(sweepSupporterLeftovers).toHaveBeenCalledExactlyOnceWith(db, SCHEDULED_AT);
	});

	it('refreshes the stock ticker list once a day at 04:20, handing it MAIL_FROM for sec.gov', async () => {
		await fires('20 4 * * *', { MAIL_FROM: ' giving@cedarfork.org ' } as unknown as typeof env);

		expect(refreshTickers).toHaveBeenCalledExactlyOnceWith(
			{
				db,
				fetch: expect.any(Function),
				email: expect.anything(),
				mailFrom: 'giving@cedarfork.org'
			},
			SCHEDULED_AT
		);
		expect(sendDueEntries).not.toHaveBeenCalled();
	});

	it.each([
		[
			'the pinned address',
			'https://donate.example.org/',
			{ origin: 'https://donate.example.org', pinned: true }
		],
		['no address where none is pinned', undefined, null]
	] as const)(
		'sends the employer match reminders due, and the packs that failed, every ten minutes, on %s',
		async (_, pin, giftOrigin) => {
			await fires('*/10 * * * *', { BETTER_AUTH_URL: pin } as unknown as typeof env);

			expect(sendDueReminders).toHaveBeenCalledExactlyOnceWith(
				{ db, email: expect.anything(), giftOrigin },
				SCHEDULED_AT
			);
			expect(sendUnsentPacks).toHaveBeenCalledExactlyOnceWith(
				{ db, email: expect.anything(), giftOrigin },
				SCHEDULED_AT
			);
			expect(sendDueEntries).not.toHaveBeenCalled();
		}
	);

	it('pulls the sponsor’s events on the hour, through the sponsor provider and a reader of its feed', async () => {
		await fires('0 * * * *');

		expect(pullSponsorEvents).toHaveBeenCalledExactlyOnceWith(
			{
				db,
				provider: expect.objectContaining({ processor: 'sponsor' }),
				processors: expect.anything(),
				email: expect.anything(),
				giftOrigin: null,
				sponsorFeed: expect.any(Function)
			},
			SCHEDULED_AT
		);
		expect(sendDueEntries).not.toHaveBeenCalled();
	});

	it('reads the feed after the cursor it is handed, with SPONSOR_API_KEY as the bearer', async () => {
		const read = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(Response.json({ events: [], has_more: false }));
		await fires('0 * * * *');
		const sponsorFeed = vi.mocked(pullSponsorEvents).mock.calls[0]?.[0].sponsorFeed;

		const result = await sponsorFeed?.(7);

		expect(result).toMatchObject({ ok: true, value: { events: [], next: 7, more: false } });
		const [url, init] = read.mock.calls[0] ?? [];
		expect(String(url)).toBe('https://better.giving/api/partner/v1/events?after=7');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer spk_test');
	});

	it('pulls nothing on the hour where SPONSOR_API_KEY is unset', async () => {
		await fires('0 * * * *', {} as Env);

		expect(pullSponsorEvents).not.toHaveBeenCalled();
	});

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
		expect(Object.keys(booksDeps).sort()).toEqual(['db', 'email', 'origin', 'provider']);
	});

	it.each([
		['the pinned address', 'https://donate.example.org/', 'https://donate.example.org'],
		['no address where none is pinned', undefined, null],
		['no address where the pin does not parse', 'donate.example.org', null]
	] as const)('hands the books %s to link its notice to', async (_, pin, origin) => {
		await fires('* * * * *', { BETTER_AUTH_URL: pin } as unknown as typeof env);

		expect(sendDueEntries).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ origin }),
			SCHEDULED_AT
		);
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

	it.each([
		['the match reminders', sendDueReminders, sendUnsentPacks],
		['the unsent match packs', sendUnsentPacks, sendDueReminders]
	] as const)(
		'still runs the other ten-minute job when %s one throws, and reports the throw',
		async (_, failing, other) => {
			const fault = new Error('the mail provider went away');
			vi.mocked(failing).mockRejectedValue(fault);

			await expect(fires('*/10 * * * *')).rejects.toBe(fault);
			expect(other).toHaveBeenCalledExactlyOnceWith(expect.anything(), SCHEDULED_AT);
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
