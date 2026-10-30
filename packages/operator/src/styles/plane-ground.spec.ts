import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// a floated date label knocks the box's edge out in two halves, and the upper half is the ground the
// box stands on: `.adm-datebox[data-floated] .adm-datefield__label` in ./adm.css reads `--_ground`,
// and falls back to the page's solid `--admin-page` when nothing sets it. so every plane states
// `--_ground` beside its own fill, and a plane added without it knocks the label out in the page's
// rung on a white plane — a grey notch no other gate sees, because the pool lays nothing out
// (../../vitest.config.ts).
//
// a plane is also a white card on the page's wash, and what makes it one is its shadow rather than
// its fill, which is Lc 0 against the page (./tokens.css at `surfaces and ink`). so every plane
// keeps its border's width in `transparent` and rests on `--admin-elevation-card`, and a plane
// nested in another — white on white — trades the shadow for a `--admin-divider-plane` edge. the
// fill's painters that are not a plane on the page — chrome, and what floats over the flow — are
// named below with what they draw instead.
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
		'.adm-rail__cells .adm-dest > .adm-mark',
		"a destination's mark tile in the rail, which holds a glyph"
	],
	[
		".adm-cropper__handle:is( [data-position='nw'], [data-position='ne'], [data-position='sw'], [data-position='se'] )",
		"a crop handle's grip, which holds nothing"
	]
]);

const painting = rulesIn(css).filter(({ stated }) => stated.get('background') === PLANE_FILL);

const NO_EDGE = 'var(--admin-border-width) solid transparent';
const DIALOG_EDGE = 'var(--admin-border-width) solid var(--admin-divider)';
const CARD_ELEVATION = 'var(--admin-elevation-card)';

/** rules painting the fill that stand a field on it and are not a card on the page, and why. */
const NOT_A_CARD = new Map([
	['.adm-identity', 'the top band, white with the rule under it and no edge round it'],
	['.adm-rail', "the phone's bar, which floats and wears the overlay's edge and shadow"],
	['.adm-moresheet', "the bar's More sheet, which floats as the bar does"],
	['.adm-sheet', 'a sheet, which floats over the flow with the overlay’s edge and shadow'],
	['.adm-dialog', 'the dialog, which takes the edge and the deeper shadow it floats with']
]);

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

describe('every plane is a white card on the page', () => {
	const planes = painting.filter(
		({ selector }) => !NOT_A_GROUND.has(selector) && !NOT_A_CARD.has(selector)
	);

	it('finds the planes it is meant to be guarding', () => {
		// a floor rather than the count today: the card, the panel, the plane, the record, the group
		// and the status section.
		expect(planes.length).toBeGreaterThanOrEqual(6);
	});

	it.each(planes.map(({ selector }) => selector))(
		'%s draws no edge and the card shadow on the wash',
		(selector) => {
			const rule = planes.find((one) => one.selector === selector);
			expect(rule?.stated.get('border')).toBe(NO_EDGE);
			expect(rule?.stated.get('box-shadow')).toBe(CARD_ELEVATION);
		}
	);

	it.each(planes.map(({ selector }) => selector))(
		'%s draws an edge and no shadow nested in another plane',
		(selector) => {
			const nested = rulesIn(css).filter(
				({ selector: one, stated }) =>
					/^:is\([^)]*\) :is\([^)]*\)$/.test(one) && stated.get('box-shadow') === 'none'
			);
			expect(nested).toHaveLength(1);
			const [outer, inner] = (nested[0]?.selector.match(/:is\(([^)]*)\)/g) ?? []).map((list) =>
				list
					.slice(4, -1)
					.split(',')
					.map((one) => one.trim())
			);
			expect(outer).toContain(selector);
			expect(inner).toContain(selector);
			expect(nested[0]?.stated.get('border-color')).toBe('var(--admin-divider-plane)');
		}
	);

	it('draws the dialog with its edge under its own shadow and the plane corner', () => {
		expect(ruleOf(css, '.adm-dialog').get('border')).toBe(DIALOG_EDGE);
		expect(ruleOf(css, '.adm-dialog').get('box-shadow')).toBe('var(--admin-elevation-dialog)');
		expect(ruleOf(css, '.adm-dialog').get('border-radius')).toBe('var(--admin-radius-plane)');
	});

	it('names only rules that still paint the fill', () => {
		for (const selector of NOT_A_CARD.keys()) {
			expect(
				painting.some((one) => one.selector === selector),
				selector
			).toBe(true);
		}
	});
});

describe('a rule drawn inside a white surface is the plane’s quieter one', () => {
	// the rules standing between rows or divisions inside a plane, the dialog or a sheet. each draws
	// `--admin-rule` on its own, `--admin-divider` against the page, and the remap trades its colour
	// for `--admin-divider-plane` wherever it stands on white, which ./tokens.css states at
	// `--admin-divider-plane`.
	const INSIDE = [
		'.adm-section + .adm-section',
		'.adm-setting',
		'.adm-triggers > li + li',
		'.adm-literals > li + li',
		'.adm-disclosure[open]',
		'.adm-sheet__head',
		'.adm-sheet__foot'
	];
	const surfaces = [
		...painting
			.filter(({ selector }) => !NOT_A_GROUND.has(selector) && !NOT_A_CARD.has(selector))
			.map(({ selector }) => selector),
		'.adm-dialog',
		'.adm-sheet'
	];
	const remap = rulesIn(css).filter(
		({ selector, stated }) =>
			/^:is\([^)]*\) :is\([^)]*\)$/.test(selector) &&
			stated.get('border-color') === 'var(--admin-divider-plane)' &&
			!stated.has('box-shadow')
	);
	const [outer, inner] = (remap[0]?.selector.match(/:is\(([^)]*)\)/g) ?? []).map((list) =>
		list
			.slice(4, -1)
			.split(',')
			.map((one) => one.trim())
	);

	it('is drawn by one rule', () => {
		expect(remap).toHaveLength(1);
	});

	it('stands on every white surface that holds rows: each plane, the dialog and a sheet', () => {
		expect([...(outer ?? [])].sort()).toEqual([...surfaces].sort());
	});

	it('names every rule drawn inside one, and each still draws the page’s rule on its own', () => {
		expect([...(inner ?? [])].sort()).toEqual([...INSIDE].sort());
		for (const selector of INSIDE) {
			// a selector may head more than one rule, and the rule is in whichever states it.
			const own = rulesIn(css)
				.filter((rule) => rule.selector === selector)
				.flatMap(({ stated }) => [
					stated.get('border-block-start'),
					stated.get('border-block-end')
				]);
			expect(own, selector).toContain('var(--admin-rule)');
		}
	});
});
