import { describe, expect, it } from 'vitest';
import { GLYPHS } from './glyph';

// node pool: the set is data, read by the app's donor page on the server through
// `@better-giving/form/glyph`, so a mark that page draws is asserted here as the data it imports.

describe('the glyph set', () => {
	it("carries lucide's play as the donor page's video press draws it", () => {
		// a pin: the path as copied from https://lucide.dev/icons/play, lucide-static 1.72.0
		// `icons/play.svg`. it goes red on any edit to `GLYPHS.play` and cannot tell a wrong copy from
		// a right one, so a re-copy is checked against that file by eye.
		expect(GLYPHS.play).toEqual([
			'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
		]);
	});

	it("carries lucide's trending-up as the unit list's stock row draws it", () => {
		// a pin, as play's above: the paths of https://lucide.dev/icons/trending-up, checked by eye.
		expect(GLYPHS['trending-up']).toEqual(['M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17']);
	});
});
