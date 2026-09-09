import { describe, expect, it, vi } from 'vitest';
import { MOTION_CAP_MS } from './motion-end';

// the signal that finishes the document's start-up bar, which is one module's whole state.
//
// every case takes the module again: what it holds is per-page rather than per-call — one bar is
// drawn once and finished once — so a case running against the state the case before it left would
// be reading the wrong pass.

/** the module with nothing said to it yet, which is the state a page starts in. */
const fresh = async () => {
	vi.resetModules();
	return import('./starting-bar');
};

describe('the bar the document draws while the first reading lands', () => {
	it('is not finishing until a pass says so', async () => {
		const bar = await fresh();

		expect(bar.startingBarFinishing()).toBe(false);
	});

	it('tells whoever is drawing it that it is finishing', async () => {
		const bar = await fresh();
		const told = vi.fn();
		bar.subscribeStartingBar(told);

		void bar.finishStartingBar();

		expect(bar.startingBarFinishing()).toBe(true);
		expect(told).toHaveBeenCalledTimes(1);
	});

	it('holds the pass that finished it until the bar has landed', async () => {
		const bar = await fresh();
		let held = true;
		const waited = bar.finishStartingBar().then(() => {
			held = false;
		});
		// a turn of the loop, which is every chance a promise with nothing to wait on would have had.
		await new Promise((settle) => setTimeout(settle, 0));

		expect(held).toBe(true);

		bar.startingBarLanded();
		await waited;

		expect(held).toBe(false);
	});

	it('lets every pass after the first straight through, with no bar left to finish', async () => {
		const bar = await fresh();
		void bar.finishStartingBar();
		bar.startingBarLanded();
		const told = vi.fn();
		bar.subscribeStartingBar(told);

		let held = true;
		void bar.finishStartingBar().then(() => {
			held = false;
		});
		await new Promise((settle) => setTimeout(settle, 0));

		expect(held).toBe(false);
		expect(told).not.toHaveBeenCalled();
	});

	it('gives the console up rather than waiting on a bar nobody drew', async () => {
		vi.useFakeTimers();
		try {
			const bar = await fresh();
			let held = true;
			const waited = bar.finishStartingBar().then(() => {
				held = false;
			});
			await vi.advanceTimersByTimeAsync(MOTION_CAP_MS);
			await waited;

			expect(held).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
