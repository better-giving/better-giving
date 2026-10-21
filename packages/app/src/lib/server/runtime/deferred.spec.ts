import { describe, expect, it, vi } from 'vitest';
import { createDeferredWork } from './deferred';

describe('createDeferredWork', () => {
	it('logs a throw and lets it go no further', async () => {
		const log = vi.fn();
		const work = createDeferredWork(log);
		const fault = new Error('the cache write failed');

		work.waitUntil(Promise.reject(fault));
		await work.settled();

		expect(log).toHaveBeenCalledExactlyOnceWith(fault);
	});

	it('returns before the work it was handed settles', () => {
		const work = createDeferredWork(vi.fn());
		const never = new Promise<void>(() => {});

		expect(work.waitUntil(never)).toBeUndefined();
		expect(work.pending()).toBe(1);
	});

	it('settles once everything handed to it has, a throw included', async () => {
		const work = createDeferredWork(vi.fn());
		let finish: () => void = () => {};
		const slow = new Promise<void>((resolve) => {
			finish = resolve;
		});
		work.waitUntil(slow);
		work.waitUntil(Promise.reject(new Error('fast')));

		let settled = false;
		const waiting = work.settled().then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		finish();
		await waiting;
		expect(settled).toBe(true);
		expect(work.pending()).toBe(0);
	});

	it('waits for work handed to it while it is already waiting', async () => {
		const work = createDeferredWork(vi.fn());
		let finishFirst: () => void = () => {};
		let finishLater: () => void = () => {};
		work.waitUntil(
			new Promise<void>((resolve) => {
				finishFirst = resolve;
			})
		);

		const waiting = work.settled();
		work.waitUntil(
			new Promise<void>((resolve) => {
				finishLater = resolve;
			})
		);
		finishFirst();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(work.pending()).toBe(1);

		finishLater();
		await waiting;
		expect(work.pending()).toBe(0);
	});
});
