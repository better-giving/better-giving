import {
	rawColourViolations,
	rawLengthViolations,
	stripComments
} from '@better-giving/operator/styles/raw-values';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brandScaleCss, generateBrandScale } from '@better-giving/form/styles/radix-scale';
import { afterAll, describe, expect, it } from 'vitest';
import { LAYOUTS } from '../page/shape';
import { blocks, declared, type Scope, steps, substitute } from './page-colour.testing';
import { PageRoot } from './page-root';

// the gate over ./page.css, which is the donor page's token layer and the rules beside it. the
// sheet's header states what each half below holds it to.
//
// names: every `--_` name the sheet reads is one the form's token file declares, or one the brand
// scale ./page-root.tsx renders sets, and every registry accent step it reads is one that scale
// re-themes. the sheet re-points `--_font-mono`, declares `--_w-sent`, and declares no other `--_`
// name.
// every `--page-*` name read is declared here or set inline by the page root; every `--donate-*`
// name written is a seed the form registers.
//
// values: outside a custom property's own declaration no colour and no length is written, which is
// the operator sweeps in packages/operator/src/styles/raw-values.ts handed a copy of the sheet with
// the token declarations blanked out. the container breakpoints the header names are the one literal
// a condition may carry.
//
// the sections: ./page-view.tsx and ./sections/*.tsx write no raw colour or length into a style object,
// and every class they write is one ./page.css draws, the form's layout sheet for its `.vh`, or the
// registry's button the page links: a class nothing draws paints nothing and fails nowhere else.
//
// the edit edge: drawn only under `:root[data-editing]`, and solid on the innermost hovered section
// alone.
//
// the steps: every colour the sheet writes lands on the radix step whose job it does
// (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), read down
// to the step through ./page-colour.testing.ts. contrast is radix's guarantee for a step doing its
// job, not a number measured here.

const require = createRequire(import.meta.url);
const FORM_TOKENS = require.resolve('@better-giving/form/styles/tokens.css');
const PAGE_CSS = join(import.meta.dirname, 'page.css');
const HERE = relative(process.cwd(), PAGE_CSS);
const pageText = readFileSync(PAGE_CSS, 'utf8');
const formText = readFileSync(FORM_TOKENS, 'utf8');
const page = blocks(pageText);
const form = blocks(formText);

// the container widths a section's layout may change at, as ./page.css's header states them.
const BREAKPOINTS = ['30rem', '48rem', '60rem'];

// a seed the page sets nothing for computes its registered initial value, as the browser does.
const seedDefaults: Scope = Object.fromEntries(
	form.flatMap(({ at: [rule, ...inside], decls }) =>
		rule?.startsWith('@property ') && inside.length === 0 && decls['initial-value'] !== undefined
			? [[rule.slice('@property '.length), decls['initial-value']]]
			: []
	)
);
// a page with no brand colour renders no scale (./page-root.tsx), so its `--accent-*` steps are the
// registry default theme's own: the light block of the copied sheet, which declares them on `:root`
// and on the page root's `[data-theme]`.
const REGISTRY_THEME = readFileSync(
	join(dirname(FORM_TOKENS), '../registry/styles/themes/default.css'),
	'utf8'
);
const registryLight = blocks(REGISTRY_THEME).find(({ decls }) => decls['--accent-2'] !== undefined);
if (registryLight === undefined) throw new Error('the registry theme declares no light accent');
// the generator's scale for a brand colour: the declarations a branded page renders on its root.
const branded = generateBrandScale('#1f6feb');
if (branded === null) throw new Error('the generator reads no scale from #1f6feb');
const brandedScale = brandScaleCss('[data-donate-root]', branded);
// the registry's roles, which the form's `--_` names alias: `--_bad-tint` is `--destructive-subtle`.
const REGISTRY_COLORS = readFileSync(
	join(dirname(FORM_TOKENS), '../registry/styles/colors.css'),
	'utf8'
);
const registryRoles = blocks(REGISTRY_COLORS).find(
	({ decls }) => decls['--destructive-subtle'] !== undefined
);
if (registryRoles === undefined) throw new Error('the registry declares no destructive role');
const formBase: Scope = {
	...seedDefaults,
	...registryRoles.decls,
	...declared(form, ':host, [data-donate-root]'),
	...registryLight.decls,
	...declared(form, ':host > *, [data-donate-root] > *')
};
const reads = (css: string, prefix: string) =>
	new Set(
		[...stripComments(css).matchAll(new RegExp(`var\\(\\s*(${prefix}[\\w-]*)`, 'g'))].map(
			(m) => m[1] ?? ''
		)
	);
const declares = (css: string, prefix: string) =>
	new Set(
		[...stripComments(css).matchAll(new RegExp(`(?:^|[;{\\s])(${prefix}[\\w-]*)\\s*:`, 'gm'))].map(
			(m) => m[1] ?? ''
		)
	);

function root(props: Partial<Parameters<typeof PageRoot>[0]> = {}): {
	attributes: Record<string, string>;
	inline: Scope;
} {
	const html = renderToStaticMarkup(
		createElement(PageRoot, {
			brandColour: '#1f6feb',
			layout: 'card',
			...props,
			children: null
		})
	);
	const open = /^<div([^>]*)>/.exec(html)?.[1] ?? '';
	const attributes = Object.fromEntries(
		[...open.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1] ?? '', m[2] ?? ''])
	);
	const inline = Object.fromEntries(
		(attributes.style ?? '')
			.split(';')
			.filter(Boolean)
			.map((d) => {
				const colon = d.indexOf(':');
				return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
			})
	);
	return { attributes, inline };
}

describe('a page with no brand colour', () => {
	const literal = (name: string) =>
		new RegExp(`^\\s*${name}:\\s*([^;]+?);`, 'm').exec(stripComments(REGISTRY_THEME))?.[1];
	const wash = page.flatMap(({ decls }) => decls['--page-wash'] ?? []);

	it('reaches the registry theme’s `:root` block from the form’s token file, with no scale of its own', () => {
		const variables = readFileSync(
			join(dirname(FORM_TOKENS), '../registry/styles/variables.css'),
			'utf8'
		);
		expect(formText).toContain("@import '../registry/styles/variables.css'");
		expect(variables).toContain('@import "./colors.css"');
		expect(REGISTRY_COLORS).toContain('@import "./themes/default.css"');
		expect(registryLight.at[0]?.split(',').map((one) => one.trim())).toContain(':root');
		expect(root({ brandColour: null }).inline).toEqual({});
	});

	it('draws the wash from the registry theme’s accent 2 and 3, and the ring from its accent 8', () => {
		expect(wash).toHaveLength(1);
		expect(substitute(formBase, wash[0] ?? '')).toBe(
			`radial-gradient(max(80cqi, 26rem) 38rem at 0% 14rem, ${literal('--accent-2')}, transparent 70%), ` +
				`radial-gradient(max(65cqi, 24rem) 38rem at 100% 100%, ${literal('--accent-3')}, transparent 70%)`
		);
		expect(substitute(formBase, 'var(--_focus-ring)')).toBe(literal('--accent-8'));
		expect(literal('--accent-8')).toMatch(/^oklch\(/);
	});
});

describe('the names ./page.css reads and writes', () => {
	it('reads every `--_` name from the form token file or the generated scale, and finds names to read', () => {
		const formNames = new Set([...declares(formText, '--_')]);
		const read = [...reads(pageText, '--_')];
		expect(read.length).toBeGreaterThan(0);
		expect(read.filter((name) => !formNames.has(name))).toEqual([]);
	});

	// the wash reads the registry's accent by name rather than through an alias the card does not
	// spend, so each step it reads has to be one the page root's scale re-themes for the brand.
	it('reads every `--accent-*` step from the scale the page root renders', () => {
		const read = [...reads(pageText, '--accent-')];
		expect(read.length).toBeGreaterThan(0);
		expect(read.filter((name) => !declares(brandedScale, '--accent-').has(name))).toEqual([]);
	});

	// no seed moves the status scales, so a `--destructive-*` step is the registry theme's on every page.
	it('reads every `--destructive-*` step from the registry theme', () => {
		const read = [...reads(pageText, '--destructive-')];
		expect(read.length).toBeGreaterThan(0);
		expect(read.filter((name) => registryLight.decls[name] === undefined)).toEqual([]);
	});

	it('re-points the form’s monospace token and the sent figure’s weight', () => {
		expect([...declares(pageText, '--_')].sort()).toEqual(['--_font-mono', '--_w-sent']);
		expect(declared(page, '.page div')).toEqual({
			'--_font-mono': 'var(--page-font-mono)',
			'--_w-sent': 'var(--_w-medium)',
			'font-variant-ligatures': 'no-contextual'
		});
	});

	it('sets the three faces from the roles the face sheet re-points', () => {
		// packages/operator/src/styles/fonts.css re-points the registry's `--font-*` roles at plain red
		// hat, `!important`, and donorPageLinks() in ./plain-page.tsx links it beside this sheet, so
		// the page reads the roles rather than stating a stack of its own.
		const fonts = stripComments(
			readFileSync(require.resolve('@better-giving/operator/styles/fonts.css'), 'utf8')
		);
		const faces = declared(page, '.page > .page-ground');
		expect({
			text: faces['--page-font-text'],
			display: faces['--page-font-display'],
			mono: faces['--page-font-mono']
		}).toEqual({
			text: 'var(--font-body)',
			display: 'var(--font-display)',
			mono: 'var(--font-mono)'
		});
		for (const [role, lead] of [
			['--font-body', 'Red Hat Text'],
			['--font-display', 'Red Hat Display'],
			['--font-mono', 'Red Hat Mono']
		])
			expect(fonts).toMatch(new RegExp(`(?<![\\w-])${role}:\\s*'${lead}'[^;]*!important;`));
		expect([...reads(pageText, '--font-')].sort()).toEqual([
			'--font-body',
			'--font-display',
			'--font-mono'
		]);
	});

	it('sets the crypto total at the mono medium, which is a file', () => {
		expect(declared(page, '.page .entry.total .value.amount')).toEqual({
			'font-weight': 'var(--_w-medium)'
		});
	});

	it('sets the sent figure at the mono medium, which is a file', () => {
		expect(declared(page, '.page div')['--_w-sent']).toBe('var(--_w-medium)');
	});

	it('reads every `--page-*` name from itself or from the page root', () => {
		const inline = Object.keys(root().inline);
		const own = declares(pageText, '--page-');
		expect(
			[...reads(pageText, '--page-')].filter((n) => !own.has(n) && !inline.includes(n))
		).toEqual([]);
	});

	it('writes no `--donate-*` name the form does not register, here or on the root', () => {
		const registered = new Set(Object.keys(seedDefaults));
		const written = [...declares(pageText, '--donate-'), ...Object.keys(root().inline)].filter(
			(name) => name.startsWith('--donate-')
		);
		expect(written.length).toBeGreaterThan(0);
		expect(written.filter((name) => !registered.has(name))).toEqual([]);
	});
});

describe('the values ./page.css writes', () => {
	// the token declarations blanked, a line's newlines kept, so a finding names the real line.
	const rules = (() => {
		const stripped = stripComments(pageText);
		const chars = [...pageText];
		for (const m of stripped.matchAll(/--[\w-]+\s*:[^;{}]*;/g)) {
			for (let i = m.index; i < m.index + m[0].length; i++) if (chars[i] !== '\n') chars[i] = ' ';
		}
		for (const m of stripped.matchAll(/@container page \([^)]*\)/g)) {
			for (const bp of BREAKPOINTS) {
				const at = m[0].indexOf(bp);
				if (at !== -1) for (let i = 0; i < bp.length; i++) chars[m.index + at + i] = ' ';
			}
		}
		const dir = mkdtempSync(join(tmpdir(), 'page-css-'));
		afterAll(() => rmSync(dir, { recursive: true }));
		const file = join(dir, 'page.css');
		writeFileSync(file, chars.join(''));
		return file;
	})();
	const named = (findings: string[]) => findings.map((f) => f.replace(rules, HERE));

	it('writes no colour outside a token declaration', () => {
		expect(named(rawColourViolations([rules]))).toEqual([]);
	});

	it('writes no length outside a token declaration', () => {
		expect(named(rawLengthViolations([rules]))).toEqual([]);
	});

	it('makes no colour with alpha but where the declaration says why', () => {
		const raw = pageText.split('\n');
		const note = /(?:^|\/\*+|\/\/)[\s*]*raw-colour-ok:/;
		const stripped = stripComments(pageText);
		const found = [...stripped.matchAll(/[\w-]+\s*:[^;{}]*;/g)].flatMap((m) => {
			if (!/oklch\([^)]*\/\s*[\d.]/.test(m[0])) return [];
			const line = stripped.slice(0, m.index).split('\n').length;
			return note.test(raw[line - 1] ?? '') || note.test(raw[line - 2] ?? '')
				? []
				: [`${HERE}:${line} ${m[0].replace(/\s+/g, ' ')}`];
		});
		expect(found).toEqual([]);
	});
});

describe('the page root', () => {
	it('carries the layout and the declaring selector the form token file reads', () => {
		for (const layout of [...LAYOUTS, 'donation', 'plain'] as const)
			expect(root({ layout }).attributes).toMatchObject({
				'data-donate-root': '',
				'data-layout': layout
			});
	});

	it('seeds the brand colour and nothing else', () => {
		expect(root().inline).toEqual({ '--donate-primary': '#1f6feb' });
		expect(Object.keys(root().attributes).sort()).toEqual([
			'class',
			'data-brand-scope',
			'data-donate-root',
			'data-layout',
			'data-theme',
			'style'
		]);
	});

	it('seeds nothing for a page with no brand colour', () => {
		expect(root({ brandColour: null }).attributes.style).toBeUndefined();
	});

	it('draws a rule for every layout it names', () => {
		for (const layout of [...LAYOUTS, 'donation'])
			expect(pageText).toContain(`.page[data-layout='${layout}']`);
	});
});

describe('every colour lands on the radix step for its job', () => {
	// each colour declaration in ./page.css, by the block it stands in and its property, read down to
	// its step through the form's token file and the ground's own names, grouped by the job radix
	// gives that step (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale).
	// `allowed` is the steps the job may land on; a new colour declaration fails the last case until it
	// is placed in one of these.
	const WIDE = '@container page (min-width: 60rem)';
	const NARROW = '@container page (min-width: 48rem)';
	const FEATURE = ".page[data-layout='feature']";
	const HERO = `${FEATURE} .page-profile > .page-profile-who`;
	const HERO_OVER_FILL = `${FEATURE} .page-profile-cover[data-cover='none'] + .page-profile-who`;
	// the rail's own text, the box heading and the chooser's question, inherits the rail's ink.
	const RAIL = `${FEATURE} .page-profile > .page-profile-rail`;
	const RAIL_OVER_FILL = `${FEATURE} .page-profile-cover[data-cover='none'] ~ .page-profile-rail`;
	const OVER_FILL = `${FEATURE} .page-layout[data-cover='logo'] .page-hero-words, ${FEATURE} .page-layout[data-cover='none'] .page-hero-words`;
	const IDLE = ":not(:has(:checked, [aria-disabled='true']))";
	const BORDER =
		'6, 7 and 8: a separator, a control’s edge, that edge under the pointer, a brand edge and red 6 round a failure';
	const RING =
		'8: the focus ring, the registry’s ring step, in a step-1 gap where it rings a control';
	const ON_FILL = 'the ink on a solid fill: the form’s `--_on-p`';
	const TEXT = '11 and 12: text';
	const SCRIM =
		'a scrim over a photo — the feature’s, and the registry’s over a poster — and slate 1 on it';
	const JOBS: Record<string, { allowed: readonly string[]; at: Record<string, string> }> = {
		'1, 2 and 3: a ground, the wash brand 2 and 3 over slate 2, and red 3 under a failure': {
			allowed: ['slate-1', 'slate-2', 'slate-3', 'brand-2', 'brand-3', 'red-3'],
			at: {
				'.page > .page-ground | --page-ground': 'slate-2',
				'.page > .page-ground | --page-wash': 'brand-2 brand-3',
				'.page > .page-ground | background': 'brand-2 brand-3 slate-2',
				'.page > .page-ground | --page-plane': 'slate-1',
				'.page > .page-ground | --page-band': 'slate-1',
				'.page > .page-ground | --page-track': 'slate-3',
				'.page-mast | background': 'slate-1',
				".page[data-layout='card'] .page-layout::before | background": 'slate-1',
				[`${WIDE} » .page[data-layout='card'] .page-layout | background`]: 'slate-1',
				".page[data-layout='letter'] [data-area='cover'] | background": 'slate-1',
				[`${FEATURE} .page-about-area | background`]: 'slate-1',
				".page[data-layout='donation'] .page-about-area | background": 'slate-1',
				'.page-cover | background': 'slate-3',
				'.page-cover-logo | background': 'slate-1',
				".page-tiers[data-shape='cards'] .page-tier | background": 'slate-1',
				'.page-goal-track | background': 'slate-3',
				'.page-share-button | background': 'slate-1',
				'.page-choose .page-choose-option:has(:checked) | background': 'slate-1',
				'.page-profile-banner | background': 'slate-3',
				".page[data-layout='letter'] .page-profile-banner | background": 'slate-1',
				'.page-profile-cover | background': 'slate-3',
				'.page-profile-logo | background': 'slate-1',
				[`${NARROW} » [data-shape='cards'] .page-messages-row | background`]: 'slate-1',
				'.page-messages-plane | background': 'slate-1',
				'.page-fundraise | background': 'slate-1',
				'.page-messages-foot | background': 'slate-2',
				'.page-video-box | background': 'slate-3',
				".page-video-box[data-face='loading'] .page-video-status | background": 'slate-3',
				".page-video-box[data-face='error'] | background": 'red-3'
			}
		},
		'3, 4 and 5: a control’s ground, its hover and its press': {
			allowed: ['slate-3', 'slate-4', 'slate-5'],
			at: {
				'.page-choose-option | background': 'slate-3',
				[`.page-choose .page-choose-option:hover${IDLE} | background`]: 'slate-4',
				[`.page-choose .page-choose-option:active${IDLE} | background`]: 'slate-5',
				'.page-share-button:hover | background': 'slate-3',
				'.page-share-button:active | background': 'slate-4'
			}
		},
		[BORDER]: {
			allowed: ['slate-6', 'slate-7', 'slate-8', 'brand-6', 'brand-7', 'brand-8', 'red-6'],
			at: {
				'.page > .page-ground | --page-plane-edge': 'slate-6',
				'.page-mast | border-block-end': 'slate-6',
				".page [part~='card'] | border-color": 'slate-6',
				".page[data-layout='card'] .page-layout::before | border": 'slate-6',
				[`${WIDE} » .page[data-layout='card'] .page-layout | border`]: 'slate-6',
				".page[data-layout='letter'] [data-area='cover'] | border": 'slate-6',
				'.page-foot | border-block-start': 'slate-6',
				".page-tiers[data-shape='cards'] .page-tier | border": 'slate-6',
				".page-tiers[data-shape='list'] .page-tier | border-block-start": 'slate-6',
				'.page-faq[data-folded] .page-faq-item | border-block-start': 'slate-6',
				'.page-faq[data-folded] .page-faq-item:last-child | border-block-end': 'slate-6',
				'.page-share-button | border': 'slate-6',
				'.page-choose-option | border': 'slate-7',
				".page-choose-option:has([aria-disabled='true']:not(:checked)) | border-color": 'slate-7',
				[`.page-choose .page-choose-option:hover${IDLE} | border-color`]: 'slate-8',
				[`.page-choose .page-choose-option:active${IDLE} | border-color`]: 'slate-8',
				'.page-choose .page-choose-option:has(:checked) | border-color': 'brand-8',
				'.page-profile-banner | border': 'slate-6',
				".page[data-layout='letter'] .page-profile-banner | border": 'slate-6',
				'.page-profile-logo | border': 'slate-6',
				[`${NARROW} » [data-shape='cards'] .page-messages-row | border`]: 'slate-6',
				'.page-messages-plane | border': 'slate-6',
				'.page-fundraise | border': 'slate-6',
				'.page-messages-row + .page-messages-row | border-block-start': 'slate-6',
				'.page-messages-foot | border-block-start': 'slate-6',
				'.page-video-box | border': 'slate-6',
				".page-video-box[data-face='error'] | border-color": 'red-6'
			}
		},
		[RING]: {
			allowed: ['brand-8', 'slate-1'],
			at: {
				'.page > .page-ground | --page-ring': 'brand-8',
				'.page-ground a:not(.ds-btn):focus-visible, .page-faq-question:focus-visible | box-shadow':
					'brand-8',
				'.page-ground .page-share-button:focus-visible | box-shadow': 'brand-8',
				'.page-choose-option:has(:focus-visible) | box-shadow': 'slate-1 brand-8',
				'.page-messages-row:focus-visible | outline': 'brand-8',
				'.page-profile-cover + .page-profile-who :is(.page-profile-logo, .page-profile-badge) | box-shadow':
					'slate-1',
				'.page-video-box:focus-visible | outline': 'brand-8'
			}
		},
		'9: a solid fill, the generator’s step 9': {
			allowed: ['brand-9'],
			at: {
				'.page-mast-badge | background': 'brand-9',
				[`${FEATURE} .page-cover-area:empty | background`]: 'brand-9',
				".page-cover[data-source='logo'] | background": 'brand-9',
				'.page-goal-fill | background': 'brand-9',
				'.page-profile-badge | background': 'brand-9',
				".page-profile-cover[data-cover='none'] | background": 'brand-9'
			}
		},
		[ON_FILL]: {
			allowed: ['on-brand-9'],
			at: {
				'.page-mast-badge | color': 'on-brand-9',
				'.page-profile-badge | color': 'on-brand-9',
				".ended [part~='action'] | color": 'on-brand-9',
				[`${WIDE} » ${OVER_FILL} | --page-quiet`]: 'on-brand-9',
				[`${WIDE} » ${OVER_FILL} | color`]: 'on-brand-9',
				[`${WIDE} » ${HERO_OVER_FILL} | --page-quiet`]: 'on-brand-9',
				[`${WIDE} » ${HERO_OVER_FILL} | color`]: 'on-brand-9',
				[`${WIDE} » ${RAIL_OVER_FILL} | color`]: 'on-brand-9'
			}
		},
		[TEXT]: {
			allowed: ['slate-11', 'slate-12', 'brand-11', 'brand-12', 'red-11'],
			at: {
				'.page > .page-ground | --page-quiet': 'slate-11',
				'.page > .page-ground | --page-accent': 'brand-11',
				'.page > .page-ground | color': 'slate-12',
				'.notice | color': 'slate-11',
				'.ended p | color': 'slate-11',
				'.page-ground a | color': 'brand-11',
				'.page-mast-share:hover | color': 'brand-12',
				'.page-mast-name | color': 'slate-12',
				'.page-label | color': 'slate-11',
				'.page-lede | color': 'slate-11',
				".page-tiers[data-shape='cards'] .page-tier | color": 'slate-11',
				".page-tiers[data-shape='cards'] .page-tier-amount | color": 'brand-11',
				".page-tiers[data-shape='list'] .page-tier-amount | color": 'brand-11',
				".page-tiers[data-shape='list'] .page-tier-buys | color": 'slate-11',
				'.page-faq-mark | color': 'slate-11',
				'.page-faq[data-folded] .page-faq-answer | color': 'slate-11',
				'.page-faq:not([data-folded]) .page-faq-answer | color': 'slate-11',
				'.page-about-beneath | color': 'slate-11',
				'.page-goal-of | color': 'slate-11',
				'.page-goal-meta | color': 'slate-11',
				'.page-org | color': 'slate-11',
				'.page-org-name | color': 'slate-11',
				'.page-share-heading | color': 'slate-11',
				'.page-share-button | color': 'slate-12',
				'.page-ground a.page-share-button | color': 'slate-12',
				".page-share-button[data-copy='failed'] | color": 'red-11',
				'.page-choose-option | color': 'slate-12',
				'.page-choose-description | color': 'slate-11',
				'.page-choose-mark | color': 'brand-11',
				'.page-choose-option:has(:checked) .page-choose-name | color': 'brand-11',
				".page-choose-option:has([aria-disabled='true']:not(:checked)) .page-choose-name | color":
					'slate-11',
				'.page-ground .amount-label | color': 'slate-11',
				'.page-profile-ein | color': 'slate-11',
				'.page-profile .page-about .page-label | color': 'slate-12',
				'.page-profile :is(.page-about-statement, .page-about-beneath) | color': 'slate-12',
				'.page-messages-time | color': 'slate-11',
				'.page-messages-count | color': 'slate-11',
				'.page-fundraise-note | color': 'slate-11',
				'.page-ground .page-fundraise-act > a.ds-btn | color': 'slate-12',
				'.page-messages-refused | color': 'red-11',
				".page-video-box[data-face='loading'] .page-video-status | color": 'slate-12',
				'.page-video-error-title | color': 'red-11',
				'.page-video-error-body | color': 'slate-12',
				'.page-video-length | color': 'slate-11'
			}
		},
		// a photo has no step. a scrim over one is off the ladders: the feature's over its cover, with
		// slate 1, radix's white, on it and the goal's track on slate 8, and the registry's `--overlay`
		// over a video's poster, which the play press stands on.
		[SCRIM]: {
			allowed: ['scrim', 'slate-1', 'slate-8'],
			at: {
				[`${WIDE} » ${FEATURE} [data-area='cover']::after | background`]: 'scrim',
				[`${WIDE} » ${FEATURE} [data-area='cover'] | --page-ring`]: 'slate-1',
				[`${WIDE} » ${FEATURE} .page-hero-words | --page-ring`]: 'slate-1',
				[`${WIDE} » ${FEATURE} .page-hero-words | --page-quiet`]: 'slate-1',
				[`${WIDE} » ${FEATURE} .page-hero-words | color`]: 'slate-1',
				[`${WIDE} » ${FEATURE} .page-hero-words .page-goal-track | background`]: 'slate-8',
				[`${WIDE} » ${FEATURE} .page-hero-words .page-goal-fill | background`]: 'slate-1',
				".page-video-box[data-face='poster']::after | background": 'scrim',
				[`${WIDE} » .page-profile-cover[data-cover='photo']::after | background`]: 'scrim',
				[`${WIDE} » ${HERO} | --page-quiet`]: 'slate-1',
				[`${WIDE} » ${HERO} | color`]: 'slate-1',
				[`${WIDE} » ${RAIL} | color`]: 'slate-1'
			}
		}
	};

	// every name a colour declaration can read: the form's declarations under its root, and the ground's.
	const scope: Scope = { ...formBase, ...declared(page, '.page > .page-ground') };
	const read = Object.fromEntries(
		page.flatMap(({ at, decls }) =>
			Object.entries(decls).flatMap(([property, value]) => {
				const found = steps(scope, value);
				return found.length === 0 ? [] : [[`${at.join(' » ')} | ${property}`, found.join(' ')]];
			})
		)
	);

	it.each(Object.entries(JOBS))('%s', (_, { allowed, at }) => {
		expect(Object.fromEntries(Object.keys(at).map((key) => [key, read[key]]))).toEqual(at);
		const off = Object.entries(at).filter(([, step]) =>
			step.split(' ').some((one) => !allowed.includes(one))
		);
		expect(off).toEqual([]);
	});

	// the registry's presses outside the card (Play, Show more) ring in its `--ring`, which no row
	// above sees: a role is substituted where it is declared, on `:root` and on every `[data-theme]`,
	// so on a root without `data-theme` it reads the default theme's accent 8, a blue.
	it(`${RING}: the registry’s presses on the page ring in the brand’s 8`, () => {
		const button = blocks(
			readFileSync(require.resolve('@better-giving/form/registry/styles/button-css.css'), 'utf8')
		);
		const ring = declared(button, '.ds-btn:focus-visible').outline ?? '';
		const theme = root().attributes['data-theme'];
		const themed =
			theme !== undefined &&
			(registryLight.at[0] ?? '')
				.split(',')
				.map((one) => one.trim())
				.includes(`[data-theme="${theme}"]`);
		const brand = blocks(brandedScale)[0]?.decls ?? {};
		const atRole: Scope = {
			...registryLight.decls,
			...registryRoles.decls,
			...(themed ? brand : {})
		};
		expect(brand['--accent-8']).not.toBe(registryLight.decls['--accent-8']);
		expect(substitute(atRole, ring)).toBe(`2px solid ${brand['--accent-8']}`);
	});

	it('sets text, a border and a ring only in the jobs that draw them', () => {
		const may: [RegExp, string[]][] = [
			[/^color$/, [TEXT, ON_FILL, SCRIM]],
			[/^border/, [BORDER]],
			[/^box-shadow$/, [RING]]
		];
		const astray = Object.entries(JOBS).flatMap(([job, { at }]) =>
			Object.keys(at).filter((key) => {
				const property = key.slice(key.lastIndexOf(' | ') + 3);
				return may.some(([pattern, jobs]) => pattern.test(property) && !jobs.includes(job));
			})
		);
		expect(astray).toEqual([]);
	});

	it('places every colour declaration ./page.css writes', () => {
		const placed = new Set(Object.values(JOBS).flatMap(({ at }) => Object.keys(at)));
		expect(Object.keys(read).length).toBeGreaterThan(0);
		expect(Object.keys(read).filter((key) => !placed.has(key))).toEqual([]);
	});
});

describe('the share row and the footer', () => {
	// each share press is a step-1 circle on the wash inside a step-6 edge, at the touch floor.
	it('draws a share press as a flat circle at the touch floor, a plane edged in step 6', () => {
		expect(substitute(formBase, 'var(--_row-min)')).toBe('44px');
		const press = declared(page, '.page-share-button');
		expect(press).toMatchObject({
			'inline-size': 'var(--_row-min)',
			'block-size': 'var(--_row-min)',
			'border-radius': '50%',
			border: 'var(--_border) solid var(--page-plane-edge)',
			background: 'var(--page-plane)',
			color: 'var(--_n12)'
		});
		expect(press['box-shadow']).toBeUndefined();
	});

	it('labels the row in the quiet ink, a step under a heading', () => {
		expect(declared(page, '.page-share-heading')).toMatchObject({
			color: 'var(--page-quiet)',
			'font-weight': 'var(--_w-medium)'
		});
	});

	// the footer is one line on the wash, under a separator: the name in `--_n11`, the rest in the
	// quiet ink at the small step.
	it('draws the footer on the wash under one separator, its line in the quiet ink', () => {
		expect(declared(page, '.page-foot')).toMatchObject({
			'border-block-start': 'var(--_border) solid var(--_n6)'
		});
		expect(declared(page, '.page-foot').background).toBeUndefined();
		expect(declared(page, '.page-org')).toMatchObject({
			color: 'var(--page-quiet)',
			'font-size': 'var(--_t-sm)'
		});
		expect(declared(page, '.page-org-name').color).toBe('var(--_n11)');
	});
});

describe('the video play press', () => {
	// the press is the registry's large square, 13 of its spacing steps; the glyph is 6 of them.
	it('draws its glyph at 6 spacing steps, against the large press’s 13', () => {
		const button = blocks(
			readFileSync(require.resolve('@better-giving/form/registry/styles/button-css.css'), 'utf8')
		);
		const glyph = declared(page, '.page-video-glyph');
		const step = declared(button, '.ds-btn');
		expect(substitute(step, glyph['inline-size'] ?? '')).toBe('calc(calc(0.25 * 1rem) * 6)');
		expect(declared(button, '.ds-btn-lg')['--ds-btn-size']).toBe('calc(var(--ds-spacing) * 13)');
		expect(glyph['block-size']).toBe(glyph['inline-size']);
	});
});

describe('the scrim over the feature’s cover', () => {
	const scrim = declared(page, '.page > .page-ground')['--page-scrim'] ?? '';
	const stops = [...scrim.matchAll(/oklch\(([^/]+)\/\s*([\d.]+)\)\s*([\d.]+%)?/g)];

	it('darkens the cover from its left edge across the 58% the words stand in', () => {
		const [darkest] = stops;
		if (darkest === undefined) throw new Error(`no translucent stop in ${scrim}`);
		expect(scrim).toMatch(/^linear-gradient\(\s*to right,/);
		expect(Number.parseFloat(darkest[3] ?? '0')).toBeGreaterThanOrEqual(58);
	});

	it('draws the words in slate 1, and the ring with it', () => {
		const words = page.find(
			({ at }) =>
				at[0] === '@container page (min-width: 60rem)' &&
				at.at(-1) === ".page[data-layout='feature'] .page-hero-words"
		)?.decls;
		expect(words?.color).toBe('var(--_n1)');
		expect(words?.['--page-ring']).toBe('var(--_n1)');
	});
});

describe('an ended page’s way on to /donate', () => {
	// the link is the form's action drawn without the registry's class, so the label's ink is
	// whichever `color` outranks the rest: the page's link rule, or the ended page's own.
	const specificity = (selector: string) => {
		const bare = selector.replace(/:where\([^)]*\)/g, '');
		const ids = (bare.match(/#[\w-]+/g) ?? []).length;
		const classes = (bare.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
		const types = (bare.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
		return ids * 10000 + classes * 100 + types;
	};

	it('draws its label in the fill’s ink, over the ink the page draws a link in', () => {
		const own = ".ended [part~='action']";
		expect(declared(page, own).color).toBe('var(--_on-p)');
		expect(declared(page, '.page-ground a').color).toBe('var(--page-accent)');
		expect(specificity(own)).toBeGreaterThan(specificity('.page-ground a'));
	});
});

describe('the entry card’s press, a link drawn as the registry’s secondary press', () => {
	const button = blocks(
		readFileSync(require.resolve('@better-giving/form/registry/styles/button-css.css'), 'utf8')
	);
	const scope: Scope = { ...formBase, ...declared(page, '.page > .page-ground') };

	it('draws its label in the variant’s own ink, not the ink of whatever holds it', () => {
		const own = declared(page, '.page-ground .page-fundraise-act > a.ds-btn').color ?? '';
		const variant = declared(button, '.ds-btn-secondary').color ?? '';
		expect(own).not.toBe('inherit');
		expect(substitute(scope, own)).toBe(substitute(scope, variant));
	});

	// the press is an `a`, so a page ring on every focused link would outrank `.ds-btn:focus-visible`.
	it('leaves its ring to the registry: no page rule rings a focused link that is a press', () => {
		const rings = page.filter(
			({ decls }) => decls.outline !== undefined || decls['box-shadow'] !== undefined
		);
		const linkRings = rings
			.flatMap(({ at }) => (at.at(-1) ?? '').split(','))
			.map((selector) => selector.trim())
			.filter((selector) => /(?:^|[\s>+~])a(?::not\([^)]*\))*:focus/.test(selector));
		expect(linkRings).toEqual(['.page-ground a:not(.ds-btn):focus-visible']);
		expect(declared(button, '.ds-btn:focus-visible').outline).toBe('2px solid var(--ring)');
	});
});

describe('a long title', () => {
	// happy-dom does no layout, so the step is read off the sheet: smaller below 60rem, where the box
	// stands under the title, and the display size from 60rem.
	it('is drawn a step smaller on a phone and at the display size from 60rem', () => {
		const long = page
			.filter(({ at }) => at.at(-1) === '.page-title[data-long]')
			.map(({ at, decls }) => [at.slice(0, -1).join(' » '), decls['font-size']]);
		expect(long).toEqual([
			['', 'var(--page-display-long)'],
			['@container page (min-width: 60rem)', 'var(--page-display)']
		]);
	});
});

describe('the card layout', () => {
	// happy-dom does no layout, so the placement is read off the sheet.
	const CARD = ".page[data-layout='card']";
	const WIDE = '@container page (min-width: 60rem)';

	it('stands the cover, the title, the lede and the goal in one plane on a phone, then the box and the story', () => {
		const layout = declared(page, `${CARD} .page-layout`);
		expect(layout['grid-template-areas']?.match(/'[\w-]+'/g)).toEqual([
			"'cover'",
			"'title'",
			"'lede'",
			"'goal'",
			"'close'",
			"'box'",
			"'story'"
		]);
		expect(declared(page, `${CARD} .page-layout::before`)).toMatchObject({
			'grid-row': 'cover-start / close-end',
			background: 'var(--page-plane)',
			border: 'var(--_border) solid var(--page-plane-edge)',
			'border-radius': 'var(--page-plane-radius)'
		});
		expect(declared(page, WIDE, `${CARD} .page-layout::before`).content).toBe('none');
	});

	it('takes the plane’s top corners inside its edge on the cover at every width', () => {
		const inner = 'calc(var(--page-plane-radius) - var(--_border))';
		expect(declared(page, `${CARD} [data-area='cover'] .page-cover`)['border-radius']).toBe(
			`${inner} ${inner} 0 0`
		);
		expect(declared(page, `${CARD} [data-area='cover']`).margin).toBe(
			'var(--_border) var(--_border) 0'
		);
		expect(
			page.filter(
				({ at, decls }) =>
					at.at(-1) === `${CARD} [data-area='cover'] .page-cover` && decls['border-radius']
			)
		).toHaveLength(1);
	});

	it('orders no card section on a phone, so the grid’s areas alone place them', () => {
		const ordered = page.filter(
			({ at, decls }) => at.length === 1 && decls.order !== undefined && at[0]?.includes(CARD)
		);
		expect(ordered).toEqual([]);
	});

	it('draws the box on the wide panel as part of the panel: no fill, edge, corner or inset of its own', () => {
		expect(declared(page, WIDE, `${CARD} .page-layout [part~='card']`)).toEqual({
			background: 'transparent',
			border: '0',
			'border-radius': '0',
			overflow: 'visible'
		});
		// the card's interior inset is `.card-body`'s, which no part name reaches
		// (packages/form/src/styles/layout.css), so the heading starts on the title's line only with it gone.
		expect(declared(page, WIDE, `${CARD} .page-layout [part~='card'] > .card-body`)).toEqual({
			padding: '0'
		});
		expect(declared(page, WIDE, `${CARD} [data-area='title']`).margin).toBe(
			'var(--page-card-inset) 0 0'
		);
		expect(declared(page, WIDE, `${CARD} [data-area='box']`)['margin-block-start']).toBe(
			'var(--page-card-inset)'
		);
	});
});

describe('no card inside a card', () => {
	// a plane is a step-1 card on the wash, and its step-6 edge is what makes it one; a plane standing
	// in another is an edge inside an edge, grouping drawn twice. the box is the one plane the form
	// draws, and it stands in `.page-layout` in every layout, so wherever a layout paints
	// `.page-layout` itself as a plane, the box there draws none of a plane's dress.
	// happy-dom does no layout, so where the box stands is read off the sheet.
	const WIDE = '@container page (min-width: 60rem)';
	const WIDTHS: readonly (readonly string[])[] = [[], [WIDE]];
	const layouts = [...LAYOUTS, 'donation'] as const;
	const PLANE = 'var(--page-plane)';
	const EDGE = 'var(--_border) solid var(--page-plane-edge)';
	const at = (inside: readonly string[], selector: string) =>
		page.filter((b) => b.at.join(' » ') === [...inside, selector].join(' » '));

	const holding = layouts.flatMap((layout) =>
		WIDTHS.flatMap((inside) =>
			at(inside, `.page[data-layout='${layout}'] .page-layout`).some(
				({ decls }) => decls.background === PLANE
			)
				? [{ layout, inside }]
				: []
		)
	);

	it('finds the plane that holds the box: the card’s panel from 60rem', () => {
		expect(holding).toEqual([{ layout: 'card', inside: [WIDE] }]);
	});

	it.each(
		holding.map(({ layout, inside }) => [layout, inside.join(' ') || 'phone', inside] as const)
	)('the box in the %s layout’s plane (%s) draws no fill or edge', (layout, _, inside) => {
		const box = at(inside, `.page[data-layout='${layout}'] .page-layout [part~='card']`);
		expect(box).toHaveLength(1);
		expect(box[0]?.decls).toMatchObject({ background: 'transparent', border: '0' });
	});

	it('keeps the box a card where it stands on the wash, the phone’s card layout included', () => {
		expect(declared(page, ".page [part~='card']")).toMatchObject({
			'border-color': 'var(--page-plane-edge)',
			'border-radius': 'var(--page-plane-radius)'
		});
		const unset = page.filter(
			({ at: [first, ...rest], decls }) =>
				rest.length === 0 &&
				first?.includes("[part~='card']") === true &&
				(decls.border !== undefined || decls.background !== undefined)
		);
		expect(unset).toEqual([]);
	});

	it('edges every plane on the wash in step 6, and the box is the one a plane holds', () => {
		const planes = page
			.filter(({ decls }) => decls.background === PLANE)
			.map(({ at, decls }) => [at.join(' » '), decls.border ?? decls['border-block-end']]);
		expect(planes.sort()).toEqual(
			[
				[".page[data-layout='card'] .page-layout::before", EDGE],
				[`${WIDE} » .page[data-layout='card'] .page-layout`, EDGE],
				[".page[data-layout='letter'] [data-area='cover']", EDGE],
				[".page-tiers[data-shape='cards'] .page-tier", EDGE],
				['.page-share-button', EDGE],
				['.page-mast', EDGE],
				['.page-profile-logo', EDGE],
				[".page[data-layout='letter'] .page-profile-banner", EDGE],
				["@container page (min-width: 48rem) » [data-shape='cards'] .page-messages-row", EDGE],
				['.page-messages-plane', EDGE],
				['.page-fundraise', EDGE]
			].sort()
		);
	});
});

describe('no shadow anywhere', () => {
	// radix's steps say depth by a face and an edge; a `box-shadow` the page writes is a focus ring,
	// a spread hugging the box with no offset and no blur.
	const layers = (value: string) => {
		const found: string[] = [];
		let depth = 0;
		let layer = '';
		for (const char of value) {
			if (char === '(') depth += 1;
			if (char === ')') depth -= 1;
			if (char === ',' && depth === 0) {
				found.push(layer.trim());
				layer = '';
			} else layer += char;
		}
		return [...found, layer.trim()];
	};

	it('finds the rings it is meant to be guarding', () => {
		expect(page.filter(({ decls }) => decls['box-shadow'] !== undefined).length).toBeGreaterThan(1);
	});

	it('writes every `box-shadow` as zero-offset, zero-blur spreads', () => {
		const cast = page.flatMap(({ at, decls }) =>
			decls['box-shadow'] === undefined
				? []
				: layers(decls['box-shadow'])
						.filter((layer) => !/^0 0 0 \S/.test(layer))
						.map((layer) => `${at.join(' » ')}: ${layer}`)
		);
		expect(cast).toEqual([]);
	});

	it('declares no shadow token', () => {
		const tokens = declared(page, '.page > .page-ground');
		expect(Object.values(tokens).filter((v) => /\d+px \d+px/.test(v))).toEqual([]);
	});
});

describe('the ground and the wash', () => {
	// brand steps 2 and 3 are the registry's accent, re-themed by the scale the page root renders;
	// the sheet derives neither.
	const ground = declared(page, '.page > .page-ground');

	it('derives no brand step of its own', () => {
		expect(stripComments(pageText)).not.toMatch(/oklch\(\s*from/);
		expect(
			[...declares(pageText, '--page-a')].filter((name) => /^--page-a\d+$/.test(name))
		).toEqual([]);
	});

	it.each([2, 3])('draws brand step %i as the generator makes it for the brand colour', (n) => {
		const scale = generateBrandScale('#1f6feb');
		const html = renderToStaticMarkup(
			createElement(PageRoot, { brandColour: '#1f6feb', layout: 'card', children: null })
		);
		const css = /<style>([^<]*)<\/style>/.exec(html)?.[1] ?? '';
		const scope = /data-brand-scope="([^"]*)"/.exec(html)?.[1] ?? '';
		expect(scope).not.toBe('');
		const sheet = blocks(css);
		expect(
			declared(sheet, `[data-donate-root][data-brand-scope="${scope}"]`)[`--accent-${n}`]
		).toBe(scale?.steps[n - 1]);
		expect(
			declared(
				sheet,
				'@supports (color: color(display-p3 1 1 1))',
				'@media (color-gamut: p3)',
				`[data-donate-root][data-brand-scope="${scope}"]`
			)[`--accent-${n}`]
		).toBe(scale?.stepsWideGamut[n - 1]);
	});

	it('lays brand 2 at the top left and brand 3 at the bottom right over slate 2', () => {
		expect(ground['--page-ground']).toBe('var(--_n2)');
		expect(ground['--page-wash']).toMatch(
			/^radial-gradient\(.* at 0% .*, var\(--accent-2\), transparent 70%\), radial-gradient\(.* at 100% 100%, var\(--accent-3\), transparent 70%\)$/
		);
		expect(ground.background).toBe('var(--page-wash), var(--page-ground)');
	});

	it('rules the masthead’s foot and the footer’s head in step 6', () => {
		expect(declared(page, '.page-mast')['border-block-end']).toBe(
			'var(--_border) solid var(--page-plane-edge)'
		);
		expect(ground['--page-plane-edge']).toBe('var(--_n6)');
		expect(declared(page, '.page-foot')['border-block-start']).toBe(
			'var(--_border) solid var(--_n6)'
		);
	});
});

describe('the program options', () => {
	it('edges an option in step 7 and in step 8 under a pointer and a press', () => {
		expect(
			page
				.filter(({ at, decls }) => at.join() === '.page-choose-option' && decls.border)
				.map(({ decls }) => decls.border)
		).toEqual(['var(--_border) solid var(--_edge-control)']);
		for (const state of [':hover', ':active'])
			expect(
				declared(
					page,
					`.page-choose .page-choose-option${state}:not(:has(:checked, [aria-disabled='true']))`
				)['border-color']
			).toBe('var(--_n8)');
	});

	it('marks the chosen option as the form marks a chosen tile: step 1, a brand-8 edge, brand-11 words', () => {
		expect(declared(page, '.page-choose .page-choose-option:has(:checked)')).toEqual({
			background: 'var(--_n1)',
			'border-color': 'var(--_a8)'
		});
		expect(declared(page, '.page-choose-option:has(:checked) .page-choose-name').color).toBe(
			'var(--_a11)'
		);
		expect(declared(page, '.page-choose-mark').color).toBe('var(--_a11)');
	});
});

describe('the profile head’s box and logo', () => {
	// happy-dom does no layout, so both are read off the sheet.
	const WIDE = '@container page (min-width: 60rem)';

	it('stands no box sticky, and sets the rail in its grid cell from 60rem', () => {
		expect(page.filter(({ decls }) => decls.position === 'sticky')).toEqual([]);
		expect(declared(page, WIDE, ".page[data-layout='letter'] .page-profile-rail")).toMatchObject({
			'grid-column': '2',
			'grid-row': '1 / -1'
		});
		expect(
			declared(page, WIDE, ".page[data-layout='feature'] .page-profile > .page-profile-rail")
		).toMatchObject({ 'grid-row': '1', 'align-self': 'start' });
	});

	it('leaves the rail’s own text to the rail’s ink, so the cover’s ink reaches the heading and the chooser’s question', () => {
		const inked = page.filter(
			({ at, decls }) =>
				/\.page-(profile-box-heading|choose-legend)\b/.test(at.join(' » ')) && 'color' in decls
		);
		expect(inked).toEqual([]);
	});

	it('holds the card, its share row and its footer to the profile’s column at every width', () => {
		expect(declared(page, ".page[data-profile][data-layout='card'] .page-in")).toEqual({
			'max-inline-size': 'calc(var(--page-profile-box) + 2 * var(--page-gutter))'
		});
	});

	it('holds the letter’s and the feature’s box to `--page-box` below 60rem, as a campaign’s, and lets the card’s fill its column', () => {
		const held = page
			.filter(({ at }) => at.length === 1 && /\.page-box > div > \*$/.test(at[0] ?? ''))
			.map(({ at, decls }) => [at[0], decls['max-inline-size']]);
		expect(held).toEqual([
			['.page-box > div > *', 'var(--page-box)'],
			[".page[data-profile][data-layout='card'] .page-box > div > *", 'none']
		]);
		expect(declared(page, WIDE, '.page[data-profile] .page-box > div > *')['max-inline-size']).toBe(
			'none'
		);
	});

	it('stands the letter’s rail top on the name’s from 60rem, under a banner as without one', () => {
		const who = declared(
			page,
			WIDE,
			".page[data-layout='letter'] .page-profile > :not(:first-child, .page-profile-rail)"
		);
		const rail = declared(
			page,
			WIDE,
			".page[data-layout='letter'] .page-profile-banner ~ .page-profile-rail"
		);
		expect(rail['grid-row']).toBe('2 / -1');
		expect(rail['margin-block-start']).toBe(who['margin-block-start']);
		expect(
			declared(page, WIDE, ".page[data-layout='letter'] .page-profile-rail")['margin-block-start']
		).toBeUndefined();
	});

	it('takes back the campaign card’s margin on the name and the box', () => {
		expect(declared(page, '.page[data-profile] :is(.page-profile-name, .page-box)')).toEqual({
			margin: '0'
		});
	});

	it('draws a logo at least twice as wide as it is tall whole at its own shape, as the masthead does', () => {
		expect(declared(page, '.page-profile-logo')).toMatchObject({
			'object-fit': 'contain',
			'max-inline-size': '100%'
		});
		expect(declared(page, '.page-profile-logo[data-wide]')).toEqual({ 'inline-size': 'auto' });
		expect(
			declared(
				page,
				".page-profile-id:has(> [data-wide]), .page[data-layout='card'] .page-profile-banner + .page-profile-who .page-profile-id"
			)['flex-direction']
		).toBe('column');
	});

	// the cover is positioned, so a static mark lifted over its foot is painted under it; the mark
	// stacks itself above, as a leaf, so no ancestor of the box gains a position.
	it('stands the mark over the feature’s cover foot, stacked above it', () => {
		const over = declared(
			page,
			'.page-profile-cover + .page-profile-who :is(.page-profile-logo, .page-profile-badge)'
		);
		const cover = declared(page, '.page-profile-cover');
		expect(over['margin-block-start']).toMatch(/^calc\(-1 \*/);
		expect(over.position).toBe('relative');
		expect(over['z-index']).toMatch(/^[1-9]\d*$/);
		expect(cover.position).toBeDefined();
		expect(cover.position).not.toBe('static');
		expect(cover['z-index']).toBeUndefined();
	});

	it('leaves the mark’s ancestors out of the stacking the lift needs', () => {
		const stacks = ['position', 'isolation', 'transform', 'z-index'];
		const endsOnAncestor = (selector: string) =>
			/\.page-profile-(who|id)(:[\w-]+(\([^)]*\))?|\[[^\]]*\])*$/.test(selector.trim());
		const ancestors = page.filter(
			(b) => b.at.length === 1 && b.at[0]?.split(',').some(endsOnAncestor)
		);
		// the sweep reaches the rules it claims to: the id's own base rule is one of them
		expect(ancestors.map((b) => b.decls['flex-direction'])).toContain('column');
		for (const { at, decls } of ancestors)
			expect(
				Object.keys(decls).filter((name) => stacks.includes(name)),
				at[0]
			).toEqual([]);
	});
});

describe('the profile head’s quiet ink', () => {
	// the EIN is slate 11, which stands only on slate 1 or 2: on the wash, under no ground of the
	// head's own, and on the feature's cover in that cover's own ink.
	it('stands the EIN on the wash', () => {
		for (const selector of ['.page-profile-id', '.page-profile-names', '.page-profile-ein'])
			expect(declared(page, selector).background, selector).toBeUndefined();
	});
});

describe('the profile head’s type', () => {
	// happy-dom computes no face, so the weights are read off the sheet down to their numbers, and
	// each is a weight packages/operator/src/styles/fonts.css registers a red hat display file at.
	const fonts = stripComments(
		readFileSync(require.resolve('@better-giving/operator/styles/fonts.css'), 'utf8')
	);
	const displayWeights = [
		...fonts.matchAll(/font-family:\s*'Red Hat Display';[^}]*?font-weight:\s*(\d+)/g)
	].map((m) => m[1]);
	const ground = declared(page, '.page > .page-ground');
	const weight = (value: string | undefined) => substitute({ ...formBase, ...ground }, value ?? '');

	it('sets the name in red hat display at 700, a face the sheet registers', () => {
		const name = declared(page, '.page-profile-name');
		expect(name['font-family']).toBe('var(--page-font-display)');
		expect(weight(name['font-weight'])).toBe('700');
		expect(displayWeights).toContain('700');
	});

	it.each([
		['About us', '.page-profile .page-about .page-label'],
		['a heading saved for the page', '.page-profile-box-heading'],
		['Videos and Messages from donors', '.page-messages-heading, .page-videos-heading']
	])('sets %s in red hat display at 700, a face the sheet registers', (_, selector) => {
		const heading = declared(page, selector);
		expect(heading['font-family']).toBe('var(--page-font-display)');
		expect(weight(heading['font-weight'])).toBe('700');
		expect(displayWeights).toContain('700');
	});

	it('sets the feature’s closing About us band at the display weight, 700, and no other band', () => {
		expect(
			weight(declared(page, ".page[data-layout='feature'] .page-about .page-label")['font-weight'])
		).toBe('700');
		expect(declared(page, '.page-about .page-label')['font-weight']).toBeUndefined();
	});

	it('sets the EIN on a 20px line', () => {
		expect(declared(page, '.page-profile-ein')['line-height']).toBe('var(--page-profile-lh-small)');
		expect(ground['--page-profile-lh-small']).toBe('1.25rem');
	});

	it('draws the feature’s hero name a step larger from 60rem, and the name elsewhere at one size', () => {
		const hero = declared(
			page,
			'@container page (min-width: 60rem)',
			".page[data-layout='feature'] .page-profile > .page-profile-who"
		);
		expect(hero['--page-profile-name']).toBe('var(--page-profile-name-hero)');
		expect(ground['--page-profile-name-hero']).toBe('2.25rem');
		const wide = declared(page, '@container page (min-width: 60rem)', '.page > .page-ground');
		expect(wide['--page-profile-name']).toBeUndefined();
		expect(ground['--page-profile-name']).toBe('1.875rem');
	});
});

describe('the organisation’s name in the top bar', () => {
	// happy-dom does no layout, so the cut is read off the sheet: a name that wrapped would stand the
	// bar taller than the header's first-screen sum counts, and Share takes width from the name's row.
	it('is cut to one line with an ellipsis, and gives up its width rather than widening the bar', () => {
		expect(declared(page, '.page-mast-name')).toMatchObject({
			'white-space': 'nowrap',
			overflow: 'hidden',
			'text-overflow': 'ellipsis',
			'min-inline-size': '0'
		});
	});
});

describe('the squint tiers on the page', () => {
	// `--_sp2` is an em step, so it is read at the heading's own size; the heading's largest size is
	// the top of its clamp, where the step is widest.
	const ground = declared(page, '.page > .page-ground');
	const rem = (value: string | undefined) => {
		const m = /^([\d.]+)rem$/.exec(value ?? '');
		if (!m) throw new Error(`not a rem length: ${value}`);
		return Number(m[1]);
	};
	const em = (value: string | undefined) => {
		const m = /^([\d.]+)em$/.exec(value ?? '');
		if (!m) throw new Error(`not an em length: ${value}`);
		return Number(m[1]);
	};

	it('stands a section heading closer to its content than one item to the next', () => {
		const heading = declared(page, '.page-heading');
		expect(heading['margin-block-end']).toBe('var(--_sp2)');
		const largest = /clamp\(.*,\s*([\d.]+rem)\)$/.exec(ground['--page-heading'] ?? '')?.[1];
		const step = em(formBase['--_sp2']) * rem(largest);
		expect(step).toBeLessThan(rem(ground['--page-gap-item']));
	});
});

describe('the masthead’s lead over a cover', () => {
	// happy-dom does no layout, so the margins are read off the sheet. on a phone the card's and the
	// feature's covers stand `--page-gap-lead` under the masthead, so no rule on the cover takes its
	// block-start margin negative; wide, the card's cover sits flush at the top of its panel.
	const COVERS = [
		".page[data-layout='card'] [data-area='cover']",
		".page[data-layout='feature'] [data-area='cover']"
	];
	const terms = (value: string) => {
		const found: string[] = [];
		let depth = 0;
		let term = '';
		for (const char of value.trim()) {
			if (char === '(') depth += 1;
			if (char === ')') depth -= 1;
			if (char === ' ' && depth === 0) {
				if (term) found.push(term);
				term = '';
			} else term += char;
		}
		if (term) found.push(term);
		return found;
	};
	const blockStart = (decls: Scope) =>
		decls['margin-block-start'] ??
		(decls['margin-block'] === undefined ? undefined : terms(decls['margin-block'])[0]) ??
		(decls.margin === undefined ? undefined : terms(decls.margin)[0]);
	const onCover = (at: readonly string[]) =>
		(at.at(-1) ?? '').split(',').some((one) => COVERS.includes(one.trim()));

	it('takes no cover’s block-start margin negative on a phone', () => {
		const phone = page.filter(({ at }) => at.length === 1 && onCover(at));
		expect(phone.length).toBeGreaterThanOrEqual(COVERS.length);
		for (const { at, decls } of phone) {
			const start = blockStart(decls);
			expect(start ?? '', at.join(' » ')).not.toMatch(/^calc\(\s*-|^-/);
			expect(start ?? '', at.join(' » ')).not.toContain('--page-gap-lead');
		}
	});

	it('still sets the wide card’s cover flush at the top of its panel', () => {
		const wide = declared(page, '@container page (min-width: 60rem)', COVERS[0] ?? '');
		expect(blockStart(wide)).toBe('0');
	});
});

describe('the sections ./page.css draws', () => {
	const here = relative(process.cwd(), import.meta.dirname);
	const components = [
		join(here, 'page-view.tsx'),
		...globSync(join(here, 'sections/*.tsx')).filter((file) => !file.includes('.spec.'))
	];
	const FORM_LAYOUT = require.resolve('@better-giving/form/styles/layout.css');
	// the registry's button, which the page links beside its own sheet (./plain-page.tsx).
	const FORM_BUTTON = require.resolve('@better-giving/form/registry/styles/button-css.css');
	const drawn = new Set(
		[pageText, readFileSync(FORM_LAYOUT, 'utf8'), readFileSync(FORM_BUTTON, 'utf8')].flatMap(
			(css) => [...stripComments(css).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '')
		)
	);

	it('finds the components it is meant to be guarding', () => {
		expect(components.length).toBeGreaterThan(8);
	});

	it('writes no colour and no length into a style object', () => {
		expect([...rawColourViolations(components), ...rawLengthViolations(components)]).toEqual([]);
	});

	it('writes only classes a sheet draws', () => {
		const written = components.flatMap((file) =>
			[...readFileSync(file, 'utf8').matchAll(/className="([^"]+)"/g)].flatMap((m) =>
				(m[1] ?? '').split(/\s+/).map((name) => `${relative(here, file)} .${name}`)
			)
		);
		expect(written.length).toBeGreaterThan(0);
		expect(written.filter((entry) => !drawn.has(entry.slice(entry.indexOf(' .') + 2)))).toEqual([]);
	});
});

describe('the entry card’s width', () => {
	const PLAIN = '.page:not([data-profile]) .page-fundraise-area > .page-fundraise';
	// a selector list split at its top-level commas, and a selector's last compound, after its last
	// top-level combinator, so neither cuts inside `:is()` or `:not()`.
	const topLevel = (selector: string, split: (char: string) => boolean): string[] => {
		const parts = [''];
		let depth = 0;
		for (const char of selector) {
			depth += char === '(' ? 1 : char === ')' ? -1 : 0;
			if (depth === 0 && split(char)) parts.push('');
			else parts[parts.length - 1] += char;
		}
		return parts.map((part) => part.trim()).filter((part) => part !== '');
	};
	const subject = (selector: string) => topLevel(selector, (char) => /[\s>+~]/.test(char)).at(-1);
	// a block that may size the area or the card itself: one of its selectors names either, none of
	// the card's parts, and ends on one of them or on `*`.
	const sizesTheCard = (selector: string) =>
		topLevel(selector, (char) => char === ',').some(
			(one) =>
				one.includes('page-fundraise') &&
				!/page-fundraise-(?:heading|act|note)/.test(one) &&
				/page-fundraise|^\*$/.test(subject(one) ?? '')
		);
	const fundraise = page.filter(({ at }) => sizesTheCard(at.at(-1) ?? ''));
	const WIDTHS = ['max-inline-size', 'inline-size', 'max-width', 'width', 'grid-template-columns'];

	it('is held to `--page-fundraise-width` under no profile head, and to no width of its own under it', () => {
		// under the profile head it is one of `.page-profile`'s parts, sized by the layout's rules for
		// them: the letter's reading column and measure from 60rem among them.
		const sized = fundraise.filter(({ decls }) => WIDTHS.some((name) => decls[name] !== undefined));
		expect(sized.map(({ at }) => at.join(' » '))).toEqual([PLAIN]);
		expect(declared(page, PLAIN)).toEqual({ 'max-inline-size': 'var(--page-fundraise-width)' });
		const readers = page.filter(({ decls }) =>
			Object.values(decls).some((value) => value.includes('--page-fundraise-width'))
		);
		expect(readers.map(({ at }) => at.join(' » '))).toEqual([PLAIN]);
	});

	it('steps a section below a layout it follows, and adds nothing to the profile column’s own spacing', () => {
		const spaced = fundraise.filter(({ decls }) =>
			Object.keys(decls).some((name) => name.startsWith('margin'))
		);
		expect(spaced.map(({ at }) => at.join(' » '))).toEqual([
			'.page:not([data-profile]) .page-fundraise-area'
		]);
	});

	it('wraps the organisation’s name in its heading as the profile head wraps it, never past the plane', () => {
		expect(declared(page, '.page-fundraise-heading')['overflow-wrap']).toBe(
			declared(page, '.page-profile-name')['overflow-wrap']
		);
	});
});
