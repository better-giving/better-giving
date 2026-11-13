import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { noRegistryFaces } from '../../vite.registry-faces';
import browserConfig from '../../vitest.browser.config';
import vitestConfig from '../../vitest.config';

// the form copies no registry face (AGENTS.md → Boundaries, "Neither lock copies the registry's
// `fonts` item"). the registry's `variables` item lists `fonts` among its registryDependencies, so a
// `bg-design update` that touches `variables` writes the face item back into the lock and its files
// into src/registry/styles, and `pnpm design:check` checks only the items the lock already lists.

const lock: { items: Record<string, unknown> } = JSON.parse(
	readFileSync(new URL('../../bg-design.json', import.meta.url), 'utf8')
);

describe('the registry’s face item', () => {
	it('is not in the form’s lock', () => {
		expect(Object.keys(lock.items)).not.toContain('fonts');
	});

	it('left no file in the copied styles', () => {
		const styles = readdirSync(new URL('../registry/styles', import.meta.url));
		expect(styles.filter((name) => name.startsWith('fonts'))).toEqual([]);
	});
});

// the swap ../../vite.registry-faces.ts makes, in every config that turns this package's css into a
// sheet. the embed build's is read in its shipped bytes (./build-output.spec.ts); these three are the
// dev page and both test pools, where a missing alias is an unresolved `@import`.
describe('the registry’s face sheet', () => {
	const configs = [
		['vite.config.ts', viteConfig],
		['vitest.config.ts', vitestConfig],
		['vitest.browser.config.ts', browserConfig]
	] as const;
	for (const [name, config] of configs) {
		it(`is swapped for an empty sheet by ${name}`, () => {
			expect(config.resolve?.alias).toContain(noRegistryFaces);
		});
	}
});
