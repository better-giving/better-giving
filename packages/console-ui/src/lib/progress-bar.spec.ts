import { describe, expect, it, vi } from 'vitest';
import { MOTION_CAP_MS } from './motion-end';

// the signal between the console's one progress bar and the reading that replaces the screen it
// stands over.
//
// every case takes the module again: what it holds is per-page rather than per-call — the page on
// the screen, and the one bar standing over it — so a case running against the state the case
// before it left would be reading the wrong pass.

/** the module with nothing said to it yet, which is the state a page starts in. */
const fresh = async () => {
	vi.resetModules();
	return import('./progress-bar');
};

/** a turn of the loop, which is every chance a promise with nothing to wait on would have had. */
const turn = () => new Promise((settle) => setTimeout(settle, 0));

/** whether the promise is still unsettled after a turn. */
const stillHeld = async (waited: Promise<void>) => {
	let held = true;
	void waited.then(() => {
		held = false;
	});
	await turn();
	return held;
};

describe('the bar a reading is taken behind', () => {
	it('holds the first reading of all until the bar has landed', async () => {
		const bar = await fresh();
		const pass = bar.holdBar('/');
		const waited = pass.finish();

		expect(bar.progressBarFinishing()).toBe(true);
		expect(await stillHeld(waited)).toBe(true);

		bar.progressBarLanded();

		expect(await stillHeld(waited)).toBe(false);
	});

	it('lets a re-read of the page on the screen straight through, with no bar over it', async () => {
		const bar = await fresh();
		bar.pageDrawn('/payments/stripe');
		const told = vi.fn();
		bar.subscribeProgressBar(told);

		const waited = bar.holdBar('/payments/stripe').finish();

		expect(await stillHeld(waited)).toBe(false);
		expect(bar.progressBarFinishing()).toBe(false);
		expect(told).not.toHaveBeenCalled();
	});

	it('holds a reading of another page until the bar over the one being left has landed', async () => {
		const bar = await fresh();
		bar.pageDrawn('/');

		const waited = bar.holdBar('/payments/stripe').finish();

		expect(await stillHeld(waited)).toBe(true);
		bar.progressBarLanded();
		expect(await stillHeld(waited)).toBe(false);
	});

	it('opens the next bar filling, before the reading behind it has taken a pass', async () => {
		// the bar over a move mounts on the press, and the destination's loader takes its pass only
		// once the route module has loaded — the bar reads this in between.
		const bar = await fresh();
		bar.pageDrawn('/');
		void bar.holdBar('/payments/stripe').finish();
		bar.progressBarLanded();
		const told = vi.fn();
		bar.subscribeProgressBar(told);

		bar.pageDrawn('/payments/stripe');

		expect(bar.progressBarFinishing()).toBe(false);
		expect(told).toHaveBeenCalledTimes(1);
	});

	it('puts a bar still rushing back to filling when a later navigation takes a pass', async () => {
		const bar = await fresh();
		bar.pageDrawn('/');
		void bar.holdBar('/payments/stripe').finish();
		const told = vi.fn();
		bar.subscribeProgressBar(told);

		bar.holdBar('/payments/paypal');

		expect(bar.progressBarFinishing()).toBe(false);
		expect(told).toHaveBeenCalledTimes(1);
	});

	it('finishes nothing for a navigation a later one took the place of', async () => {
		const bar = await fresh();
		bar.pageDrawn('/');
		const left = bar.holdBar('/payments/stripe');
		const taken = bar.holdBar('/payments/paypal');

		const abandoned = left.finish();

		expect(await stillHeld(abandoned)).toBe(false);
		expect(bar.progressBarFinishing()).toBe(false);

		const waited = taken.finish();
		expect(await stillHeld(waited)).toBe(true);
		bar.progressBarLanded();
		expect(await stillHeld(waited)).toBe(false);
	});

	it('lets go of a pass left waiting when a later navigation takes its place', async () => {
		const bar = await fresh();
		bar.pageDrawn('/');
		const waited = bar.holdBar('/payments/stripe').finish();

		bar.holdBar('/payments/paypal');

		expect(await stillHeld(waited)).toBe(false);
	});

	it('gives the screen up rather than waiting on a bar nobody drew', async () => {
		vi.useFakeTimers();
		try {
			const bar = await fresh();
			let held = true;
			const waited = bar
				.holdBar('/')
				.finish()
				.then(() => {
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

describe('what the bar says is loading', () => {
	it('is the words the link that was pressed carried', async () => {
		const bar = await fresh();

		expect(bar.openingLabel(bar.opening('Opening Stripe'))).toBe('Opening Stripe');
	});

	it('is the bare word for a move nothing named', async () => {
		const bar = await fresh();

		expect(bar.openingLabel(null)).toBe('Opening');
		expect(bar.openingLabel({ opening: 7 })).toBe('Opening');
		expect(bar.openingLabel('Opening Stripe')).toBe('Opening');
	});
});

describe('which address changes are drawn under the bar', () => {
	it('draws it for another pathname, and for nothing on the same one', async () => {
		const bar = await fresh();

		expect(bar.movesPage('/payments/stripe', '/')).toBe(true);
		expect(bar.movesPage('/', '/payments/paypal')).toBe(true);
		expect(bar.movesPage('/', '/')).toBe(false);
		expect(bar.movesPage('/', null)).toBe(true);
	});
});
