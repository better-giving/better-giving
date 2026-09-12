import { DEPLOY_VARS } from '@better-giving/operator/deploy-split';
import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';

// the guard on "a deploy from a terminal does not wipe this deployment's settings".
//
// all seventeen values ./env.ts and ../auth/env.ts read are plain Worker vars — which seventeen, and
// why every one of them is a var rather than a secret, is `@better-giving/operator/deploy-split`,
// and the assertion that the list is exactly the names this app reads is ./deploy-split.spec.ts.
// this file is the wrangler side alone: what has to be true of packages/app/wrangler.jsonc for a
// value an operator set to still be there after the next deploy.
//
// wrangler's own `deploy --help` says what the default costs: "When not used (or set to false),
// Wrangler will delete all vars before setting those found in the Wrangler configuration. … Note
// that secrets are never deleted by deployments." the flag defaults to false
// (node_modules/wrangler/config-schema.json gives `keep_vars` a `"default": false`).
//
// so the two halves of this file's subject are a pair, and neither is safe without the other. this
// repo commits no `vars` block, because every one of these values is org-specific and a committed
// value is a deployment artifact (CLAUDE.md, Product surface) — and half of them are credentials,
// so a committed block is a live Stripe key in a public repository. that leaves the deployment
// itself as the only place a value exists — and with `keep_vars` off, the next plain
// `pnpm run deploy` uploads a config that mentions none of them and Cloudflare drops all seventeen,
// leaving a deployment that can sign nobody in, charge nothing and send nothing.
//
// `keep_vars` is a top-level key and wrangler's config schema puts it on `RawConfig` alone and not
// on `RawEnvironment`, so the one line here covers every named environment a fork ever adds.
//
// what this spec cannot prove is that Cloudflare honours the flag; only a real deploy shows that.
// what it proves is that the flag is still in the file and that no `vars` block has appeared beside
// it, which are the two ways this breaks from inside the repository. `test` runs in lefthook.yml's
// pre-commit hook, so both land in front of whoever changed them.

/** the fields this file reads. everything else in the config is somebody else's concern. */
interface WranglerConfig {
	readonly keep_vars?: unknown;
	readonly vars?: unknown;
	readonly env?: unknown;
}

const config = readWranglerConfig() as WranglerConfig;

describe('the deploy-time configuration this app is deployed with', () => {
	/**
	 * the whole point of this file. without it a `pnpm run deploy` deletes every var on the
	 * deployment before uploading a config that declares none.
	 */
	it('keeps the vars an operator set when wrangler deploys', () => {
		expect(
			config.keep_vars,
			`without this a plain deploy deletes all ${DEPLOY_VARS.length} of this deployment's values`
		).toBe(true);
	});

	/**
	 * and no `vars` block, in the top level or in any environment. a value in one is a value
	 * committed — org-specific, so a fork inherits a pointer at somebody else's mail host.
	 *
	 * the environments are read one by one rather than by asserting there are none. `vars` is not
	 * inherited by a named environment, so an environment declaring its own is the one way a value
	 * lands in this file without appearing at the top level — which is exactly what an assertion
	 * that no environment exists would stop reporting the moment one did.
	 */
	it('commits no value of its own for any of them', () => {
		expect(config.vars).toBeUndefined();
		for (const [name, env] of Object.entries(config.env ?? {})) {
			expect(env?.vars, `env.${name} declares vars`).toBeUndefined();
		}
	});

	/**
	 * and the same thing said against the list, so a failure names the value rather than the block.
	 *
	 * the assertion above is the stronger one — no `vars` block at all — and this is what it is for:
	 * every one of the seventeen is a credential or an org-specific address, and the one that gets
	 * committed will be committed by someone adding a `vars` block for a value they thought was
	 * harmless.
	 */
	it('declares none of the seventeen anywhere in the file', () => {
		const declared = [
			...Object.keys((config.vars as Record<string, unknown>) ?? {}),
			...Object.values(config.env ?? {}).flatMap((env) =>
				Object.keys(((env as { vars?: Record<string, unknown> })?.vars ?? {}) as object)
			)
		];
		expect(declared.filter((name) => (DEPLOY_VARS as readonly string[]).includes(name))).toEqual(
			[]
		);
	});
});
