import { describe, expect, it } from 'vitest';
import { keyRateLimitRefusal, notFoundRefusal, readOnlyRefusal } from './surface';

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

describe('what an address no list answers is told', () => {
	it('quotes a long path cut short, as every refusal quotes a value it names', async () => {
		const path = `/integrations/v1/${'x'.repeat(200)}`;
		const body = (await notFoundRefusal(path).json()) as Record<string, string>;

		expect(body.error).toBe('not_found');
		expect(body.message).toContain(`\`${path.slice(0, 64)}…\``);
	});
});

describe('what a method other than GET or HEAD is told', () => {
	it('quotes a long method cut short, as every refusal quotes a value it names', async () => {
		const method = 'X'.repeat(200);
		const body = (await readOnlyRefusal(method).json()) as Record<string, string>;

		expect(body.error).toBe('method_not_allowed');
		expect(body.message).toContain(`${method.slice(0, 64)}… is not a method`);
		expect(body.message).not.toContain(method);
	});
});
