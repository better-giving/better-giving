import { act } from 'react';
import { vi } from 'vitest';

// the crop cards read their file with happy-dom's `FileReader`, which finishes on a timer, so a spec
// waits for what the read draws. not a spec itself: no project's `include` matches this name.

/**
 * what `find` finds once the card's read of its file has landed, or null if it never does within
 * `timeout`: each turn a timer's tick inside `act`, so react draws what the read set before `find`
 * looks again. the budget is generous because a starved worker is slow, not wrong.
 */
export async function settled<T>(find: () => T | null, timeout = 10_000): Promise<T | null> {
	try {
		return await vi.waitFor(
			async () => {
				const found = find();
				if (found !== null) return found;
				await act(async () => {
					await new Promise((done) => setTimeout(done, 10));
				});
				throw new Error('not drawn yet');
			},
			{ timeout, interval: 0 }
		);
	} catch {
		return null;
	}
}
