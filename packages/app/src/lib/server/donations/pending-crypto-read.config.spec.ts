import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';

// the schedule ./pending-crypto-read.ts runs on, held to wrangler.jsonc. nothing else starts that read,
// so a deployment whose config lost its cron settles no expired crypto gift and says nothing.

interface WranglerConfig {
	readonly triggers?: { readonly crons?: readonly unknown[] };
	readonly env?: Readonly<
		Record<string, { readonly triggers?: { readonly crons?: readonly unknown[] } } | undefined>
	>;
}

const config = readWranglerConfig() as WranglerConfig;
const environments = Object.keys(config.env ?? {});

describe('the pending crypto read’s schedule', () => {
	it('is declared', () => {
		expect(config.triggers?.crons?.length ?? 0).toBeGreaterThan(0);
	});

	// the list below is read off the parsed config, so an empty one registers no test at all and the
	// rule goes uncovered under a green file.
	it('has environments to inherit it', () => {
		expect(environments.length).toBeGreaterThan(0);
	});

	// an environment's own `triggers` replaces the top level's rather than adding to it.
	it.each(environments)('is inherited by the %s environment', (name) => {
		expect(config.env?.[name]?.triggers).toBeUndefined();
	});
});
