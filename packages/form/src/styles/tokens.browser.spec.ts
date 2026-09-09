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

const sheet = new CSSStyleSheet();
sheet.replaceSync(tokens);

/** the seed's own roles: each a solid step of the clamped brand, never an alpha of it. */
const PRIMARY = ['--_p', '--_p-hover', '--_p-press', '--_on-p'];

/** the twelve rungs in order, rung 1 first. */
const RUNGS = [
	'--_n1',
	'--_n2',
	'--_n3',
	'--_n4',
	'--_n5',
	'--_n6',
	'--_n7',
	'--_n8',
	'--_n9',
	'--_n10',
	'--_n11',
	'--_n12'
];

/** the twelve fixed steps, plus the root they are derived from and the three named edges. */
const NEUTRAL = [
	'--_s',
	'--_n1',
	'--_n2',
	'--_n3',
	'--_n4',
	'--_n5',
	'--_n6',
	'--_n7',
	'--_n8',
	'--_n9',
	'--_n10',
	'--_n11',
	'--_n12',
	'--_edge-control',
	'--_edge-unavailable',
	'--_focus-ring'
];

/**
 * fixed literals with no relation to any seed: legibility is not allowed to depend on a host. two
 * bands and not three — the card reports success by drawing the receipt, so there is no green
 * band. a band is a rule and a ground; `--_bad` is the third name only because refusal is also
 * drawn on the control itself, and attention marks no control. "carries no step nothing spends"
 * in ../element.dom.spec.ts is what keeps a fourth from sitting here unread.
 */
const SEMANTIC = ['--_bad', '--_bad-line', '--_bad-tint', '--_warn-line', '--_warn-tint'];

const COLOR_TOKENS = [...PRIMARY, ...NEUTRAL, ...SEMANTIC];

/**
 * the clamp band tokens.css narrows the seed's lightness into. the floor is the ladder's own
 * darkest rung, so the registered default computes to itself; the ceiling is where a near-white
 * stops clearing 4.5:1 on the fill, which is the tighter of the two readings the band carries.
 */
const BAND = { low: 0.27, high: 0.5 };

/** the registered `initial-value` of the seed: the ladder's darkest rung. */
const DEFAULT_SEED = { l: 0.27, c: 0, h: 0 };

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

/** resolves one declaration against the real cascade and reads a property back off it. */
function computed(declaration: string, property: string): string {
	probe.style.cssText = declaration;
	return getComputedStyle(probe).getPropertyValue(property);
}

/** the token, forced through an `oklch()` output so the engine has to evaluate it. */
function oklchString(token: string): string {
	return computed(`color: oklch(from var(${token}) l c h)`, 'color');
}

type Oklch = { l: number; c: number; h: number };

const OKLCH = /^oklch\(\s*(\S+)\s+(\S+)\s+([^\s/)]+)/;

function channel(raw: string, percentBase: number): number {
	if (raw === 'none') return 0;
	if (raw.endsWith('%')) return (Number(raw.slice(0, -1)) / 100) * percentBase;
	return Number(raw);
}

/**
 * the token as three numbers, or `null` when it did not resolve to a color at all.
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

function oklchOf(token: string): Oklch {
	const serialized = oklchString(token);
	const parsed = parseOklch(serialized);
	if (parsed === null) throw new Error(`${token} did not resolve to a color: "${serialized}"`);
	return parsed;
}

const SRGB = /^color\(srgb\s+(\S+)\s+(\S+)\s+([^\s/)]+)/;

/** the token converted into sRGB channels, which is the space WCAG contrast is defined in. */
function srgbOf(token: string): [number, number, number] {
	const serialized = computed(`color: color(from var(${token}) srgb r g b)`, 'color');
	const match = SRGB.exec(serialized);
	const [, r, g, b] = match ?? [];
	if (r === undefined || g === undefined || b === undefined) {
		throw new Error(`${token} did not resolve to a color: "${serialized}"`);
	}
	return [Number(r), Number(g), Number(b)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
	// a seed outside the sRGB gamut converts to channels outside [0, 1]; a screen shows the
	// clamped value, so the contrast a donor sees is the clamped one.
	const linear = (channelValue: number) => {
		const v = Math.min(Math.max(channelValue, 0), 1);
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
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
		// at all rather than one drawn in the registered grey.
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

	it('declares none of the private layer anywhere else in the document', () => {
		const reaching = COLOR_TOKENS.filter((token) => resolvesOn(outside, token));

		// a selector matching in the document tree at large would hand a host page every `--_` name
		// this file derives, which is the reading `:host` alone made impossible.
		expect(reaching).toEqual([]);
	});
});

describe('the derived ramp', () => {
	it('resolves every derived step to a real color', () => {
		const unresolved = COLOR_TOKENS.filter((token) => parseOklch(oklchString(token)) === null);

		expect(unresolved).toEqual([]);
	});

	it('keeps every derived step inside a displayable lightness', () => {
		const outOfRange = COLOR_TOKENS.filter((token) => {
			const { l } = oklchOf(token);
			return l < 0 || l > 1;
		});

		expect(outOfRange).toEqual([]);
	});

	it('carries the brand hue through every role the seed has', () => {
		seed('--donate-primary: oklch(0.5 0.14 300);');

		for (const token of PRIMARY) {
			expect(oklchOf(token).h, token).toBeCloseTo(300, 0);
		}
	});

	it('leaves the neutral steps alone whatever the brand is', () => {
		// the ladder is the form's own and the seed reaches none of it, which is what makes every
		// neutral reading in ./tokens.css a single number rather than a floor across a band. a
		// derivation accidentally reintroduced would show up here as a hue following the brand.
		seed('--donate-primary: oklch(0.5 0.25 300);');
		const seeded = RUNGS.map((token) => oklchOf(token).h);
		seed('');

		expect(RUNGS.map((token) => oklchOf(token).h)).toEqual(seeded);
	});

	it('gives the neutral steps a trace of chroma, never a colour', () => {
		seed('');

		// the root carries a trace and the dark rungs double it, so the ladder reads as a grey
		// leaning one way rather than as a second colour on the card.
		expect(oklchOf('--_n12').c).toBeLessThanOrEqual(0.004 + 1e-4);
		expect(oklchOf('--_n12').c).toBeGreaterThan(0);
	});
});

describe('the neutral ladder', () => {
	// the whole of what makes a rung number mean something: a reader who knows rung 7 is a border
	// and rung 11 is text knows it without reading a legend, and that only holds while the ladder
	// runs one way. a rung that crossed its neighbour would leave two numbers claiming one shade.
	it('runs from lightest to darkest with no rung crossing its neighbour', () => {
		const crossings = RUNGS.filter((token, index) => {
			const next = RUNGS[index + 1];
			return next !== undefined && oklchOf(next).l >= oklchOf(token).l;
		});

		expect(crossings).toEqual([]);
	});

	// where the ladder turns, and it is the decision the rung meanings rest on. rungs 1 to 8 are
	// grounds, hovers, separators and the one hairline every box on this card is drawn with — every
	// one of them is a shade of the card, and none may be drawn as a word.
	it('keeps every rung above the solid rung off the card by less than 3:1', () => {
		seed('');
		const card = srgbOf('--_n1');
		const tooDark = RUNGS.slice(0, 8).filter((token) => contrastRatio(srgbOf(token), card) >= 3);

		expect(tooDark).toEqual([]);
	});

	// rung 9 is the solid rung: dark enough to be a ground a near-white stands on, and never a word.
	// it sits between the two floors and is the last rung that does, which is what makes the number
	// it reaches worth holding rather than incidental.
	it('leaves the solid rung between the two floors', () => {
		seed('');
		const onCard = contrastRatio(srgbOf('--_n9'), srgbOf('--_n1'));

		expect(onCard).toBeGreaterThanOrEqual(3);
		expect(onCard).toBeLessThan(4.5);
	});

	// the three inks stay three. rung 10 is cut below its own distribution to carry the quietest of
	// them (./tokens.css argues it), and a cut that went far enough to merge it with rung 11 would
	// buy the floor by spending the level of hierarchy it was cut for.
	it('keeps the three ink rungs apart from each other', () => {
		seed('');

		expect(contrastRatio(srgbOf('--_n10'), srgbOf('--_n11'))).toBeGreaterThanOrEqual(1.2);
		expect(contrastRatio(srgbOf('--_n11'), srgbOf('--_n12'))).toBeGreaterThanOrEqual(1.2);
	});
});

describe('the primary clamp band', () => {
	it('darkens a seed lighter than the band', () => {
		seed('--donate-primary: oklch(0.95 0.25 140);');
		const { l } = oklchOf('--_p');

		expect(l).toBeLessThanOrEqual(BAND.high + 1e-4);
		expect(l).toBeGreaterThanOrEqual(BAND.low - 1e-4);
	});

	it('lightens a seed darker than the band', () => {
		seed('--donate-primary: oklch(0.05 0.2 300);');
		const { l } = oklchOf('--_p');

		expect(l).toBeGreaterThanOrEqual(BAND.low - 1e-4);
		expect(l).toBeLessThanOrEqual(BAND.high + 1e-4);
	});

	it('caps the chroma of an over-saturated seed', () => {
		seed('--donate-primary: oklch(0.5 0.37 30);');

		expect(oklchOf('--_p').c).toBeLessThanOrEqual(0.16 + 1e-4);
	});

	it('leaves an achromatic seed achromatic', () => {
		// the chroma floor reaches zero, which is the whole of how a card carries no hue: a floor
		// above it would tint a grey brand, and the registered default is a grey brand.
		seed('--donate-primary: oklch(0.5 0 0);');

		expect(oklchOf('--_p').c).toBe(0);
	});

	it('leaves a seed already inside the band alone', () => {
		seed('--donate-primary: oklch(0.44 0.09 210);');
		const { l, c, h } = oklchOf('--_p');

		expect(l).toBeCloseTo(0.44, 3);
		expect(c).toBeCloseTo(0.09, 3);
		expect(h).toBeCloseTo(210, 0);
	});

	// the two steps a fill answers a pointer with are a constant lightness apart, so the contrast
	// they buy narrows as the band darkens — oklch lightness is perceptually even and a WCAG ratio
	// is not. the floor is where that narrowing bottoms out, and it is the number a later change to
	// either step has to beat rather than a guarantee anything else rests on.
	it.each([
		['at the floor', '--donate-primary: oklch(0.1 0.3 250);', 1.08, 1.14],
		['at the ceiling', '--donate-primary: oklch(0.5 0.16 190);', 1.25, 1.5]
	])('keeps the hover and press steps apart from the fill %s', (_n, decls, hover, press) => {
		seed(decls);
		const fill = srgbOf('--_p');

		expect(contrastRatio(srgbOf('--_p-hover'), fill)).toBeGreaterThanOrEqual(hover);
		expect(contrastRatio(srgbOf('--_p-press'), fill)).toBeGreaterThanOrEqual(press);
	});
});

describe('the one seed', () => {
	// the card a host who seeded nothing gets, and it is the reason the chroma floor reaches zero.
	//
	// measured against one 8-bit step rather than against zero. a grey authored in oklch does not
	// come back out of the srgb conversion with its three channels bit-identical — the round trip
	// leaves a spread around 4e-5, which is a hundredth of the smallest difference a screen can
	// draw. the bound still decides the question this test asks: a chroma floor of 0.02 spreads the
	// channels by an order of magnitude more than a step and is a tint anyone can see.
	//
	// `--_on-p` is the one step left out. it carries a fixed trace of chroma whatever the fill
	// does, which its own entry in ./tokens.css states, so it is held to a bound of its own.
	it('draws no brand hue at all when nothing is seeded', () => {
		seed('');
		const ONE_BYTE = 1 / 255;
		const spread = (token: string) => {
			const [r, g, b] = srgbOf(token);
			return Math.max(r, g, b) - Math.min(r, g, b);
		};

		for (const token of ['--_p', '--_p-hover', '--_p-press']) {
			expect(spread(token), token).toBeLessThan(ONE_BYTE);
		}
		expect(spread('--_on-p')).toBeLessThan(3 * ONE_BYTE);
	});
});

describe('the primary as ink on the card', () => {
	// the brand is a word twice on this card — the quiet action, and the figure or label on a chosen
	// amount or frequency — so the whole band it may be seeded to carries the text floor against the
	// card. it is the looser of the two readings that bound the band (the fill's own foreground is
	// the tighter, swept below), and the sweep is the point: the worst corner is a saturated cyan,
	// and a value picked off one seed is a value a host moves.
	it.each([
		['unseeded', ''],
		['a neon brand', '--donate-primary: oklch(0.92 0.28 140);'],
		['the cyan end of the band', '--donate-primary: oklch(0.5 0.3 191);'],
		['a yellow brand', '--donate-primary: oklch(0.86 0.18 100);'],
		['a magenta brand', '--donate-primary: oklch(0.7 0.3 330);'],
		['white', '--donate-primary: #ffffff;'],
		['a cyan brand at the worst corner of the band', '--donate-primary: oklch(0.5 0.16 190);']
	])('the primary reads as ink on the card for %s', (_name, declarations) => {
		seed(declarations);

		expect(contrastRatio(srgbOf('--_p'), srgbOf('--_n1'))).toBeGreaterThanOrEqual(4.5);
	});

	// the same ink as a fill, which is the step head's current mark: a shape a donor reads rather
	// than a word, so it carries a boundary's floor rather than a text one.
	it.each([
		['unseeded', ''],
		['the cyan end of the band', '--donate-primary: oklch(0.5 0.3 191);'],
		['a yellow brand', '--donate-primary: oklch(0.86 0.18 100);']
	])('the primary reads as a mark on the card for %s', (_name, declarations) => {
		seed(declarations);

		expect(contrastRatio(srgbOf('--_p'), srgbOf('--_n1'))).toBeGreaterThanOrEqual(3);
	});
});

describe('the focus ring', () => {
	// where the caret is standing, and it is a rung rather than the brand: nothing a host writes
	// moves it, which is why these are single readings. it is drawn on four grounds, because a
	// keyboard donor can be hovering or pressing what they have tabbed onto — the card, the receipt
	// block the fee switch stands in, and an option's own fill at rest, under the pointer and under
	// the press. 3:1 is the floor a boundary carries; the ring clears it by an order of magnitude,
	// which is the whole point of taking the darkest rung for it.
	it('clears 3:1 on every ground it is drawn on', () => {
		seed('');

		for (const ground of ['--_n1', '--_n2', '--_n3', '--_n4', '--_n5']) {
			const measured = contrastRatio(srgbOf('--_focus-ring'), srgbOf(ground));
			expect(measured, ground).toBeGreaterThanOrEqual(3);
		}
	});

	// a focused field recolours its own border to the ring as well as drawing one outside it
	// (`[part~='field']:focus-visible` in ./parts.css). a ring token that landed on
	// `--_edge-control` would make that recolour a no-op — the edge would change to the colour it
	// already was — so the two being distinct is the rule rather than a happy accident.
	it('is a step a focused field can actually recolour its own edge to', () => {
		seed('');

		expect(
			contrastRatio(srgbOf('--_focus-ring'), srgbOf('--_edge-control'))
		).toBeGreaterThanOrEqual(2.5);
	});

	// the one adjacency this system never allows, and the reason a `--_p`-filled control rings
	// itself inside instead: the ring is the ladder's darkest rung and the seed's band reaches that
	// same darkness at its floor, so a ring laid outside such a fill is the fill continuing outward.
	// ./tokens.css argues it at `--_on-p` and at `--_focus-ring`; this is the measurement.
	it('is indistinguishable from a fill at the band floor, which is why it is never laid on one', () => {
		seed('--donate-primary: oklch(0.05 0 0);');

		expect(contrastRatio(srgbOf('--_focus-ring'), srgbOf('--_p'))).toBeLessThan(1.5);
	});

	// and what keeps the two apart wherever a marked control does put them one pixel apart: the
	// `--_n1` band laid between a primary edge and the ring outside it (the four two-tone blocks in
	// ./parts.css). it is the hairline doing the separating, not the two darks.
	it('is separated from a primary edge by a band that clears both', () => {
		seed('--donate-primary: oklch(0.27 0 0);');
		const band = srgbOf('--_n1');

		expect(contrastRatio(band, srgbOf('--_focus-ring'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(band, srgbOf('--_p'))).toBeGreaterThanOrEqual(4.5);
	});
});

describe('on-primary', () => {
	// the band is what makes this unconditional: nothing in the component selects a foreground
	// for contrast, because a fill lighter than the band's ceiling never exists.
	it.each([
		['unseeded', ''],
		['a neon brand', '--donate-primary: oklch(0.92 0.28 140);'],
		['a near-black brand', '--donate-primary: oklch(0.06 0.02 260);'],
		['an over-saturated brand', '--donate-primary: oklch(0.5 0.37 25);'],
		['white', '--donate-primary: #ffffff;'],
		['black', '--donate-primary: #000000;'],
		['a gray brand', '--donate-primary: oklch(0.5 0 0);'],
		['a yellow brand', '--donate-primary: oklch(0.86 0.18 100);'],
		['a magenta brand', '--donate-primary: oklch(0.7 0.3 330);'],
		['a blue brand', '--donate-primary: oklch(0.45 0.2 265);'],
		['a cyan brand', '--donate-primary: oklch(0.7 0.3 191);'],
		['a teal brand at the ceiling', '--donate-primary: oklch(0.5 0.16 178);'],
		['a cyan brand at the worst corner of the band', '--donate-primary: oklch(0.5 0.16 188);'],
		['a brand at the floor', '--donate-primary: oklch(0.1 0.3 250);']
	])('clears 4.5:1 against the primary fill for %s', (_name, declarations) => {
		seed(declarations);

		expect(contrastRatio(srgbOf('--_on-p'), srgbOf('--_p'))).toBeGreaterThanOrEqual(4.5);
	});
});

describe('text on the card', () => {
	// every neutral step the sheets actually set words in. `--_n10` is the smallest of them — the
	// "(optional)" beside a label, an aside, the note under the fee — and it is the one this exists
	// to hold, because it is authored below its own distribution to reach the floor at all. the
	// brand is absent here and swept on its own above: it is the one ink a host moves.
	it('clears 4.5:1 on the card', () => {
		seed('');
		const card = srgbOf('--_n1');

		for (const token of ['--_n10', '--_n11', '--_n12']) {
			expect(contrastRatio(srgbOf(token), card), token).toBeGreaterThanOrEqual(4.5);
		}
	});

	// the card is not the only ground a word is drawn on, and a floor read against `--_n1` alone
	// says nothing about the others. the receipt block is `--_n2` and carries the ledger's labels,
	// its notes and the quoted mandate; the denominations are `--_n3` and step to `--_n4` and
	// `--_n5` under the pointer, carrying their figure the whole way.
	it('clears 4.5:1 on every other ground a word is drawn on', () => {
		seed('');
		const pairs: [string, string][] = [
			['--_n10', '--_n2'],
			['--_n11', '--_n2'],
			['--_n12', '--_n2'],
			['--_n11', '--_n3'],
			['--_n11', '--_n4'],
			['--_n12', '--_n3'],
			['--_n12', '--_n4'],
			['--_n12', '--_n5']
		];

		for (const [ink, ground] of pairs) {
			const measured = contrastRatio(srgbOf(ink), srgbOf(ground));
			expect(measured, `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	// the two fixed tints are literals with no relation to any seed, and the ink standing on them is
	// a step that rides one — so these are the one place in the file where only one side moves. the
	// attention band is not only the takeover's: a receipt whose total was corrected takes it under
	// the whole block, so the ledger's own labels and its notes are drawn on it too.
	it('clears 4.5:1 for the ink on an attention or error band', () => {
		seed('');

		expect(contrastRatio(srgbOf('--_n10'), srgbOf('--_warn-tint'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(srgbOf('--_n11'), srgbOf('--_warn-tint'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(srgbOf('--_n12'), srgbOf('--_warn-tint'))).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(srgbOf('--_n11'), srgbOf('--_bad-tint'))).toBeGreaterThanOrEqual(4.5);
	});

	// one hairline shade for every box on the card: a field, a rail and the box the provider paints
	// into are drawn with the rung the amount tray and the cadence track carry, so a field reads as
	// the same kind of box the tiles stand in. no floor is asserted and none is claimed — the edge
	// is a look, which ./tokens.css says at the token itself; what is held here is that the two
	// have not been allowed to drift apart into two hairlines.
	it('draws a control boundary at the rung the trays are drawn with', () => {
		seed('');

		expect(srgbOf('--_edge-control')).toEqual(srgbOf('--_n7'));
	});

	// a boundary under the pointer steps down the ladder rather than up it. every bordered control
	// on this card answers a hover by stepping to `--_n11` and the switch's track carries on to
	// `--_n12` under the press, and both of those are darker than the card by a margin the resting
	// edge does not have — a hover that stepped the other way would be a control receding under the
	// hand that reached for it.
	it('holds the two steps a boundary answers a pointer with well clear of the card', () => {
		seed('');
		const card = srgbOf('--_n1');

		expect(contrastRatio(srgbOf('--_n11'), card)).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(srgbOf('--_n12'), card)).toBeGreaterThanOrEqual(3);
	});

	// the decision itself, not a consequence of it: at a boundary, unavailable is drawn at exactly
	// the available value. no control here is ever rendered `disabled` (../checkout.machine.ts), so
	// an unavailable one is still focusable and a donor can tab onto a shape and ring it — and the
	// available edge is already as light as a boundary on this card goes, so there is no quieter
	// step to move the state to. it is carried in the stroke's
	// pattern instead (`.step-mark` in ./parts.css). a change here that makes these two differ is a
	// re-decision, and this is where it has to be argued.
	it('draws an unavailable boundary at exactly the available one', () => {
		seed('');

		expect(srgbOf('--_edge-unavailable')).toEqual(srgbOf('--_edge-control'));
	});

	// the one pair the switch introduces. its thumb is `--_on-p` on both tracks: against `--_p` that
	// is the 4.5:1 swept above, and against the off track it is this — the thumb is where the
	// decision is read from, so it carries a boundary's floor against the fill it stands on.
	it.each([
		['unseeded', ''],
		['a neon brand', '--donate-primary: oklch(0.92 0.28 140);'],
		['a red brand', '--donate-primary: oklch(0.5 0.2 20);'],
		['a cyan brand at the worst corner of the band', '--donate-primary: oklch(0.5 0.16 190);']
	])('clears 3:1 for the switch thumb on its off track for %s', (_name, declarations) => {
		seed(declarations);

		// all three fills the off track takes: at rest, under the pointer, under the press. the
		// thumb is where the decision is read from and it does not change with any of them.
		for (const track of ['--_n10', '--_n11', '--_n12']) {
			const measured = contrastRatio(srgbOf('--_on-p'), srgbOf(track));
			expect(measured, track).toBeGreaterThanOrEqual(3);
		}
	});
});

describe('the lift', () => {
	// the one elevation this component draws, and the bound it was admitted under rather than its
	// geometry: a solid rung of the card's own ladder and never an alpha of black. the file-level ban
	// on alpha is what this holds — a translucent shade takes on whatever the host put behind the
	// card, and a rung is a shade the component knows the ground for.
	it('draws the lift in a solid rung of the card ladder', () => {
		seed('');
		const shadow = computed('box-shadow: var(--_lift)', 'box-shadow');

		expect(shadow).toContain(computed('color: var(--_n7)', 'color'));
		// an alpha channel serializes as a slash in a modern color function and as `rgba(` in a
		// legacy one, so both spellings are the failure.
		expect(shadow).not.toMatch(/\/|rgba/);
	});
});

describe('a malformed seed', () => {
	it("falls back to the seed's initial value", () => {
		seed('--donate-primary: not-a-color;');
		const seedColor = oklchOf('--donate-primary');

		expect(seedColor.l).toBeCloseTo(DEFAULT_SEED.l, 3);
		expect(seedColor.c).toBeCloseTo(DEFAULT_SEED.c, 3);
		expect(seedColor.h).toBeCloseTo(DEFAULT_SEED.h, 0);
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
		const unseeded = oklchOf('--_n12');
		seed('--donate-primary: rgb(0 0);');
		const rejected = oklchOf('--_n12');

		expect(rejected.l).toBeCloseTo(unseeded.l, 4);
		expect(rejected.c).toBeCloseTo(unseeded.c, 4);
		expect(rejected.h).toBeCloseTo(unseeded.h, 2);
	});
});

describe('the card the form draws for itself', () => {
	// the seed is a colour and nothing else, so everything a host once reached is now the form's own
	// literal. these are the four that were seeds: a rule that reintroduces one shows up here as a
	// value that moved.
	it('paints the card at one lightness whatever the brand is', () => {
		seed('--donate-primary: oklch(0.45 0.2 265);');

		expect(oklchOf('--_n1').l).toBeCloseTo(0.995, 3);
		expect(oklchOf('--_s').l).toBeCloseTo(0.995, 3);
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

	// the step marks take `--_r` and the engine reduces a corner over half the box to that half, so
	// 8px draws a circle at every root the clamp allows rather than a rounded square.
	it('draws the step marks as circles at every root', () => {
		seed('');

		expect(parseFloat(lengthOf('--_mark')) / 2).toBeLessThan(8);
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
