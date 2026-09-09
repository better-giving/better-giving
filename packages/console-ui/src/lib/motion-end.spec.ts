import { describe, expect, it } from 'vitest';
import { MOTION_CAP_MS, endsWithin } from './motion-end';

// how long a screen may be held for a piece of motion it is waiting on the end of.

describe('the wait on a css duration', () => {
	it('spells seconds and milliseconds the same', () => {
		expect(endsWithin('0.08s', '0s')).toBe(endsWithin('80ms', '0ms'));
	});

	it('outlasts the duration it read, and is nowhere near the cap', () => {
		expect(endsWithin('80ms', '0s')).toBeGreaterThan(80);
		expect(endsWithin('80ms', '0s')).toBeLessThan(MOTION_CAP_MS);
	});

	it('waits out the delay in front of the duration as well', () => {
		expect(endsWithin('240ms', '80ms')).toBe(endsWithin('320ms', '0s'));
		expect(endsWithin('240ms', '80ms')).toBeGreaterThan(320);
	});

	it('takes the last of each list, which is the animation that ends last', () => {
		// the rush and the dwell after it, as the sheet declares them: the pair is read as one run
		// and what is waited on is the end of the second.
		expect(endsWithin('80ms, 240ms', '0s, 80ms')).toBe(endsWithin('240ms', '80ms'));
	});

	it('falls to the cap where either half cannot be read', () => {
		expect(endsWithin('', '0s')).toBe(MOTION_CAP_MS);
		expect(endsWithin('auto', '0s')).toBe(MOTION_CAP_MS);
		expect(endsWithin('80ms', '')).toBe(MOTION_CAP_MS);
		expect(endsWithin('80ms', 'auto')).toBe(MOTION_CAP_MS);
	});

	it('still leaves a moment where the motion is nothing at all', () => {
		// what a reader who asked for less motion gets: tokens.css re-points the step to `0ms`, and
		// a wait of nothing would be a screen replaced in front of the event it is waiting on.
		expect(endsWithin('0ms', '0ms')).toBeGreaterThan(0);
		expect(endsWithin('0ms', '0ms')).toBeLessThan(MOTION_CAP_MS);
	});
});
