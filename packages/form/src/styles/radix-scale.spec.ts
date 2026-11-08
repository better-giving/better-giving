import { readFileSync } from 'node:fs';
import * as RadixColors from '@radix-ui/colors';
import { describe, expect, it } from 'vitest';
import { generateRadixColors } from './radix-generator.testing';
import { brandScaleCss, generateBrandScale, REGISTRY_GRAY_SEED } from './radix-scale';

// ./radix-scale.ts is a port of radix's custom-palette generator, and this is the spec that says
// whether it is one: every seed below goes through the generator as radix ships it
// (./radix-generator.testing.ts, on colorjs.io, bezier-easing and @radix-ui/colors) and through the
// port, and every output the card paints must come back identical — the twelve steps as sRGB hex,
// the twelve as wide-gamut `oklch()`, and the ink on the solid. identical is the tolerance: zero, at
// the precision the generator itself serializes (eight bits a channel; four significant digits of
// chroma and hue, lightness to a tenth of a percent).

/** the generator's inputs other than the seed: light, the registry's grey seed, a white page. */
const RADIX_INPUTS = {
	appearance: 'light',
	gray: REGISTRY_GRAY_SEED,
	background: '#ffffff'
} as const;

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
	['a near-black, slate 12', '#1c2024'],
	['the registered default, the registry’s accent 9', 'oklch(0.5198 0.1225 247.31)'],
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

/** a display-p3 seed from @radix-ui/colors' light p3 table, by scale and step. */
function p3Step(name: string, step: number): string {
	const value = Object.values(PALETTES[`${name}P3`] ?? {})[step - 1];
	if (value === undefined) throw new Error(`@radix-ui/colors has no ${name} p3 step ${step}`);
	return value;
}

/** the same seed with its first channel moved by a billionth: on no step, and a hair from this one. */
function offStep(seed: string): string {
	return seed.replace(/(display-p3 )([\d.]+)/, (_all, head: string, red: string) => {
		return `${head}${Number(red) + 1e-9}`;
	});
}

describe('a seed exactly on a radix step', () => {
	// what an engine hands back for `var(--blue-9)` from radix's own css on a display-p3 screen. the
	// generator's triangle has no side from the seed to the nearest step there, its mix ratio is 0/0,
	// and it draws a grey ramp from white to black. the port takes that scale alone, which is where
	// the generator lands for a seed a hair off the step.
	it.each([
		['blue 9', p3Step('blue', 9)],
		['teal 3', p3Step('teal', 3)],
		['slate 9, a grey', p3Step('slate', 9)],
		['sand 9, a grey', p3Step('sand', 9)]
	])(
		'draws the scale radix’s generator draws a hair off %s, where on it the generator greys the scale out',
		(_name, seed) => {
			const onStep = generateRadixColors({ ...RADIX_INPUTS, accent: seed });
			const port = generateBrandScale(seed);
			expect(port?.steps).not.toEqual(onStep.accentScale.map(longHex));

			const nearby = generateRadixColors({ ...RADIX_INPUTS, accent: offStep(seed) });
			expect(port?.steps).toEqual(nearby.accentScale.map(longHex));
			expect(port?.stepsWideGamut.slice(0, 8)).toEqual(nearby.accentScaleWideGamut.slice(0, 8));
			expect(port?.stepsWideGamut.slice(10)).toEqual(nearby.accentScaleWideGamut.slice(10));
			expect(port?.contrast).toEqual(longHex(nearby.accentContrast));
		}
	);
});

describe('a seed nearest a step two radix scales share', () => {
	// red 1 and tomato 1 are one colour, so for a seed nearest it the second-nearest scale sits on the
	// nearest's own step: the triangle has no side between them, and the generator greys the scale
	// out on the step and around it alike. there is no seed nearby to hold the port to, so it is held
	// to being a ramp: the seed's warm hue throughout, step 1 the lightest and every step darker on.
	it.each([
		['red 1 itself', p3Step('red', 1)],
		['red 1 as hex', '#fffcfc']
	])('draws a red ramp for %s, where radix’s generator greys the scale out', (_name, seed) => {
		const radix = generateRadixColors({ ...RADIX_INPUTS, accent: seed });
		expect(radix.accentScale[11]).toBe('#000');

		const port = generateBrandScale(seed);
		const steps = (port?.stepsWideGamut ?? []).map((step) => {
			const [, l = '', c = '', h = ''] = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(step) ?? [];
			return { l: Number(l), c: Number(c), h: Number(h) };
		});
		const ramp = [...steps.slice(0, 8), ...steps.slice(10)];
		expect(ramp).toHaveLength(10);
		for (const [i, step] of ramp.entries()) {
			expect(step.c, `step ${i}`).toBeGreaterThan(0);
			expect(step.h, `step ${i}`).toBeLessThan(40);
			if (i > 0) expect(step.l, `step ${i}`).toBeLessThan(ramp[i - 1]?.l ?? 0);
		}
	});
});

describe('where the port departs from radix’s generator on purpose', () => {
	// the generator keeps a seed's alpha in step 9, and lets a translucent black or white skip the
	// grey scale's tint; colorjs.io keeps `none` as NaN, which the generator reads as a grey. the card
	// paints an opaque step 9 and reads `none` as css paints it, as zero.
	it.each([
		['an 8-digit hex', '#0f766e80', '#0f766e'],
		['an rgba() the way an engine computes it', 'rgba(15, 118, 110, 0.5)', 'rgb(15, 118, 110)'],
		['a translucent black', '#00000080', '#000000'],
		['a translucent white', '#ffffff80', '#ffffff']
	])('drops the alpha of %s', (_name, seed, opaque) => {
		const port = generateBrandScale(seed);
		const radix = generateRadixColors({ ...RADIX_INPUTS, accent: opaque });
		expect(generateRadixColors({ ...RADIX_INPUTS, accent: seed }).accentScale).not.toEqual(
			radix.accentScale
		);

		expect(port?.steps).toEqual(radix.accentScale.map(longHex));
		expect(port?.stepsWideGamut).toEqual(radix.accentScaleWideGamut);
		expect(port?.contrast).toEqual(longHex(radix.accentContrast));
	});

	it.each([
		['a hue', 'oklch(0.6 0.15 none)', 'oklch(0.6 0.15 0)'],
		['a lightness', 'oklch(none 0.15 30)', 'oklch(0 0.15 30)'],
		['an rgb channel', 'rgb(none 118 110)', 'rgb(0 118 110)']
	])('reads `none` for %s as zero', (_name, seed, zeroed) => {
		const port = generateBrandScale(seed);
		const radix = generateRadixColors({ ...RADIX_INPUTS, accent: zeroed });

		expect(port?.steps).toEqual(radix.accentScale.map(longHex));
		expect(port?.stepsWideGamut).toEqual(radix.accentScaleWideGamut);
		expect(port?.contrast).toEqual(longHex(radix.accentContrast));
	});
});

describe('the registry’s default theme', () => {
	// the registry's scales are this generator's output, run by its CLI on the seeds the theme file's
	// head names. the port is what themes a seed a host sets at runtime, so it has to reproduce the
	// registry's own: the default accent seed in, the default accent scale out, step for step.
	const theme = readFileSync(
		new URL('../registry/styles/themes/default.css', import.meta.url),
		'utf8'
	);
	const light = theme.slice(0, theme.indexOf('}'));
	const seed = (name: string) => new RegExp(`--${name} '(#[0-9a-f]{6})'`).exec(theme)?.[1];
	const hexOf = (name: string) =>
		[...light.matchAll(new RegExp(`--${name}: [^;]+; /\\* (#[0-9a-f]{6}) \\*/`, 'g'))].map(
			([, hex]) => hex
		);

	it('names the grey seed the port is handed', () => {
		expect(seed('gray')).toBe(REGISTRY_GRAY_SEED);
	});

	it('comes out of the port as the registry’s accent scale and its ink, from the registry’s seed', () => {
		const accent = seed('accent');
		expect(accent).toBeDefined();
		const port = generateBrandScale(accent ?? '');
		const steps = Array.from({ length: 12 }, (_, i) => hexOf(`accent-${i + 1}`)[0]);

		expect(steps.every((hex) => hex !== undefined)).toBe(true);
		expect(port?.steps).toEqual(steps);
		expect(port?.contrast).toBe(hexOf('accent-contrast')[0]);
	});
});

describe('a seed the port does not read', () => {
	// the element draws these in relative colour instead (`brandCss` in ./brand.ts): notations no
	// engine hands back for a registered `<color>` it was given in another form, and strings that are
	// no colour at all.
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
	const css = brandScaleCss(':host > [data-theme]', scale);

	/** the declarations in one block of the css, by name. */
	function block(source: string): Record<string, string> {
		return Object.fromEntries(
			[...source.matchAll(/(--[\w-]+): ([^;]+);/g)].map(([, name, value]) => [name, value])
		);
	}

	it('sets every step of the registry’s accent and its ink, in sRGB for every display', () => {
		const [srgb = ''] = css.split('@supports');
		expect(srgb.startsWith(':host > [data-theme] {')).toBe(true);
		expect(block(srgb)).toEqual({
			...Object.fromEntries(scale.steps.map((value, i) => [`--accent-${i + 1}`, value])),
			'--accent-contrast': scale.contrast
		});
	});

	it('sets the wide-gamut steps for a display-p3 screen, as radix’s custom page does', () => {
		const [, wide = ''] = css.split('@supports');
		expect(wide.startsWith(' (color: color(display-p3 1 1 1)) { @media (color-gamut: p3) {')).toBe(
			true
		);
		expect(block(wide)).toEqual({
			...Object.fromEntries(scale.stepsWideGamut.map((value, i) => [`--accent-${i + 1}`, value])),
			'--accent-contrast': scale.contrast
		});
	});
});

/** the generator's hex as the six digits the port always writes; it collapses `#ffffff` to `#fff`. */
function longHex(hex: string): string {
	return hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex;
}
