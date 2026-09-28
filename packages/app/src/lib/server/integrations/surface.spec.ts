import { describe, expect, it } from 'vitest';
import { keyRateLimitRefusal } from './surface';

// what a key that has spent its bucket is told. the numbers are held to the binding wrangler.jsonc
// declares by `../api/rate-limit.config.spec.ts`; these cases hold the shape.

describe('what a key over its limit is told', () => {
	it('is a 429 that says when to come back', () => {
		const response = keyRateLimitRefusal();
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('names the limit and what it is counted per', async () => {
		const body = (await keyRateLimitRefusal().json()) as Record<string, string>;
		expect(body.error).toBe('rate_limited');
		expect(body.message).toContain('120 requests a minute');
		expect(body.message).toContain('per key');
		expect(body.fix).toContain('Retry-After');
	});
});
