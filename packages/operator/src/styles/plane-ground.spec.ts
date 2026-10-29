import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// a floated date label knocks the box's edge out in two halves, and the upper half is the ground the
// box stands on: `.adm-datebox[data-floated] .adm-datefield__label` in ./adm.css reads `--_ground`,
// and falls back to the page when nothing sets it. so every plane states `--_ground` beside its own
// fill, and a plane added without it knocks the label out in the page's rung on a white box — a grey
// notch no other gate sees, because the pool lays nothing out (../../vitest.config.ts).
//
// what counts as a plane is derived rather than listed: every rule that paints the plane's fill. the
// few that paint it and are not a ground a field stands on are named below with why, so a new rule
// painting the fill fails here until it either states the ground or says why it holds no field.

const css = sheet('adm.css');

const PLANE_FILL = 'var(--admin-surface)';

/** rules painting the plane's fill that no date field ever stands on, and why. */
const NOT_A_GROUND = new Map([
	['.adm-menulist, .adm-selectlist', "a menu's and a select's list, which hold rows and no field"],
	['.adm-cal', 'the calendar a date field opens, which holds day presses and no field'],
	['.adm-table [data-pin]', "a pinned cell, inside a table's plane, which states the ground"],
	[
		".adm-cropper__handle:is( [data-position='nw'], [data-position='ne'], [data-position='sw'], [data-position='se'] )",
		"a crop handle's grip, which holds nothing"
	]
]);

const painting = rulesIn(css).filter(({ stated }) => stated.get('background') === PLANE_FILL);

describe('every plane states the ground a floated date label knocks out in', () => {
	it('is read by the floated label, with the page as its fallback', () => {
		expect(
			ruleOf(css, '.adm-datebox[data-floated] .adm-datefield__label').get('background')
		).toMatch(/var\(--_ground, var\(--admin-page\)\)/);
	});

	it.each(
		painting.filter(({ selector }) => !NOT_A_GROUND.has(selector)).map(({ selector }) => selector)
	)('%s states its own fill as the ground', (selector) => {
		const rule = painting.find((one) => one.selector === selector);
		expect(rule?.stated.get('--_ground')).toBe(PLANE_FILL);
	});

	it('names only rules that still paint the fill and state no ground', () => {
		for (const selector of NOT_A_GROUND.keys()) {
			const rule = painting.find((one) => one.selector === selector);
			expect(rule, selector).toBeDefined();
			expect(rule?.stated.get('--_ground'), selector).toBeUndefined();
		}
	});
});
