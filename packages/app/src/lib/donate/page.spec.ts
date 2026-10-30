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
import { LAYOUTS } from '../page/shape';
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
// names: every `--_` name the sheet reads is one the form's token file declares. the sheet
// re-points `--_font` and `--_font-mono`, declares `--_w-sent`, and declares no other `--_` name.
// every `--page-*` name read is declared here or set inline by the page root; every `--donate-*`
// name written is a seed the form registers.
//
// values: outside a custom property's own declaration no colour and no length is written, which is
// the operator sweeps in packages/operator/src/styles/raw-values.ts handed a copy of the sheet with
// the token declarations blanked out. the container breakpoints the header names are the one literal
// a condition may carry.
//
// the sections: ./page-view.tsx and ./sections/*.tsx write no raw colour or length into a style object,
// and every class they write is one ./page.css draws, or the form's layout sheet for its `.vh`: a
// class nothing draws paints nothing and fails nowhere else.
//
// the edit edge: drawn only under `:root[data-editing]`, and solid on the innermost hovered section
// alone.
//
// contrast: the page's grounds and inks, worked out from the two sheets as written by
// ./page-colour.testing.ts across a sweep of brand colours, for every shade and ground.
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
const formBase: Scope = {
	...seedDefaults,
	...declared(form, ':host, [data-donate-root]'),
	...declared(form, ':host > *, [data-donate-root] > *')
};
const SHADES = ['light', 'warm', 'cool'] as const;
type Shade = (typeof SHADES)[number];
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

describe('the names ./page.css reads and writes', () => {
	it('reads every `--_` name from the form token file, and finds names to read', () => {
		const formNames = declares(formText, '--_');
		const read = [...reads(pageText, '--_')];
		expect(read.length).toBeGreaterThan(0);
		expect(read.filter((name) => !formNames.has(name))).toEqual([]);
	});

	it('re-points the form’s two type tokens and the sent figure’s weight', () => {
		expect([...declares(pageText, '--_')].sort()).toEqual(['--_font', '--_font-mono', '--_w-sent']);
		expect(declared(page, '.page div')).toEqual({
			'--_font': 'var(--page-font-text)',
			'--_font-mono': 'var(--page-font-mono)',
			'--_w-sent': 'var(--_w-medium)',
			'font-variant-ligatures': 'no-contextual'
		});
	});

	it('sets the three faces to the operator screens’ stacks', () => {
		const operator = readFileSync(
			require.resolve('@better-giving/operator/styles/tokens.css'),
			'utf8'
		);
		const stack = (css: string, name: string) => {
			const found = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
			if (found?.[1] === undefined) throw new Error(`${name} is not declared`);
			return found[1].trim();
		};
		expect(stack(pageText, '--page-font-text')).toBe(stack(operator, '--admin-font-sans'));
		expect(stack(pageText, '--page-font-display')).toBe(stack(operator, '--admin-font-display'));
		expect(stack(pageText, '--page-font-mono')).toBe(stack(operator, '--admin-font-mono'));
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
			'data-donate-root',
			'data-layout',
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

describe('the colour evaluator agrees with the readings the form token file states', () => {
	const at = (seed?: string) => ({ ...formBase, ...(seed ? { '--donate-primary': seed } : {}) });
	const worst = 'oklch(0.5 0.16 190)';
	it.each([
		['--_n10', '--_n1', 4.96, undefined],
		['--_n10', '--_n2', 4.85, undefined],
		['--_n10', '--_n3', 4.56, undefined],
		['--_focus-ring', '--_n1', 14.8, undefined],
		['--_on-p', '--_p', 4.79, worst],
		['--_p', '--_n1', 4.92, worst]
	])('%s on %s reads %s', (ink, ground, stated, seed) => {
		const scope = at(seed);
		// to the two places the token file states each reading at, so a move of 0.01 fails.
		expect(contrast(resolve(scope, ink), resolve(scope, ground))).toBeCloseTo(stated, 2);
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

/** where text stands: the page ground, the form's card on `--_n1`, a plane on `--page-plane`, and
 * the About us band. */
const GROUNDS = {
	page: { ground: '--page-ground', scope: {} },
	card: { ground: '--_n1', scope: {} },
	plane: { ground: '--page-plane', scope: {} },
	band: {
		ground: '--page-band',
		scope: declared(page, ".page[data-layout='feature'] .page-about-area")
	}
} as const;
type Ground = keyof typeof GROUNDS;

function scopeFor(shade: Shade, ground: Ground, brand: string | null): Scope {
	return {
		...formBase,
		...shadeRoot[shade],
		...declared(page, '.page > .page-ground'),
		...GROUNDS[ground].scope,
		...root({ brandColour: brand }).inline
	};
}

/** the lowest reading of one pair across every brand, on one shade and ground. */
function floor(shade: Shade, ground: Ground, ink: string, on: string = GROUNDS[ground].ground) {
	let low = Number.POSITIVE_INFINITY;
	for (const brand of BRANDS) {
		const scope = scopeFor(shade, ground, brand);
		low = Math.min(low, contrast(resolve(scope, ink), resolve(scope, on)));
	}
	return Math.round(low * 100) / 100;
}

describe('the evaluator reads a hex colour', () => {
	// the sRGB primaries' oklch hues as https://www.w3.org/TR/css-color-4/#ok-lab publishes them, a
	// source independent of the conversion, which the 4.5:1 sweep below rests on.
	it.each([
		['#ff0000', 29.23],
		['#00ff00', 142.5],
		['#0000ff', 264.05],
		['#ff00ff', 328.36]
	])('%s at hue %f', (hex, hue) => {
		expect(colour(hex).h).toBeCloseTo(hue, 1);
	});
});

describe('text clears 4.5:1 for every brand colour', () => {
	it.each(SHADES)('the quiet ink on every ground, %s', (shade) => {
		for (const ground of Object.keys(GROUNDS) as Ground[])
			expect(floor(shade, ground, '--page-quiet'), ground).toBeGreaterThanOrEqual(4.5);
	});

	// a link and a tier's amount are drawn in it on the page ground, on a card and on a plane.
	it.each(SHADES)('the primary as ink on the page ground, a card and a plane, %s', (shade) => {
		expect(floor(shade, 'page', '--_p')).toBeGreaterThanOrEqual(4.5);
		expect(floor(shade, 'card', '--_p')).toBeGreaterThanOrEqual(4.5);
		expect(floor(shade, 'plane', '--_p')).toBeGreaterThanOrEqual(4.5);
	});

	// a program option's description stands on the option's own ground, which rests on rung 3 and
	// steps to 5 under a press.
	it.each(SHADES)('the option’s quiet ink on its press rung, %s', (shade) => {
		expect(declared(page, '.page-choose-description').color).toBe('var(--_n11)');
		expect(floor(shade, 'page', '--_n11', '--_n5')).toBeGreaterThanOrEqual(4.5);
	});

	// the feature's words on a cover with no photo stand on the brand fill itself.
	it.each(SHADES)('the one ink on the brand fill, %s', (shade) => {
		expect(floor(shade, 'page', '--_on-p', '--_p')).toBeGreaterThanOrEqual(4.5);
	});
});

describe('the goal track', () => {
	// the fill is what the bar is read by; the track against the ground under it is a look.
	it.each(SHADES)('holds its fill apart by 3:1, %s', (shade) => {
		expect(floor(shade, 'page', '--_p', '--page-track')).toBeGreaterThanOrEqual(3);
		expect(floor(shade, 'card', '--_p', '--page-track')).toBeGreaterThanOrEqual(3);
	});
});

describe('the scrim over the feature’s cover', () => {
	const scrim = declared(page, '.page > .page-ground')['--page-scrim'] ?? '';
	const stops = [...scrim.matchAll(/oklch\(([^/]+)\/\s*([\d.]+)\)\s*([\d.]+%)?/g)];
	const ink = resolve(scopeFor('light', 'page', null), '--_n1');

	it('holds the words’ ink at 4.5:1 over a white photo where the words stand', () => {
		const [darkest] = stops;
		if (darkest === undefined) throw new Error(`no translucent stop in ${scrim}`);
		expect(scrim).toMatch(/^linear-gradient\(\s*to right,/);
		expect(Number.parseFloat(darkest[3] ?? '0')).toBeGreaterThanOrEqual(58);
		const ground = overWhite(colour(`oklch(${darkest[1]})`), Number(darkest[2]));
		expect(contrast(ink, ground)).toBeGreaterThanOrEqual(4.5);
	});

	it('draws the words in that ink, and the ring with it', () => {
		const words = page.find(
			({ at }) =>
				at[0] === '@container page (min-width: 60rem)' &&
				at.at(-1) === ".page[data-layout='feature'] .page-hero-words"
		)?.decls;
		expect(words?.color).toBe('var(--_n1)');
		expect(words?.['--page-ring']).toBe('var(--_n1)');
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
