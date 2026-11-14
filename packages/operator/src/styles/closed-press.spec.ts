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

describe('a press closed by aria-disabled on a button', () => {
	// ../components/controls/SaveButton.jsx closes its press this way so the reader standing on it
	// keeps the focus. the registry draws it — the closed pair, the not-allowed pointer and no press
	// nudge — and ./adm.css leaves it to the registry but for the one press whose face is its own
	// outcome.
	const closed = registryRules.find(({ selector }) => selector === `button.ds-btn${DISABLED}`);

	it('is drawn by the registry on the closed pair, with no nudge', () => {
		expect(closed?.stated.get('background-color')).toBe('var(--gray-3)');
		expect(closed?.stated.get('color')).toBe('var(--gray-11)');
		expect(closed?.stated.get('cursor')).toBe('not-allowed');
		expect(closed?.stated.get('transform')).toBe('none');
	});

	it('is the same pair the registry closes a native and a busy press with', () => {
		const busy = registryRules.find(({ selector }) => selector.includes(`.ds-btn-primary${BUSY}`));
		expect([busy?.stated.get('background-color'), busy?.stated.get('color')]).toEqual([
			closed?.stated.get('background-color'),
			closed?.stated.get('color')
		]);
	});

	it('takes no ground, ink or nudge from the operator sheet but on the outcome press', () => {
		const restated = rulesIn(css)
			.filter(({ selector }) => /\.adm-btn\b[^,]*\[aria-disabled='true'\]/.test(selector))
			.filter(({ stated }) =>
				['background-color', 'background', 'color', 'transform'].some((p) => stated.has(p))
			)
			.map(({ selector }) => selector);
		expect(restated).toEqual([".adm-btn.adm-saidpress[aria-disabled='true']"]);
	});
});

// a mark beside a press's words is spaced by the registry's flex gap, on the md tier and on each
// tier that restates it. a gap from ./adm.css as well would outrank the registry's and put a second
// measure between the two, and none at all leaves the mark touching the words.
describe('the space between a mark and its words', () => {
	const TIERS = ['.ds-btn', '.ds-btn-sm', '.ds-btn-md', '.ds-btn-lg', '.ds-btn-field'];

	it('is drawn by the registry on every tier', () => {
		const gaps = TIERS.map(
			(tier) => registryRules.find(({ selector }) => selector === tier)?.stated.get('gap') ?? ''
		);
		expect(gaps.filter((gap) => !/^calc\(var\(--ds-spacing\) \* [\d.]+\)$/.test(gap))).toEqual([]);
	});

	it('is not restated on a press by the operator sheet', () => {
		const restated = rulesIn(css)
			.filter(({ selector }) => /\.adm-btn\b/.test(selector) && !selector.includes('::'))
			.filter(({ stated }) => stated.has('gap') || stated.has('column-gap'))
			.map(({ selector }) => selector);
		expect(restated).toEqual([]);
	});
});
