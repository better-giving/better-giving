import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the form copies no registry face (AGENTS.md → Boundaries, "one look, one source"): the card is set
// in the face the host page gives the element (../styles/tokens.css). the registry's `variables`
// item ships no face and imports none (../registry/styles/variables.usage.md), so a face item in the
// lock is one somebody added, and `pnpm design:check` checks only the items the lock already lists.

const lock: { items: Record<string, unknown> } = JSON.parse(
	readFileSync(new URL('../../bg-design.json', import.meta.url), 'utf8')
);

describe('the registry’s face items', () => {
	it('are not in the form’s lock', () => {
		expect(Object.keys(lock.items).filter((name) => name.startsWith('fonts'))).toEqual([]);
	});

	it('left no file in the copied styles', () => {
		const styles = readdirSync(new URL('../registry/styles', import.meta.url));
		expect(styles.filter((name) => name.startsWith('fonts'))).toEqual([]);
	});
});

// no config in this package aliases a css `@import`, so one in a copied sheet that names a file the
// lock did not copy fails every build that reads it. this names that import before a build has to.
describe('the copied registry sheets', () => {
	const styles = new URL('../registry/styles/', import.meta.url);
	const sheets = readdirSync(styles, { recursive: true, encoding: 'utf8' }).filter((name) =>
		name.endsWith('.css')
	);

	it('import only a file the lock copied beside them', () => {
		const missing = sheets.flatMap((sheet) => {
			const at = new URL(sheet, styles);
			return [...readFileSync(at, 'utf8').matchAll(/@import\s+["']([^"']+)["']/g)]
				.map(([, specifier = '']) => specifier)
				.filter((specifier) => !existsSync(new URL(specifier, at)))
				.map((specifier) => `${sheet} → ${specifier}`);
		});
		expect(sheets.length).toBeGreaterThan(0);
		expect(missing).toEqual([]);
	});
});
