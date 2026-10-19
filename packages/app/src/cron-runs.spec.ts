import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWranglerConfig } from './lib/server/wrangler-config.testing';
import { sendDueEntries } from '$lib/server/accounting/deliver';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { sendOwedRefundNotices } from '$lib/server/donations/refund-notice';
import { sendDueWebhooks } from '$lib/server/webhooks/deliver';
import { mailPause } from '$lib/server/webhooks/paused-mail';
import { sendDueZapierEvents } from '$lib/server/zapier/deliver';
import { CRON_RUNS } from './cron-runs';
import type { Db } from '$lib/server/db/client';

// the join between the schedule this deployment declares and the work ./cron-runs.ts runs for it.
//
// nothing in the language holds them together: ../wrangler.jsonc's `triggers.crons` are strings, and
// a branch keyed on one that nobody declared is a branch that never runs, while an expression declared with no branch is a cron firing into
// nothing, every time, with nothing anywhere saying so. so the config is read here rather than
// restated, the way src/lib/server/api/rate-limit.config.spec.ts reads the same file for the
// buckets.
//
// the same read is what notices a named environment declaring `triggers` of its own, which
// replaces the top level's rather than adding to it — a rehearsal deployment that runs neither of
// the two.
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

/** the fields this file reads. everything else in the config is somebody else's concern. */
interface WranglerConfig {
	readonly triggers?: { readonly crons?: string[] };
	readonly env?: Readonly<
		Record<string, { readonly triggers?: { readonly crons?: readonly unknown[] } } | undefined>
	>;
}

const config = readWranglerConfig() as WranglerConfig;
const DECLARED = config.triggers?.crons ?? [];
const ENVIRONMENTS = Object.keys(config.env ?? {});

const SCHEDULED_AT = new Date('2026-09-20T12:30:00.000Z');

/** the env a run is handed. nothing below reaches configuration: every job is mocked. */
const env = {} as Env;

/** the database handle a run is handed, never read: every job is mocked. */
const db = {} as Db;

/** one cron firing, run to its end. an expression the table does not answer runs nothing. */
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

describe('the schedule this deployment declares', () => {
	it('is answered expression for expression, with no branch for one nothing fires', () => {
		// a guard on the guard: an unread config would make the comparison pass against nothing.
		expect(DECLARED.length).toBeGreaterThan(0);
		expect([...Object.keys(CRON_RUNS)].sort()).toEqual([...DECLARED].sort());
	});

	it.each(DECLARED)('runs work on %s', async (cron) => {
		await fires(cron);

		expect(JOBS.some((job) => vi.mocked(job).mock.calls.length > 0)).toBe(true);
	});

	// the list below is read off the parsed config, so an empty one registers no test at all and the
	// rule goes uncovered under a green file.
	it('has environments to inherit it', () => {
		expect(ENVIRONMENTS.length).toBeGreaterThan(0);
	});

	// an environment's own `triggers` replaces the top level's rather than adding to it, so a
	// rehearsal deployment declaring one of its own runs neither of the two above.
	it.each(ENVIRONMENTS)('is inherited by the %s environment', (name) => {
		expect(config.env?.[name]?.triggers).toBeUndefined();
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

	it('runs nothing at all on an expression it does not answer', async () => {
		// a deployment's live schedule and the code it runs are put up by two calls rather than one
		// (packages/console/internal/deploy/upload.go), so an expression being retired fires against
		// a bundle that has already dropped it. running nothing is what that has to cost.
		await fires('0 3 * * *');

		for (const job of JOBS) expect(job).not.toHaveBeenCalled();
	});
});
