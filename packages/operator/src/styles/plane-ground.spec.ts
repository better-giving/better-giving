import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// a floated date label knocks the box's edge out in two halves, and the upper half is the ground the
// box stands on: `.adm-datebox[data-floated] .adm-datefield__label` in ./adm.css reads `--_ground`,
// and falls back to the page's solid `--admin-page` when nothing sets it. so every plane states
// `--_ground` beside its own fill, and a plane added without it knocks the label out in the page's
// step on a step-1 plane — a grey notch no other gate sees, because the pool lays nothing out
// (../../vitest.config.ts).
//
// a plane is also a card on the page's wash, and what makes it one is radix's subtle border, step 6,
// round a step-1 face, and no shadow (./tokens.css at `surfaces and ink`). a plane nested in another
// is drawn the same way. the fill's painters that are not a plane on the page — chrome, and what
// floats over the flow — are named below with what they draw instead.
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

const PLANE_EDGE = 'var(--admin-rule)';
const tokens = sheet('tokens.css');

/** the value ./tokens.css states for a custom property, spaces collapsed. */
const token = (name: string): string | undefined =>
	tokens
		.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
		?.trim()
		.replace(/\s+/g, ' ');

/** rules painting the fill that stand a field on it and are not a card on the page, and why. */
const NOT_A_CARD = new Map([
	['.adm-identity', 'the top band, step 1 with the rule under it and no edge round it'],
	['.adm-rail', "the phone's bar, which floats and wears the overlay's edge"],
	['.adm-moresheet', "the bar's More sheet, which floats as the bar does"],
	['.adm-sheet', 'a sheet, which floats over the flow with the overlay’s edge']
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

describe('every plane is a step-1 card with a step-6 edge on the page', () => {
	const planes = painting.filter(
		({ selector }) => !NOT_A_GROUND.has(selector) && !NOT_A_CARD.has(selector)
	);

	it('finds the planes it is meant to be guarding', () => {
		// a floor rather than the count today: the card, the panel, the plane, the record, the group
		// and the status section.
		expect(planes.length).toBeGreaterThanOrEqual(6);
	});

	it('paints a plane on step 1 and its edge on step 6', () => {
		expect(token('--admin-surface')).toBe('var(--admin-neutral-1)');
		expect(token('--admin-rule')).toBe('var(--admin-border-width) solid var(--admin-divider)');
		expect(token('--admin-divider')).toBe('var(--hairline)'); // the registry's step 6 in light
	});

	it.each(planes.map(({ selector }) => selector))(
		'%s draws the step-6 edge and no shadow',
		(selector) => {
			const rule = planes.find((one) => one.selector === selector);
			expect(rule?.stated.get('border')).toBe(PLANE_EDGE);
			expect(rule?.stated.has('box-shadow')).toBe(false);
			expect(rule?.stated.get('border-radius')).toBe('var(--admin-radius-plane)');
		}
	);

	it('draws a plane nested in another the same way, with no rule re-colouring its edge', () => {
		// one subtle border for every card, nested or not: nothing may trade a nested plane's edge
		// for another colour or put a shadow back on it.
		const planeNames = planes.map(({ selector }) => selector);
		// a rule whose subject — the compound after its last combinator — names a plane.
		const subject = (selector: string) => selector.match(/\s(:is\([^)]*\)|[^\s]+)$/)?.[1] ?? '';
		const nested = rulesIn(css).filter(
			({ selector, stated }) =>
				planeNames.some((name) => subject(selector).includes(name)) &&
				(stated.has('border-color') || stated.has('box-shadow'))
		);
		expect(nested.map(({ selector }) => selector)).toEqual([]);
	});

	it("states the dialog surface's own fill as the ground, which the registry paints", () => {
		// the surface is the registry's `ds-dialog-surface` on `--popover`, step 1 as the plane's
		// fill is, so the floated label inside a dialog knocks out in the colour it stands on.
		expect(ruleOf(css, '.adm-dialog__surface').get('--_ground')).toBe(PLANE_FILL);
		expect(token('--admin-surface')).toBe('var(--admin-neutral-1)');
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

describe('what floats over the flow is flat, with the step-6 edge', () => {
	it('edges an overlay on step 6', () => {
		expect(token('--admin-overlay-border')).toBe('var(--admin-neutral-6)');
	});

	it.each(['.adm-menulist, .adm-selectlist', '.adm-cal'])(
		'%s draws the overlay edge and no shadow',
		(selector) => {
			const rule = rulesIn(css).find((one) => one.selector === selector)?.stated;
			expect(rule?.get('border')).toBe(
				'var(--admin-border-width) solid var(--admin-overlay-border)'
			);
			expect(rule?.has('box-shadow')).toBe(false);
		}
	);

	it('draws the phone bar, the More sheet and a sheet with the overlay edge on the side they stand on', () => {
		for (const selector of ['.adm-rail', '.adm-moresheet', '.adm-sheet']) {
			const rule = ruleOf(css, selector);
			expect(rule.get('border-block-start'), selector).toBe(
				'var(--admin-border-width) solid var(--admin-overlay-border)'
			);
			expect(rule.has('box-shadow'), selector).toBe(false);
		}
	});

	it('edges a destination’s mark tile in the rail with the subtle border', () => {
		const tile = rulesIn(css).find(
			({ selector }) => selector === '.adm-rail__cells .adm-dest > .adm-mark'
		)?.stated;
		expect(tile?.get('border')).toBe(PLANE_EDGE);
		expect(tile?.has('box-shadow')).toBe(false);
	});
});

describe('no shadow is depth', () => {
	// radix's flat look: a `box-shadow` here is a ring, a link's bleed or the scrim's spread — no
	// offset and no blur, only a spread — and never a lift. ./tokens.css holds no elevation token.
	const RING = /^(inset )?0 0 0 \S/;
	/** a shadow's layers, split on the commas no parenthesis holds: a ring outside a band is two. */
	const layers = (value: string): string[] => {
		const out = [''];
		let depth = 0;
		for (const ch of value) {
			if (ch === '(') depth++;
			else if (ch === ')') depth--;
			if (ch === ',' && depth === 0) out.push('');
			else out[out.length - 1] += ch;
		}
		return out.map((one) => one.trim());
	};
	const shadows = (['adm.css', 'base.css'] as const).flatMap((name) =>
		rulesIn(sheet(name))
			.filter(({ stated }) => stated.has('box-shadow'))
			.map(({ selector, stated }) => ({
				at: `${name} ${selector}`,
				value: stated.get('box-shadow') ?? ''
			}))
	);

	it('finds the shadows it is meant to be reading', () => {
		// the focus rings alone are more than this; a floor rather than the count today.
		expect(shadows.length).toBeGreaterThan(10);
	});

	it('draws every shadow as a spread with no offset and no blur', () => {
		expect(
			shadows
				.filter(
					({ value }) => value !== 'none' && !layers(value).every((layer) => RING.test(layer))
				)
				.map(({ at, value }) => `${at}: ${value}`)
		).toEqual([]);
	});

	it('declares no elevation token', () => {
		expect(tokens.match(/--admin-elevation-[\w-]+/g) ?? []).toEqual([]);
	});
});

describe('a rule drawn inside a plane is the page’s own', () => {
	// the rules standing between rows or divisions inside a plane, the dialog or a sheet. each draws
	// `--admin-rule`, step 6, inside a card or out, and nothing re-colours it where it stands.
	const INSIDE = [
		'.adm-section + .adm-section',
		'.adm-setting',
		'.adm-triggers > li + li',
		'.adm-literals > li + li',
		'.adm-disclosure[open]',
		'.adm-sheet__head',
		'.adm-sheet__foot'
	];

	it.each(INSIDE)('%s draws the page’s rule', (selector) => {
		const own = rulesIn(css)
			.filter((rule) => rule.selector === selector)
			.flatMap(({ stated }) => [stated.get('border-block-start'), stated.get('border-block-end')]);
		expect(own, selector).toContain('var(--admin-rule)');
	});

	it('declares one rule colour, with no quieter one for a plane', () => {
		expect(tokens.match(/--admin-(divider-plane|rule-plane)\b/g) ?? []).toEqual([]);
		expect(
			rulesIn(css).filter(({ stated }) =>
				/divider-plane|rule-plane/.test([...stated.values()].join(' '))
			)
		).toEqual([]);
	});
});
