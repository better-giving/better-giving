import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
