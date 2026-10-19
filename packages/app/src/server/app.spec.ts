import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { startCron } from './app';

// this module is the server bundle's entry (../../vite.config.ts), so what it exports is what
// ../../server/start.ts can reach in build/server/index.js.

const cron = vi.hoisted(() => ({ minute: vi.fn(async () => {}) }));

vi.mock(import('../cron-runs'), () => ({
	CRON_RUNS: { '* * * * *': cron.minute },
	allRun: vi.fn()
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-19T11:59:30.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the scheduled runs the bundle starts', () => {
	it('fire the cron table with the env, a database handle and the minute', async () => {
		const env = { BETTER_AUTH_URL: 'https://donate.example.org' } as unknown as Env;
		const deferred = createDeferredWork(vi.fn());
		const client = createClient({ url: ':memory:' });
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const scheduler = startCron({ env, deferred, client });
		await vi.advanceTimersByTimeAsync(60_000);
		await deferred.settled();
		scheduler.stop();
		client.close();

		expect(cron.minute).toHaveBeenCalledExactlyOnceWith(
			env,
			expect.objectContaining({ batch: expect.any(Function) }),
			new Date('2026-10-19T12:00:00.000Z')
		);
	});
});
