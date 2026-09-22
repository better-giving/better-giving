import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWranglerConfig } from './lib/server/wrangler-config.testing';
import { sendDueEntries } from '$lib/server/accounting/deliver';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { sendDueZapierEvents } from '$lib/server/zapier/deliver';
import worker, { CRON_RUNS } from './worker';

// the join between the schedule this worker is deployed with and the work its `scheduled` handler
// runs.
//
// nothing in the language holds them together: ./wrangler.jsonc's `triggers.crons` are strings
// Cloudflare hands back on `controller.cron`, and a branch keyed on one that nobody declared is a
// branch that never runs, while an expression declared with no branch is a cron firing into
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
// $lib/server/accounting/deliver.workers.spec.ts and $lib/server/zapier/deliver.workers.spec.ts,
// against a real database.

vi.mock('$lib/server/donations/pending-crypto-read', () => ({
	readPendingCryptoGifts: vi.fn(async () => {})
}));
vi.mock('$lib/server/accounting/deliver', () => ({
	sendDueEntries: vi.fn(async () => {})
}));
vi.mock('$lib/server/zapier/deliver', () => ({
	sendDueZapierEvents: vi.fn(async () => {})
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

type Scheduled = NonNullable<typeof worker.scheduled>;

/** the platform env a run is handed. nothing below reaches a binding: every job is mocked. */
const env = { DB: {} } as unknown as Parameters<Scheduled>[1];

/**
 * one cron firing, run to the end of everything the handler put on `waitUntil`, and that list
 * handed back.
 *
 * it comes back because handing the run over is the one thing `scheduled` does that nothing else
 * in this file can see: the handler is not `async` and returns nothing, so a run started and left
 * off `waitUntil` is a run the invocation ends underneath — sends abandoned mid-call, and the rows
 * that run claimed sitting `pending` with `attempts` unincremented until the lease passes
 * ($lib/server/accounting/deliver.ts). a mock called is a mock called either way.
 */
async function fires(cron: string): Promise<Promise<unknown>[]> {
	const waited: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (promise: Promise<unknown>) => waited.push(promise),
		passThroughOnException: () => {},
		props: {}
	} as unknown as Parameters<Scheduled>[2];

	await worker.scheduled(
		{
			cron,
			scheduledTime: SCHEDULED_AT.getTime(),
			type: 'scheduled',
			noRetry: () => {}
		} as unknown as Parameters<Scheduled>[0],
		env,
		ctx
	);
	await Promise.all(waited);
	return waited;
}

/** every job a cron can reach, for the cases asserting on none of them or all. */
const JOBS = [readPendingCryptoGifts, sendDueEntries, sendDueZapierEvents] as const;

// `restoreMocks` in ../vitest.config.ts restores a spy's implementation and leaves a module mock's
// call history and a rejection a case set on it alone, so a case would be reading every case
// before it.
beforeEach(() => {
	for (const job of JOBS) vi.mocked(job).mockReset().mockResolvedValue(undefined);
});

describe('the schedule this worker is deployed with', () => {
	it('is answered expression for expression, with no branch for one nothing fires', () => {
		// a guard on the guard: an unread config would make the comparison pass against nothing.
		expect(DECLARED.length).toBeGreaterThan(0);
		expect([...Object.keys(CRON_RUNS)].sort()).toEqual([...DECLARED].sort());
	});

	it.each(DECLARED)('runs work on %s', async (cron) => {
		const waited = await fires(cron);

		expect(JOBS.some((job) => vi.mocked(job).mock.calls.length > 0)).toBe(true);
		// the run reached the runtime, which is what keeps the invocation open until it is done.
		// `fires` awaited it on the way out, so a run that rejected never got this far.
		expect(waited).toHaveLength(1);
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

	it('sends what the books and the Zaps are owed every minute, from the run’s own time', async () => {
		await fires('* * * * *');

		expect(sendDueEntries).toHaveBeenCalledWith(expect.anything(), SCHEDULED_AT);
		expect(sendDueZapierEvents).toHaveBeenCalledWith(
			{ db: expect.anything(), fetch: expect.any(Function) },
			SCHEDULED_AT
		);
		expect(readPendingCryptoGifts).not.toHaveBeenCalled();
	});

	it.each([
		['the books', sendDueEntries, sendDueZapierEvents],
		['the Zaps', sendDueZapierEvents, sendDueEntries]
	] as const)(
		'still runs the other minute job when %s one throws, and reports the throw',
		async (_, failing, other) => {
			const fault = new Error('the database went away');
			vi.mocked(failing).mockRejectedValue(fault);

			await expect(fires('* * * * *')).rejects.toBe(fault);
			expect(other).toHaveBeenCalledWith(expect.anything(), SCHEDULED_AT);
		}
	);

	it('reports both throws when both minute jobs throw', async () => {
		const books = new Error('books');
		const zaps = new Error('zaps');
		vi.mocked(sendDueEntries).mockRejectedValue(books);
		vi.mocked(sendDueZapierEvents).mockRejectedValue(zaps);

		const thrown = await fires('* * * * *').catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(AggregateError);
		expect((thrown as AggregateError).errors).toEqual([books, zaps]);
	});

	it('runs nothing at all on an expression it does not answer', async () => {
		// a deployment's live schedule and the code it runs are put up by two calls rather than one
		// (packages/console/internal/deploy/upload.go), so an expression being retired fires against
		// a bundle that has already dropped it. running nothing is what that has to cost.
		await fires('0 3 * * *');

		for (const job of JOBS) expect(job).not.toHaveBeenCalled();
	});
});
