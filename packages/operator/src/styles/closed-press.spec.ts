import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { rulesIn, sheet } from './sheet-rule.testing';

// a press that is closed is drawn closed by the registry's button sheet and by ./adm.css, and the
// component specs only see the attribute: `aria-busy` on a button in flight, `aria-disabled` on one
// closed in its own handler (../components/controls/SaveButton.jsx). the look lives in the sheets,
// so a registry update that drops `[aria-busy]` or `[aria-disabled]` from a closed list leaves
// every component spec green and a closed press drawn open, hovering and pressing under the
// pointer that started it. no /admin screen gets a `*.browser.spec.ts` (AGENTS.md, Never), so the
// selectors are read as text, as ./touch-geometry.spec.ts reads its rules.

const RANKS = ['primary', 'secondary', 'ghost', 'outline', 'destructive', 'success', 'warning'];
const BUSY = '[aria-busy="true"]';
const DISABLED = '[aria-disabled="true"]';

const registry = stripComments(
	readFileSync(
		// resolved through `fileURLToPath`, which ./field-on-a-tight-stack.dom.spec.tsx argues.
		join(dirname(fileURLToPath(import.meta.url)), '../registry/styles/button-css.css'),
		'utf8'
	)
);
const registryRules = rulesIn(registry);
const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** the rules that hover or press a rank, which must pass over a closed press. */
const reachesAnOpenPress = ({ selector }: { selector: string }) =>
	/:(?:hover|active):not\(/.test(selector);

describe("the registry's closed press", () => {
	it('is read from the rules it should be', () => {
		// a sheet renamed or reshaped reads as no rule disagreeing with another.
		expect(registryRules.filter(reachesAnOpenPress).length).toBeGreaterThan(6);
	});

	it('is passed over by every hover and press rule, for a native, a disabled-by-aria and a busy press', () => {
		const open = registryRules.filter(reachesAnOpenPress);

		const missing = open.flatMap(({ selector }) =>
			[':disabled', DISABLED, BUSY]
				.filter((closed) => !selector.includes(closed))
				.map((closed) => `${selector} lacks ${closed}`)
		);

		expect(missing).toEqual([]);
	});

	it('draws a press in flight as the closed fill, inert to the pointer, on every rank', () => {
		const busy = registryRules.filter(
			({ selector }) => selector.includes(BUSY) && !/:not\(/.test(selector)
		);
		const ranksDrawn = RANKS.filter((rank) =>
			busy.some(({ selector }) =>
				selector.split(',').some((part) => part.trim() === `.ds-btn-${rank}${BUSY}`)
			)
		);

		expect(ranksDrawn).toEqual(RANKS);
		expect(busy.some(({ stated }) => stated.get('pointer-events') === 'none')).toBe(true);
		expect(busy.some(({ stated }) => stated.has('background-color'))).toBe(true);
	});

	it('draws a press closed by aria-disabled on an anchor, every rank', () => {
		const anchors = registryRules.filter(
			({ selector }) => selector.includes(`a.ds-btn-`) && selector.includes(DISABLED)
		);
		const ranksDrawn = RANKS.filter((rank) =>
			anchors.some(({ selector }) =>
				selector.split(',').some((part) => part.trim() === `a.ds-btn-${rank}${DISABLED}`)
			)
		);

		expect(ranksDrawn).toEqual(RANKS);
	});
});

describe("the operator sheet's closed press", () => {
	const closed = rulesIn(css).find(({ selector }) => selector === ".adm-btn[aria-disabled='true']");
	const pressed = rulesIn(css).find(({ selector }) =>
		selector.includes(".adm-btn[aria-disabled='true']:active")
	);

	it('closes a button held shut by aria-disabled on the same fill and ink as the registry closes it', () => {
		expect(closed?.stated.get('background-color')).toBe('var(--admin-button-bg-disabled)');
		expect(closed?.stated.get('color')).toBe('var(--admin-button-ink-disabled)');
		expect(closed?.stated.get('cursor')).toBe('not-allowed');
	});

	it('names the pair it draws in the token sheet', () => {
		expect(tokens).toMatch(/--admin-button-bg-disabled:\s*var\(--admin-neutral-3\)/);
		expect(tokens).toMatch(/--admin-button-ink-disabled:\s*var\(--admin-neutral-11\)/);
	});

	it('takes the pixel off a closed press, as the pointer and as the forced state', () => {
		expect(pressed?.selector.split(',').map((part) => part.trim())).toEqual([
			".adm-btn[aria-disabled='true']:active",
			".adm-btn[aria-disabled='true'].is-active"
		]);
		expect(pressed?.stated.get('transform')).toBe('none');
	});
});
