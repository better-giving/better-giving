import { vi } from 'vitest';
import type { Db } from './client';

// two writers interleaved on one real database, without timing: the one under test has read, and
// the other commits before its `batch()` runs. `vi.restoreAllMocks` (or `restoreMocks` in
// vitest.config.ts) takes the spy off.

type Batch = (this: Db, ...args: unknown[]) => Promise<unknown>;

/**
 * runs `between` to completion just before the next `batch()` on any `Db` executes, then lets that
 * batch run. a batch `between` makes itself runs as it would.
 */
export function beforeNextBatch(db: Db, between: () => Promise<unknown>): void {
	const prototype = Object.getPrototypeOf(db) as { batch: Batch };
	const batch = prototype.batch;
	const spy = vi.spyOn(prototype, 'batch').mockImplementation(async function (this: Db, ...args) {
		spy.mockImplementation(batch);
		await between();
		return batch.apply(this, args);
	});
}
