import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';

// the Workers AI binding in wrangler.jsonc, under the name ./generate.ts reads.
//
// wrangler does not carry `ai` from the top level into a named environment, so a block that leaves
// it out deploys a worker with no model to call, and nothing fails until the first generate is
// refused as `not_bound`.

interface Block {
	readonly ai?: { readonly binding?: unknown };
}

const config = readWranglerConfig() as Block & { readonly env?: Record<string, Block> };

const blocks: [string, Block][] = [['the top level', config], ...Object.entries(config.env ?? {})];

describe('the Workers AI binding', () => {
	it('is read from more than the top level', () => {
		expect(blocks.length).toBeGreaterThan(1);
	});

	it.each(blocks)('is bound as `AI` in %s', (_, block) => {
		expect(block.ai?.binding).toBe('AI');
	});
});
