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
// neighbours' rules spend. the members are read off the shared rule's own list, and each is named
// here with its holder and the neighbours it stands off, so a member joining the list without both
// fails.

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
		// an option in a select's list: padding and a line or two of type.
		['.adm-selectrow']
	])('%s', (selector) => {
		expect(ruleOf(css, selector).get('min-block-size')).toBe('var(--admin-touch-min)');
	});
});

/** a length ./tokens.css states — in rem at the root's 16px, in px, or as another token — in css pixels. */
const px = (token: string): number => {
	const stated = tokens.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim() ?? '';
	const [, figure, unit] = stated.match(/^(\d*\.?\d+)(rem|px)?$/) ?? [];
	if (figure !== undefined && (unit !== undefined || Number(figure) === 0)) {
		return Number(figure) * (unit === 'rem' ? 16 : 1);
	}
	const alias = stated.match(/^var\((--[\w-]+)\)$/)?.[1];
	if (alias !== undefined) return px(alias);
	throw new Error(`${token} is not a length in ./tokens.css: ${stated}`);
};

/**
 * a length a rule spells, in css pixels: tokens, numbers, `+ - * /`, brackets, `calc()`, `min()`
 * and `max()`, with `100%` standing for `percent`. a name in `bound` is read from there rather than
 * from ./tokens.css — a length in pixels, or another value to spell out — which is how a property
 * the sheet declares, or one the machine states inline, is given the value a case reads it at. a
 * value spelled any other way throws rather than reading as zero.
 */
const evaluate = (
	value: string | undefined,
	percent?: number,
	bound: Readonly<Record<string, string | number>> = {}
): number => {
	const source = (value ?? '').trim();
	const lexer = /\s*(?:var\((--[\w-]+)\)|(\d*\.?\d+)(%|px|rem)?|(calc\(|min\(|max\(|[-+*/(),]))/y;
	const items: (number | string)[] = [];
	const named = (name: string): number => {
		const given = bound[name];
		if (given === undefined) return px(name);
		return typeof given === 'number' ? given : evaluate(given, percent, bound);
	};
	while (lexer.lastIndex < source.length) {
		const hit = lexer.exec(source);
		if (hit === null) throw new Error(`not a length this spec reads: ${source}`);
		const [, name, figure, unit, operator] = hit;
		if (name !== undefined) items.push(named(name));
		else if (figure === undefined) items.push(operator === 'calc(' ? '(' : (operator ?? ''));
		else if (unit !== '%') items.push(Number(figure) * (unit === 'rem' ? 16 : 1));
		else if (percent === undefined)
			throw new Error(`a percentage with nothing to be one of: ${source}`);
		else items.push((Number(figure) / 100) * percent);
	}
	let at = 0;
	const factor = (): number => {
		const item = items[at++];
		if (typeof item === 'number') return item;
		if (item === '-') return -factor();
		if (item === '(') {
			const inner = sum();
			if (items[at++] !== ')') throw new Error(`an unclosed bracket in: ${source}`);
			return inner;
		}
		if (item === 'min(' || item === 'max(') {
			const terms = [sum()];
			while (items[at] === ',') {
				at += 1;
				terms.push(sum());
			}
			if (items[at++] !== ')') throw new Error(`an unclosed bracket in: ${source}`);
			return item === 'min(' ? Math.min(...terms) : Math.max(...terms);
		}
		throw new Error(`not a length this spec reads: ${source}`);
	};
	const product = (): number => {
		let total = factor();
		while (items[at] === '*' || items[at] === '/') {
			total = items[at++] === '*' ? total * factor() : total / factor();
		}
		return total;
	};
	const sum = (): number => {
		let total = product();
		while (items[at] === '+' || items[at] === '-') {
			total = items[at++] === '+' ? total + product() : total - product();
		}
		return total;
	};
	const total = sum();
	if (at !== items.length) throw new Error(`not a length this spec reads: ${source}`);
	return total;
};

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
	const list = ruleOf(css, '.adm-selectlist');

	// four and a half rows of the floor, and the list's own padding and border at both ends on top,
	// so a list of four rows stands whole and a fifth shows half of itself.
	it('is four and a half rows of the floor tall, plus its padding and border', () => {
		expect(list.get('padding')).toBe('var(--admin-space-2)');
		// the overlay's whole edge, whose width is the term the height below counts.
		expect(list.get('border')).toBe('var(--admin-border-width) solid var(--admin-overlay-border)');
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

		// the tab's floor, which its contents are shorter than: ./adm.css argues it at the reserve.
		expect(tab.get('min-block-size')).toBe('var(--admin-touch-min)');
		// the overlay's edge the bar draws over its tabs, whose width is its first term.
		expect(bar.get('border-block-start')).toBe(
			'var(--admin-border-width) solid var(--admin-overlay-border)'
		);
		// the platform's inset, under the tabs.
		expect(bar.get('padding-block-end')).toBe('env(safe-area-inset-bottom)');

		expect(terms(root.get('--_bar-height'))).toEqual([
			'--admin-touch-min',
			'--admin-border-width',
			'env(safe-area-inset-bottom)'
		]);
	});
});

/**
 * a length a rule spells, read against a holder of no size at all, or nothing where it spells one
 * this spec cannot read. a size that is a share of its holder is then at its least, so what is
 * still at the floor is at the floor on any holder.
 */
const lengthOr = (value: string | undefined) => {
	try {
		return evaluate(value, 0);
	} catch {
		return Number.NaN;
	}
};

/** every rule drawing a box at least the floor each way on a `::before`, and its members without the pseudo. */
const floorRules = rulesIn(css).filter(
	({ selector, stated }) =>
		selector.split(', ').every((member) => member.endsWith('::before')) &&
		[stated.get('inline-size'), stated.get('block-size')].every(
			(size) => lengthOr(size) >= px('--admin-touch-min')
		)
);
const members = (floorRules[0]?.selector.split(', ') ?? []).map((member) =>
	member.replace(/::before$/, '')
);

/** a control as drawn: its border box, and the border its target's insets are measured inside. */
type Drawn = { readonly inline: number; readonly block: number; readonly border: number };

/** how big a target is, and how far it reaches past each edge of the control it is drawn on. */
type Target = {
	readonly inline: number;
	readonly block: number;
	readonly inlineStart: number;
	readonly inlineEnd: number;
	readonly blockStart: number;
	readonly blockEnd: number;
};

/**
 * one member of the shared rule: the rule that makes the control the box its target is placed
 * against, the control as drawn, and each neighbour as what it is, how far the target reaches
 * toward it and the room the control stands off it by.
 */
type Member = {
	readonly holder: string;
	readonly drawn: () => Drawn;
	readonly neighbours: () => readonly (readonly [string, number, number])[];
};

/** the width a border shorthand states, from its first term; none stated is none drawn. */
const widthOf = (border: string | undefined) =>
	border === undefined ? 0 : evaluate(border.split(' ')[0]);

const BUTTON_BORDER = () => widthOf(ruleOf(css, '.adm-btn').get('border'));
const ROW_REMOVE = '.adm-rows__row > .adm-rows__remove';
const CHIP = '.adm-choicechips:not(.adm-choicechips--cards) > .adm-choicechip';
const GLOBE = '.adm-identity__lead > .adm-btn';
const PAGE_LINK = '.adm-identity > .adm-pagelink > .adm-btn';
const WAY_OUT = '.adm-identity > .adm-signout > .adm-btn';

/**
 * a small button in the top bar at its narrowest, a mark alone between its padding: the globe always
 * is one, and a way out is one where it carries no word. a wider way out reaches less far across.
 */
const barButton = (): Drawn => {
	const small = ruleOf(css, '.adm-btn--sm');
	const border = BUTTON_BORDER();
	return {
		inline: 2 * (border + evaluate(small.get('padding-inline'))) + px('--admin-mark-size'),
		block: evaluate(small.get('min-block-size')),
		border
	};
};

/** the top bar's edges above and below a button in it, each a step of the bar's breathing room off it. */
const barEdges = (member: string): (readonly [string, number, number])[] => {
	const at = target(member);
	const bar = ruleOf(css, '.adm-identity');
	const room = (evaluate(bar.get('min-block-size')) - barButton().block) / 2;
	return [
		["the bar's edge above", at.blockStart, room],
		["the bar's edge below", at.blockEnd, room]
	];
};

const MEMBERS: Record<string, Member> = {
	// a row's Remove is a button (../components/controls/Button.jsx draws `.adm-btn`), the box's
	// height and square.
	[ROW_REMOVE]: {
		holder: '.adm-btn',
		drawn: () => {
			const remove = ruleOf(css, ROW_REMOVE);
			return {
				inline: evaluate(remove.get('inline-size')),
				block: evaluate(remove.get('min-block-size')),
				border: BUTTON_BORDER()
			};
		},
		neighbours: () => {
			const at = target(ROW_REMOVE);
			const [rowStep, boxStep] = terms(ruleOf(css, '.adm-rows').get('gap'));
			return [
				['its box', at.inlineStart, px(boxStep ?? '')],
				["the next row's Remove", at.blockEnd + at.blockStart, px(rowStep ?? '')]
			];
		}
	},
	// the label round the brand colour's well hugs it, and draws no border of its own.
	'.adm-wellwrap': {
		holder: '.adm-wellwrap',
		drawn: () => {
			const well = ruleOf(css, '.adm-swatch--well');
			return {
				inline: evaluate(well.get('inline-size')),
				block: evaluate(well.get('block-size')),
				border: widthOf(ruleOf(css, '.adm-wellwrap').get('border'))
			};
		},
		neighbours: () => [
			[
				'its box',
				target('.adm-wellwrap').inlineStart,
				evaluate(ruleOf(css, '.adm-field > .adm-actions:has(> .adm-wellwrap)').get('gap'))
			]
		]
	},
	// a choice chip in a wrapping row, drawn at the small control's height and never narrower than
	// the floor: the `<label>` round the radio or checkbox is the holder, and a press on it is a
	// press on the box inside.
	[CHIP]: {
		holder: '.adm-choicechip',
		drawn: () => {
			const chip = ruleOf(css, CHIP);
			return {
				inline: evaluate(chip.get('min-inline-size')),
				block: evaluate(chip.get('min-block-size')),
				border: widthOf(ruleOf(css, '.adm-choicechip').get('border'))
			};
		},
		neighbours: () => {
			const at = target(CHIP);
			const row = ruleOf(css, '.adm-choicechips');
			return [
				['the chip beside it', at.inlineEnd + at.inlineStart, evaluate(row.get('column-gap'))],
				['the chip on the next line', at.blockEnd + at.blockStart, evaluate(row.get('row-gap'))]
			];
		}
	},
	// the site's globe leading the top bar, an icon-only small button in a box exactly its width.
	[GLOBE]: {
		holder: '.adm-btn',
		drawn: () => ({
			...barButton(),
			inline: evaluate(ruleOf(css, '.adm-identity__lead').get('inline-size'))
		}),
		neighbours: () => {
			const at = target(GLOBE);
			const bar = ruleOf(css, '.adm-identity');
			return [
				["the window's edge", at.inlineStart, evaluate(bar.get('padding-inline'))],
				['the name after it', at.inlineEnd, evaluate(bar.get('gap'))],
				...barEdges(GLOBE)
			];
		}
	},
	// the link to the organisation's public page, just before the way out: a mark alone under the
	// middle breakpoint, which is its narrowest. its target and the way out's both reach into the
	// gap between them, so the two reaches together are held to it.
	[PAGE_LINK]: {
		holder: '.adm-btn',
		drawn: barButton,
		neighbours: () => {
			const at = target(PAGE_LINK);
			const bar = ruleOf(css, '.adm-identity');
			return [
				['the name before it', at.inlineStart, evaluate(bar.get('gap'))],
				[
					'the way out after it',
					at.inlineEnd + target(WAY_OUT).inlineStart,
					evaluate(bar.get('gap'))
				],
				...barEdges(PAGE_LINK)
			];
		}
	},
	// the way out ending the top bar: the button inside the `.adm-signout` holder, which is the form
	// packages/app/src/routes/_app.tsx posts and a span in ../components/shell/AppShell.jsx's specimen.
	[WAY_OUT]: {
		holder: '.adm-btn',
		drawn: barButton,
		neighbours: () => {
			const at = target(WAY_OUT);
			const bar = ruleOf(css, '.adm-identity');
			return [
				['the name before it', at.inlineStart, evaluate(bar.get('gap'))],
				["the window's edge", at.inlineEnd, evaluate(bar.get('padding-inline'))],
				...barEdges(WAY_OUT)
			];
		}
	}
};

/**
 * the target the shared rule draws on a member. a size and an inset are measured from the holder's
 * padding box, so `100%` is the drawn size less the border and the border is added back to place
 * the target against the border box.
 */
function target(member: string): Target {
	const entry = MEMBERS[member];
	if (entry === undefined) throw new Error(`${member} is not a member named in this spec`);
	const drawn = entry.drawn();
	const stated = new Map(floorRules[0]?.stated ?? []);
	const inline = evaluate(stated.get('inline-size'), drawn.inline - 2 * drawn.border);
	const block = evaluate(stated.get('block-size'), drawn.block - 2 * drawn.border);
	const inlineStart =
		-drawn.border - evaluate(stated.get('inset-inline-start'), drawn.inline - 2 * drawn.border);
	const blockStart =
		-drawn.border - evaluate(stated.get('inset-block-start'), drawn.block - 2 * drawn.border);
	return {
		inline,
		block,
		inlineStart,
		inlineEnd: inline - drawn.inline - inlineStart,
		blockStart,
		blockEnd: block - drawn.block - blockStart
	};
}

describe('a control drawn under the floor takes a target at it', () => {
	// a control joins the list rather than growing a target of its own.
	it('is drawn by one rule, which every such control shares', () => {
		expect(floorRules).toHaveLength(1);
		expect(members.length).toBeGreaterThan(0);
	});

	it('names every member of that rule here, with its holder and its neighbours', () => {
		expect([...members].sort()).toEqual(Object.keys(MEMBERS).sort());
	});

	// the target is absolute, so a holder that is not positioned hands it to whatever ancestor is,
	// and it lands somewhere else on the screen as an invisible press. it is a pseudo-element of the
	// holder, so the pointer it shows is the holder's own.
	it.each(members)('%s is placed against its own box and shows its pointer', (member) => {
		const holder = ruleOf(css, MEMBERS[member]?.holder ?? '');
		const naming = rulesIn(css).filter(({ selector }) => selector.split(', ').includes(member));

		expect(holder.get('position')).toBe('relative');
		for (const { stated } of naming) expect(stated.get('position') ?? 'relative').toBe('relative');
		expect(holder.get('cursor') ?? 'auto').not.toBe('auto');
	});

	it.each(members)('%s reaches the floor and covers the whole control', (member) => {
		const at = target(member);
		expect(at.inline).toBeGreaterThanOrEqual(px('--admin-touch-min'));
		expect(at.block).toBeGreaterThanOrEqual(px('--admin-touch-min'));
		for (const reach of [at.inlineStart, at.inlineEnd, at.blockStart, at.blockEnd]) {
			expect(reach).toBeGreaterThanOrEqual(0);
		}
	});

	it.each(members)('%s lies over nothing beside it', (member) => {
		const neighbours = MEMBERS[member]?.neighbours() ?? [];

		expect(neighbours.length).toBeGreaterThan(0);
		for (const [what, reach, room] of neighbours) {
			expect(reach, `${member} toward ${what}`).toBeLessThanOrEqual(room);
		}
	});

	it('shows the closed pointer over a closed well, on the label a pointer lands on', () => {
		const closed = ruleOf(css, '.adm-wellwrap:has(> :disabled)').get('cursor');

		expect(closed).toBeDefined();
		expect(closed).not.toBe(ruleOf(css, '.adm-wellwrap').get('cursor'));
	});
});

describe('a crop handle reaches 24px into the square, and leaves 24px in its middle to drag', () => {
	// the viewport clips what lies past the image, so a handle on a square at the image's edge keeps
	// only the half of its target inside the square: the reach on that side is the whole target. a
	// press on a handle never moves the square, so what is left in the middle is where a drag starts.
	const CORNERS =
		".adm-cropper__handle:is( [data-position='nw'], [data-position='ne'], [data-position='sw'], [data-position='se'] )";
	const ACROSS = ".adm-cropper__handle:is([data-position='n'], [data-position='s'])";
	const DOWN = ".adm-cropper__handle:is([data-position='e'], [data-position='w'])";
	const stated = (selector: string) =>
		rulesIn(css).find((rule) => rule.selector === selector)?.stated ?? new Map<string, string>();

	const HANDLES = [
		['a corner', `${CORNERS}::before`, 'inset'],
		['an edge across the top or bottom', `${ACROSS}::before`, 'inset-block'],
		['an edge down a side', `${DOWN}::before`, 'inset-inline']
	] as const;

	/**
	 * how far a handle's target reaches into a square drawn `side` across, from the corner or edge it
	 * moves: half the handle less the inset its `::before` states, at the reach the square states.
	 */
	const reach = (selector: string, property: string, side: number): number => {
		const handle = evaluate(stated(CORNERS).get('inline-size'));
		const inset = evaluate(stated(selector).get(property), handle, {
			'--_handle-reach': ruleOf(css, '.adm-cropper__selection').get('--_handle-reach') ?? '',
			'--crop-width': side
		});
		return handle / 2 - inset;
	};

	it.each(HANDLES)(
		"%s reaches 2.5.8's 24px into a square of 72px or more",
		(_, selector, property) => {
			for (const side of [72, 120, 400]) {
				expect(reach(selector, property, side), `on a square of ${side}`).toBe(
					px('--admin-space-8')
				);
				expect(reach(selector, property, side)).toBeGreaterThanOrEqual(24);
			}
		}
	);

	it.each(HANDLES)(
		'%s leaves 24px clear in the middle of a smaller square',
		(_, selector, property) => {
			for (const side of [71, 60, 48, 40]) {
				const clear = side - 2 * reach(selector, property, side);
				expect(clear, `on a square of ${side}`).toBeCloseTo(24);
				expect(reach(selector, property, side)).toBeLessThan(24);
			}
		}
	);

	it('stands a corner over the edges its target overlaps', () => {
		// an edge stating no step stands at the one every positioned box without one does.
		const step = (selector: string) => Number(stated(selector).get('z-index') ?? 0);

		expect(step(CORNERS)).toBeGreaterThan(step(ACROSS));
		expect(step(CORNERS)).toBeGreaterThan(step(DOWN));
	});
});
