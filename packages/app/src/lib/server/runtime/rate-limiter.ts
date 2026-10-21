// the rate limiters this deployment charges: one process, so one counter per bucket in memory is the
// whole count (AGENTS.md → Storage: one container, one database file).
//
// each keeps the shape the callers in ../api/rate-limit.ts already spend — `limit({ key })` answering
// `{ success }` — and is counted in fixed windows: a key's window opens at its first charge and runs
// `period` seconds, so a caller refused inside one is admitted again at most `period` seconds later.
// that is the promise `Retry-After` makes (`PERIOD_SECONDS` in ../api/rate-limit.ts), and
// ../api/rate-limit.config.spec.ts holds every refusal to the period declared below.

/** one bucket's size: `limit` charges per key per `period` seconds. */
export interface RateLimit {
	readonly limit: number;
	readonly period: number;
}

/** what a caller charges a bucket through. */
export interface RateLimiter {
	limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

/** the limiters `Env` carries, by the names the callers read them under. */
export const RATE_LIMITS = {
	API_RATE_LIMITER: { limit: 600, period: 60 },
	QUOTE_RATE_LIMITER: { limit: 60, period: 60 },
	SIGN_IN_RATE_LIMITER: { limit: 10, period: 60 },
	INTEGRATIONS_KEY_RATE_LIMITER: { limit: 120, period: 60 }
} as const satisfies Record<string, RateLimit>;

export type RateLimiterName = keyof typeof RATE_LIMITS;

export type RateLimiters = { readonly [Name in RateLimiterName]: RateLimiter };

/**
 * one limiter over `size`, plus `size()`, the count of keys it holds.
 *
 * memory is bounded by the keys charged in one period: a key whose window has closed is dropped by
 * the sweep the first charge after each period runs, so a flood of fresh keys lasts a period and no
 * longer.
 */
export function createRateLimiter(
	size: RateLimit,
	now: () => number = Date.now
): RateLimiter & { size(): number } {
	const periodMs = size.period * 1000;
	const windows = new Map<string, { opened: number; count: number }>();
	let swept = now();

	return {
		async limit({ key }) {
			const at = now();
			if (at - swept >= periodMs) {
				for (const [held, window] of windows) {
					if (at - window.opened >= periodMs) windows.delete(held);
				}
				swept = at;
			}

			const window = windows.get(key);
			if (window === undefined || at - window.opened >= periodMs) {
				windows.set(key, { opened: at, count: 1 });
				return { success: true };
			}
			window.count += 1;
			return { success: window.count <= size.limit };
		},
		size: () => windows.size
	};
}

/** every limiter `Env` carries, each sized from `sizes`: `RATE_LIMITS` in production. */
export function createRateLimiters(
	sizes: Readonly<Record<RateLimiterName, RateLimit>> = RATE_LIMITS
): RateLimiters {
	return {
		API_RATE_LIMITER: createRateLimiter(sizes.API_RATE_LIMITER),
		QUOTE_RATE_LIMITER: createRateLimiter(sizes.QUOTE_RATE_LIMITER),
		SIGN_IN_RATE_LIMITER: createRateLimiter(sizes.SIGN_IN_RATE_LIMITER),
		INTEGRATIONS_KEY_RATE_LIMITER: createRateLimiter(sizes.INTEGRATIONS_KEY_RATE_LIMITER)
	};
}
