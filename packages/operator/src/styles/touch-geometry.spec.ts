import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// where a finger lands on the phone's own furniture: a row takes the row's floor, and the More
// sheet stands on the bar rather than above it.
//
// **a row is 44px and a small control is 28px, and ./tokens.css spends the small one on density a
// desk screen reads.** a full-width row drawn at a control's height — padding plus a line of type,
// with no floor under it — reads as a row and is a control's target, and nothing on the screen
// says so. the rows below are the ones the sheet draws without a floor of their own to inherit.
//
// **the sheet's footing is the bar's drawn height, which the page's reserve is not.** the reserve
// overstates the bar on purpose, and a sheet standing on it leaves a strip of the page showing
// between the two. so the footing is read here term by term against what the bar draws: the tab's
// floor, the rule over the tabs, and the platform's inset under them.
//
// **a control drawn under the floor is aimed at at it, and its target lies over nothing else.** the
// pool lays nothing out, so where a target reaches is the arithmetic of the tokens its rule and its
// neighbours' rules spend.

const css = sheet('adm.css');
const tokens = sheet('tokens.css');

/** the `var()` names and `env()` calls a value adds up, in the order it spells them. */
const terms = (value: string | undefined) =>
	[...(value ?? '').matchAll(/var\((--[\w-]+)\)|env\(([\w-]+)\)/g)].map(
		([, name, env]) => name ?? `env(${env})`
	);

describe("a row a finger aims at takes the row's floor", () => {
	it.each([
		// the More sheet's way out: the sheet is open on a phone alone, under rows at the floor.
		['.adm-moresheet__close'],
		// the foot of a plane something can be added to, as wide as the plane.
		['.adm-table__add'],
		// an option in a select's list and in the coin picker's: padding and a line or two of type.
		['.adm-selectrow'],
		['.adm-coinrow']
	])('%s', (selector) => {
		expect(ruleOf(css, selector).get('min-block-size')).toBe('var(--admin-touch-min)');
	});
});

/** a length ./tokens.css states in rem, as css pixels. */
const px = (token: string) => {
	const stated = tokens.match(new RegExp(`${token}:\\s*([\\d.]+)rem\\s*;`))?.[1];
	if (stated === undefined) throw new Error(`${token} is not a rem length in ./tokens.css`);
	return Number.parseFloat(stated) * 16;
};

/** what a rule states, found by a selector anywhere in its list. */
const listed = (selector: string) =>
	rulesIn(css).find(({ selector: list }) => list.split(', ').includes(selector))?.stated ??
	new Map<string, string>();

describe("the range slider's thumb is drawn small and aimed at at the floor", () => {
	const thumb = ruleOf(css, '.adm-range__thumb');
	const target = ruleOf(css, '.adm-range__thumb::before');

	it("keeps the thumb drawn at its own size, which clears 2.5.8's 24px across", () => {
		expect(thumb.get('inline-size')).toBe('var(--admin-space-8)');
		expect(thumb.get('block-size')).toBe('var(--admin-space-8)');
		expect(px('--admin-space-8')).toBeGreaterThanOrEqual(24);
	});

	it('lays a target over it out of flow, at the floor in the block axis and centred there', () => {
		expect(target.get('content')).toBe("''");
		expect(target.get('position')).toBe('absolute');
		expect(terms(target.get('block-size'))).toEqual(['--admin-touch-min']);
		expect(terms(target.get('inset-block-start'))).toEqual(['--admin-touch-min']);
	});

	// two thumbs a stop apart on a narrow panel stand closer than the floor, and a target wider
	// than its thumb would cover the neighbour's drawn body and take its press.
	it("keeps the target at the thumb's drawn size in the inline axis, so it never reaches a neighbour", () => {
		expect(target.get('inline-size')).toBeUndefined();
		expect(target.get('inset-inline-start')).toBeUndefined();
		expect(target.get('inset-inline')).toBe('0');
	});
});

describe("a select's list counts the row's floor", () => {
	// the rule the coin picker's list shares, which is the first to name the select's on a line of
	// its own.
	const list = ruleOf(css, '.adm-selectlist');

	// four and a half rows of the floor, and the list's own padding and border at both ends on top,
	// so a list of four rows stands whole and a fifth shows half of itself.
	it('is four and a half rows of the floor tall, plus its padding and border', () => {
		expect(list.get('padding')).toBe('var(--admin-space-2)');
		expect(list.get('border')).toBe('var(--admin-hairline)');
		expect(terms(tokens.match(/--admin-hairline:\s*([^;]+);/)?.[1])[0]).toBe(
			'--admin-border-width'
		);
		const height = list.get('max-block-size');
		expect(height).toMatch(/4\.5 \* var\(--admin-touch-min\)/);
		expect(terms(height)).toEqual(['--admin-touch-min', '--admin-space-2', '--admin-border-width']);
	});
});

describe('the More sheet stands on the bar', () => {
	const root = ruleOf(css, ':root:has(.adm-shell > .adm-rail)');
	const positioner = ruleOf(
		css,
		"[data-scope='dialog'][data-part='positioner']:has(> .adm-moresheet)"
	);

	it('stands its card on the top edge of the bar, and caps it to what is left above', () => {
		expect(positioner.get('inset-block-end')).toBe('var(--_bar-height)');
		expect(terms(ruleOf(css, '.adm-moresheet').get('max-block-size'))).toEqual(['--_bar-height']);
	});

	it("adds up the bar's height out of what the bar draws", () => {
		const tab = ruleOf(css, '.adm-dest');
		const bar = ruleOf(css, '.adm-rail');
		const rule = tokens.match(/--admin-rule:\s*([^;]+);/)?.[1];

		// the tab's floor, which its contents are shorter than: ./adm.css argues it at the reserve.
		expect(tab.get('min-block-size')).toBe('var(--admin-touch-min)');
		// the rule the bar draws over its tabs, whose width is the first term of the rule.
		expect(bar.get('border-block-start')).toBe('var(--admin-rule)');
		expect(terms(rule)[0]).toBe('--admin-border-width');
		// the platform's inset, under the tabs.
		expect(bar.get('padding-block-end')).toBe('env(safe-area-inset-bottom)');

		expect(terms(root.get('--_bar-height'))).toEqual([
			'--admin-touch-min',
			'--admin-border-width',
			'env(safe-area-inset-bottom)'
		]);
	});
});

describe('a control drawn under the floor takes a target at it', () => {
	/** how far a target `--admin-touch-min` square reaches past a control drawn at `drawn`. */
	const reach = (drawn: string) => (px('--admin-touch-min') - px(drawn)) / 2;

	/** the one token a single-term value spends. */
	const token = (value: string | undefined) => {
		const [only, ...more] = terms(value);
		if (only === undefined || more.length > 0) throw new Error(`not one token: ${value}`);
		return only;
	};

	it.each([
		['.adm-markbtn::before'],
		['.adm-logo__presses > .adm-btn::before'],
		['.adm-rows__row > .adm-rows__remove::before'],
		['.adm-wellwrap::before']
	])('%s is the floor square, centred on the border box', (selector) => {
		const target = listed(selector);

		expect(target.get('content')).toBe("''");
		expect(target.get('position')).toBe('absolute');
		expect(target.get('inline-size')).toBe('var(--admin-touch-min)');
		expect(target.get('block-size')).toBe('var(--admin-touch-min)');
		// centred off the padding box's `100%`, which a border leaves on the border box's centre.
		for (const side of ['inset-block-start', 'inset-inline-start']) {
			expect(target.get(side)).toBe('calc((100% - var(--admin-touch-min)) / 2)');
		}
		expect(target.get('inset')).toBeUndefined();
	});

	it("meets the logo's other press and reaches the square's edge, and no further", () => {
		const presses = ruleOf(css, '.adm-logo__presses');
		const press = token(ruleOf(css, '.adm-logo__presses > .adm-btn').get('inline-size'));

		expect(presses.get('gap')).toBe(
			'calc(var(--admin-touch-min) - var(--admin-control-height-sm))'
		);
		expect(press).toBe('--admin-control-height-sm');
		expect(px(token(presses.get('inset-block-start')))).toBe(reach(press));
		expect(px(token(presses.get('inset-inline-end')))).toBe(reach(press));
	});

	it("stops a row's Remove short of its box and of the Remove on the next row", () => {
		const [rowStep, boxStep] = terms(ruleOf(css, '.adm-rows').get('gap'));
		const drawn = token(ruleOf(css, '.adm-rows__row > .adm-rows__remove').get('inline-size'));

		expect(reach(drawn)).toBeGreaterThan(0);
		expect(reach(drawn)).toBeLessThan(px(boxStep ?? ''));
		expect(2 * reach(drawn)).toBeLessThan(px(rowStep ?? ''));
	});

	it("stops the brand colour's well short of its box", () => {
		const drawn = token(ruleOf(css, '.adm-swatch--well').get('inline-size'));
		const step = token(ruleOf(css, '.adm-field > .adm-actions:has(> .adm-wellwrap)').get('gap'));

		expect(reach(drawn)).toBeGreaterThan(0);
		expect(reach(drawn)).toBeLessThan(px(step));
	});
});

describe("a crop handle keeps 2.5.8's 24px inside the square", () => {
	// the viewport clips what lies past the image, so a handle on a square at the image's edge keeps
	// only the half of its target inside the square: the reach on that side is the whole target.
	const CORNERS =
		".adm-cropper__handle:is( [data-position='nw'], [data-position='ne'], [data-position='sw'], [data-position='se'] )";

	it.each([
		['a corner', `${CORNERS}::before`, 'inset'],
		[
			'the top and bottom edges',
			".adm-cropper__handle:is([data-position='n'], [data-position='s'])::before",
			'inset-block'
		],
		[
			'the side edges',
			".adm-cropper__handle:is([data-position='e'], [data-position='w'])::before",
			'inset-inline'
		]
	])('%s', (_, selector, property) => {
		const target = rulesIn(css).find((rule) => rule.selector === selector)?.stated;

		expect(target?.get(property)).toBe('calc(50% - var(--admin-space-8))');
		expect(px('--admin-space-8')).toBeGreaterThanOrEqual(24);
	});

	it('stands a corner over the edges its target overlaps', () => {
		const corner = rulesIn(css).find((rule) => rule.selector === CORNERS)?.stated;

		expect(corner?.get('z-index')).toBe('1');
	});
});
