import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';

// the guard on "a deployment on an account without R2 deploys". a worker config naming an R2
// bucket fails its whole deploy on an account that has not enabled R2, which takes a card in the
// dashboard that no API call can do for the operator — so image bytes live in D1 behind
// ./bytes.ts, and no `r2_buckets` block may appear in packages/app/wrangler.jsonc, at the top level
// or in any environment (a named environment does not inherit bindings, so it can declare one of
// its own).

/** the fields this file reads. everything else in the config is somebody else's concern. */
interface WranglerConfig {
	readonly d1_databases?: readonly { readonly binding?: string }[];
	readonly r2_buckets?: unknown;
	readonly env?: Readonly<Record<string, { readonly r2_buckets?: unknown } | undefined>>;
}

const config = readWranglerConfig() as WranglerConfig;

describe('the worker config binds no object store', () => {
	it('reads the config it guards, which binds the database the bytes live in', () => {
		expect(config.d1_databases?.map((d) => d.binding)).toContain('DB');
	});

	it('declares environments to read', () => {
		expect(Object.keys(config.env ?? {}).length).toBeGreaterThan(0);
	});

	it('names no R2 bucket anywhere', () => {
		expect(config.r2_buckets, 'the top level declares r2_buckets').toBeUndefined();
		for (const [name, env] of Object.entries(config.env ?? {})) {
			expect(env?.r2_buckets, `env.${name} declares r2_buckets`).toBeUndefined();
		}
	});
});
