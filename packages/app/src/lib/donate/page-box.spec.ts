import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the donation box's column on the donor page, ./page.css's `--page-box`, against the card
// breakpoint in packages/form/src/styles/layout.css: below it the card draws its narrow shape, so a
// column narrower than the breakpoint draws the box cramped on a page that has the room. the two
// sheets are read as text; the form's is not in its `exports` map, so nothing imports it.

const read = (url: string) => readFileSync(new URL(url, import.meta.url), 'utf8');
const pageCss = read('./page.css');
const layoutCss = read('../../../../form/src/styles/layout.css');

/** the card's root is clamped to [15px, 18px] (`--_root-size`, packages/form/src/styles/tokens.css). */
const ROOT_CEILING_PX = 18;

describe('--page-box', () => {
	it('is at least as wide as the card’s breakpoint, its two 1px hairlines taken off', () => {
		const breakpoint = /@container donate \(min-width: calc\((\d+(?:\.\d+)?)em - 2px\)\)/.exec(
			layoutCss
		);
		const box = /--page-box:\s*(\d+(?:\.\d+)?)rem;/.exec(pageCss);
		if (!breakpoint?.[1] || !box?.[1]) throw new Error('the breakpoint or --page-box moved');

		// the breakpoint is widest in rem terms where the root is: 26em less 2px, at the ceiling.
		const breakpointRem = Number(breakpoint[1]) - 2 / ROOT_CEILING_PX;

		expect(Number(box[1])).toBeGreaterThanOrEqual(breakpointRem);
	});

	it('is the width the box’s column is held to', () => {
		expect(pageCss).toMatch(/\.page-box > div > \* \{\s*max-inline-size: var\(--page-box\);\s*\}/);
	});
});
