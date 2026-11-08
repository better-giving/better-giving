// radix's custom-palette generator, light only, ported with no dependency: one brand colour in, the
// twelve-step accent scale out — the design registry's `--accent-1`…`--accent-12` and
// `--accent-contrast`, the ink on the solid (../registry/styles/variables.usage.md).
//
// the registry's own scales come from this same generator, run by its CLI (`theme:generate`) at
// build time; the registry ships no runtime generator and no seed hook, so a colour a host page
// seeds at runtime is put through this port instead. ./radix-scale.spec.ts holds the port to the
// registry: the registry's default accent seed comes out as the registry's default accent scale.
//
// the source is components/generate-radix-colors.tsx in https://github.com/radix-ui/website, the
// code behind https://www.radix-ui.com/colors/custom. its light path — `generateRadixColors`,
// `getScaleFromColor`, `getStep9Colors`, `getButtonHoverColor`, `getTextColor` and the easing
// transposition — is here with its inputs fixed but the seed: the seed as the accent, the
// registry's grey seed as the grey and white as the background, the inputs the registry's default
// theme was generated with (the head of ../registry/styles/themes/default.css). the
// colour arithmetic it borrows from colorjs.io 0.5.2 (oklab, oklch, deltaEOK, the css gamut
// mapping, APCA) and the curve it borrows from bezier-easing 2.1.0 are ported beside it, operation
// for operation, so a step comes out bit for bit what the generator writes —
// ./radix-scale.spec.ts runs the original on its own dependencies against this and holds every
// output identical. it departs in three places, each held by a spec of its own: a seed's alpha and
// a `none` channel (`parseSeed`), and a seed with no triangle to mix by (`mixRatio`). the radix
// light scales the generator searches are @radix-ui/colors 3.0.0's display-p3 values, copied below.
//
// nothing here touches a document. the element runs it in the browser (./brand.ts) and the
// deployment's own donor pages run it on the server, so the two draw one scale from one seed.
//
// generate-radix-colors.tsx and @radix-ui/colors: Copyright (c) 2024 WorkOS.
// colorjs.io: Copyright (c) 2021 Lea Verou, Chris Lilley.
// bezier-easing: Copyright (c) 2014 Gaëtan Renaudeau.
// each is MIT licensed, and for the portions of each in this file:
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/** a colour's three coordinates. an oklch hue is `NaN` where colorjs.io calls it powerless. */
type Coords = [number, number, number];

/** the spaces a seed can arrive in; everything past the parse is oklch. */
type Space = 'srgb' | 'srgb-linear' | 'p3' | 'oklab' | 'oklch';

type Scale = Coords[];

/** what the card is painted with, one scale per seed. */
export type BrandScale = {
	/** steps 1 to 12 as six-digit sRGB hex, gamut-mapped the way the generator maps them. */
	readonly steps: readonly string[];
	/** steps 1 to 12 as `oklch()`, for a display that shows past sRGB. */
	readonly stepsWideGamut: readonly string[];
	/** the ink on steps 9 and 10, as six-digit sRGB hex. */
	readonly contrast: string;
};

const GRAY_SCALE_NAMES = ['gray', 'mauve', 'slate', 'sage', 'olive', 'sand'] as const;

/**
 * @radix-ui/colors 3.0.0's light scales in display-p3, steps 1 to 12, in the generator's own order —
 * the order is load-bearing: its nearest-scale search keeps the first of two equal distances.
 */
const RADIX_LIGHT_P3: Readonly<Record<string, string>> = {
	gray: '0.988 0.988 0.988,0.975 0.975 0.975,0.939 0.939 0.939,0.908 0.908 0.908,0.88 0.88 0.88,0.849 0.849 0.849,0.807 0.807 0.807,0.732 0.732 0.732,0.553 0.553 0.553,0.512 0.512 0.512,0.392 0.392 0.392,0.125 0.125 0.125',
	mauve:
		'0.991 0.988 0.992,0.98 0.976 0.984,0.946 0.938 0.952,0.915 0.906 0.925,0.886 0.876 0.901,0.856 0.846 0.875,0.814 0.804 0.84,0.735 0.728 0.777,0.555 0.549 0.596,0.514 0.508 0.552,0.395 0.388 0.424,0.128 0.122 0.147',
	slate:
		'0.988 0.988 0.992,0.976 0.976 0.984,0.94 0.941 0.953,0.908 0.909 0.925,0.88 0.881 0.901,0.85 0.852 0.876,0.805 0.808 0.838,0.727 0.733 0.773,0.547 0.553 0.592,0.503 0.512 0.549,0.379 0.392 0.421,0.113 0.125 0.14',
	sage: '0.986 0.992 0.988,0.97 0.977 0.974,0.935 0.944 0.94,0.904 0.913 0.909,0.875 0.885 0.88,0.844 0.854 0.849,0.8 0.811 0.806,0.725 0.738 0.732,0.531 0.556 0.546,0.492 0.515 0.506,0.377 0.395 0.389,0.107 0.129 0.118',
	olive:
		'0.989 0.992 0.989,0.974 0.98 0.973,0.939 0.945 0.937,0.907 0.914 0.905,0.878 0.885 0.875,0.846 0.855 0.843,0.803 0.812 0.8,0.727 0.738 0.723,0.541 0.556 0.532,0.5 0.515 0.491,0.38 0.395 0.374,0.117 0.129 0.111',
	sand: '0.992 0.992 0.989,0.977 0.977 0.973,0.943 0.942 0.936,0.913 0.912 0.903,0.885 0.883 0.873,0.854 0.852 0.839,0.813 0.81 0.794,0.738 0.734 0.713,0.553 0.553 0.528,0.511 0.511 0.488,0.388 0.388 0.37,0.129 0.126 0.111',
	tomato:
		'0.998 0.989 0.988,0.994 0.974 0.969,0.985 0.924 0.909,0.996 0.868 0.835,0.98 0.812 0.77,0.953 0.75 0.698,0.917 0.673 0.611,0.875 0.575 0.502,0.831 0.345 0.231,0.802 0.313 0.2,0.755 0.259 0.152,0.335 0.165 0.132',
	red: '0.998 0.989 0.988,0.995 0.971 0.971,0.985 0.925 0.925,0.999 0.866 0.866,0.984 0.812 0.811,0.955 0.751 0.749,0.915 0.675 0.672,0.872 0.575 0.572,0.83 0.329 0.324,0.798 0.294 0.285,0.744 0.234 0.222,0.36 0.115 0.143',
	ruby: '0.998 0.989 0.992,0.995 0.971 0.974,0.983 0.92 0.928,0.987 0.869 0.885,0.968 0.817 0.839,0.937 0.758 0.786,0.897 0.685 0.721,0.851 0.588 0.639,0.83 0.323 0.408,0.795 0.286 0.375,0.728 0.211 0.311,0.36 0.115 0.171',
	crimson:
		'0.998 0.989 0.992,0.991 0.969 0.976,0.987 0.917 0.941,0.975 0.866 0.904,0.953 0.813 0.864,0.921 0.755 0.817,0.88 0.683 0.761,0.834 0.592 0.694,0.843 0.298 0.507,0.807 0.266 0.468,0.731 0.195 0.388,0.352 0.111 0.221',
	pink: '0.998 0.989 0.996,0.992 0.97 0.985,0.981 0.917 0.96,0.963 0.867 0.932,0.939 0.815 0.899,0.907 0.756 0.859,0.869 0.683 0.81,0.825 0.59 0.751,0.775 0.297 0.61,0.748 0.27 0.581,0.698 0.219 0.528,0.363 0.101 0.279',
	plum: '0.995 0.988 0.999,0.988 0.971 0.99,0.973 0.923 0.98,0.953 0.875 0.966,0.926 0.825 0.945,0.89 0.765 0.916,0.84 0.686 0.877,0.775 0.58 0.832,0.624 0.313 0.708,0.587 0.29 0.667,0.543 0.263 0.619,0.299 0.114 0.352',
	purple:
		'0.995 0.988 0.996,0.983 0.971 0.993,0.963 0.931 0.989,0.937 0.888 0.981,0.904 0.837 0.966,0.86 0.774 0.942,0.799 0.69 0.91,0.719 0.583 0.874,0.523 0.318 0.751,0.483 0.289 0.7,0.473 0.281 0.687,0.234 0.132 0.363',
	violet:
		'0.991 0.988 0.995,0.978 0.974 0.998,0.953 0.943 0.993,0.916 0.897 1,0.876 0.851 1,0.825 0.793 0.981,0.752 0.712 0.943,0.654 0.602 0.902,0.417 0.341 0.784,0.381 0.306 0.741,0.383 0.317 0.702,0.179 0.15 0.359',
	iris: '0.992 0.992 0.999,0.972 0.973 0.998,0.943 0.945 0.992,0.902 0.906 1,0.857 0.861 1,0.799 0.805 0.987,0.721 0.727 0.955,0.61 0.619 0.918,0.357 0.357 0.81,0.318 0.318 0.774,0.337 0.326 0.748,0.154 0.161 0.371',
	indigo:
		'0.992 0.992 0.996,0.971 0.977 0.998,0.933 0.948 0.992,0.885 0.914 1,0.831 0.87 1,0.767 0.814 0.995,0.685 0.74 0.957,0.569 0.639 0.916,0.276 0.384 0.837,0.234 0.343 0.801,0.256 0.354 0.755,0.133 0.175 0.348',
	blue: '0.986 0.992 0.999,0.96 0.979 0.998,0.912 0.956 0.991,0.853 0.932 1,0.788 0.894 0.998,0.709 0.843 0.976,0.606 0.777 0.947,0.451 0.688 0.917,0.247 0.556 0.969,0.234 0.523 0.912,0.15 0.44 0.84,0.102 0.193 0.379',
	cyan: '0.982 0.992 0.996,0.955 0.981 0.984,0.888 0.965 0.975,0.821 0.941 0.959,0.751 0.907 0.935,0.671 0.862 0.9,0.564 0.8 0.854,0.388 0.715 0.798,0.282 0.627 0.765,0.264 0.583 0.71,0.08 0.48 0.63,0.108 0.232 0.277',
	teal: '0.983 0.996 0.992,0.958 0.983 0.976,0.895 0.971 0.952,0.831 0.949 0.92,0.761 0.914 0.878,0.682 0.864 0.825,0.581 0.798 0.756,0.433 0.716 0.671,0.297 0.637 0.581,0.275 0.599 0.542,0.08 0.5 0.43,0.11 0.235 0.219',
	jade: '0.986 0.996 0.992,0.962 0.983 0.969,0.912 0.965 0.932,0.858 0.941 0.893,0.795 0.909 0.847,0.715 0.864 0.791,0.603 0.802 0.718,0.44 0.72 0.629,0.319 0.63 0.521,0.299 0.592 0.488,0.15 0.5 0.37,0.142 0.229 0.194',
	green:
		'0.986 0.996 0.989,0.963 0.983 0.967,0.913 0.964 0.925,0.859 0.94 0.879,0.796 0.907 0.826,0.718 0.863 0.761,0.61 0.801 0.675,0.451 0.715 0.559,0.332 0.634 0.442,0.308 0.595 0.417,0.19 0.5 0.32,0.132 0.228 0.18',
	grass:
		'0.986 0.996 0.985,0.966 0.983 0.964,0.923 0.965 0.917,0.872 0.94 0.865,0.811 0.908 0.802,0.733 0.864 0.724,0.628 0.803 0.622,0.477 0.72 0.482,0.38 0.647 0.378,0.344 0.598 0.342,0.263 0.488 0.261,0.151 0.233 0.153',
	brown:
		'0.995 0.992 0.989,0.987 0.976 0.964,0.959 0.936 0.909,0.934 0.897 0.855,0.909 0.856 0.798,0.88 0.808 0.73,0.841 0.742 0.639,0.782 0.647 0.514,0.651 0.505 0.368,0.601 0.465 0.344,0.485 0.374 0.288,0.236 0.202 0.183',
	orange:
		'0.995 0.988 0.985,0.994 0.968 0.934,0.989 0.938 0.85,1 0.874 0.687,1 0.821 0.583,0.975 0.767 0.545,0.919 0.693 0.486,0.877 0.597 0.379,0.9 0.45 0.2,0.87 0.409 0.164,0.76 0.34 0,0.323 0.185 0.127',
	sky: '0.98 0.995 0.999,0.953 0.98 0.99,0.899 0.963 0.989,0.842 0.937 0.977,0.777 0.9 0.954,0.701 0.851 0.921,0.604 0.785 0.879,0.457 0.696 0.829,0.585 0.877 0.983,0.555 0.845 0.959,0.193 0.448 0.605,0.145 0.241 0.329',
	mint: '0.98 0.995 0.992,0.957 0.985 0.977,0.888 0.972 0.95,0.819 0.951 0.916,0.747 0.918 0.873,0.668 0.87 0.818,0.567 0.805 0.744,0.42 0.724 0.649,0.62 0.908 0.834,0.585 0.871 0.797,0.203 0.463 0.397,0.136 0.259 0.236',
	lime: '0.989 0.992 0.981,0.975 0.98 0.954,0.939 0.965 0.851,0.896 0.94 0.76,0.843 0.903 0.678,0.778 0.852 0.599,0.694 0.784 0.508,0.585 0.707 0.378,0.78 0.928 0.466,0.734 0.896 0.397,0.386 0.482 0.227,0.222 0.25 0.128',
	yellow:
		'0.992 0.992 0.978,0.995 0.99 0.922,0.997 0.982 0.749,0.992 0.953 0.627,0.984 0.91 0.51,0.934 0.847 0.474,0.876 0.785 0.46,0.811 0.689 0.313,1 0.92 0.22,0.977 0.868 0.291,0.6 0.44 0,0.271 0.233 0.137',
	amber:
		'0.995 0.992 0.985,0.994 0.986 0.921,0.994 0.969 0.782,0.989 0.937 0.65,0.97 0.902 0.527,0.936 0.844 0.506,0.89 0.762 0.443,0.85 0.65 0.3,1 0.77 0.26,0.959 0.741 0.274,0.64 0.4 0,0.294 0.208 0.145'
};

const SRGB_TO_XYZ: readonly Coords[] = [
	[0.41239079926595934, 0.357584339383878, 0.1804807884018343],
	[0.21263900587151027, 0.715168678767756, 0.07219231536073371],
	[0.01933081871559182, 0.11919477979462598, 0.9505321522496607]
];
const XYZ_TO_SRGB: readonly Coords[] = [
	[3.2409699419045226, -1.537383177570094, -0.4986107602930034],
	[-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
	[0.05563007969699366, -0.20397695888897652, 1.0569715142428786]
];
const P3_TO_XYZ: readonly Coords[] = [
	[0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
	[0.2289745640697488, 0.6917385218365064, 0.079286914093745],
	[0.0, 0.04511338185890264, 1.043944368900976]
];
const XYZ_TO_LMS: readonly Coords[] = [
	[0.819022437996703, 0.3619062600528904, -0.1288737815209879],
	[0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
	[0.0481771893596242, 0.2642395317527308, 0.6335478284694309]
];
const LMS_TO_XYZ: readonly Coords[] = [
	[1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
	[-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
	[-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]
];
const LMS_TO_OKLAB: readonly Coords[] = [
	[0.210454268309314, 0.7936177747023054, -0.0040720430116193],
	[1.9779985324311684, -2.4285922420485799, 0.450593709617411],
	[0.0259040424655478, 0.7827717124575296, -0.8086757549230774]
];
const OKLAB_TO_LMS: readonly Coords[] = [
	[1.0, 0.3963377773761749, 0.2158037573099136],
	[1.0, -0.1055613458156586, -0.0638541728258133],
	[1.0, -0.0894841775298119, -1.2914855480194092]
];

/** colorjs.io's `multiplyMatrices` for a 3×3 by a vector, summed in its order and from its zero. */
function multiply(m: readonly Coords[], v: Coords): Coords {
	const row = (r: Coords | undefined): number =>
		r === undefined ? 0 : 0 + r[0] * (v[0] || 0) + r[1] * (v[1] || 0) + r[2] * (v[2] || 0);
	return [row(m[0]), row(m[1]), row(m[2])];
}

/** the sRGB transfer, which display-p3 shares, from encoded to linear. */
function decode(rgb: Coords): Coords {
	return rgb.map((val) => {
		const sign = val < 0 ? -1 : 1;
		const abs = val * sign;
		if (abs <= 0.04045) return val / 12.92;
		return sign * ((abs + 0.055) / 1.055) ** 2.4;
	}) as Coords;
}

function encode(rgb: Coords): Coords {
	return rgb.map((val) => {
		const sign = val < 0 ? -1 : 1;
		const abs = val * sign;
		if (abs > 0.0031308) return sign * (1.055 * abs ** (1 / 2.4) - 0.055);
		return 12.92 * val;
	}) as Coords;
}

function xyzToOklab(xyz: Coords): Coords {
	return multiply(LMS_TO_OKLAB, multiply(XYZ_TO_LMS, xyz).map((val) => Math.cbrt(val)) as Coords);
}

function oklabToXyz(oklab: Coords): Coords {
	return multiply(LMS_TO_XYZ, multiply(OKLAB_TO_LMS, oklab).map((val) => val ** 3) as Coords);
}

function constrainAngle(angle: number): number {
	return ((angle % 360) + 360) % 360;
}

function oklabToOklch([L, a, b]: Coords): Coords {
	// chromatic components much smaller than a and b leave the hue powerless
	const ε = 0.0002;
	const h = Math.abs(a) < ε && Math.abs(b) < ε ? Number.NaN : (Math.atan2(b, a) * 180) / Math.PI;
	return [L, Math.sqrt(a ** 2 + b ** 2), constrainAngle(h)];
}

/**
 * colorjs.io's conversion out of a space: a powerless (`NaN`) coordinate is read as zero before
 * anything else, which is why a hue it cannot name still turns a trace of chroma into `a`.
 */
function zeroed(coords: Coords): Coords {
	return coords.map((c) => (Number.isNaN(c) ? 0 : c)) as Coords;
}

function oklchToOklab(oklch: Coords): Coords {
	const [L, C, h] = zeroed(oklch);
	return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
}

function toOklab(space: Space, coords: Coords): Coords {
	if (space === 'oklab') return [...coords];
	if (space === 'oklch') return oklchToOklab(coords);
	const c = zeroed(coords);
	if (space === 'srgb') return xyzToOklab(multiply(SRGB_TO_XYZ, decode(c)));
	if (space === 'srgb-linear') return xyzToOklab(multiply(SRGB_TO_XYZ, c));
	return xyzToOklab(multiply(P3_TO_XYZ, decode(c)));
}

function toOklch(space: Space, coords: Coords): Coords {
	if (space === 'oklch') return [...coords];
	return oklabToOklch(space === 'oklab' ? zeroed(coords) : toOklab(space, coords));
}

function oklabToSrgb(oklab: Coords): Coords {
	return encode(multiply(XYZ_TO_SRGB, oklabToXyz(oklab)));
}

function oklchToSrgb(oklch: Coords): Coords {
	return oklabToSrgb(oklchToOklab(oklch));
}

/** colorjs.io's `deltaEOK`: euclidean distance in oklab. */
function deltaEOK(a: Coords, b: Coords): number {
	const [L1, a1, b1] = a;
	const [L2, a2, b2] = b;
	return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

function distanceOklch(a: Coords, b: Coords): number {
	return deltaEOK(oklchToOklab(a), oklchToOklab(b));
}

function inSrgb(rgb: Coords, epsilon: number): boolean {
	return rgb.every((c) => Number.isNaN(c) || (c >= 0 - epsilon && c <= 1 + epsilon));
}

/** colorjs.io's `toGamutCSS` into sRGB: the CSS Color 4 chroma reduction, binary-searched in oklch. */
function toGamutCss(origin: Coords): Coords {
	const JND = 0.02;
	const ε = 0.0001;
	const originOklch = toOklch('srgb', origin);
	const L = originOklch[0];
	if (L >= 1) return oklabToSrgb([1, 0, 0]);
	if (L <= 0) return oklabToSrgb([0, 0, 0]);
	if (inSrgb(oklchToSrgb(originOklch), 0)) return oklchToSrgb(originOklch);

	const clip = (color: Coords): Coords =>
		oklchToSrgb(color).map((c) => Math.max(Math.min(1, c), 0)) as Coords;
	const error = (clipped: Coords, current: Coords): number =>
		deltaEOK(toOklab('srgb', clipped), oklchToOklab(current));

	let min = 0;
	let max = originOklch[1];
	let minInGamut = true;
	const current: Coords = [...originOklch];
	let clipped = clip(current);
	let E = error(clipped, current);
	if (E < JND) return clipped;

	while (max - min > ε) {
		const chroma = (min + max) / 2;
		current[1] = chroma;
		if (minInGamut && inSrgb(oklchToSrgb(current), 0)) {
			min = chroma;
		} else {
			clipped = clip(current);
			E = error(clipped, current);
			if (E < JND) {
				if (JND - E < ε) break;
				minInGamut = false;
				min = chroma;
			} else {
				max = chroma;
			}
		}
	}
	return clipped;
}

/** the colour as the eight-bit channels colorjs.io writes into a hex string, gamut-mapped first. */
function srgbBytes(oklch: Coords): Coords {
	let rgb = oklchToSrgb(oklch);
	if (!inSrgb(rgb, 0.000075)) rgb = toGamutCss(rgb);
	return rgb.map((c) => Math.round(c * 255)) as Coords;
}

function hex(oklch: Coords): string {
	return `#${srgbBytes(oklch)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')}`;
}

/** colorjs.io's `toPrecision`: `precision` significant digits, rounded half up. */
function toPrecision(n: number, precision: number): number {
	if (n === 0) return 0;
	const integer = Math.trunc(n);
	const digits = integer ? Math.trunc(Math.log10(Math.abs(integer))) + 1 : 0;
	const multiplier = 10.0 ** (precision - digits);
	return Math.floor(n * multiplier + 0.5) / multiplier;
}

/** the generator's `toOklchString`: lightness as a percentage to a tenth, the rest to four digits. */
function oklchString([L, C, h]: Coords): string {
	const channel = (n: number) => (Number.isNaN(n) ? 'none' : String(toPrecision(n, 4)));
	return `oklch(${+(L * 100).toFixed(1)}% ${channel(C)} ${channel(h)})`;
}

/** APCA lightness contrast (0.0.98G-4g) as colorjs.io's `contrastAPCA` computes it. */
function contrastAPCA(background: Coords, foreground: Coords): number {
	const blkThrs = 0.022;
	// biome-ignore lint/suspicious/noApproximativeNumericConstant: APCA's black-clamp exponent is 1.414 exactly, not √2
	const blkClmp = 1.414;
	const fclamp = (Y: number) => (Y >= blkThrs ? Y : Y + (blkThrs - Y) ** blkClmp);
	const linearize = (val: number) => (val < 0 ? -1 : 1) * Math.abs(val) ** 2.4;
	const luminance = ([R, G, B]: Coords) =>
		linearize(R) * 0.2126729 + linearize(G) * 0.7151522 + linearize(B) * 0.072175;

	const Ytxt = fclamp(luminance(oklchToSrgb(foreground)));
	const Ybg = fclamp(luminance(oklchToSrgb(background)));
	let C: number;
	if (Math.abs(Ybg - Ytxt) < 0.0005) C = 0;
	else if (Ybg > Ytxt) C = (Ybg ** 0.56 - Ytxt ** 0.57) * 1.14;
	else C = (Ybg ** 0.65 - Ytxt ** 0.62) * 1.14;
	let Sapc: number;
	if (Math.abs(C) < 0.1) Sapc = 0;
	else if (C > 0) Sapc = C - 0.027;
	else Sapc = C + 0.027;
	return Sapc * 100;
}

/**
 * bezier-easing 2.1.0's `bezier(mX1, mY1, mX2, mY2)`, its sample table in float32 as it builds one.
 */
function bezier(mX1: number, mY1: number, mX2: number, mY2: number): (x: number) => number {
	const A = (a1: number, a2: number) => 1.0 - 3.0 * a2 + 3.0 * a1;
	const B = (a1: number, a2: number) => 3.0 * a2 - 6.0 * a1;
	const C = (a1: number) => 3.0 * a1;
	const calc = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
	const slope = (t: number, a1: number, a2: number) =>
		3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);

	if (mX1 === mY1 && mX2 === mY2) return (x) => x;

	const tableSize = 11;
	const stepSize = 1.0 / (tableSize - 1.0);
	const samples = new Float32Array(tableSize);
	for (let i = 0; i < tableSize; ++i) samples[i] = calc(i * stepSize, mX1, mX2);
	const sample = (i: number) => samples[i] ?? 0;

	const tForX = (x: number): number => {
		let intervalStart = 0.0;
		let current = 1;
		const last = tableSize - 1;
		for (; current !== last && sample(current) <= x; ++current) intervalStart += stepSize;
		--current;

		const dist = (x - sample(current)) / (sample(current + 1) - sample(current));
		let t = intervalStart + dist * stepSize;
		const initialSlope = slope(t, mX1, mX2);
		if (initialSlope >= 0.001) {
			for (let i = 0; i < 4; ++i) {
				const s = slope(t, mX1, mX2);
				if (s === 0.0) return t;
				t -= (calc(t, mX1, mX2) - x) / s;
			}
			return t;
		}
		if (initialSlope === 0.0) return t;

		let a = intervalStart;
		let b = intervalStart + stepSize;
		let currentX: number;
		let i = 0;
		do {
			t = a + (b - a) / 2.0;
			currentX = calc(t, mX1, mX2) - x;
			if (currentX > 0.0) b = t;
			else a = t;
		} while (Math.abs(currentX) > 0.0000001 && ++i < 10);
		return t;
	};

	return (x) => {
		if (x === 0) return 0;
		if (x === 1) return 1;
		return calc(tForX(x), mY1, mY2);
	};
}

const lightModeEasing = bezier(0, 2, 0, 2);

/** the generator's `transposeProgressionStart`: moves a progression's start to `to`, eased out. */
function transposeProgressionStart(to: number, arr: readonly number[]): number[] {
	const lastIndex = arr.length - 1;
	const diff = (arr[0] ?? 0) - to;
	return arr.map((n, i) => n - diff * lightModeEasing(1 - i / lastIndex));
}

function nth<T>(list: readonly T[], index: number): T {
	const item = list[index];
	if (item === undefined) throw new RangeError(`no item ${index} in a list of ${list.length}`);
	return item;
}

/** colorjs.io's d65 to d50 bradford adaptation, and back. */
const D65_TO_D50: readonly Coords[] = [
	[1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
	[0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
	[-0.009243040646204504, 0.015055191490298152, 0.7518742814281371]
];
const D50_TO_D65: readonly Coords[] = [
	[0.955473421488075, -0.02309845494876471, 0.06325924320057072],
	[-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
	[0.012314014864481998, -0.020507649298898964, 1.330365926242124]
];
const D50: Coords = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];
const LAB_ε = 216 / 24389;
const LAB_ε3 = 24 / 116;
const LAB_κ = 24389 / 27;

function oklchToLab(oklch: Coords): Coords {
	const xyz = multiply(D65_TO_D50, oklabToXyz(oklchToOklab(oklch)));
	const f = xyz.map((value, i) => {
		const scaled = value / (D50[i] ?? 1);
		return scaled > LAB_ε ? Math.cbrt(scaled) : (LAB_κ * scaled + 16) / 116;
	}) as Coords;
	return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function labToOklch([L, a, b]: Coords): Coords {
	const f1 = (L + 16) / 116;
	const f0 = a / 500 + f1;
	const f2 = f1 - b / 200;
	const xyz = [
		f0 > LAB_ε3 ? f0 ** 3 : (116 * f0 - 16) / LAB_κ,
		L > 8 ? ((L + 16) / 116) ** 3 : L / LAB_κ,
		f2 > LAB_ε3 ? f2 ** 3 : (116 * f2 - 16) / LAB_κ
	].map((value, i) => value * (D50[i] ?? 1)) as Coords;
	return oklabToOklch(xyzToOklab(multiply(D50_TO_D65, xyz)));
}

/** colorjs.io's `Color.mix`, which interpolates in cie lab (d50) unless told otherwise. */
function mix(c1: Coords, c2: Coords, p: number): Coords {
	const from = oklchToLab(c1);
	const to = oklchToLab(c2);
	return labToOklch(
		[0, 1, 2].map((i) => {
			const start = from[i] ?? 0;
			return start + ((to[i] ?? 0) - start) * p;
		}) as Coords
	);
}

/**
 * how much of B the triangle above mixes into A. a seed on a step (`b` zero) or a B on A's own step
 * (`c` zero) has no triangle: the cosines are 0/0, and the generator, which divides anyway, draws a
 * grey ramp from white to black. zero is the limit the ratio takes as the seed nears A, and with B
 * on A, B adds nothing at any ratio — so both take A alone, as `getScaleFromColor` below does.
 */
function mixRatio(a: number, b: number, c: number): number {
	const cosA = (b ** 2 + c ** 2 - a ** 2) / (2 * b * c);
	const sinA = Math.sin(Math.acos(cosA));
	const cosB = (a ** 2 + c ** 2 - b ** 2) / (2 * a * c);
	const sinB = Math.sin(Math.acos(cosB));
	const tanC1 = cosA / sinA;
	const tanC2 = cosB / sinB;
	return Math.max(0, tanC1 / tanC2) * 0.5;
}

/** the generator's `getScaleFromColor`, light path. */
function getScaleFromColor(
	source: Coords,
	scales: Readonly<Record<string, Scale>>,
	backgroundColor: Coords
): Scale {
	const allColors: { scale: string; color: Coords; distance: number }[] = [];
	for (const [name, scale] of Object.entries(scales)) {
		for (const color of scale) {
			allColors.push({ scale: name, distance: distanceOklch(source, color), color });
		}
	}
	allColors.sort((a, b) => a.distance - b.distance);

	// one entry per scale, its nearest step
	const closestColors = allColors.filter(
		(color, i, arr) => i === arr.findIndex((value) => value.scale === color.scale)
	);

	// greys sit so close together that a second grey says nothing about direction: past the nearest,
	// skip greys until a chromatic scale is second
	const isGray = (name: string) => (GRAY_SCALE_NAMES as readonly string[]).includes(name);
	const allAreGrays = closestColors.every((color) => isGray(color.scale));
	if (!allAreGrays && isGray(nth(closestColors, 0).scale)) {
		while (isGray(nth(closestColors, 1).scale)) closestColors.splice(1, 1);
	}

	const colorA = nth(closestColors, 0);
	const colorB = nth(closestColors, 1);

	// the triangle source–A–B, sides named after the angles they face. where neither angle at A nor
	// at B is obtuse, B is mixed into A in the proportion the foot of the source's perpendicular
	// splits AB; where one is, B adds nothing A does not and the ratio is zero.
	const a = colorB.distance;
	const b = colorA.distance;
	const c = distanceOklch(colorA.color, colorB.color);

	const ratio = b === 0 || c === 0 ? 0 : mixRatio(a, b, c);

	const scaleA = scales[colorA.scale] ?? [];
	const scaleB = scales[colorB.scale] ?? [];
	const scale: Scale = scaleA.map((step, i) => mix(step, nth(scaleB, i), ratio));

	const baseColor = nth(
		scale.slice().sort((x, y) => distanceOklch(source, x) - distanceOklch(source, y)),
		0
	);

	// the seed's hue throughout, and its chroma in the proportion the nearest step held to it
	const ratioC = source[1] / baseColor[1];
	for (const color of scale) {
		color[1] = Math.min(source[1] * 1.5, color[1] * ratioC);
		color[2] = source[2];
	}

	// the lightnesses eased so step 1 sits against the background, white standing in as a step 0
	const backgroundL = Math.max(0, Math.min(1, backgroundColor[0]));
	const lightness = transposeProgressionStart(backgroundL, [1, ...scale.map((color) => color[0])]);
	lightness.shift();
	lightness.forEach((value, i) => {
		nth(scale, i)[0] = value;
	});
	return scale;
}

/** the generator's `getTextColor`: white, or a dark tint of the fill where white reads under Lc 40. */
function getTextColor(background: Coords): Coords {
	const white: Coords = [1, 0, 0];
	if (Math.abs(contrastAPCA(white, background)) < 40) {
		const [, C, H] = background;
		return [0.25, Math.max(0.08 * C, 0.04), H];
	}
	return white;
}

/** the generator's `getStep9Colors`: the seed as step 9, unless it is all but the page itself. */
function getStep9Colors(scale: Scale, accentBaseColor: Coords): [Coords, Coords] {
	const distance = distanceOklch(accentBaseColor, nth(scale, 0)) * 100;
	if (distance < 25) {
		const nine = nth(scale, 8);
		return [nine, getTextColor(nine)];
	}
	return [accentBaseColor, getTextColor(accentBaseColor)];
}

/** the generator's `getButtonHoverColor`: step 9 moved in lightness, its chroma and hue a step's. */
function getButtonHoverColor(source: Coords, scales: readonly Scale[]): Coords {
	const [L, C, H] = source;
	const newL = L > 0.4 ? L - 0.03 / (L + 0.1) : L + 0.03 / (L + 0.1);
	const newC = L > 0.4 && !Number.isNaN(H) ? C * 0.93 + 0 : C;
	const buttonHoverColor: Coords = [newL, newC, H];

	let closestColor = buttonHoverColor;
	let minDistance = Number.POSITIVE_INFINITY;
	for (const scale of scales) {
		for (const color of scale) {
			const distance = distanceOklch(buttonHoverColor, color);
			if (distance < minDistance) {
				minDistance = distance;
				closestColor = color;
			}
		}
	}

	buttonHoverColor[1] = closestColor[1];
	buttonHoverColor[2] = closestColor[2];
	return buttonHoverColor;
}

/** a number, a percentage, an angle in degrees, or `none`: one channel of a css colour function. */
const CHANNEL = /^(none|[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(%|deg)?)$/;

/** a channel's value, a percentage taken as a share of `full`, and `none` as zero, as css paints it. */
function channel(raw: string, full: number): number {
	if (raw === 'none') return 0;
	if (raw.endsWith('%')) return (Number(raw.slice(0, -1)) / 100) * full;
	return Number(raw.replace(/deg$/, ''));
}

/** for each function this reads: the space it names, and what 100% of each channel is. */
const FUNCTIONS: Readonly<Record<string, { readonly space: Space; readonly full: Coords }>> = {
	rgb: { space: 'srgb', full: [1, 1, 1] },
	rgba: { space: 'srgb', full: [1, 1, 1] },
	oklch: { space: 'oklch', full: [1, 0.4, 1] },
	oklab: { space: 'oklab', full: [1, 0.4, 0.4] },
	'color(srgb': { space: 'srgb', full: [1, 1, 1] },
	'color(srgb-linear': { space: 'srgb-linear', full: [1, 1, 1] },
	'color(display-p3': { space: 'p3', full: [1, 1, 1] }
};

/**
 * a seed as the space and coordinates it was written in, or `null` for one this does not read.
 *
 * it reads what reaches it: the hex the deployment stores, and what an engine serializes a
 * registered `<color>` to — `rgb()` or `rgba()` for every legacy sRGB form and keyword, and the
 * function as written for `oklch()`, `oklab()` and `color(srgb | srgb-linear | display-p3 …)`.
 * any other notation — `lab()`, `lch()`, `color(rec2020 …)` and the rest — is `null`, and the card
 * keeps ./tokens.css's fallback scale.
 *
 * two readings depart from the generator, which keeps a seed's alpha in step 9 and reads colorjs.io's
 * `none` as a grey: alpha is dropped, because the card paints step 9 opaque, and `none` is zero, as
 * css paints it. "where the port departs from radix’s generator on purpose" in
 * ./radix-scale.spec.ts holds both.
 */
function parseSeed(value: string): { space: Space; coords: Coords } | null {
	const text = value.trim().toLowerCase();
	const hexDigits = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
	if (hexDigits !== undefined) {
		const digits = hexDigits.length <= 4 ? hexDigits.replace(/./g, '$&$&') : hexDigits;
		const byte = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16) / 255;
		return { space: 'srgb', coords: [byte(0), byte(2), byte(4)] };
	}

	const call = /^([a-z]+)\(\s*([^()]*)\)$/.exec(text);
	if (call === null) return null;
	let [, name = '', body = ''] = call;
	if (name === 'color') {
		const [id, ...rest] = body.split(/\s+/);
		name = `color(${id}`;
		body = rest.join(' ');
	}
	const form = FUNCTIONS[name];
	if (form === undefined) return null;

	const raw = (body.split('/')[0] ?? '').trim().split(/\s*,\s*|\s+/);
	const channels = raw.slice(0, 3);
	if (channels.length !== 3 || !channels.every((c) => CHANNEL.test(c))) return null;
	const coords = channels.map((c, i) => {
		const value = channel(c, form.full[i] ?? 1);
		// legacy and modern rgb() alike take a bare number on 0 to 255
		return form.space === 'srgb' && name.startsWith('rgb') && !c.endsWith('%')
			? value / 255
			: value;
	}) as Coords;
	return { space: form.space, coords };
}

type RadixLight = {
	readonly all: Readonly<Record<string, Scale>>;
	readonly grays: Readonly<Record<string, Scale>>;
};

let radixLight: RadixLight | null = null;

/** the radix light scales in oklch, converted once and never written to after. */
function radixLightScales(): RadixLight {
	if (radixLight !== null) return radixLight;
	const all: Record<string, Scale> = {};
	for (const [name, steps] of Object.entries(RADIX_LIGHT_P3)) {
		all[name] = steps
			.split(',')
			.map((step) => toOklch('p3', step.split(' ').map(Number) as Coords));
	}
	const grays = Object.fromEntries(GRAY_SCALE_NAMES.map((name) => [name, all[name] ?? []]));
	radixLight = { all, grays };
	return radixLight;
}

/** the generator's light default page: white. */
const BACKGROUND: Coords = toOklch('srgb', [1, 1, 1]);

/**
 * the grey the registry's default theme was generated with (`--gray` in the head of
 * ../registry/styles/themes/default.css), the generator's `gray` input. it reaches only a pure white
 * or black seed, which takes the grey scale's tint.
 */
export const REGISTRY_GRAY_SEED = '#e2e8f0';

let grayScale: Scale | null = null;

/** the grey scale the generator builds from the registry's grey seed. */
function grayScaleColors(): Scale {
	if (grayScale === null) {
		const seed = parseSeed(REGISTRY_GRAY_SEED);
		if (seed === null) throw new Error(`${REGISTRY_GRAY_SEED} is a seed the port reads`);
		grayScale = getScaleFromColor(
			toOklch(seed.space, seed.coords),
			radixLightScales().grays,
			BACKGROUND
		);
	}
	return grayScale;
}

/**
 * the brand scale for one seed, the generator's `generateRadixColors` with `appearance: 'light'`,
 * the seed as `accent`, `REGISTRY_GRAY_SEED` as `gray` and `#ffffff` as `background`. `null` for a
 * seed `parseSeed` above does not read.
 */
export function generateBrandScale(seed: string): BrandScale | null {
	const parsed = parseSeed(seed);
	if (parsed === null) return null;

	const accentBaseColor = toOklch(parsed.space, parsed.coords);
	let accentScaleColors = getScaleFromColor(accentBaseColor, radixLightScales().all, BACKGROUND);

	// a pure white or black seed takes the grey scale's tint
	const bytes = srgbBytes(accentBaseColor);
	if (bytes.every((byte) => byte === 0) || bytes.every((byte) => byte === 255)) {
		accentScaleColors = grayScaleColors().map((color): Coords => [...color]);
	}

	const [accent9Color, accentContrastColor] = getStep9Colors(accentScaleColors, accentBaseColor);
	accentScaleColors[8] = accent9Color;
	accentScaleColors[9] = getButtonHoverColor(accent9Color, [accentScaleColors]);

	// the text steps take no more chroma than the solid or step 8 does
	const textChroma = Math.max(nth(accentScaleColors, 8)[1], nth(accentScaleColors, 7)[1]);
	nth(accentScaleColors, 10)[1] = Math.min(textChroma, nth(accentScaleColors, 10)[1]);
	nth(accentScaleColors, 11)[1] = Math.min(textChroma, nth(accentScaleColors, 11)[1]);

	return {
		steps: accentScaleColors.map(hex),
		stepsWideGamut: accentScaleColors.map(oklchString),
		contrast: hex(accentContrastColor)
	};
}

/** the registry's accent variables one scale sets: every step, and the ink on the solid. */
function declarations(steps: readonly string[], contrast: string): string {
	return [
		...steps.map((value, i) => `--accent-${i + 1}: ${value};`),
		`--accent-contrast: ${contrast};`
	].join(' ');
}

/**
 * the scale as css for `selector`, the way radix's custom page writes one: sRGB hex for every
 * display, and the wide-gamut steps for a display that shows display-p3. the ink is hex in both,
 * as the generator gives it.
 */
export function brandScaleCss(selector: string, scale: BrandScale): string {
	return (
		`${selector} { ${declarations(scale.steps, scale.contrast)} }\n` +
		'@supports (color: color(display-p3 1 1 1)) { @media (color-gamut: p3) { ' +
		`${selector} { ${declarations(scale.stepsWideGamut, scale.contrast)} } } }`
	);
}
