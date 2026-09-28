import {
	rawColourViolations,
	rawLengthViolations,
	stripComments
} from '@better-giving/operator/styles/raw-values';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import {
	BACKGROUNDS,
	PALETTES,
	SHADES,
	type Background,
	type Palette,
	type Shade
} from '../page/keys';
import {
	blocks,
	colour,
	contrast,
	declared,
	overWhite,
	resolve,
	type Scope
} from './page-colour.testing';
import { PageRoot } from './page-root';

// the gate over ./page.css, which is the donor page's token layer and the rules beside it. the
// sheet's header states what each half below holds it to.
//
// names: every `--_` name the sheet reads is one the form's token file declares, and the sheet
// declares none of its own; every `--page-*` name read is declared here or set inline by the page
// root; every `--donate-*` name written is a seed the form registers.
//
// values: outside a custom property's own declaration no colour and no length is written, which is
// the operator sweeps in packages/operator/src/styles/raw-values.ts handed a copy of the sheet with
// the token declarations blanked out. the container breakpoints the header names are the one literal
// a condition may carry.
//
// contrast: the page's grounds and inks, worked out from the two sheets as written by
// ./page-colour.testing.ts across a sweep of brand colours, for every palette, shade and ground.
// the node pool, because this app has no browser pool; the evaluator is checked first against the
// readings the form's own token file states, which were taken in chromium.

const require = createRequire(import.meta.url);
const FORM_TOKENS = require.resolve('@better-giving/form/styles/tokens.css');
const PAGE_CSS = join(import.meta.dirname, 'page.css');
const HERE = relative(process.cwd(), PAGE_CSS);
const pageText = readFileSync(PAGE_CSS, 'utf8');
const formText = readFileSync(FORM_TOKENS, 'utf8');
const page = blocks(pageText);
const form = blocks(formText);

// the container widths a block's layout may change at, as ./page.css's header states them.
const BREAKPOINTS = ['30rem', '48rem', '60rem'];

// a seed the page sets nothing for computes its registered initial value, as the browser does.
const seedDefaults: Scope = Object.fromEntries(
	form.flatMap(({ at: [rule, ...inside], decls }) =>
		rule?.startsWith('@property ') && inside.length === 0 && decls['initial-value'] !== undefined
			? [[rule.slice('@property '.length), decls['initial-value']]]
			: []
	)
);
const formBase: Scope = {
	...seedDefaults,
	...declared(form, ':host, [data-donate-root]'),
	...declared(form, ':host > *, [data-donate-root] > *')
};
const shadeRoot: Record<Shade, Scope> = {
	light: {},
	warm: declared(
		form,
		'@container style(--donate-shade: warm)',
		':host > *, [data-donate-root] > *'
	),
	cool: declared(
		form,
		'@container style(--donate-shade: cool)',
		':host > *, [data-donate-root] > *'
	)
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
			shade: 'light',
			corner: 'soft',
			palette: 'tint',
			layout: 'box-right',
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

describe('the names ./page.css reads and writes', () => {
	it('reads every `--_` name from the form token file, and finds names to read', () => {
		const formNames = declares(formText, '--_');
		const read = [...reads(pageText, '--_')];
		expect(read.length).toBeGreaterThan(0);
		expect(read.filter((name) => !formNames.has(name))).toEqual([]);
	});

	it('declares no `--_` name of its own', () => {
		expect([...declares(pageText, '--_')]).toEqual([]);
	});

	it('reads every `--page-*` name from itself or from the page root', () => {
		const inline = Object.keys(root({ palette: 'duo' }).inline);
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
	it('carries the four axes and the declaring selector the form token file reads', () => {
		const { attributes } = root({
			shade: 'warm',
			corner: 'round',
			palette: 'duo',
			layout: 'cover'
		});
		expect(attributes).toMatchObject({
			'data-donate-root': '',
			'data-shade': 'warm',
			'data-corner': 'round',
			'data-palette': 'duo',
			'data-layout': 'cover'
		});
	});

	it('seeds the brand and both hues a duo page draws', () => {
		// #1f6feb is oklch hue 259.7: duo's second hue lands at 49.7 and moves out of the window
		expect(root({ palette: 'duo' }).inline).toEqual({
			'--donate-primary': '#1f6feb',
			'--page-hue': '259.7',
			'--page-hue-2': '115'
		});
	});

	it('seeds only the hue a tint page draws', () => {
		expect(root({ palette: 'tint', brandColour: '#d1242f' }).inline).toEqual({
			'--donate-primary': '#d1242f',
			'--page-hue': '115'
		});
	});

	it('seeds nothing for a page with no brand colour', () => {
		expect(root({ brandColour: null }).attributes.style).toBeUndefined();
	});

	it('sets each shade and corner seed from its attribute', () => {
		for (const shade of SHADES)
			expect(declared(page, `.page[data-shade='${shade}']`)).toEqual({ '--donate-shade': shade });
		expect(declared(page, ".page[data-corner='square']")).toEqual({ '--donate-corner': 'square' });
		expect(declared(page, ".page[data-corner='soft']")).toEqual({ '--donate-corner': 'soft' });
		expect(declared(page, ".page[data-corner='round']")).toEqual({ '--donate-corner': 'round' });
	});
});

describe('the colour evaluator agrees with the readings the form token file states', () => {
	const at = (seed?: string) => ({ ...formBase, ...(seed ? { '--donate-primary': seed } : {}) });
	const worst = 'oklch(0.5 0.16 190)';
	it.each([
		['--_n10', '--_n1', 4.99, undefined],
		['--_n10', '--_n2', 4.86, undefined],
		['--_n10', '--_n3', 4.57, undefined],
		['--_focus-ring', '--_n1', 14.85, undefined],
		['--_on-p', '--_p', 4.79, worst],
		['--_p', '--_n1', 4.93, worst]
	])('%s on %s reads %d', (ink, ground, stated, seed) => {
		const scope = at(seed);
		expect(contrast(resolve(scope, ink), resolve(scope, ground))).toBeCloseTo(stated, 1);
	});
});

// brand colours across the wheel, at full strength, dark and muted, and the unbranded page.
const hsv = (h: number, s: number, v: number) => {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
	};
	return `#${[5, 3, 1].map((n) => f(n).toString(16).padStart(2, '0')).join('')}`;
};
const BRANDS: (string | null)[] = [null, '#000000', '#808080', '#ffffff'];
for (let h = 0; h < 360; h += 5) BRANDS.push(hsv(h, 1, 1), hsv(h, 1, 0.45), hsv(h, 0.35, 0.85));

function scopeFor(palette: Palette, shade: Shade, background: Background, brand: string | null) {
	return {
		...formBase,
		...shadeRoot[shade],
		...declared(page, '.page > .page-ground'),
		...declared(page, `.page[data-palette='${palette}'] > .page-ground`),
		...(background === 'none'
			? {}
			: declared(page, `.page-ground [data-background='${background}']`)),
		...root({ palette, shade, brandColour: brand }).inline
	};
}

const GROUND: Record<Background, string> = {
	none: '--page-ground',
	soft: '--page-bg-soft',
	tint: '--page-bg-tint',
	strong: '--page-bg-strong'
};

/** the lowest reading of one pair across every brand, on one palette, shade and ground. */
function floor(
	palette: Palette,
	shade: Shade,
	background: Background,
	ink: string,
	on = GROUND[background]
) {
	let low = Number.POSITIVE_INFINITY;
	for (const brand of BRANDS) {
		const scope = scopeFor(palette, shade, background, brand);
		low = Math.min(low, contrast(resolve(scope, ink), resolve(scope, on)));
	}
	return Math.round(low * 100) / 100;
}

const QUIET_GROUNDS = BACKGROUNDS.filter((b) => b !== 'strong');
const cases = PALETTES.flatMap((palette) => SHADES.map((shade) => [palette, shade] as const));

describe('text on every ground clears 4.5:1 for every brand colour', () => {
	it.each(cases)('the quiet ink on %s, %s', (palette, shade) => {
		for (const background of QUIET_GROUNDS)
			expect(floor(palette, shade, background, '--page-quiet'), background).toBeGreaterThanOrEqual(
				4.5
			);
	});

	it.each(cases)('the one ink on the strong ground on %s, %s', (palette, shade) => {
		expect(floor(palette, shade, 'strong', '--page-on-strong')).toBeGreaterThanOrEqual(4.5);
	});
});

describe('the primary as ink', () => {
	// a link and a tier's amount are drawn in it on the page ground and on a soft one.
	it.each(cases)(
		'clears 4.5:1 on the page ground and a soft ground on %s, %s',
		(palette, shade) => {
			expect(floor(palette, shade, 'none', '--_p')).toBeGreaterThanOrEqual(4.5);
			expect(floor(palette, shade, 'soft', '--_p')).toBeGreaterThanOrEqual(4.5);
		}
	);
});

describe('the goal track', () => {
	// the fill is what the bar is read by; the track against the ground under it is a look and
	// states no floor, as ./page.css's header says.
	it.each(cases)(
		'holds its fill apart by 3:1 on every ground it stands on, %s, %s',
		(palette, shade) => {
			for (const background of QUIET_GROUNDS)
				expect(
					floor(palette, shade, background, '--_p', '--page-track'),
					background
				).toBeGreaterThanOrEqual(3);
		}
	);
});

describe('the scrim under the cover title', () => {
	it('holds the title ink at 4.5:1 over a white photo at its darkest stop', () => {
		const scrim = declared(page, '.page > .page-ground')['--page-scrim'] ?? '';
		const stop = /oklch\(([^/]+)\/\s*([\d.]+)\)/.exec(scrim);
		if (!stop) throw new Error(`no translucent stop in ${scrim}`);
		const ground = overWhite(colour(`oklch(${stop[1]})`), Number(stop[2]));
		const ink = resolve(scopeFor('plain', 'light', 'none', null), '--_n1');
		expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
	});
});
