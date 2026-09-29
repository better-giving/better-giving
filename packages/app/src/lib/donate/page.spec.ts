import {
	rawColourViolations,
	rawLengthViolations,
	stripComments
} from '@better-giving/operator/styles/raw-values';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
	type Scope,
	substitute
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
// the blocks: ./page-view.tsx and ./blocks/*.tsx write no raw colour or length into a style object,
// and every class they write is one ./page.css draws, or the form's layout sheet for its `.vh`: a
// class nothing draws paints nothing and fails nowhere else.
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

describe('the focus ring on a strong ground', () => {
	// a strong ground carries one ink, and a ring drawn on it is that ink (`--page-ring` in
	// ./page.css); a ring is a boundary rather than text, so it is held to 3:1.
	it.each(cases)(
		'holds `--page-on-strong` at 3:1 on the strong ground on %s, %s',
		(palette, shade) => {
			expect(floor(palette, shade, 'strong', '--page-on-strong')).toBeGreaterThanOrEqual(3);
		}
	);
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

/** a length expression, its `var()`s substituted, in px: `rem`, `px`, `em`, `cqi` and `%` inside
 * `calc()`, `clamp()`, `min()` and `max()`. anything else throws and names itself. */
function px(text: string, units: { cqi: number; em: number; percent: number }): number {
	const tokens = text.match(/-?[\d.]+[a-z%]*|[a-z-]+\(|[()+*/,-]/g) ?? [];
	let at = 0;
	const next = () => tokens[at++] ?? '';
	const peek = () => tokens[at] ?? '';
	const args = (): number[] => {
		const found = [sum()];
		while (peek() === ',') {
			next();
			found.push(sum());
		}
		if (next() !== ')') throw new Error(`unclosed call in ${text}`);
		return found;
	};
	const unit = (token: string) => {
		const m = /^(-?[\d.]+)([a-z%]*)$/.exec(token);
		if (!m) throw new Error(`no length at ${token} in ${text}`);
		const value = Number(m[1]);
		const per: Record<string, number> = {
			'': 1,
			px: 1,
			rem: 16,
			em: units.em,
			cqi: units.cqi,
			'%': units.percent / 100
		};
		const scale = per[m[2] ?? ''];
		if (scale === undefined) throw new Error(`no unit ${m[2]} in ${text}`);
		return value * scale;
	};
	const atom = (): number => {
		const token = next();
		if (token === '(' || token === 'calc(') {
			const value = sum();
			if (next() !== ')') throw new Error(`unclosed ( in ${text}`);
			return value;
		}
		if (token === 'clamp(') {
			const [low = 0, value = 0, high = 0] = args();
			return Math.max(low, Math.min(value, high));
		}
		if (token === 'min(') return Math.min(...args());
		if (token === 'max(') return Math.max(...args());
		return unit(token);
	};
	const product = (): number => {
		let value = atom();
		while (peek() === '*' || peek() === '/')
			value = next() === '*' ? value * atom() : value / atom();
		return value;
	};
	function sum(): number {
		let value = product();
		while (peek() === '+' || peek() === '-')
			value = next() === '+' ? value + product() : value - product();
		return value;
	}
	const value = sum();
	if (at !== tokens.length)
		throw new Error(`left over after ${tokens.slice(0, at).join(' ')} in ${text}`);
	return value;
}

/** the top-level comma-separated parts of a function's arguments. */
function parts(text: string) {
	const found: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '(') depth++;
		else if (text[i] === ')') depth--;
		else if (text[i] === ',' && depth === 0) {
			found.push(text.slice(from, i).trim());
			from = i + 1;
		}
	}
	found.push(text.slice(from).trim());
	return found;
}

/**
 * the scrim's colour and alpha at `fromBottom` px up an element `height` px tall: a
 * `linear-gradient(to top, …)` of one colour at several alphas, whose stops interpolate as a
 * premultiplied colour does, so only the alpha moves.
 */
function scrimAt(gradient: string, height: number, fromBottom: number) {
	const inner = /^linear-gradient\((.*)\)$/.exec(gradient)?.[1];
	const [direction, ...stops] = parts(inner ?? '');
	if (direction !== 'to top' || stops.length < 2) throw new Error(`not a scrim: ${gradient}`);
	let last = 0;
	const placed = stops.map((stop, i) => {
		const m = /^(oklch\(([^/]+)\/\s*([\d.]+)\))\s*(.*)$/.exec(stop);
		if (!m) throw new Error(`no translucent stop in ${stop}`);
		const position = m[4]
			? px(m[4], { cqi: Number.NaN, em: Number.NaN, percent: height })
			: i === 0
				? 0
				: i === stops.length - 1
					? height
					: Number.NaN;
		if (Number.isNaN(position)) throw new Error(`a middle stop with no position in ${gradient}`);
		// a stop placed before the one ahead of it is moved up to it.
		last = Math.max(last, position);
		return { base: m[2] ?? '', alpha: Number(m[3]), at: last };
	});
	const first = placed[0];
	const final = placed.at(-1);
	if (!first || !final || placed.some((stop) => stop.base !== first.base))
		throw new Error(`a scrim of more than one colour: ${gradient}`);
	let alpha = fromBottom <= first.at ? first.alpha : final.alpha;
	for (let i = 1; i < placed.length; i++) {
		const [below, above] = [placed[i - 1], placed[i]];
		if (below && above && fromBottom > below.at && fromBottom <= above.at) {
			const run = above.at - below.at;
			alpha =
				run === 0
					? above.alpha
					: below.alpha + ((fromBottom - below.at) / run) * (above.alpha - below.alpha);
		}
	}
	return { base: colour(`oklch(${first.base})`), alpha };
}

describe('the scrim under the cover title', () => {
	const WIDE = '@container page (min-width: 60rem)';
	const ink = resolve(scopeFor('plain', 'light', 'none', null), '--_n1');

	it('holds the title ink at 4.5:1 over a white photo at its darkest stop', () => {
		const scrim = declared(page, '.page > .page-ground')['--page-scrim'] ?? '';
		const stop = /oklch\(([^/]+)\/\s*([\d.]+)\)/.exec(scrim);
		if (!stop) throw new Error(`no translucent stop in ${scrim}`);
		const ground = overWhite(colour(`oklch(${stop[1]})`), Number(stop[2]));
		expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
	});

	// the over-element is the cover's scrim run, the title and its lede, and the run under them;
	// its height is theirs, and the first line's box starts where the run above it ends, since a
	// block's headings carry no margin. white is the worst photo under a dark scrim.
	it.each([
		[375, 1, 'no lede', 0],
		[375, 2, 'no lede', 0],
		[375, 1, 'a three-line lede', 3],
		[375, 2, 'a three-line lede', 3],
		[1280, 1, 'no lede', 0],
		[1280, 2, 'no lede', 0],
		[1280, 1, 'a two-line lede', 2],
		[1280, 2, 'a two-line lede', 2]
	])(
		'holds the title ink at 4.5:1 at the top of its first line, %ipx wide, a %i-line title and %s',
		(width, titleLines, _lede, ledeLines) => {
			// what a rule declares at the narrow widths, and what the widest breakpoint adds over it.
			const cascade = (selector: string) => ({
				...declared(page, selector),
				...(width >= 60 * 16
					? page.find(({ at }) => at.join(' » ') === `${WIDE} » ${selector}`)?.decls
					: {})
			});
			const scope: Scope = {
				...scopeFor('plain', 'light', 'none', null),
				...cascade('.page > .page-ground')
			};
			const over = cascade('.page-hero-over');
			const length = (text: string, em = Number.NaN) =>
				px(substitute(scope, text), { cqi: width / 100, em, percent: Number.NaN });
			const number = (name: string) => Number(substitute(scope, `var(${name})`));

			const [start = '', end = start] = parts(
				(over['padding-block'] ?? '').replace(/ (?![^(]*\))/g, ',')
			);
			const runAbove = length(start);
			const runUnder = length(over['padding-block-end'] ?? end);
			const display = length('var(--page-display)');
			const lede = length('var(--page-lede)');
			const title = titleLines * display * number('--page-lh-display');
			const ledeBlock =
				ledeLines === 0
					? 0
					: length('var(--_sp4)', lede) + ledeLines * lede * number('--page-lh-lede');
			const height = runAbove + title + ledeBlock + runUnder;

			const { base, alpha } = scrimAt(
				substitute(scope, over.background ?? ''),
				height,
				height - runAbove
			);
			expect(contrast(ink, overWhite(base, alpha))).toBeGreaterThanOrEqual(4.5);
		}
	);
});

describe('the blocks ./page.css draws', () => {
	const here = relative(process.cwd(), import.meta.dirname);
	const components = [
		join(here, 'page-view.tsx'),
		...globSync(join(here, 'blocks/*.tsx')).filter((file) => !file.includes('.spec.'))
	];
	const FORM_LAYOUT = require.resolve('@better-giving/form/styles/layout.css');
	const drawn = new Set(
		[pageText, readFileSync(FORM_LAYOUT, 'utf8')].flatMap((css) =>
			[...stripComments(css).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '')
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
