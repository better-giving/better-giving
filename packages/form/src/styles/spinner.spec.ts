import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// node pool: the sheets read as text, as ./font-mono.spec.ts reads them. the busy ring is the
// registry's (../registry/styles/spinner-css.css); the card restates its turn so the ring keeps
// turning, slowed, under reduced motion, where the registry stands it still (the head of
// ./tokens.css). what this holds is that the restated turn is the registry's own.

const read = (path: string): string =>
	readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const registry = read('../registry/styles/spinner-css.css');
const tokens = read('./tokens.css');
const motion = read('./motion.css');

describe('the busy ring', () => {
	it('turns the ring at the registry’s own speed', () => {
		const [, name, turn] =
			/--ds-animate-spinner:\s*(\S+)\s+(\S+)\s+linear infinite;/.exec(registry) ?? [];

		expect(name).toBe('ds-spin');
		// the first declaration is the card's, before the reduced-motion block re-points it.
		expect(/--_dur-spin:\s*([^;]+);/.exec(tokens)?.[1]).toBe(turn);
		expect(motion).toMatch(/animation: ds-spin var\(--_dur-spin\) linear infinite;/);
	});

	it('draws no ring of its own', () => {
		expect(motion).not.toMatch(/@keyframes spin\b/);
		expect(tokens).not.toMatch(/--_spinner\b/);
	});
});
