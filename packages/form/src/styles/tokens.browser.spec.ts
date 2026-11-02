import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import tokens from './tokens.css?inline';

// the browser pool, and the only pool that can see any of this. `oklch(from …)` is resolved at
// computed-value time by a real engine — a lightweight DOM hands the expression back as the
// string it was given, so an assertion there would be asserting the fixture rather than the
// ramp. run with `pnpm test:browser`; it is deliberately outside `pnpm test` and outside the
// deploy gate (see vitest.browser.config.ts).
//
// how a token is read here. the `--_` steps are unregistered custom properties, so
// `getPropertyValue('--_p')` returns the `oklch(from …)` expression rather than a color. every
// helper below therefore assigns the token to a standard property on a probe element and reads
// that property back, which is the same thing ./resolve.ts does before anything is handed to a
// payment provider — what that module then sends is asserted in ./resolve.browser.spec.ts.
//
// every colour in ./tokens.css is a step of a radix colors scale
// (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale). the brand
// steps read here are the stylesheet's fallback; the scale the element generates over them is held
// in ../element.browser.spec.ts and, against radix's own generator, in ./radix-scale.spec.ts.

const sheet = new CSSStyleSheet();
sheet.replaceSync(tokens);

/** radix slate, light, from @radix-ui/colors 3.0.0 — the literal each declared step must be. */
const SLATE: Record<string, string> = {
	'--_n1': '#fcfcfd',
	'--_n2': '#f9f9fb',
	'--_n3': '#f0f0f3',
	'--_n4': '#e8e8ec',
	'--_n5': '#e0e1e6',
	'--_n6': '#d9d9e0',
	'--_n7': '#cdced6',
	'--_n8': '#b9bbc6',
	'--_n9': '#8b8d98',
	'--_n11': '#60646c',
	'--_n12': '#1c2024'
};

/** the slate steps the card declares, lightest first. */
const RUNGS = Object.keys(SLATE);

/** the brand scale's declared steps, the solid pair and the ink on it. */
const BRAND = ['--_a8', '--_p', '--_p-hover', '--_a11', '--_a12', '--_on-p'];

/** fixed literals with no relation to any seed: a refusal is drawn alike whatever a host seeded. */
const SEMANTIC = ['--_bad', '--_bad-edge', '--_bad-tint', '--_warn-tint', '--_warn-ink'];

const NETWORK = [0, 1, 2, 3, 4, 5].flatMap((n) => [`--_net-${n}-tint`, `--_net-${n}-ink`]);

const COLOR_TOKENS = [
	...BRAND,
	...RUNGS,
	'--_edge-control',
	'--_edge-unavailable',
	'--_focus-ring',
	...SEMANTIC,
	...NETWORK
];

/** the registered `initial-value` of the seed: slate's step 12. */
const DEFAULT_SEED = '#1c2024';

/**
 * a spread of seeds every brand reading is made across: the default, radix's own step 9s (its deep
 * hues, the ones it draws white on, and the light ones it draws dark ink on), and the seeds no radix
 * scale holds — a pastel, a neon outside sRGB, a near-black, white and a mid grey.
 */
const SEEDS: readonly (readonly [string, string])[] = [
	['the default', ''],
	['radix blue', '#0090ff'],
	['radix violet', '#6e56cf'],
	['radix purple', '#8e4ec6'],
	['radix red', '#e5484d'],
	['radix orange', '#f76b15'],
	['radix grass', '#46a758'],
	['radix teal', '#12a594'],
	['radix yellow', '#ffe629'],
	['radix amber', '#ffc53d'],
	['radix sky', '#7ce2fe'],
	['a pastel pink', '#ffd1dc'],
	['a neon green outside sRGB', 'oklch(0.92 0.28 140)'],
	['a near-black navy', '#0b1d3a'],
	['white', '#ffffff'],
	['a mid grey', '#808080']
];

/** the three shade presets: a preset moves every grey on the card at once. */
const SHADES = ['light', 'warm', 'cool'] as const;

let host: HTMLElement;
let probe: HTMLElement;
let hostStyle: HTMLStyleElement;

beforeEach(() => {
	// the two trees the element has to put this sheet in, and both are load-bearing: the shadow
	// root is where `:host` applies, and the document is the only tree `@property` registrations
	// are collected from.
	document.adoptedStyleSheets = [sheet];

	host = document.createElement('div');
	host.id = 'donate-host';
	document.body.appendChild(host);

	const shadow = host.attachShadow({ mode: 'open' });
	shadow.adoptedStyleSheets = [sheet];

	probe = document.createElement('div');
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

/** a seed as a declaration, or nothing for the default. */
function brand(value: string): string {
	return value === '' ? '' : `--donate-primary: ${value};`;
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

describe('the seed registrations', () => {
	it('registers only from the document tree', () => {
		// the sheet is still adopted into the shadow root, so `:host` still applies and the ramp
		// is still declared — but with nothing registering `--donate-primary` there is no initial
		// value behind it, and every step derived from it is invalid at computed-value time.
		// a host who seeded nothing is the common case, so this is a card drawn with no brand on it
		// at all rather than one drawn in the registered default.
		document.adoptedStyleSheets = [];

		expect(parseOklch(oklchString('--_p'))).toBeNull();
	});

	it('resolves the ramp once the document tree has them', () => {
		expect(parseOklch(oklchString('--_p'))).not.toBeNull();
	});
});

describe('the light-DOM card root', () => {
	// the deployment draws this card on its own page in the document tree rather than in a shadow
	// root, so `[data-donate-root]` is the second selector on the ladder. the pair of cases is the
	// whole of what that selector is allowed to do: declare the private layer where the card is,
	// and nowhere else on a document that adopted this sheet.
	let root: HTMLElement;
	let card: HTMLElement;
	let outside: HTMLElement;

	beforeEach(() => {
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

	it('declares the ladder under a root carrying the attribute', () => {
		expect(resolvesOn(card, '--_p')).toBe(true);
		expect(resolvesOn(card, '--_n12')).toBe(true);
	});

	// the presets switch on the node under the root, so a page can set them at its own root and the
	// card follows — the same reading an embedding page gets by setting them above the element.
	it('switches the presets a page sets above the root', () => {
		hostStyle.textContent = 'body { --donate-shade: warm; --donate-corner: round; }';
		card.style.cssText = 'color: oklch(from var(--_n1) l c h); padding-left: var(--_r)';
		const face = parseOklch(getComputedStyle(card).color);

		expect(face?.h).toBeCloseTo(70, 0);
		expect(getComputedStyle(card).paddingLeft).toBe('16px');
	});

	it('declares none of the private layer anywhere else in the document', () => {
		const reaching = COLOR_TOKENS.filter((token) => resolvesOn(outside, token));

		// a selector matching in the document tree at large would hand a host page every `--_` name
		// this file derives, which is the reading `:host` alone made impossible.
		expect(reaching).toEqual([]);
	});
});

describe('the derived ramp', () => {
	it.each(SEEDS)('resolves every step to a real color for %s', (_name, value) => {
		seed(brand(value));
		const unresolved = COLOR_TOKENS.filter((token) => parseOklch(oklchString(token)) === null);

		expect(unresolved).toEqual([]);
	});

	it('carries the seed’s hue through every brand step', () => {
		seed('--donate-primary: oklch(0.5 0.14 300);');

		for (const token of BRAND.filter((name) => name !== '--_on-p')) {
			expect(oklchOf(token).h, token).toBeCloseTo(300, 0);
		}
	});

	it('leaves the neutral steps alone whatever the brand is', () => {
		// the ladder is the form's own and the seed reaches none of it, which is what makes every
		// neutral reading a single number whatever the seed. a derivation
		// accidentally reintroduced would show up here as a step following the brand.
		seed('--donate-primary: oklch(0.5 0.25 300);');
		const seeded = RUNGS.map(oklchString);
		seed('');

		expect(RUNGS.map(oklchString)).toEqual(seeded);
	});
});

describe('the neutral ladder', () => {
	// slate exactly, step for step, at the screen's own resolution.
	it('is radix slate under light', () => {
		seed('');

		expect(RUNGS.map(bytes)).toEqual(RUNGS.map((token) => bytes(SLATE[token] as string)));
	});

	// the hue `warm` and `cool` hand the ladder is private and declared unset under `light`, so a
	// page that happens to set the same name cannot re-hue a card it never chose a shade for.
	it('keeps slate under light whatever the page above set', () => {
		seed('--_shade-h: 140;');

		expect(RUNGS.map(bytes)).toEqual(RUNGS.map((token) => bytes(SLATE[token] as string)));
	});

	// warm and cool turn slate's hue and keep its lightness and chroma, so every reading made on
	// slate holds under them.
	it.each([
		['warm', 70],
		['cool', 220]
	])('keeps slate’s lightness and chroma under %s, at its own hue', (shade, hue) => {
		seed('');
		const light = RUNGS.map((token) => oklchOf(token));
		seed(`--donate-shade: ${shade};`);

		RUNGS.forEach((token, index) => {
			const step = oklchOf(token);
			expect(step.l, token).toBeCloseTo(light[index]?.l ?? Number.NaN, 4);
			expect(step.c, token).toBeCloseTo(light[index]?.c ?? Number.NaN, 4);
			expect(step.h, token).toBeCloseTo(hue, 0);
		});
	});

	// slate's chroma tops out at 0.019, a trace a donor reads as the card's tone rather than a
	// colour, and the three shades share it.
	it.each(SHADES)('gives every step a trace of chroma, never a colour, under %s', (shade) => {
		seed(`--donate-shade: ${shade};`);

		for (const token of RUNGS) expect(oklchOf(token).c, token).toBeLessThanOrEqual(0.0195);
	});

	it.each(SHADES)(
		'runs from lightest to darkest with no step crossing its neighbour under %s',
		(shade) => {
			seed(`--donate-shade: ${shade};`);
			const lightness = RUNGS.map((token) => oklchOf(token).l);

			expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
		}
	);
});

describe('the brand scale’s fallback', () => {
	// radix holds the seed as step 9: the brand exactly as the host gave it, at the screen's own
	// resolution, for every seed inside sRGB.
	it.each(SEEDS.filter(([, value]) => !value.startsWith('oklch')))(
		'is the seed itself at step 9 for %s',
		(_name, value) => {
			seed(brand(value));

			expect(bytes('--_p')).toEqual(bytes(value === '' ? DEFAULT_SEED : value));
		}
	);

	// every other declared step stands at the lightness the table in ./tokens.css gives it, whatever
	// the seed's own lightness. read off the unclipped colour, where the lightness is the one authored.
	it.each(SEEDS)('sets steps 8, 11 and 12 at fixed lightnesses for %s', (_name, value) => {
		seed(brand(value));

		expect(oklchOf('--_a8').l).toBeCloseTo(0.729, 3);
		expect(oklchOf('--_a11').l).toBeCloseTo(0.54, 3);
		expect(oklchOf('--_a12').l).toBeCloseTo(0.326, 3);
	});

	// step 10 is the seed moved 0.03 in lightness: darker, as every radix scale's is, and lighter
	// under a seed darker than 0.4, where a darker step would be no change a donor sees.
	it.each([
		['a mid seed', 'oklch(0.6 0.15 250)', 0.57],
		['a light seed', 'oklch(0.9 0.15 100)', 0.87],
		['a dark seed', 'oklch(0.3 0.1 250)', 0.33],
		['the default', '', 0.271]
	])('moves step 10 off step 9 for %s', (_name, value, expected) => {
		seed(brand(value));

		expect(oklchOf('--_p-hover').l).toBeCloseTo(expected, 2);
		expect(bytes('--_p-hover')).not.toEqual(bytes('--_p'));
	});

	// an unseeded card's brand scale is slate's hue at slate's trace of chroma: no hue a host did
	// not ask for.
	it('draws no brand hue beyond slate’s trace when nothing is seeded', () => {
		seed('');

		for (const token of BRAND) expect(oklchOf(token).c, token).toBeLessThanOrEqual(0.0195);
	});
});

describe('the edges', () => {
	// every box a donor operates is found by slate's step 7, radix's border for an interactive
	// component, and steps to 8 under the pointer: radix's step 7 taken as it is.
	it('draws every box outline at step 7', () => {
		seed('');

		expect(bytes('--_edge-control')).toEqual(bytes('--_n7'));
	});

	// the decision itself, not a consequence of it: at a boundary, unavailable is drawn at exactly
	// the available value. no control here is ever rendered `disabled` (../checkout.machine.ts), so
	// an unavailable one is still focusable and a donor can tab onto a shape and ring it. it is
	// carried in the stroke's pattern instead (`.step-mark` in ./parts.css).
	it('draws an unavailable boundary at exactly the available one', () => {
		seed('');

		expect(bytes('--_edge-unavailable')).toEqual(bytes('--_edge-control'));
	});

	// the focus ring is the brand's step 8, the step radix gives a focus ring, and never its fill.
	it.each(SEEDS)('draws the focus ring at the brand’s step 8 for %s', (_name, value) => {
		seed(brand(value));

		expect(bytes('--_focus-ring')).toEqual(bytes('--_a8'));
	});

	// a refused control is drawn at red 8 and named in red 11: two steps of one hue, each on its
	// own job.
	it('draws a refusal’s edge and its words at two steps of red', () => {
		seed('');

		expect(bytes('--_bad-edge')).toEqual(bytes('#eb8e90'));
		expect(bytes('--_bad')).toEqual(bytes('#ce2c31'));
	});
});

describe('a malformed seed', () => {
	it("falls back to the seed's initial value", () => {
		seed('--donate-primary: not-a-color;');

		expect(bytes('--donate-primary')).toEqual(bytes(DEFAULT_SEED));
	});

	it('leaves the rest of the ramp resolving past a bad seed', () => {
		// unregistered, this is the case that shreds the form: the bad value substitutes into
		// every `oklch(from …)`, each one is invalid at computed-value time, and every dependent
		// property falls back to `unset`.
		seed('--donate-primary: 12px;');
		const unresolved = COLOR_TOKENS.filter((token) => parseOklch(oklchString(token)) === null);

		expect(unresolved).toEqual([]);
	});

	it('renders the same ramp a host who set nothing gets', () => {
		seed('');
		const unseeded = BRAND.map(bytes);
		seed('--donate-primary: rgb(0 0);');

		expect(BRAND.map(bytes)).toEqual(unseeded);
	});
});

describe('the card the form draws for itself', () => {
	// what the card draws when a host sets nothing: the brand moves none of it, and the two presets
	// that move the ground and the corners are at their initial values. a rule that let the brand
	// reach one of these shows up here as a value that moved.
	it('paints the card at slate’s step 1 whatever the brand is', () => {
		seed('--donate-primary: oklch(0.45 0.2 265);');

		expect(bytes('--_n1')).toEqual(bytes('#fcfcfd'));
	});

	it('draws the two corners the whole card is built from', () => {
		seed('');

		expect(lengthOf('--_r')).toBe('8px');
		expect(lengthOf('--_r-in')).toBe('4px');
	});

	it('sets the form in the platform stack and loads no face of its own', () => {
		seed('');
		const stack = computed('font-family: var(--_font)', 'font-family');

		expect(stack).toContain('system-ui');
		expect(stack.endsWith('sans-serif')).toBe(true);
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

describe('the shade seed', () => {
	// a preset a host picks has to be a look they can see: the three hues are far enough apart
	// around the wheel that the steps carrying the most trace land on three different 8-bit
	// colours, which is the screen's own resolution rather than a difference only arithmetic finds.
	it('draws a ladder of its own under each shade', () => {
		const steps = (shade: string) => {
			seed(`--donate-shade: ${shade};`);
			return ['--_n6', '--_n9', '--_n12'].map((step) => bytes(step).join());
		};
		const [light, warm, cool] = SHADES.map(steps) as [string[], string[], string[]];

		for (const at of [0, 1, 2]) {
			expect(new Set([light[at], warm[at], cool[at]]).size).toBe(3);
		}
	});

	// the registration makes a keyword off the list invalid at computed-value time, so with nothing
	// above setting one what computes is the initial value, the card a host who set nothing gets.
	it('draws today’s ladder for a shade off the list', () => {
		seed('');
		const unseeded = RUNGS.map(oklchString);
		seed('--donate-shade: dark;');

		expect(RUNGS.map(oklchString)).toEqual(unseeded);
	});
});

describe('the corner seed', () => {
	// the card's corner, the corner of a control inside a box on it, the tick box's, which follows
	// the inner corner up to `soft`'s and no further so it never rounds toward a radio, and where a
	// floated label's band starts, which follows it down to `soft`'s and no further so a square box
	// keeps its edge.
	it.each([
		['square', ['0px', '0px', '0px', '4px']],
		['soft', ['8px', '4px', '4px', '4px']],
		['round', ['16px', '8px', '4px', '8px']],
		['a corner off the list', ['8px', '4px', '4px', '4px']]
	])('draws %s', (name, corners) => {
		const corner = name.includes(' ') ? 'pill' : name;
		seed(`--donate-corner: ${corner};`);

		expect(['--_r', '--_r-in', '--_r-box', '--_label-inset'].map(lengthOf)).toEqual(corners);
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
	// falls to its initial value, and what renders is a checkbox with no size or a spinner with no
	// ring rather than an error. that fallback is `0px` and it matches a length pattern, so the
	// assertion has to be a positive number — a drawn shape at zero is the same defect anyway.
	it('resolves every drawn shape to a real length', () => {
		const unresolved = [
			'--_mark',
			'--_box',
			'--_glyph-among',
			'--_glyph-beside',
			'--_spinner',
			'--_spinner-stroke',
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
