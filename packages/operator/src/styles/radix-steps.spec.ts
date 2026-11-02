import { describe, expect, it } from 'vitest';
import { sheet } from './sheet-rule.testing';

// ./tokens.css adopts radix colors whole: the four ladders are `@radix-ui/colors` 3.0.0's light
// values, and every alias reads the step whose job radix names for it
// (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale). contrast is
// radix's guarantee rather than a number measured here — step 11 is built for APCA Lc 60 and step 12
// for Lc 90 on step 2, and a step-7 control edge reads under a fine line's Lc 30 by radix's own
// design — so what this file holds is the step each job lands on, which is what that guarantee is
// a guarantee about.

const tokens = sheet('tokens.css');

/** the value ./tokens.css states for a custom property, spaces collapsed. */
const token = (name: string): string | undefined =>
	tokens
		.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
		?.trim()
		.replace(/\s+/g, ' ');

// the package's published light scales, copied from `@radix-ui/colors` 3.0.0 (slate.js, blue.js,
// red.js, amber.js). no dependency is installed: these are the reference the file is held to.
const RADIX = {
	neutral: [
		'#fcfcfd',
		'#f9f9fb',
		'#f0f0f3',
		'#e8e8ec',
		'#e0e1e6',
		'#d9d9e0',
		'#cdced6',
		'#b9bbc6',
		'#8b8d98',
		'#80838d',
		'#60646c',
		'#1c2024'
	],
	accent: [
		'#fbfdff',
		'#f4faff',
		'#e6f4fe',
		'#d5efff',
		'#c2e5ff',
		'#acd8fc',
		'#8ec8f6',
		'#5eb1ef',
		'#0090ff',
		'#0588f0',
		'#0d74ce',
		'#113264'
	],
	blocker: [
		'#fffcfc',
		'#fff7f7',
		'#feebec',
		'#ffdbdc',
		'#ffcdce',
		'#fdbdbe',
		'#f4a9aa',
		'#eb8e90',
		'#e5484d',
		'#dc3e42',
		'#ce2c31',
		'#641723'
	],
	attention: [
		'#fefdfb',
		'#fefbe9',
		'#fff7c2',
		'#ffee9c',
		'#fbe577',
		'#f3d673',
		'#e9c162',
		'#e2a336',
		'#ffc53d',
		'#ffba18',
		'#ab6400',
		'#4f3422'
	]
} as const;

/** an alias's step, as `<ladder>-<n>`, or what it states when that is not one step of a ladder. */
const step = (name: string) =>
	token(name)?.match(/^var\(--admin-((?:neutral|accent|blocker|attention)-\d+)\)$/)?.[1] ??
	`not one step: ${token(name)}`;

describe('the four ladders are radix’s published values', () => {
	it.each(Object.entries(RADIX))('%s is its radix scale, step for step', (ladder, values) => {
		const declared = values.map((_, index) => token(`--admin-${ladder}-${index + 1}`));
		expect(declared).toEqual([...values]);
		expect(token(`--admin-${ladder}-13`)).toBeUndefined();
	});
});

// every colour alias, grouped by the job radix gives the step it reads. a new colour alias fails
// the last case until it is placed in one of these.
const JOBS: Record<string, Record<string, string>> = {
	'1 app background': {
		'--admin-surface': 'neutral-1',
		'--admin-field-bg': 'neutral-1'
	},
	'2 subtle background': {
		'--admin-page': 'neutral-2'
	},
	'3 ui element background': {
		'--admin-surface-sunken': 'neutral-3',
		'--admin-surface-fill': 'neutral-3',
		'--admin-control-bg': 'neutral-3',
		'--admin-control-bg-disabled': 'neutral-3',
		'--admin-control-soft-bg': 'neutral-3',
		'--admin-control-quiet-bg-hover': 'neutral-3',
		'--admin-primary-bg-disabled': 'neutral-3',
		'--admin-field-bg-disabled': 'neutral-3',
		'--admin-code-bg': 'neutral-3',
		'--admin-slab-bg': 'neutral-3',
		'--admin-rail-hover-bg': 'neutral-3',
		'--admin-accent-tint': 'accent-3',
		'--admin-tone-blocker-tint': 'blocker-3',
		'--admin-tone-attention-tint': 'attention-3',
		'--admin-tone-note-tint': 'neutral-3',
		'--admin-tone-done-tint': 'accent-3'
	},
	'4 hovered ui element': {
		'--admin-control-bg-hover': 'neutral-4',
		'--admin-control-soft-bg-hover': 'neutral-4',
		'--admin-control-quiet-bg-active': 'neutral-4'
	},
	'5 active or selected ui element': {
		'--admin-control-bg-active': 'neutral-5',
		'--admin-control-soft-bg-active': 'neutral-5',
		'--admin-selection-bg': 'accent-5',
		'--admin-accent-selected': 'accent-5',
		'--admin-rail-current-bg': 'accent-5',
		'--admin-rail-current-bg-hover': 'accent-5',
		'--admin-bar-current-bg': 'accent-5',
		'--admin-bar-current-bg-hover': 'accent-5'
	},
	'6 subtle borders and separators': {
		'--admin-divider': 'neutral-6',
		'--admin-overlay-border': 'neutral-6',
		'--admin-control-border-disabled': 'neutral-6'
	},
	'7 ui element border': {
		'--admin-border': 'neutral-7',
		'--admin-control-border': 'neutral-7',
		'--admin-field-border': 'neutral-7',
		'--admin-accent-edge': 'accent-7'
	},
	'8 hovered ui element border, and the focus ring': {
		'--admin-control-border-hover': 'neutral-8',
		'--admin-control-border-active': 'neutral-8',
		'--admin-field-border-hover': 'neutral-8',
		'--admin-field-border-invalid': 'blocker-8',
		'--admin-field-border-needed': 'attention-8',
		'--admin-focus-ring': 'accent-8',
		'--admin-accent-edge-hover': 'accent-8',
		// radix themes draws a disabled label on the hovered border step.
		'--admin-ink-disabled': 'neutral-8',
		'--admin-control-ink-disabled': 'neutral-8',
		'--admin-primary-ink-disabled': 'neutral-8'
	},
	'9 solid background': {
		'--admin-primary-bg': 'accent-9',
		'--admin-accent-fill': 'accent-9',
		'--admin-danger-bg': 'blocker-9'
	},
	'10 hovered solid background': {
		'--admin-primary-bg-hover': 'accent-10',
		'--admin-primary-bg-active': 'accent-10',
		'--admin-danger-bg-hover': 'blocker-10',
		'--admin-danger-bg-active': 'blocker-10'
	},
	'11 low-contrast text': {
		'--admin-ink-2': 'neutral-11',
		'--admin-ink-muted': 'neutral-11',
		'--admin-field-placeholder': 'neutral-11',
		'--admin-accent-ink': 'accent-11',
		'--admin-link': 'accent-11',
		'--admin-tone-blocker-ink': 'blocker-11',
		'--admin-tone-blocker-mark': 'blocker-11',
		'--admin-tone-attention-ink': 'attention-11',
		'--admin-tone-attention-mark': 'attention-11',
		'--admin-tone-note-ink': 'neutral-11',
		'--admin-tone-note-mark': 'neutral-11',
		'--admin-tone-done-ink': 'accent-11',
		'--admin-tone-done-mark': 'accent-11',
		'--admin-tone-resolved-ink': 'neutral-11',
		'--admin-tone-resolved-mark': 'neutral-11'
	},
	'12 high-contrast text': {
		'--admin-ink': 'neutral-12',
		'--admin-control-ink': 'neutral-12',
		'--admin-control-ink-hover': 'neutral-12',
		'--admin-control-soft-ink': 'neutral-12',
		'--admin-code-ink': 'neutral-12',
		'--admin-slab-ink': 'neutral-12',
		'--admin-accent-ink-hover': 'accent-12',
		'--admin-accent-deep': 'accent-12',
		'--admin-link-hover': 'accent-12',
		'--admin-link-visited': 'accent-12',
		'--admin-selection-ink': 'accent-12',
		'--admin-rail-current-ink': 'accent-12',
		'--admin-tone-blocker-deep': 'blocker-12',
		'--admin-tone-attention-deep': 'attention-12',
		'--admin-tone-note-deep': 'neutral-12',
		'--admin-tone-done-deep': 'accent-12'
	},
	// the white a label stands in on a solid fill, and the ring drawn inside one: radix's white,
	// spelled as the neutral's step 1 so no literal stands outside the ladders.
	'white on a solid step': {
		'--admin-primary-ink': 'neutral-1',
		'--admin-danger-ink': 'neutral-1',
		'--admin-focus-ring-solid': 'neutral-1'
	}
};

describe('every colour alias reads the step radix names for its job', () => {
	it.each(Object.entries(JOBS))('%s', (_, aliases) => {
		const stated = Object.fromEntries(Object.keys(aliases).map((name) => [name, step(name)]));
		expect(stated).toEqual(aliases);
	});

	it('draws the wash as step 2 under the accent’s 2 and 3', () => {
		expect(token('--admin-page-wash')).toBe(
			'radial-gradient(80% 65% at 15% 30%, var(--admin-accent-2), transparent 70%), radial-gradient(65% 65% at 95% 90%, var(--admin-accent-3), transparent 70%), var(--admin-neutral-2)'
		);
	});

	it('places every colour alias tokens.css declares', () => {
		// a colour alias is a declaration whose value is one ladder step. the wash, the scrim and the
		// ladders themselves are not aliases.
		const aliases = [
			...tokens.matchAll(
				/(--admin-[\w-]+)\s*:\s*var\(--admin-(?:neutral|accent|blocker|attention)-\d+\)\s*;/g
			)
		].map(([, name]) => name);
		const placed = new Set(Object.values(JOBS).flatMap((group) => Object.keys(group)));
		expect(aliases.filter((name) => name !== undefined && !placed.has(name))).toEqual([]);
		expect([...placed].filter((name) => !aliases.includes(name))).toEqual([]);
	});
});
