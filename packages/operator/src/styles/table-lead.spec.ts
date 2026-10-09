import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the sentence counting a table's rows stands between the heading over the list and the plane
// under it (../components/data/DataTable.jsx). it is the table's sentence, so it has to read as the
// plane's: the step from it down to the plane plainly the smaller of the two, or it floats between
// them and belongs to neither. both the heading and `.adm-tablelead` are children of the container
// the screen stands them in, so the container's gap is on both sides of the line, and whatever the
// line states under itself is added to the gap on its far side.

const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** one spacing step from ./tokens.css, as css pixels. */
const step = (token: string) => {
	const stated = tokens.match(new RegExp(`${token}:\\s*([\\d.]+)rem\\s*;`))?.[1];
	if (stated === undefined) throw new Error(`${token} is not a rem length in ./tokens.css`);
	return Number.parseFloat(stated) * 16;
};

/** a stated length that is one spacing step, or one step less another, as css pixels. */
const px = (value: string | undefined) => {
	const one = value?.match(/^var\((--admin-space-\d+)\)$/);
	if (one?.[1] !== undefined) return step(one[1]);
	const less = value?.match(/^calc\(var\((--admin-space-\d+)\) - var\((--admin-space-\d+)\)\)$/);
	if (less?.[1] !== undefined && less[2] !== undefined) return step(less[1]) - step(less[2]);
	throw new Error(`${value} is neither one spacing step nor one step less another`);
};

// the containers a screen stands a heading and a counted table in, one after the other.
describe.each(['.adm-stack', '.adm-stack--tight', '.adm-section'])(
	'a counted table under a heading in %s',
	(container) => {
		const gap = px(ruleOf(css, container).get('gap'));
		const scoped = ruleOf(css, `${container} > .adm-tablelead`).get('margin-block-end');
		const under = px(scoped ?? ruleOf(css, '.adm-tablelead').get('margin-block-end'));

		it('stands its caption nearer the plane than the heading', () => {
			const headingToCaption = gap;
			const captionToPlane = gap + under;
			expect(captionToPlane).toBeLessThan(headingToCaption);
		});

		it('still stands its caption off the plane', () => {
			expect(gap + under).toBeGreaterThan(0);
		});
	}
);

// every tight stack is also `.adm-stack`, so each pair of rules below is matched by one element at
// one specificity, and the one later in the sheet is the one drawn. the cases above read each rule
// alone, and stay green with the tight rule moved above the base one — where the base step would
// set the caption flush on its plane.
describe('a counted table on the tight stack', () => {
	const order = rulesIn(css).map((rule) => rule.selector);
	const at = (selector: string) => {
		const index = order.indexOf(selector);
		if (index === -1) throw new Error(`${selector} is no rule of its own in ./adm.css`);
		return index;
	};

	it.each([
		['.adm-stack', '.adm-stack--tight'],
		['.adm-stack > .adm-tablelead', '.adm-stack--tight > .adm-tablelead']
	])('states %s before %s', (base, tight) => {
		expect(at(tight)).toBeGreaterThan(at(base));
	});
});
