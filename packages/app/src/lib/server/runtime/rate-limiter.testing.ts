import {
	createRateLimiters,
	type RateLimit,
	type RateLimiterName,
	type RateLimiters
} from './rate-limiter';

/**
 * the limiters' sizes a spec runs against: the deployment's names and periods (`RATE_LIMITS` in
 * ./rate-limiter.ts) with much smaller buckets, chosen to make a refusal quick to reach. the specs
 * that charge them ask until they are refused and give each case an address or a key of its own, so
 * no case depends on the number — only on it being small.
 *
 * the surface bucket stays wider than the quote and sign-in buckets, in the order `RATE_LIMITS`
 * sets and ../api/rate-limit.config.spec.ts holds for it: a surface bucket no looser than theirs
 * refuses first and none of them can ever be the thing that answers — a spec for the quote
 * endpoint's own bucket that goes green while the bucket is unreachable.
 */
export const SPEC_RATE_LIMITS = {
	API_RATE_LIMITER: { limit: 20, period: 60 },
	QUOTE_RATE_LIMITER: { limit: 3, period: 60 },
	SIGN_IN_RATE_LIMITER: { limit: 3, period: 60 },
	INTEGRATIONS_KEY_RATE_LIMITER: { limit: 3, period: 60 }
} as const satisfies Record<RateLimiterName, RateLimit>;

/** a fresh set of limiters at `SPEC_RATE_LIMITS`, counting from nothing. */
export function specRateLimiters(): RateLimiters {
	return createRateLimiters(SPEC_RATE_LIMITS);
}
