// the rate limiters this deployment charges: one process, so one counter per bucket in memory is the
// whole count (AGENTS.md → Storage: one container, one database file).
//
// each is counted in fixed windows: a key's window opens at its first charge and runs `period`
// seconds, so a caller refused inside one is admitted again at most `period` seconds later, and a
// refusal says how much of that is left. the 60-second limiters' wire and sign-in refusals word
// the whole period (`PERIOD_SECONDS` in ../api/rate-limit.ts, held to the periods below by
// ../api/rate-limit.config.spec.ts). the supporter limiters are refused in the words of the
// supporter's screens ($lib/supporter/area/copy.ts), and a refused sign-in link or Send it again
// carries the seconds left to the sign-in screen (`signInRefusal` in ../supporters/links.ts).

/** one bucket's size: `limit` charges per key per `period` seconds. */
export interface RateLimit {
	readonly limit: number;
	readonly period: number;
}

/** one charge's answer: a refusal names the whole seconds until the key's window closes. */
export type RateLimitAnswer =
	| { readonly success: true }
	| { readonly success: false; readonly retryAfterSeconds: number };

/** what a caller charges a bucket through. */
export interface RateLimiter {
	limit(options: { readonly key: string }): Promise<RateLimitAnswer>;
}

/** the limiters `Env` carries, by the names the callers read them under. */
export const RATE_LIMITS = {
	API_RATE_LIMITER: { limit: 600, period: 60 },
	QUOTE_RATE_LIMITER: { limit: 60, period: 60 },
	SIGN_IN_RATE_LIMITER: { limit: 10, period: 60 },
	INTEGRATIONS_KEY_RATE_LIMITER: { limit: 120, period: 60 },
	SUPPORTER_SIGN_IN_CALLER_RATE_LIMITER: { limit: 20, period: 3600 },
	SUPPORTER_SIGN_IN_ADDRESS_RATE_LIMITER: { limit: 5, period: 3600 },
	SUPPORTER_START_RATE_LIMITER: { limit: 5, period: 3600 },
	SUPPORTER_RESEND_RATE_LIMITER: { limit: 3, period: 3600 },
	SUPPORTER_RESEND_CALLER_RATE_LIMITER: { limit: 15, period: 3600 },
	SUPPORTER_PHOTO_RATE_LIMITER: { limit: 10, period: 86_400 }
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
			if (window.count <= size.limit) return { success: true };
			return {
				success: false,
				retryAfterSeconds: Math.ceil((window.opened + periodMs - at) / 1000)
			};
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
		INTEGRATIONS_KEY_RATE_LIMITER: createRateLimiter(sizes.INTEGRATIONS_KEY_RATE_LIMITER),
		SUPPORTER_SIGN_IN_CALLER_RATE_LIMITER: createRateLimiter(
			sizes.SUPPORTER_SIGN_IN_CALLER_RATE_LIMITER
		),
		SUPPORTER_SIGN_IN_ADDRESS_RATE_LIMITER: createRateLimiter(
			sizes.SUPPORTER_SIGN_IN_ADDRESS_RATE_LIMITER
		),
		SUPPORTER_START_RATE_LIMITER: createRateLimiter(sizes.SUPPORTER_START_RATE_LIMITER),
		SUPPORTER_RESEND_RATE_LIMITER: createRateLimiter(sizes.SUPPORTER_RESEND_RATE_LIMITER),
		SUPPORTER_RESEND_CALLER_RATE_LIMITER: createRateLimiter(
			sizes.SUPPORTER_RESEND_CALLER_RATE_LIMITER
		),
		SUPPORTER_PHOTO_RATE_LIMITER: createRateLimiter(sizes.SUPPORTER_PHOTO_RATE_LIMITER)
	};
}
