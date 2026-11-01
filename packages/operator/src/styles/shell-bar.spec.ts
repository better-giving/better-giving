import { describe, expect, it } from 'vitest';
import { rulesIn, ruleOf, sheet } from './sheet-rule.testing';

// what the top bar and the phone bar paint, read off the sheets: neither pool lays anything out
// (../../vitest.config.ts), so the rule is the claim.

const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** the value ./tokens.css states for a custom property, spaces collapsed. */
const token = (name: string): string | undefined =>
	tokens
		.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
		?.trim()
		.replace(/\s+/g, ' ');

/** the declarations of the rule whose selector list is exactly `selectors`. */
const listed = (...selectors: string[]) =>
	rulesIn(css).find((rule) => rule.selector === selectors.join(', '))?.stated;

describe("the phone bar's current destination", () => {
	it('is the accent’s tint at rest and one step up under a pointer', () => {
		expect(token('--admin-bar-current-bg')).toBe('var(--admin-accent-3)');
		expect(token('--admin-bar-current-bg-hover')).toBe('var(--admin-accent-4)');
	});

	it('paints those grounds, and keeps its ink the rail’s at rest', () => {
		const rest = listed('.adm-dest[aria-current]', '.adm-dest.is-current');
		expect(rest?.get('background')).toBe('var(--admin-bar-current-bg)');
		expect(rest?.get('color')).toBe('var(--admin-rail-current-ink)');
	});

	it('wears the accent’s deep ink under a pointer', () => {
		const hover = listed(
			'.adm-dest[aria-current]:hover',
			'.adm-dest[aria-current].is-hover',
			'.adm-dest.is-current:hover',
			'.adm-dest.is-current.is-hover'
		);
		expect(hover?.get('background')).toBe('var(--admin-bar-current-bg-hover)');
		expect(hover?.get('color')).toBe('var(--admin-accent-deep)');
	});
});

describe('the way out in the top bar', () => {
	it('never shrinks and stands at the far end', () => {
		const out = ruleOf(css, '.adm-signout');
		expect(out.get('flex-shrink')).toBe('0');
		expect(out.get('margin-inline-start')).toBe('auto');
	});

	it('shows its word and hides its mark', () => {
		expect(ruleOf(css, '.adm-signout:has(.adm-signout__word) .adm-mark').get('display')).toBe(
			'none'
		);
	});
});

describe('the top bar’s row', () => {
	it('is white and draws the neutral-6 rule under it', () => {
		const bar = ruleOf(css, '.adm-identity');
		expect(bar.get('background')).toBe('var(--admin-surface)');
		expect(bar.get('border-block-end')).toBe('var(--admin-rule)');
		expect(token('--admin-rule')).toBe('var(--admin-border-width) solid var(--admin-divider)');
		expect(token('--admin-divider')).toBe('var(--admin-neutral-6)');
	});
});
