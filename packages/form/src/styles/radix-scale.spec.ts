import * as RadixColors from '@radix-ui/colors';
import { describe, expect, it } from 'vitest';
import { generateRadixColors } from './radix-generator.testing';
import { brandScaleCss, generateBrandScale } from './radix-scale';

// ./radix-scale.ts is a port of radix's custom-palette generator, and this is the spec that says
// whether it is one: every seed below goes through the generator as radix ships it
// (./radix-generator.testing.ts, on colorjs.io, bezier-easing and @radix-ui/colors) and through the
// port, and every output the card paints must come back identical — the twelve steps as sRGB hex,
// the twelve as wide-gamut `oklch()`, and the ink on the solid. identical is the tolerance: zero, at
// the precision the generator itself serializes (eight bits a channel; four significant digits of
// chroma and hue, lightness to a tenth of a percent).

/** the generator's inputs other than the seed: light, slate's step 9 as the grey, a white page. */
const RADIX_INPUTS = { appearance: 'light', gray: '#8b8d98', background: '#ffffff' } as const;

const SCALE_NAMES = [
	'gray',
	'mauve',
	'slate',
	'sage',
	'olive',
	'sand',
	'tomato',
	'red',
	'ruby',
	'crimson',
	'pink',
	'plum',
	'purple',
	'violet',
	'iris',
	'indigo',
	'blue',
	'cyan',
	'teal',
	'jade',
	'green',
	'grass',
	'brown',
	'orange',
	'sky',
	'mint',
	'lime',
	'yellow',
	'amber'
] as const;

const PALETTES: Readonly<Record<string, Readonly<Record<string, string>>>> = RadixColors;

/** every radix scale's own step 9, light, as the sRGB hex @radix-ui/colors ships it. */
const RADIX_NINES = SCALE_NAMES.map((name) => {
	const nine = Object.values(PALETTES[name] ?? {})[8];
	if (nine === undefined) throw new Error(`@radix-ui/colors has no ${name} step 9`);
	return [`radix ${name} 9`, nine] as const;
});

const SEEDS: readonly (readonly [string, string])[] = [
	...RADIX_NINES,
	['the registered default, slate 12', '#1c2024'],
	['a mid grey', '#808080'],
	['a dark grey', '#333333'],
	['a light grey', '#cccccc'],
	['black', '#000000'],
	['white', '#ffffff'],
	['a near-white', '#fafafa'],
	['a near-black navy', '#0b1d3a'],
	['a pastel pink', '#ffd1dc'],
	['a pastel green', '#c1e1c1'],
	['a pastel yellow', '#fdfd96'],
	['a pastel blue', '#aec6cf'],
	['a neon green', '#39ff14'],
	['a neon red', '#ff073a'],
	['a neon pink', '#fe019a'],
	['cyan', '#00ffff'],
	['a teal the way an engine computes it', 'rgb(15, 118, 110)'],
	['a short hex', '#f0a'],
	['p3 green, outside sRGB', 'color(display-p3 0 1 0)'],
	['p3 magenta, outside sRGB', 'color(display-p3 1 0 0.5)'],
	['an oklch neon green outside sRGB', 'oklch(0.92 0.28 140)'],
	['an oklch neon magenta outside sRGB', 'oklch(0.7 0.35 330)'],
	['a seed just under white ink’s reach', 'oklch(0.72 0.15 190)'],
	['a seed just over it', 'oklch(0.74 0.15 25)']
];

describe('the brand scale against radix’s own generator', () => {
	it('covers forty seeds or more', () => {
		expect(SEEDS.length).toBeGreaterThanOrEqual(40);
	});

	it.each(SEEDS)('matches every output for %s', (_name, seed) => {
		const radix = generateRadixColors({ ...RADIX_INPUTS, accent: seed });
		const port = generateBrandScale(seed);

		expect(port).not.toBeNull();
		expect(port?.steps).toEqual(radix.accentScale.map(longHex));
		expect(port?.stepsWideGamut).toEqual(radix.accentScaleWideGamut);
		expect(port?.contrast).toEqual(longHex(radix.accentContrast));
	});
});

describe('a seed the port does not read', () => {
	// the element leaves ./tokens.css's fallback scale standing for these rather than painting a
	// guess: notations no engine hands back for a registered `<color>` it was given in another form,
	// and strings that are no colour at all.
	it.each([
		['a cie lab colour', 'lab(50% 40 30)'],
		['a rec2020 colour', 'color(rec2020 0.5 0.2 0.1)'],
		['a keyword', 'rebeccapurple'],
		['a truncated hex', '#12'],
		['a channel that is no number', 'rgb(1, two, 3)'],
		['nothing', '']
	])('is no scale for %s', (_name, seed) => {
		expect(generateBrandScale(seed)).toBeNull();
	});
});

describe('the scale as css', () => {
	const scale = generateBrandScale('#0f766e');
	if (scale === null) throw new Error('#0f766e is a seed the port reads');
	const css = brandScaleCss(':host', scale);

	/** the declarations in one block of the css, by name. */
	function block(source: string): Record<string, string> {
		return Object.fromEntries(
			[...source.matchAll(/(--_[\w-]+): ([^;]+);/g)].map(([, name, value]) => [name, value])
		);
	}

	it('sets every step, the solid pair and the ink, in sRGB for every display', () => {
		const [srgb = ''] = css.split('@supports');
		expect(srgb.startsWith(':host {')).toBe(true);
		expect(block(srgb)).toEqual({
			...Object.fromEntries(scale.steps.map((value, i) => [`--_a${i + 1}`, value])),
			'--_p': scale.steps[8],
			'--_p-hover': scale.steps[9],
			'--_on-p': scale.contrast
		});
	});

	it('sets the wide-gamut steps for a display-p3 screen, as radix’s custom page does', () => {
		const [, wide = ''] = css.split('@supports');
		expect(wide.startsWith(' (color: color(display-p3 1 1 1)) { @media (color-gamut: p3) {')).toBe(
			true
		);
		expect(block(wide)).toEqual({
			...Object.fromEntries(scale.stepsWideGamut.map((value, i) => [`--_a${i + 1}`, value])),
			'--_p': scale.stepsWideGamut[8],
			'--_p-hover': scale.stepsWideGamut[9],
			'--_on-p': scale.contrast
		});
	});
});

/** the generator's hex as the six digits the port always writes; it collapses `#ffffff` to `#fff`. */
function longHex(hex: string): string {
	return hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex;
}
