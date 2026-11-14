import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// node pool: the sheets read as text, as ./font-mono.spec.ts reads them. the busy ring is the
// registry's (../registry/styles/spinner-css.css); the card restates its turn so the ring keeps
// turning, slowed, under reduced motion, where the registry stands it still (the head of
// ./tokens.css), and restates its size to centre it on the status's first line (the same head).
// what this holds is that each restated figure is the registry's own.

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

	it('centres the status’s ring on a size equal to the registry’s', () => {
		const step = Number(
			/--ds-spacing:\s*calc\(([\d.]+) \* var\(--ds-rem, 1rem\)\);/.exec(registry)?.[1]
		);
		// the first `inline-size` is `.ds-spinner`'s, before `.ds-spinner-sm` restates it.
		const steps = Number(
			/inline-size:\s*calc\(var\(--ds-spacing\) \* ([\d.]+)\);/.exec(registry)?.[1]
		);
		const restated = Number(
			/\.status > \.ds-spinner\s*\{[^}]*margin-block-start:\s*calc\(\(1lh - var\(--ds-rem\) \* ([\d.]+)\) \/ 2\);/.exec(
				read('./parts.css')
			)?.[1]
		);

		// a pattern that stops matching reads NaN on both sides, which `toBe` calls equal.
		expect(restated).toBeGreaterThan(0);
		expect(restated).toBe(step * steps);
	});

	it('draws no ring of its own', () => {
		expect(motion).not.toMatch(/@keyframes spin\b/);
		expect(tokens).not.toMatch(/--_spinner\b/);
	});
});
