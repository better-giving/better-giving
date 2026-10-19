import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredWork } from './deferred';
import { type ScheduledRun, startScheduler } from './scheduler';

// half a minute before 12:00, so the first minute boundary the scheduler meets is 12:00.
const START = new Date('2026-10-19T11:59:30.000Z');
const MINUTE = 60_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
});

const silent = { ok: vi.fn(), threw: vi.fn() };

/** a table whose every run records the minute it was handed, `HH:MM` in UTC. */
function recording(expressions: readonly string[]) {
	const fired = new Map<string, string[]>(expressions.map((expression) => [expression, []]));
	const runs: Record<string, ScheduledRun> = {};
	for (const expression of expressions) {
		runs[expression] = async (now) => {
			fired.get(expression)?.push(now.toISOString().slice(11, 16));
		};
	}
	return { fired, runs };
}

describe('the scheduler', () => {
	it('fires each expression on exactly the UTC minutes it matches, across two hours', async () => {
		const { fired, runs } = recording(['*/30 * * * *', '15 * * * *', '45 * * * *', '* * * * *']);
		const scheduler = startScheduler(runs, createDeferredWork(vi.fn()), silent);

		// to 13:59:30, past every boundary from 12:00 to 13:59 and short of 14:00.
		await vi.advanceTimersByTimeAsync(120 * MINUTE);
		scheduler.stop();

		expect(fired.get('*/30 * * * *')).toEqual(['12:00', '12:30', '13:00', '13:30']);
		expect(fired.get('15 * * * *')).toEqual(['12:15', '13:15']);
		expect(fired.get('45 * * * *')).toEqual(['12:45', '13:45']);
		const everyMinute = fired.get('* * * * *') ?? [];
		expect(everyMinute).toHaveLength(120);
		expect(everyMinute[0]).toBe('12:00');
		expect(everyMinute.at(-1)).toBe('13:59');
	});

	it('writes a throw as one `threw` line and fires the next minute all the same', async () => {
		const fault = new Error('the outbox read failed');
		const handed: string[] = [];
		const run = vi.fn(async (now: Date) => {
			handed.push(now.toISOString());
			if (handed.length === 1) throw fault;
		});
		const log = { ok: vi.fn(), threw: vi.fn() };
		const scheduler = startScheduler({ '* * * * *': run }, createDeferredWork(vi.fn()), log);

		await vi.advanceTimersByTimeAsync(2 * MINUTE);
		scheduler.stop();

		expect(handed).toEqual(['2026-10-19T12:00:00.000Z', '2026-10-19T12:01:00.000Z']);
		expect(log.threw).toHaveBeenCalledExactlyOnceWith(
			'cron run expression="* * * * *" start=2026-10-19T12:00:00.000Z outcome=threw',
			fault
		);
		expect(log.ok).toHaveBeenCalledExactlyOnceWith(
			'cron run expression="* * * * *" start=2026-10-19T12:01:00.000Z outcome=ok'
		);
	});

	it('fires nothing once stopped', async () => {
		const run = vi.fn(async () => {});
		const scheduler = startScheduler({ '* * * * *': run }, createDeferredWork(vi.fn()), silent);

		await vi.advanceTimersByTimeAsync(MINUTE);
		scheduler.stop();
		await vi.advanceTimersByTimeAsync(10 * MINUTE);

		expect(run).toHaveBeenCalledOnce();
	});

	it('hands each run to the deferred-work tracker, which holds it until it ends', async () => {
		let finish: () => void = () => {};
		const deferred = createDeferredWork(vi.fn());
		const scheduler = startScheduler(
			{
				'* * * * *': () =>
					new Promise<void>((resolve) => {
						finish = resolve;
					})
			},
			deferred,
			silent
		);

		await vi.advanceTimersByTimeAsync(MINUTE);
		expect(deferred.pending()).toBe(1);
		finish();
		await deferred.settled();
		scheduler.stop();
		expect(deferred.pending()).toBe(0);
	});

	it.each(['0 3 * * 1-5', '*/0 * * * *', '60 * * * *', '* * * *', '0 0 1 * 1'])(
		'refuses %s at start rather than never firing it',
		(expression) => {
			expect(() =>
				startScheduler({ [expression]: async () => {} }, createDeferredWork(vi.fn()), silent)
			).toThrow(`unsupported cron expression "${expression}"`);
		}
	);
});
