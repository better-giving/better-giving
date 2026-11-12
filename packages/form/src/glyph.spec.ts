import { describe, expect, it } from 'vitest';
import { GLYPHS } from './glyph';

// node pool: the set is data, read by the app's donor page on the server through
// `@better-giving/form/glyph`, so a mark that page draws is asserted here as the data it imports.

describe('the glyph set', () => {
	it("carries lucide's play as the donor page's video press draws it", () => {
		// https://lucide.dev/icons/play, lucide-static 1.72.0 `icons/play.svg`
		expect(GLYPHS.play).toEqual([
			'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
		]);
	});
});
