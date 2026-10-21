import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limiter';

/** a clock a case moves by hand, in ms. */
function clock(start = 1_000_000) {
	let now = start;
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		}
	};
}

describe('createRateLimiter', () => {
	it('admits `limit` calls in a period and refuses the next', async () => {
		const time = clock();
		const limiter = createRateLimiter({ limit: 3, period: 60 }, time.now);

		const answers = [];
		for (let i = 0; i < 4; i++) answers.push((await limiter.limit({ key: 'a' })).success);

		expect(answers).toEqual([true, true, true, false]);
	});

	it('admits again once the period has passed', async () => {
		const time = clock();
		const limiter = createRateLimiter({ limit: 1, period: 60 }, time.now);
		await limiter.limit({ key: 'a' });

		time.advance(59_999);
		expect((await limiter.limit({ key: 'a' })).success).toBe(false);
		time.advance(1);
		expect((await limiter.limit({ key: 'a' })).success).toBe(true);
	});

	it('counts each key on its own', async () => {
		const limiter = createRateLimiter({ limit: 1, period: 60 }, clock().now);
		await limiter.limit({ key: 'a' });

		expect((await limiter.limit({ key: 'b' })).success).toBe(true);
	});

	it('drops a key whose period has passed', async () => {
		const time = clock();
		const limiter = createRateLimiter({ limit: 5, period: 60 }, time.now);
		for (let i = 0; i < 100; i++) await limiter.limit({ key: `k${i}` });
		expect(limiter.size()).toBe(100);

		time.advance(60_000);
		await limiter.limit({ key: 'fresh' });

		expect(limiter.size()).toBe(1);
	});
});
