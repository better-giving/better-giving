import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';

// the guard on "a deployment calls no AI model and binds no AI service" (CLAUDE.md, Product
// surface): no `ai` binding in packages/app/wrangler.jsonc, at the top level or in any named
// environment. an assistant reaches a deployment as a caller of the deployment's own surfaces, so
// nothing a deployment runs needs a model of its own.

interface WranglerConfig {
	readonly ai?: unknown;
	readonly env?: Readonly<Record<string, { readonly ai?: unknown }>>;
}

const config = readWranglerConfig() as WranglerConfig;

describe('the bindings this app is deployed with', () => {
	it('binds no AI service at the top level', () => {
		expect(config.ai).toBeUndefined();
	});

	it('binds no AI service in any named environment', () => {
		const bound = Object.entries(config.env ?? {})
			.filter(([, environment]) => environment.ai !== undefined)
			.map(([name]) => name);
		expect(bound).toEqual([]);
	});
});
