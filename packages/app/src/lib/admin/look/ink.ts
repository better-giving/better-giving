// which of the operator's two inks is written on a fill of the organisation's brand colour: the
// Organisation chip in ./look-control.tsx is that colour as stored, or the donor page's unseeded one
// where none is, and the colour is whatever the organisation picked, so the ink is chosen per colour
// rather than named per colour.
//
// the split is the colour's relative luminance (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance)
// against the point where black and white stand equally far from it, sqrt(1.05 * 0.05) - 0.05:
// above it the dark ink, at or below it the light one.

export type Ink = 'dark' | 'light';

const EVEN = Math.sqrt(1.05 * 0.05) - 0.05;

/** the ink for a fill of `hex`, a `#rrggbb` as `LOOK_KEYS.brandColour` stores it. */
export function inkOn(hex: string): Ink {
	const linear = (at: number) => {
		const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const luminance = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
	return luminance > EVEN ? 'dark' : 'light';
}
