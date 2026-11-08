import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sheet } from './sheet-rule.testing';

// ./tokens.css holds no colour of its own: each of its four ladders is twelve aliases onto a scale of
// the design registry's copied theme (../registry/styles/themes/default.css, recorded in
// bg-design.json), and every alias reads the step whose job radix names for it
// (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), which the
// registry's scales follow. what a step's value is belongs to the registry and `pnpm design:check`;
// what this file holds is that each name reads the registry scale it is meant to, step for step, and
// the step each job lands on.

const tokens = sheet('tokens.css');
// the theme's two blocks, comments stripped, cut where tokens.spec.ts cuts them: the light block
// opens the file and the dark block opens at the first `:root.dark`.
const registryTheme = readFileSync(
	new URL('../registry/styles/themes/default.css', import.meta.url).pathname,
	'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');
const darkAt = registryTheme.indexOf(':root.dark');
if (darkAt < 0) throw new Error('registry themes/default.css has no :root.dark block to cut at');
const registryModes = {
	light: registryTheme.slice(0, darkAt),
	dark: registryTheme.slice(darkAt)
};

/** the value ./tokens.css states for a custom property, spaces collapsed. */
const token = (name: string): string | undefined =>
	tokens
		.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
		?.trim()
		.replace(/\s+/g, ' ');

// the registry scale each ladder reads: the neutral is the registry's gray, the accent its accent,
// the blocker its destructive and the attention its warning.
const LADDERS = {
	neutral: 'gray',
	accent: 'accent',
	blocker: 'destructive',
	attention: 'warning'
} as const;

/** an alias's step, as `<ladder>-<n>`, or what it states when that is not one step of a ladder. */
const step = (name: string) =>
	token(name)?.match(/^var\(--admin-((?:neutral|accent|blocker|attention)-\d+)\)$/)?.[1] ??
	`not one step: ${token(name)}`;

describe('the four ladders alias the registry’s scales', () => {
	it.each(Object.entries(LADDERS))('%s is the registry’s %s, step for step', (ladder, scale) => {
		const declared = Array.from({ length: 12 }, (_, index) =>
			token(`--admin-${ladder}-${index + 1}`)
		);
		expect(declared).toEqual(
			Array.from({ length: 12 }, (_, index) => `var(--${scale}-${index + 1})`)
		);
		expect(token(`--admin-${ladder}-13`)).toBeUndefined();
	});

	it.each(Object.values(LADDERS))('the registry theme declares every step of %s', (scale) => {
		// an alias onto a step the registry does not declare resolves to nothing and draws nothing,
		// so each mode declares all twelve itself.
		const missing = Object.entries(registryModes).flatMap(([mode, block]) =>
			Array.from({ length: 12 }, (_, index) => `--${scale}-${index + 1}:`)
				.filter((name) => !block.includes(name))
				.map((name) => `${mode} ${name}`)
		);
		expect(missing).toEqual([]);
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
		'--admin-selection-ink': 'accent-12',
		'--admin-rail-current-ink': 'accent-12',
		'--admin-tone-blocker-deep': 'blocker-12',
		'--admin-tone-attention-deep': 'attention-12',
		'--admin-tone-note-deep': 'neutral-12',
		'--admin-tone-done-deep': 'accent-12'
	}
};

// the aliases that read a registry role instead of a ladder step, because the registry's theme file
// declares the job per appearance (../registry/styles/themes/default.css: `--hairline` is gray 6 in
// light and 8 in dark, `--link` accent 9 and 11, and `--ring` the step its generator picks for each,
// accent 11 in both), where a fixed step would be wrong in one of them.
// the ring inside a solid fill is the fill's own ink, white in both modes, where the neutral's
// step 1 turns near-black in dark. a visited link reads `--link` because the registry names no
// visited ink.
const ROLES: Record<string, string> = {
	'--admin-divider': 'var(--hairline)',
	'--admin-focus-ring': 'var(--ring)',
	'--admin-link': 'var(--link)',
	'--admin-link-hover': 'var(--link-hover)',
	'--admin-link-visited': 'var(--link)',
	'--admin-focus-ring-solid': 'var(--primary-fg)',
	'--admin-primary-ink': 'var(--primary-fg)',
	'--admin-danger-ink': 'var(--destructive-fg)',
	'--admin-scrim': 'var(--overlay)'
};

// the aliases that read a registry variable directly and are no colour: the three faces and the two
// radii, which tokens.spec.ts pins to their targets.
const NON_COLOUR_REGISTRY_READS = [
	'--admin-font-sans',
	'--admin-font-display',
	'--admin-font-mono',
	'--admin-radius',
	'--admin-radius-plane'
];

describe('every colour alias reads the step radix names for its job', () => {
	it.each(Object.entries(JOBS))('%s', (_, aliases) => {
		const stated = Object.fromEntries(Object.keys(aliases).map((name) => [name, step(name)]));
		expect(stated).toEqual(aliases);
	});

	it('reads a registry role where the registry resolves the job differently in dark', () => {
		const stated = Object.fromEntries(Object.keys(ROLES).map((name) => [name, token(name)]));
		expect(stated).toEqual(ROLES);
	});

	it('draws the wash as step 2 under the accent’s 2 and 3', () => {
		expect(token('--admin-page-wash')).toBe(
			'radial-gradient(80% 65% at 15% 30%, var(--admin-accent-2), transparent 70%), radial-gradient(65% 65% at 95% 90%, var(--admin-accent-3), transparent 70%), var(--admin-neutral-2)'
		);
	});

	it('places every colour alias tokens.css declares', () => {
		// a colour alias is a declaration whose value is one ladder step. the wash, the roles above and
		// the ladders themselves are not aliases.
		const aliases = [
			...tokens.matchAll(
				/(--admin-[\w-]+)\s*:\s*var\(--admin-(?:neutral|accent|blocker|attention)-\d+\)\s*;/g
			)
		].map(([, name]) => name);
		const placed = new Set(Object.values(JOBS).flatMap((group) => Object.keys(group)));
		expect(aliases.filter((name) => name !== undefined && !placed.has(name))).toEqual([]);
		expect([...placed].filter((name) => !aliases.includes(name))).toEqual([]);
	});

	it('names every alias that reads a registry variable instead of a ladder step', () => {
		// an alias onto a registry variable is in no job above, so without this it is checked by
		// nothing: it is a role or one of the non-colour reads, or it fails here. the ladders' own
		// rungs read the registry by design and are held by the first cases.
		const rungs = Object.keys(LADDERS).flatMap((ladder) =>
			Array.from({ length: 12 }, (_, index) => `--admin-${ladder}-${index + 1}`)
		);
		const direct = [...tokens.matchAll(/(--admin-[\w-]+)\s*:\s*([^;]+);/g)]
			.filter(([, , value]) => /var\(\s*--(?!admin-)/.test(value ?? ''))
			.map(([, name]) => name ?? '')
			.filter((name) => !rungs.includes(name));
		const named = new Set([...Object.keys(ROLES), ...NON_COLOUR_REGISTRY_READS]);
		expect(direct.filter((name) => !named.has(name))).toEqual([]);
		expect([...named].filter((name) => !direct.includes(name))).toEqual([]);
	});
});
