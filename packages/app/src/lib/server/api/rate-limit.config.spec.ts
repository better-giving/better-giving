import { describe, expect, it } from 'vitest';
import { callerRateLimitRefusal, keyRateLimitRefusal } from '../integrations/surface';
import { RATE_LIMITS, type RateLimiterName } from '../runtime/rate-limiter';
import {
	donorPageRateLimitRefusal,
	imageRateLimitRefusal,
	quoteRateLimitRefusal,
	rateLimitRefusal,
	signInRateLimitMessage
} from './rate-limit';

// the join between this module's promises and the limiters that have to keep them.
//
// `PERIOD_SECONDS` in ./rate-limit.ts and every `period` in `RATE_LIMITS`
// (../runtime/rate-limiter.ts) are literals that have to agree, and nothing in the language joins
// them: the number is what a refused caller is told to wait, so if the limiter resets on ten seconds
// and the answer says sixty, every refused donor is sent away for fifty seconds longer than the
// bucket held them.
//
// asserting the constants against each other is not what this does. `rate-limit.spec.ts` already
// reads the `Retry-After` a refusal carries; what is read here is the table the server builds its
// limiters from, and the assertion is between the answer a caller actually receives and the period
// the deployment actually enforces.

/** one limiter's size, by the name the code reads off the platform env. */
const size = (name: RateLimiterName) => RATE_LIMITS[name];

/**
 * the limiters this app charges, and where each one's period is promised back to a caller.
 *
 * the `promised` string is what the deployment tells somebody it refused. for those that answer
 * over the wire it is the body; for the sign-in it is the sentence itself, because the one site
 * that spends that bucket is a form action, which answers with data the page renders rather than
 * with a `Response`.
 */
const LIMITERS = [
	{
		name: 'API_RATE_LIMITER',
		promised: async () => JSON.stringify(await rateLimitRefusal().json())
	},
	{
		name: 'QUOTE_RATE_LIMITER',
		promised: async () => JSON.stringify(await quoteRateLimitRefusal(new Headers()).json())
	},
	{ name: 'SIGN_IN_RATE_LIMITER', promised: () => Promise.resolve(signInRateLimitMessage()) },
	{
		name: 'INTEGRATIONS_KEY_RATE_LIMITER',
		promised: async () => JSON.stringify(await keyRateLimitRefusal().json())
	}
] as const satisfies readonly { name: RateLimiterName; promised: () => Promise<string> }[];

describe('the rate limiters the server builds', () => {
	it('declares one entry per limiter this app charges, and no more', () => {
		expect(Object.keys(RATE_LIMITS).sort()).toEqual(LIMITERS.map(({ name }) => name).sort());
	});

	/** a count of requests, so a fraction or a zero is a limit that means something else. */
	it.each(LIMITERS.map(({ name }) => name))(
		'gives %s a positive whole number of requests and of seconds',
		(name) => {
			const { limit, period } = size(name);
			expect(Number.isInteger(limit) && limit > 0).toBe(true);
			expect(Number.isInteger(period) && period > 0).toBe(true);
		}
	);

	/**
	 * the promise and the bucket, held to each other, for every limiter. what a refused caller acts
	 * on is the wait they were given, and the period is how long the bucket really holds them.
	 */
	it.each(LIMITERS)(
		'tells a caller refused by $name how long it really holds them',
		async ({ name, promised }) => {
			expect(await promised()).toContain(String(size(name).period));
		}
	);

	/**
	 * `Retry-After` is the machine-readable half of that promise, and every refusal that answers
	 * over the wire carries one. the sign-in is the one refusal with no header to write it on,
	 * because its only site answers with data a page renders rather than with a `Response`.
	 */
	it('sets Retry-After on every wire refusal to the period that limiter enforces', () => {
		expect(rateLimitRefusal().headers.get('retry-after')).toBe(
			String(size('API_RATE_LIMITER').period)
		);
		expect(quoteRateLimitRefusal(new Headers()).headers.get('retry-after')).toBe(
			String(size('QUOTE_RATE_LIMITER').period)
		);
		expect(keyRateLimitRefusal().headers.get('retry-after')).toBe(
			String(size('INTEGRATIONS_KEY_RATE_LIMITER').period)
		);
		expect(callerRateLimitRefusal().headers.get('retry-after')).toBe(
			String(size('API_RATE_LIMITER').period)
		);
		// the photo and donor page buckets are counted by the surface limiter under keys of their own.
		expect(imageRateLimitRefusal().headers.get('retry-after')).toBe(
			String(size('API_RATE_LIMITER').period)
		);
		expect(new Headers(donorPageRateLimitRefusal().init?.headers).get('retry-after')).toBe(
			String(size('API_RATE_LIMITER').period)
		);
	});

	/**
	 * the read API's two refusals name their limits, because the reader is a system being paced: an
	 * integrator sizes a sync loop by them, and a number that disagreed with the limiter would pace
	 * that loop into refusals or leave the headroom unused. the per-address one names the key's
	 * limit too, to say it is not the one that refused.
	 */
	it('tells a key refused by INTEGRATIONS_KEY_RATE_LIMITER the limit it really holds it to', async () => {
		const { message } = (await keyRateLimitRefusal().json()) as { message: string };
		const { limit, period } = size('INTEGRATIONS_KEY_RATE_LIMITER');

		expect(period).toBe(60);
		expect(message).toContain(`${String(limit)} requests a minute`);
	});

	it('tells an address refused on the read API the limits it really holds it to', async () => {
		const { message, fix } = (await callerRateLimitRefusal().json()) as Record<string, string>;
		const perAddress = size('API_RATE_LIMITER');
		const perKey = size('INTEGRATIONS_KEY_RATE_LIMITER');

		expect(perAddress.period).toBe(60);
		expect(message).toContain(`${String(perAddress.limit)} requests a minute`);
		expect(fix).toContain(`${String(perKey.limit)} requests a minute`);
	});

	/**
	 * the read API charges every request to its address on the surface limiter and then to its key,
	 * so a key's budget above the address's could never be what refuses a key presented from one
	 * address.
	 */
	it('sizes the per-key bucket below the surface bucket it is charged behind', () => {
		expect(size('INTEGRATIONS_KEY_RATE_LIMITER').limit).toBeLessThan(
			size('API_RATE_LIMITER').limit
		);
	});

	/**
	 * tighter than the surface is the whole justification these two carry, and they are keyed on
	 * the same payer the surface bucket is (./rate-limit.ts), so the comparison is a real one rather
	 * than two numbers side by side.
	 *
	 * it is load-bearing for the quote in particular, which is charged on a request that has
	 * already spent the surface bucket: a quote limit above the surface limit could never refuse
	 * anybody, because the surface always runs out first.
	 */
	it('sizes both tighter buckets below the surface bucket', () => {
		const surface = size('API_RATE_LIMITER').limit;
		expect(size('QUOTE_RATE_LIMITER').limit).toBeLessThan(surface);
		expect(size('SIGN_IN_RATE_LIMITER').limit).toBeLessThan(surface);
	});
});
