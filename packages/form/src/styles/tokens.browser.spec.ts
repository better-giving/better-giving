import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { cdp } from 'vitest/browser';
import { documentCss } from '../element';
import { CARD_THEME } from '../parts';
import { UNSEEDED } from './brand';
import tokens from './tokens.css?inline';

// the browser pool, and the only pool that can see any of this. a registry step is an `oklch()`
// literal behind one or two `var()`s, resolved at computed-value time by a real engine — a
// lightweight DOM hands the expression back as the string it was given, so an assertion there would
// be asserting the fixture rather than the ramp. run with `pnpm test:browser`; it is deliberately
// outside `pnpm test` and outside the deploy gate (see vitest.browser.config.ts).
//
// how a token is read here. the `--_` names are unregistered custom properties, so
// `getPropertyValue('--_p')` returns the `var()` it aliases rather than a color. every helper below
// therefore assigns the token to a standard property on a probe element and reads that property
// back, which is the same thing ./resolve.ts does before anything is handed to a payment provider —
// what that module then sends is asserted in ./resolve.browser.spec.ts.
//
// every colour in ./tokens.css is a registry variable (../registry/styles/variables.css and the
// theme it imports). the probe stands where the card's root does — the first node in the shadow
// root, carrying the registry theme — because that is the node the registry declares its scales on.
// the accent a seed writes over them is the element's brand sheet (./brand.ts), held in
// ../element.browser.spec.ts and, against radix's own generator, in ./radix-scale.spec.ts.

const sheet = new CSSStyleSheet();
sheet.replaceSync(tokens);

/** what the element puts in the document: the seed registrations, and nothing else. */
const documentSheet = new CSSStyleSheet();
documentSheet.replaceSync(documentCss(tokens));

/** the neutral steps the card declares, lightest first, and the registry step each one is. */
const RUNGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '11', '12'].map((n) => [
	`--_n${n}`,
	`--gray-${n}`
]);

/** the brand aliases, and the registry accent each one is. */
const BRAND = [
	['--_a8', '--accent-8'],
	['--_a11', '--accent-11'],
	['--_a12', '--accent-12'],
	['--_p', '--accent-9'],
	['--_p-hover', '--accent-10'],
	['--_on-p', '--accent-contrast']
];

/** refusal and attention, and the registry role each one is: none moves with a seed. */
const SEMANTIC = [
	['--_bad', '--destructive-subtle-fg'],
	['--_bad-edge', '--destructive'],
	['--_bad-tint', '--destructive-subtle'],
	['--_warn-tint', '--warning-subtle'],
	['--_warn-ink', '--warning-subtle-fg']
];

/** the edges, and the registry role each one is. */
const EDGES = [
	['--_edge-control', '--input'],
	['--_edge-unavailable', '--input'],
	['--_focus-ring', '--ring']
];

const ALIASES = [...RUNGS, ...BRAND, ...SEMANTIC, ...EDGES];

const COLOR_TOKENS = ALIASES.map(([token]) => token as string);

let host: HTMLElement;
let probe: HTMLElement;
let hostStyle: HTMLStyleElement;

beforeEach(() => {
	// the two trees the element puts its sheets in, and both are load-bearing: the shadow root is
	// where `:host` and the card's theme apply, and the document is the only tree `@property`
	// registrations and `@font-face` rules are collected from.
	document.adoptedStyleSheets = [documentSheet];

	host = document.createElement('div');
	host.id = 'donate-host';
	document.body.appendChild(host);

	const shadow = host.attachShadow({ mode: 'open' });
	shadow.adoptedStyleSheets = [sheet];

	probe = document.createElement('div');
	probe.setAttribute('data-theme', CARD_THEME);
	shadow.appendChild(probe);

	// a stylesheet in the outer document, targeting the host element — the path an org's own
	// CSS actually takes to reach a seed. setting the property through CSSOM instead would skip
	// the parse-time validation that makes `@property` registration worth anything.
	hostStyle = document.createElement('style');
	document.head.appendChild(hostStyle);
});

afterEach(() => {
	document.adoptedStyleSheets = [];
	host.remove();
	hostStyle.remove();
	document.documentElement.style.removeProperty('font-size');
});

/** what a host page wrote on the element. */
function seed(declarations: string): void {
	hostStyle.textContent = `#donate-host { ${declarations} }`;
}

/** resolves one declaration against the real cascade and reads a property back off it. */
function computed(declaration: string, property: string): string {
	probe.style.cssText = declaration;
	return getComputedStyle(probe).getPropertyValue(property);
}

/** a token, or any colour expression, forced through an `oklch()` output. */
function oklchString(colour: string): string {
	const source = colour.startsWith('--') ? `var(${colour})` : colour;
	return computed(`color: oklch(from ${source} l c h)`, 'color');
}

type Oklch = { l: number; c: number; h: number };

const OKLCH = /^oklch\(\s*(\S+)\s+(\S+)\s+([^\s/)]+)/;

function channel(raw: string, percentBase: number): number {
	if (raw === 'none') return 0;
	if (raw.endsWith('%')) return (Number(raw.slice(0, -1)) / 100) * percentBase;
	return Number(raw);
}

/**
 * the colour as three numbers, or `null` when it did not resolve to a color at all.
 *
 * an unresolvable token makes the whole `oklch(from …)` invalid, so `color` falls back to its
 * inherited value and serializes as `rgb(…)` — which is exactly the failure this spec exists
 * to catch, and why the match is on the function name rather than on the numbers alone.
 */
function parseOklch(serialized: string): Oklch | null {
	const match = OKLCH.exec(serialized);
	if (match === null) return null;
	const [, l, c, h] = match;
	if (l === undefined || c === undefined || h === undefined) return null;
	const parsed = { l: channel(l, 1), c: channel(c, 0.4), h: channel(h, 1) };
	return Number.isFinite(parsed.l) && Number.isFinite(parsed.c) && Number.isFinite(parsed.h)
		? parsed
		: null;
}

function oklchOf(colour: string): Oklch {
	const serialized = oklchString(colour);
	const parsed = parseOklch(serialized);
	if (parsed === null) throw new Error(`${colour} did not resolve to a color: "${serialized}"`);
	return parsed;
}

const SRGB = /^color\(srgb\s+(\S+)\s+(\S+)\s+([^\s/)]+)/;

/** a token, or any colour expression, as sRGB channels clamped to what a screen shows. */
function srgbOf(colour: string): [number, number, number] {
	const source = colour.startsWith('--') ? `var(${colour})` : colour;
	const serialized = computed(`color: color(from ${source} srgb r g b)`, 'color');
	const [, r, g, b] = SRGB.exec(serialized) ?? [];
	if (r === undefined || g === undefined || b === undefined) {
		throw new Error(`${colour} did not resolve to a color: "${serialized}"`);
	}
	const clamp = (value: string) => Math.min(Math.max(Number(value), 0), 1);
	return [clamp(r), clamp(g), clamp(b)];
}

/** the two colours as the eight-bit channels a screen draws. */
function bytes(colour: string): number[] {
	return srgbOf(colour).map((value) => Math.round(value * 255));
}

/** the token as a used length, which is the only way a `clamp()` of lengths becomes a number. */
function lengthOf(token: string): string {
	return computed(`padding-left: var(${token})`, 'padding-left');
}

describe('the document sheet', () => {
	it('registers the seed only from the document tree', () => {
		// the token sheet is still adopted into the shadow root, so its `@property` rules are still
		// in a sheet the card reads — and an engine ignores them there. with nothing registering
		// `--donate-primary`, an unseeded card computes no default to tell a seed from.
		document.adoptedStyleSheets = [];
		expect(computed('', '--donate-primary').trim()).toBe('');

		document.adoptedStyleSheets = [documentSheet];
		expect(computed('', '--donate-primary').trim()).toBe(UNSEEDED);
	});

	// the card loads no web font, so the document gets the seed registrations and no face: a
	// `@font-face` here would be a face fetched onto a stranger's page.
	it('registers no face in the host document', () => {
		document.adoptedStyleSheets = [documentSheet];

		expect([...document.fonts]).toEqual([]);
		expect(documentCss(tokens)).not.toMatch(/@font-face/);
	});

	it('declares nothing on the host page', () => {
		const outside = document.createElement('div');
		document.body.appendChild(outside);
		const reaching = ['--gray-1', '--accent-9', '--primary', '--_n1'].filter(
			(name) => getComputedStyle(outside).getPropertyValue(name) !== ''
		);
		outside.remove();

		expect(reaching).toEqual([]);
	});
});

describe('the light-DOM card root', () => {
	// the deployment draws this card on its own page in the document tree rather than in a shadow
	// root, so `[data-donate-root]` is the second selector on the ladder, and that page links the
	// whole token file, whose registry `:root` block declares the scales there. the pair of cases is
	// the whole of what the selector is allowed to do: declare the private layer where the card is,
	// and nowhere else on the document.
	let root: HTMLElement;
	let card: HTMLElement;
	let outside: HTMLElement;

	beforeEach(() => {
		document.adoptedStyleSheets = [sheet];
		root = document.createElement('div');
		root.setAttribute('data-donate-root', '');
		card = document.createElement('div');
		root.appendChild(card);
		document.body.appendChild(root);

		outside = document.createElement('div');
		document.body.appendChild(outside);
	});

	afterEach(() => {
		root.remove();
		outside.remove();
	});

	/** the token forced through an `oklch()` output on a given element, as `oklchString` does. */
	function resolvesOn(element: HTMLElement, token: string): boolean {
		element.style.cssText = `color: oklch(from var(${token}) l c h)`;
		return parseOklch(getComputedStyle(element).getPropertyValue('color')) !== null;
	}

	// light only (the head of ./tokens.css): the registry theme has no `prefers-color-scheme` branch,
	// and its one dark switch on this page is a `.dark` class on `<html>`, which nothing in the app
	// sets. so a visitor whose system is dark gets the light page.
	it('stays light for a visitor whose system prefers dark', async () => {
		const names = ['--accent-1', '--accent-12', '--gray-1', '--gray-12'];
		const read = () => names.map((name) => getComputedStyle(card).getPropertyValue(name));
		const light = read();

		const session = cdp();
		await session.send('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: 'dark' }]
		});
		onTestFinished(async () => {
			await session.send('Emulation.setEmulatedMedia', {
				features: [{ name: 'prefers-color-scheme', value: 'light' }]
			});
			document.documentElement.classList.remove('dark');
		});
		expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
		expect(read()).toEqual(light);

		// the read is live: the class on `<html>` is what moves it.
		document.documentElement.classList.add('dark');
		expect(read()).not.toEqual(light);
	});

	it('declares the ladder under a root carrying the attribute', () => {
		expect(resolvesOn(card, '--_p')).toBe(true);
		expect(resolvesOn(card, '--_n12')).toBe(true);
	});

	// the preset switches on the node under the root, so a page can set it at its own root and the
	// card follows — the same reading an embedding page gets by setting it above the element.
	it('switches the corner a page sets above the root', () => {
		hostStyle.textContent = 'body { --donate-corner: round; }';
		card.style.cssText = 'padding-left: var(--_r)';
		expect(getComputedStyle(card).paddingLeft).toBe('24px');
	});

	it('declares none of the private layer anywhere else in the document', () => {
		const reaching = COLOR_TOKENS.filter((token) => resolvesOn(outside, token));

		// a selector matching in the document tree at large would hand a host page every `--_` name
		// this file derives, which is the reading `:host` alone made impossible.
		expect(reaching).toEqual([]);
	});
});

describe('the colour layer', () => {
	it('resolves every alias to a real color', () => {
		const unresolved = COLOR_TOKENS.filter((token) => parseOklch(oklchString(token)) === null);

		expect(unresolved).toEqual([]);
	});

	// every colour on the card is the registry's: each alias paints exactly the registry variable it
	// names, at the screen's own resolution.
	it.each(ALIASES)('paints %s as the registry’s %s', (token, registry) => {
		expect(bytes(token as string)).toEqual(bytes(registry as string));
	});

	it('reads the registry’s default theme on a card nobody seeded', () => {
		// the theme file's own step 9 and grey step 1, which the card face and the action are drawn in.
		expect(bytes('--_p')).toEqual(bytes(UNSEEDED));
		expect(bytes('--_n1')).toEqual(bytes('#fbfcfe'));
	});

	// a host's own registry, or any page that names its variables the registry's way, stops at the
	// card's root: the theme declares its own there, so nothing a page sets above reaches the card.
	it('takes none of a host page’s registry-named variables', () => {
		const ring = bytes('--_focus-ring');
		seed(
			'--gray-1: #ff0000; --accent-8: #ffff00; --accent-9: #00ff00; --primary: #0000ff; --ring: #ff00ff;'
		);

		expect(bytes('--_n1')).toEqual(bytes('#fbfcfe'));
		expect(bytes('--_p')).toEqual(bytes(UNSEEDED));
		expect(bytes('--primary')).toEqual(bytes(UNSEEDED));
		// the card's focus ring and its accent step 8 are what they were before the page spoke.
		expect(bytes('--_focus-ring')).toEqual(ring);
		expect(bytes('--_focus-ring')).toEqual(bytes('--_a8'));
		expect(bytes('--_a8')).not.toEqual(bytes('#ffff00'));
	});

	it('leaves every alias alone whatever the seed is, which only the brand sheet moves', () => {
		seed('--donate-primary: oklch(0.5 0.25 300);');
		const seeded = COLOR_TOKENS.map(oklchString);
		seed('');

		expect(COLOR_TOKENS.map(oklchString)).toEqual(seeded);
	});
});

describe('the neutral ladder', () => {
	// the registry's grey carries a trace of blue, at a chroma a donor reads as the card's tone
	// rather than a colour.
	it('gives every step a trace of chroma, never a colour', () => {
		for (const [token] of RUNGS)
			expect(oklchOf(token as string).c, token).toBeLessThanOrEqual(0.02);
	});

	it('runs from lightest to darkest with no step crossing its neighbour', () => {
		const lightness = RUNGS.map(([token]) => oklchOf(token as string).l);

		expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
	});
});

describe('a malformed seed', () => {
	it("falls back to the seed's initial value", () => {
		seed('--donate-primary: not-a-color;');

		expect(bytes('--donate-primary')).toEqual(bytes(UNSEEDED));
	});

	it('leaves the rest of the ramp resolving past a bad seed', () => {
		seed('--donate-primary: 12px;');
		const unresolved = COLOR_TOKENS.filter((token) => parseOklch(oklchString(token)) === null);

		expect(unresolved).toEqual([]);
	});
});

describe('the card the form draws for itself', () => {
	it('draws the two corners the whole card is built from, the registry’s pair', () => {
		seed('');

		expect(lengthOf('--_r')).toBe(lengthOf('--radius-card'));
		expect(lengthOf('--_r-in')).toBe(lengthOf('--radius-control'));
		expect(lengthOf('--_r')).toBe('12px');
		expect(lengthOf('--_r-in')).toBe('6px');
	});

	// the face is the host page's: the card declares no family of its own, so what the page gives the
	// element is what the card's words are set in, fallbacks and all.
	it('sets the card in the face the host page gives the element', () => {
		seed("font-family: Georgia, 'Times New Roman', serif;");

		expect(computed('', 'font-family')).toBe(getComputedStyle(host).fontFamily);
		expect(computed('', 'font-family')).toContain('Georgia');
	});

	// the one face it does name is the platform's monospace, for the strings a donor checks character
	// by character, and it loads nothing.
	it('sets a checked string in the platform’s monospace', () => {
		const mono = computed('font-family: var(--_font-mono)', 'font-family');

		expect(mono.startsWith('ui-monospace')).toBe(true);
		expect(mono.endsWith('monospace')).toBe(true);
	});

	// the one shape outside the two-corner pair: the switch is a pill, which is the exception
	// ./tokens.css argues at `--_switch-radius`. a change that put it back on `--_r-in` is a
	// re-decision rather than a tune.
	it('keeps the switch a pill', () => {
		seed('');

		expect(parseFloat(lengthOf('--_switch-radius'))).toBeCloseTo(
			parseFloat(lengthOf('--_switch-block')) / 2,
			4
		);
	});
});

describe('the corner seed', () => {
	// the card's corner, the corner of a control inside a box on it — the registry's own controls
	// read it as `--radius` — the tick box the form draws, which follows the inner corner up to
	// `soft`'s and no further so it never rounds toward a radio, and where a floated label's band
	// starts, which follows it down to `soft`'s and no further so a square box keeps its edge.
	it.each([
		['square', ['0px', '0px', '0px', '0px', '6px']],
		['soft', ['12px', '6px', '6px', '6px', '6px']],
		['round', ['24px', '12px', '12px', '6px', '12px']],
		['a corner off the list', ['12px', '6px', '6px', '6px', '6px']]
	])('draws %s', (name, corners) => {
		const corner = name.includes(' ') ? 'pill' : name;
		seed(`--donate-corner: ${corner};`);

		expect(['--_r', '--_r-in', '--radius', '--_r-box', '--_label-inset'].map(lengthOf)).toEqual(
			corners
		);
	});
});

// the three movements this component makes, each a duration bound to a curve at the token rather
// than at the rule that moves (./motion.css reads nothing else). the binding is what a lightweight
// DOM cannot see: `transition` there is the string it was handed, never a resolved duration.
describe('the named transitions', () => {
	it.each([
		['--_move-state', '--_dur-fast', '--_ease-enter'],
		['--_move-enter', '--_dur-screen', '--_ease-enter'],
		['--_move-press', '--_dur-fast', '--_ease-exit']
	])('binds %s to its own duration and its own curve', (move, duration, ease) => {
		expect(computed(`transition: opacity var(${move})`, 'transition-duration')).toBe(
			computed(`transition: opacity var(${duration})`, 'transition-duration')
		);
		expect(computed(`transition: opacity var(${move})`, 'transition-timing-function')).toBe(
			computed(`transition: opacity 1ms var(${ease})`, 'transition-timing-function')
		);
	});

	// the three screen rules in ./motion.css read these through `animation` rather than through
	// `transition`, and a shorthand that did not accept the pair would be dropped whole — a card
	// that simply appears, which every other spec in this package passes on.
	it('substitutes into an animation shorthand as well as a transition one', () => {
		expect(computed('animation: spin var(--_move-enter) both', 'animation-duration')).toBe(
			computed('animation: spin var(--_dur-screen) both', 'animation-duration')
		);
		expect(computed('animation: spin var(--_move-enter) both', 'animation-timing-function')).toBe(
			computed('animation: spin 1ms var(--_ease-enter) both', 'animation-timing-function')
		);
	});

	// the whole of why they are a pair of tokens rather than a pair of literals: `reduce`
	// re-points the durations above and every named transition re-resolves through them.
	//
	// the re-point is made on the host rather than on the probe, and that is the mechanism rather
	// than convenience: substitution happens where the property is declared, so `--_move-press`
	// computes on `:host` and inherits into the shadow already substituted. re-pointing the
	// duration anywhere below the host would change nothing, which is also why the `reduce` block
	// in ./tokens.css re-points on that same `:host`.
	it('carries a real duration, so re-pointing the duration collapses it', () => {
		expect(computed('transition: opacity var(--_move-press)', 'transition-duration')).not.toBe(
			'0s'
		);

		host.style.setProperty('--_dur-fast', '0s');

		expect(computed('transition: opacity var(--_move-press)', 'transition-duration')).toBe('0s');
	});
});

describe('the root size', () => {
	it('holds the scale up under a host that shrank the document root', () => {
		// `html { font-size: 62.5% }` is common and would otherwise render the whole form at 10px.
		document.documentElement.style.fontSize = '10px';

		expect(computed('', 'font-size')).toBe('15px');
	});

	it('holds the scale down under a host that inflated it', () => {
		document.documentElement.style.fontSize = '40px';

		expect(computed('', 'font-size')).toBe('18px');
	});

	it('follows the root inside the band', () => {
		document.documentElement.style.fontSize = '17px';

		expect(computed('', 'font-size')).toBe('17px');
	});

	it('scales spacing with it', () => {
		document.documentElement.style.fontSize = '10px';

		expect(lengthOf('--_sp1')).toBe('3.75px');
	});

	// the two strips the currency marks stand in ride the clamped root, because a mark and the figure
	// beside it are drawn at two sizes and an `em` resolves to a different length on each of them. a
	// lightweight DOM hands back the `calc()` it was given, so this is the only pool that can see
	// either number.
	it.each([
		['the smallest root a host can force', '10px', 15],
		['the largest', '40px', 18]
	])('sizes both currency strips off the clamped root at %s', (_name, rootSize, root) => {
		document.documentElement.style.fontSize = rootSize;

		expect(lengthOf('--_adorn-trail')).toBe(`${root * 3}px`);
		expect(lengthOf('--_adorn-lead')).toBe(`${root * 2.25}px`);
	});

	// the marks are set from the field's own border rather than centred in the strips above, and their
	// insets ride the same clamped root the marks do: a glyph that grew a fifth against an inset that
	// did not would sit tighter to the border at one end of the band than at the other.
	it.each([
		['the smallest root a host can force', '10px', 15],
		['the largest', '40px', 18]
	])('rides both mark insets on the clamped root at %s', (_name, rootSize, root) => {
		document.documentElement.style.fontSize = rootSize;

		expect(lengthOf('--_adorn-lead-inset')).toBe(`${root}px`);
		expect(lengthOf('--_adorn-trail-inset')).toBe(`${root * 0.75}px`);
	});

	// a drawn shape whose token did not resolve is not a defect anything else here can see: the
	// declaration is invalid at computed-value time, the non-inherited property it was assigned to
	// falls to its initial value, and what renders is a checkbox with no size or a switch with no
	// thumb rather than an error. that fallback is `0px` and it matches a length pattern, so the
	// assertion has to be a positive number — a drawn shape at zero is the same defect anyway.
	it('resolves every drawn shape to a real length', () => {
		const unresolved = [
			'--_mark',
			'--_box',
			'--_glyph-among',
			'--_glyph-beside',
			'--_switch-inline',
			'--_switch-block',
			'--_switch-thumb'
		].filter((token) => {
			const length = lengthOf(token);
			return !/^\d+(?:\.\d+)?px$/.test(length) || parseFloat(length) <= 0;
		});

		expect(unresolved).toEqual([]);
	});

	// the switch is the one drawn shape whose parts have to add up, so its geometry has to close on
	// itself at every root a host can force it to: a thumb at its inset, its own width, and the
	// travel to the far end have to come to exactly the track. off by a fraction and the thumb
	// stands proud of the end it travelled to, which is the one thing a switch may not do.
	it('keeps the switch closed on itself at the smallest root a host can force', () => {
		document.documentElement.style.fontSize = '10px';
		const px = (token: string) => parseFloat(lengthOf(token));

		expect(px('--_switch-inset') * 2 + px('--_switch-thumb') + px('--_switch-travel')).toBeCloseTo(
			px('--_switch-inline'),
			5
		);
	});
});
