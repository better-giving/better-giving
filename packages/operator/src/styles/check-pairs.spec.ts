import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from './sheet-rule.testing';

// boxes standing side by side in a named group — the webhook event picker's Gifts, Donors and
// Recurring gifts lines, ../components/forms/CheckboxGroups.jsx. a label sits between its own box
// and the next one, so the only thing saying which box it belongs to is which of the two gaps is
// plainly the wider. at twice the box's own gap the line reads as evenly spaced; three times is the
// floor here. and the gap between options stays inside the gap between groups, so an option is never
// stood further from its neighbour than one group is from the next.

const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** the one `var()` a stated length names, resolved through ./tokens.css as css pixels. */
const px = (value: string | undefined) => {
	const token = value?.match(/^var\((--admin-space-\d+)\)$/)?.[1];
	if (token === undefined) throw new Error(`${value} is not one spacing step`);
	const stated = tokens.match(new RegExp(`${token}:\\s*([\\d.]+)rem\\s*;`))?.[1];
	if (stated === undefined) throw new Error(`${token} is not a rem length in ./tokens.css`);
	return Number.parseFloat(stated) * 16;
};

/** the column half of a `gap` shorthand, which is its second value or its only one. */
const columnOf = (gap: string | undefined) => {
	const parts = (gap ?? '').split(' ');
	return parts[1] ?? parts[0];
};

describe('an inline group of boxes reads as box-and-label pairs', () => {
	const pairGap = px(columnOf(ruleOf(css, '.adm-check').get('gap')));
	const betweenPairs = px(
		ruleOf(css, '.adm-checkgroups > .adm-fieldset > .adm-checkgroup').get('column-gap')
	);
	const betweenGroups = px(ruleOf(css, '.adm-checkgroups').get('gap'));

	it('stands one pair off the next by at least three times the gap a box keeps from its own label', () => {
		expect(betweenPairs).toBeGreaterThanOrEqual(pairGap * 3);
	});

	it('stands one pair off the next by no more than one group stands off the next', () => {
		expect(betweenPairs).toBeLessThanOrEqual(betweenGroups);
	});
});
