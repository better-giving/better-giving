import { createClient } from '@libsql/client';
import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { startCron, startRefusal } from './app';

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

describe('what the bundle refuses to start on', () => {
	it('refuses a set password sign-in would refuse, in sign-in’s words and never the value', () => {
		const short = 'p'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);
		const env = { ADMIN_PASSWORD: short } as unknown as Env;

		const refusal = startRefusal(env);

		expect(refusal).toContain(`at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
		expect(refusal).toContain('ADMIN_PASSWORD');
		expect(refusal).not.toContain(short);
	});

	it('refuses nothing where the password is one sign-in takes', () => {
		const env = { ADMIN_PASSWORD: 'correct-horse-battery' } as unknown as Env;

		expect(startRefusal(env)).toBeNull();
	});
});
