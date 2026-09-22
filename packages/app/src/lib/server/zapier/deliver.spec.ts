import { describe, expect, it } from 'vitest';
import { backoffMs } from './deliver';

// the wait between tries, at the rungs a real outage takes hours to reach. that a waiting row is
// left alone and a due one posted is ./deliver.workers.spec.ts's.

const MINUTE = 60_000;

describe('how long a failed delivery waits before it is tried again', () => {
	it('doubles from one minute', () => {
		expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual(
			[1, 2, 4, 8, 16, 32].map((minutes) => minutes * MINUTE)
		);
	});

	it('never waits longer than an hour', () => {
		expect([7, 8, 50].map(backoffMs)).toEqual([60 * MINUTE, 60 * MINUTE, 60 * MINUTE]);
	});
});
