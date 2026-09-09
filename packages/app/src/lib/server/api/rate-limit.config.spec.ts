import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';
import { quoteRateLimitRefusal, rateLimitRefusal, signInRateLimitMessage } from './rate-limit';

// the join between this module's promises and the bindings that have to keep them.
//
// `PERIOD_SECONDS` in ./rate-limit.ts and every `simple.period` in wrangler.jsonc are literals
// that have to agree, and nothing in the language joins them: the number is what a refused caller
// is told to wait, so if the deployment resets on ten seconds and the answer says sixty, every
// refused donor is sent away for fifty seconds longer than the bucket held them. that is the
// direction that costs gifts, and 10 is the only other value the binding accepts — so it is a
// change somebody can plausibly make.
//
// asserting the constants against each other is not what this does. `rate-limit.spec.ts` already
// reads the `Retry-After` a refusal carries; what is read here is the config file, and the
// assertion is between the answer a caller actually receives and the period the deployment
// actually enforces. the same read is what notices a binding going missing altogether — which for
// API_RATE_LIMITER is the deployment `refuseIfRateLimited` refuses by name at runtime, and for the
// other two is a bucket that silently stops bounding anything, since both of those fail open. that
// difference is why every one of the three is named here rather than only the loud one: `test`
// runs in lefthook.yml's pre-commit hook, ahead of any deploy at all, so a missing binding of any
// of the three lands in front of whoever removed it rather than in production.
//
// every block the config declares is read, not the top level alone. a named environment inherits
// no `ratelimits` at all — it holds only what it declares itself — so each one is a second full set
// of bindings this same code is deployed against, and a deployment whose limiters this file never
// read is a deployment none of the joins above hold. the blocks are taken off the config rather
// than named here, so an environment added later arrives already covered.

/** the fields this file reads. everything else in the config is somebody else's concern. */
interface WranglerConfig {
	readonly ratelimits?: readonly Declared[];
	readonly env?: Readonly<
		Record<string, { readonly ratelimits?: readonly Declared[] } | undefined>
	>;
}

interface Declared {
	readonly name?: unknown;
	readonly namespace_id?: unknown;
	readonly simple?: { readonly limit?: unknown; readonly period?: unknown };
}

const config = readWranglerConfig() as WranglerConfig;

/**
 * every set of limiters this app is deployed with: the top level, which a bare `pnpm run deploy`
 * uploads, and one per named environment, which a `--env` deploy uploads instead of it.
 */
const BLOCKS = [
	{ where: 'the top level', limiters: config.ratelimits },
	...Object.entries(config.env ?? {}).map(([name, environment]) => ({
		where: `env.${name}`,
		limiters: environment?.ratelimits
	}))
];

/** the entry declaring one binding in one block, by the name the code reads off the platform env. */
function declared(limiters: readonly Declared[] | undefined, name: string): Declared | undefined {
	return limiters?.find((entry) => entry.name === name);
}

/**
 * the three limiters this app charges, and where each one's period is promised back to a caller.
 *
 * the `promised` string is what the deployment tells somebody it refused. for the two that answer
 * over the wire it is the body; for the sign-in it is the sentence itself, because the one site
 * that spends that bucket is a form action, which answers with data the page renders rather than
 * with a `Response`.
 *
 * one set of sentences against every block, because there is one deployed codebase: the answer a
 * rehearsal deployment gives a refused caller is this same string, so it has to match that
 * deployment's own period rather than the real one's.
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
	{ name: 'SIGN_IN_RATE_LIMITER', promised: () => Promise.resolve(signInRateLimitMessage()) }
] as const;

describe.each(BLOCKS)('the rate limit bindings $where is deployed with', ({ limiters }) => {
	// the parse finding nothing would make every assertion below vacuous, and a config file that
	// stopped holding the block is exactly what that looks like from here.
	it('declares one entry per limiter this app charges, and no more', () => {
		expect(limiters).toHaveLength(LIMITERS.length);
	});

	/** the names the app reads off the platform env, spelled the same way. */
	it.each(LIMITERS.map(({ name }) => name))('declares %s', (name) => {
		expect(declared(limiters, name)?.name).toBe(name);
	});

	/**
	 * a namespace is account-wide, so two bindings sharing one share a count: the login bucket
	 * would be spent by donors reading a form, and a scanner on the public api would lock the only
	 * admin out of the only login. three bindings, three namespaces.
	 */
	it('counts each limiter under a namespace of its own', () => {
		const namespaces = new Set(limiters?.map((entry) => entry.namespace_id));
		expect(namespaces.size).toBe(LIMITERS.length);
	});

	/**
	 * seconds, and the binding takes 10 or 60 and nothing else
	 * (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). a third value
	 * is a deploy that fails at `wrangler deploy`, after the one-way door at
	 * `wrangler d1 migrations apply DB --remote` has already opened.
	 */
	it.each(LIMITERS.map(({ name }) => name))('gives %s a period the binding accepts', (name) => {
		expect([10, 60]).toContain(declared(limiters, name)?.simple?.period);
	});

	/** a count of requests, so a fraction or a zero is a limit that means something else. */
	it.each(LIMITERS.map(({ name }) => name))(
		'gives %s a positive whole number of requests',
		(name) => {
			const limit = declared(limiters, name)?.simple?.limit;
			expect(typeof limit === 'number' && Number.isInteger(limit) && limit > 0).toBe(true);
		}
	);

	/**
	 * the promise and the bucket, held to each other, for every limiter. what a refused caller acts
	 * on is the wait they were given, and the period is how long the bucket really holds them.
	 */
	it.each(LIMITERS)(
		'tells a caller refused by $name how long it really holds them',
		async ({ name, promised }) => {
			expect(await promised()).toContain(String(declared(limiters, name)?.simple?.period));
		}
	);

	/**
	 * `Retry-After` is the machine-readable half of that promise, and every refusal that answers
	 * over the wire carries one. the sign-in is the one refusal with no header to write it on,
	 * because its only site answers with data a page renders rather than with a `Response`.
	 */
	it('sets Retry-After on every wire refusal to the period that binding enforces', () => {
		expect(rateLimitRefusal().headers.get('retry-after')).toBe(
			String(declared(limiters, 'API_RATE_LIMITER')?.simple?.period)
		);
		expect(quoteRateLimitRefusal(new Headers()).headers.get('retry-after')).toBe(
			String(declared(limiters, 'QUOTE_RATE_LIMITER')?.simple?.period)
		);
	});

	/**
	 * tighter than the surface is the whole justification these two carry in wrangler.jsonc, and
	 * they are keyed on the same payer the surface bucket is (src/lib/server/api/rate-limit.ts), so
	 * the comparison is a real one rather than two numbers side by side.
	 *
	 * it is load-bearing for the quote in particular, which is charged on a request that has
	 * already spent the surface bucket: a quote limit above the surface limit could never refuse
	 * anybody, because the surface always runs out first.
	 */
	it('sizes both tighter buckets below the surface bucket', () => {
		const surface = declared(limiters, 'API_RATE_LIMITER')?.simple?.limit as number;
		expect(declared(limiters, 'QUOTE_RATE_LIMITER')?.simple?.limit).toBeLessThan(surface);
		expect(declared(limiters, 'SIGN_IN_RATE_LIMITER')?.simple?.limit).toBeLessThan(surface);
	});
});

describe('the rate limit bindings across every environment this app is deployed with', () => {
	/**
	 * the one property no single block can hold, and the reason a second deployment declares
	 * namespaces at all: a namespace is account-wide and shared across Workers by design, so a
	 * second deployment reusing an id spends the first one's counters key for key — a load test
	 * against a rehearsal refusing real donors, a scripted sign-in there holding the real
	 * operator's login closed. two deployments in one account is the case this repo actually
	 * produces, since `wrangler.jsonc` names the environment that stands one up.
	 */
	it('gives every binding in every block a namespace no other binding anywhere uses', () => {
		const all = BLOCKS.flatMap(({ limiters }) => limiters ?? []).map((entry) => entry.namespace_id);

		expect(new Set(all).size).toBe(all.length);
	});

	/**
	 * and the property that makes a rehearsal a rehearsal: the numbers are copied where the
	 * namespaces are not, so a deployment stood up to be exercised refuses exactly where the one
	 * serving donors would. a limit changed on one side only is a rehearsal that stopped
	 * rehearsing, and it is silent — nothing fails, the copy just meters something else.
	 */
	it.each(LIMITERS.map(({ name }) => name))(
		'charges %s the same limit and period in every block',
		(name) => {
			const [top, ...rest] = BLOCKS.map(({ limiters }) => declared(limiters, name)?.simple);

			for (const other of rest) expect(other).toEqual(top);
		}
	);
});
