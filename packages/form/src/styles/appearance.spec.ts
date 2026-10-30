import { describe, expect, it } from 'vitest';
import { APPEARANCE_INPUTS, stripeAppearance, type TokenReader } from './appearance';

// node pool, no browser. what is decidable here is the mapping — which token feeds which
// Stripe variable, what happens to a value that did not resolve, and the em-to-px conversion —
// all of which is arithmetic over strings. whether those tokens resolve to real colors in a
// real cascade is the browser pool's question, and ./tokens.browser.spec.ts drives this same
// function off one.

/**
 * a cascade that resolved cleanly, with the brand seeded and a 16px root.
 *
 * the brand is deliberately not the ring's own value and not the registered default, which is grey:
 * a fixture where the two matched would pass every assertion below with the brand feeding the focus
 * ring or the ring feeding a fill.
 */
const RESOLVED: Record<string, string> = {
	'--_p': 'oklch(0.45 0.13 264)',
	'--_p-hover': 'oklch(0.395 0.13 264)',
	'--_focus-ring': 'oklch(0.27 0.013 250)',
	'--_n1': 'oklch(0.994 0.002 250)',
	'--_n2': 'oklch(0.986 0.003 250)',
	'--_n10': 'oklch(0.54 0.019 250)',
	'--_n11': 'oklch(0.49 0.017 250)',
	'--_n12': 'oklch(0.27 0.013 250)',
	'--_edge-control': 'oklch(0.794 0.016 250)',
	'--_bad': 'oklch(0.485 0.18 27)',
	'--_r': '8px',
	'--_r-in': '4px',
	'--_border': '1px',
	'--_focus-width': '1px',
	'--_sp1': '0.25em',
	'--_sp3': '0.75em',
	'--_sp4': '1em',
	'--_sp5': '1.25em',
	'--_t-sm': '0.875em',
	'--_w-bold': '600',
	'font-family': 'system-ui, sans-serif',
	'font-size': '16px'
};

/**
 * the rail's container off a cascade that resolved: a choice box, the white face inside the outline
 * that finds a box, at the control corner, and the room inside it.
 */
const RAIL = {
	boxShadow: 'none',
	border: '1px solid oklch(0.794 0.016 250)',
	borderRadius: '4px',
	backgroundColor: 'oklch(0.994 0.002 250)',
	paddingTop: '12px',
	paddingBottom: '12px',
	paddingLeft: '16px',
	paddingRight: '16px'
};

/** and off one that did not: the edge, corner, ground and pads are read from tokens, so only the refused lift is left. */
const RAIL_WITHOUT_ROOM = {
	boxShadow: 'none'
};

/** a reader over that cascade, with any property replaced or blanked for one test. */
function reader(overrides: Record<string, string> = {}): TokenReader {
	const table = { ...RESOLVED, ...overrides };
	return (property) => table[property] ?? '';
}

/** the same reader, recording what was asked for. */
function recordingReader(): { read: TokenReader; asked: string[] } {
	const asked: string[] = [];
	const inner = reader();
	return {
		asked,
		read: (property) => {
			asked.push(property);
			return inner(property);
		}
	};
}

describe('stripeAppearance', () => {
	it('maps the ramp onto the appearance Stripe accepts', () => {
		const appearance = stripeAppearance(reader());

		expect(appearance.theme).toBe('flat');
		expect(appearance.variables).toEqual({
			colorPrimary: 'oklch(0.45 0.13 264)',
			colorBackground: 'oklch(0.994 0.002 250)',
			colorText: 'oklch(0.27 0.013 250)',
			colorTextSecondary: 'oklch(0.49 0.017 250)',
			colorTextPlaceholder: 'oklch(0.49 0.017 250)',
			colorDanger: 'oklch(0.485 0.18 27)',
			fontFamily: 'system-ui, sans-serif',
			fontSizeBase: '14px',
			// the provider's own rail names, held at the size our rows draw theirs at rather than
			// scaled off the root above — otherwise the two kinds of row stop being one list.
			accordionItemLabelFontSize: '14px',
			borderRadius: '8px',
			spacingUnit: '4px',
			// the item gap: each rail is a box of its own, stood apart from the next by the step
			// the card's asks stand apart by.
			accordionItemSpacing: '20px'
		});
		expect(appearance.rules).toEqual({
			// the control edge and the border weight are both read, so the card fields carry the
			// same frame the form's own fields do rather than a restatement of it.
			'.Input': {
				border: '1px solid oklch(0.794 0.016 250)',
				// the control corner the rail around it and the card's own fields are drawn at, rather
				// than the plane's corner `variables.borderRadius` carries.
				borderRadius: '4px',
				backgroundColor: 'oklch(0.986 0.003 250)',
				// the length `[part~='field']` in ./parts.css draws the card's own fields at, worn
				// here a second time: the box a donor types into is one size wherever it is painted.
				fontSize: '16px'
			},
			// a pointer over a field steps its outline, as it does over the card's own.
			'.Input:hover': { borderColor: 'oklch(0.54 0.019 250)' },
			// and a refused field keeps its danger edge under the pointer, sent after the rule above
			// so the step along the ramp does not take it back.
			'.Input--invalid:hover': { borderColor: 'oklch(0.485 0.18 27)' },
			// each rail is a choice box of its own: the white face, the control outline, the
			// control corner, and no lift.
			'.AccordionItem': RAIL,
			// the open rail is the chosen one and is marked by the primary's edge on the same face.
			'.AccordionItem--selected': {
				borderColor: 'oklch(0.45 0.13 264)',
				backgroundColor: 'oklch(0.994 0.002 250)'
			},
			// a pointer steps the edge, along the ramp on a closed rail and along the brand on the
			// open one, and the face holds.
			'.AccordionItem:hover': {
				borderColor: 'oklch(0.54 0.019 250)',
				backgroundColor: 'oklch(0.994 0.002 250)'
			},
			'.AccordionItem--selected:hover': {
				borderColor: 'oklch(0.395 0.13 264)',
				backgroundColor: 'oklch(0.994 0.002 250)'
			},
			// a focused rail is rung the way ./rows.css rings ours: the plain ring hugging a closed
			// rail's edge, and on the open one a band of the face laid against the primary's edge
			// first, with the ring outside it. the transparent outline is what forced colours paint.
			'.AccordionItem:focus-visible': {
				outline: '1px solid transparent',
				boxShadow: '0 0 0 1px oklch(0.27 0.013 250)'
			},
			'.AccordionItem--selected:focus-visible': {
				boxShadow: '0 0 0 1px oklch(0.994 0.002 250), 0 0 0 2px oklch(0.27 0.013 250)'
			},
			// the ring is the accent's, not the primary's: a ring is a line rather than a fill, and
			// the same swap is made on every focused control the form draws itself.
			'.Input:focus': { boxShadow: '0 0 0 1px oklch(0.27 0.013 250)' },
			'.Label': {
				fontSize: '14px',
				color: 'oklch(0.49 0.017 250)',
				fontWeight: '600'
			}
		});
	});

	it('asks for exactly the properties it declares', () => {
		const { read, asked } = recordingReader();
		stripeAppearance(read);

		expect([...new Set(asked)].sort()).toEqual([...APPEARANCE_INPUTS].sort());
	});

	it("sets the provider's root to the size the rows its fields sit in are drawn at", () => {
		// `.name` in ./rows.css is that size, and the card's own base is a step above it: a field
		// drawn at the base reads larger than the row it stands in.
		const appearance = stripeAppearance(reader());

		expect(appearance.variables.fontSizeBase).toBe('14px');
		expect(appearance.variables.fontSizeBase).not.toBe(RESOLVED['font-size']);
	});

	it("draws the typed field at the length the card's own fields carry", () => {
		// both halves of `[part~='field']` in ./parts.css, which the root the provider is given sits
		// under: the floor holds at the bottom of the clamp band, and the root wins at the top of it.
		const floored = stripeAppearance(reader({ 'font-size': '15px' }));
		const raised = stripeAppearance(reader({ 'font-size': '18px' }));

		expect(floored.rules['.Input']?.fontSize).toBe('16px');
		expect(raised.rules['.Input']?.fontSize).toBe('18px');
		// and the field is never dragged under that floor by the root the rows set: a base moved
		// down here is a field a donor types into zooming the page it is painted on.
		expect(floored.variables.fontSizeBase).toBe('13.125px');
	});

	it('converts em lengths against the root the form actually resolved to', () => {
		// the clamp floor in tokens.css, which is what a host with a shrunken root gets.
		const appearance = stripeAppearance(reader({ 'font-size': '15px' }));

		expect(appearance.variables.spacingUnit).toBe('3.75px');
		expect(appearance.rules['.Label']?.fontSize).toBe('13.125px');
	});

	it('passes an absolute length through untouched', () => {
		const appearance = stripeAppearance(reader({ '--_sp1': '5px' }));

		expect(appearance.variables.spacingUnit).toBe('5px');
	});

	it('leaves an em length alone when the root font-size could not be read', () => {
		// the root is the one length that is dropped instead of passed through: every other `em`
		// inside the frame resolves against it, so a relative root there is a scale the form has
		// handed to whatever font size the provider happened to apply.
		const appearance = stripeAppearance(reader({ 'font-size': '' }));

		expect(appearance.variables).not.toHaveProperty('fontSizeBase');
		expect(appearance.variables.spacingUnit).toBe('0.25em');
	});

	it('omits a variable whose token did not resolve, and keeps the rest', () => {
		const appearance = stripeAppearance(reader({ '--_p': '' }));

		expect(appearance.variables).not.toHaveProperty('colorPrimary');
		expect(appearance.variables.colorText).toBe('oklch(0.27 0.013 250)');
	});

	it('treats a whitespace-only read as an absent one', () => {
		const appearance = stripeAppearance(reader({ '--_n12': '   \n' }));

		expect(appearance.variables).not.toHaveProperty('colorText');
	});

	it('trims a resolved value rather than sending its padding', () => {
		const appearance = stripeAppearance(reader({ '--_p': '  oklch(0.4 0.1 20)  ' }));

		expect(appearance.variables.colorPrimary).toBe('oklch(0.4 0.1 20)');
	});

	it('never lets an unresolved var() reach Stripe', () => {
		// a var() names a property that does not exist inside Stripe's iframe, so it would
		// arrive as nothing at all rather than as a wrong color.
		const appearance = stripeAppearance(() => 'var(--_p)');

		expect(appearance.variables).toEqual({});
		// the one rule left is the rail's refused lift, which reads no token; every value it does
		// read is dropped here with every other one rather than sent carrying the var().
		expect(appearance.rules).toEqual({ '.AccordionItem': RAIL_WITHOUT_ROOM });
	});

	it('drops a rule whose every declaration failed to resolve', () => {
		const appearance = stripeAppearance(reader({ '--_focus-width': '' }));

		expect(appearance.rules).not.toHaveProperty('.Input:focus');
		expect(appearance.rules).toHaveProperty('.Input');
	});

	// the whole of the split, at the one boundary where both colours are handed to somebody else's
	// code: a fill takes the primary and a line takes the accent, and neither seed reaches the
	// other's surface.
	it('sends the primary to the fills and the accent to the ring', () => {
		const appearance = stripeAppearance(reader());

		expect(appearance.variables.colorPrimary).toBe('oklch(0.45 0.13 264)');
		expect(appearance.rules['.Input:focus']?.boxShadow).toBe('0 0 0 1px oklch(0.27 0.013 250)');
	});

	it('draws no ring when the ring step did not resolve', () => {
		// a ring at a weight against no colour is Stripe's own default edge thickened, which reads
		// as a field focused by nobody.
		const appearance = stripeAppearance(reader({ '--_focus-ring': '' }));

		expect(appearance.rules).not.toHaveProperty('.Input:focus');
		expect(appearance.rules).toHaveProperty('.Input');
	});

	it('still rings a focused field when the primary did not resolve', () => {
		// the ring is a rung of the ladder and takes nothing from the seed, so a form that lost the
		// brand keeps every surface saying where the caret is.
		const appearance = stripeAppearance(reader({ '--_p': '' }));

		expect(appearance.rules['.Input:focus']?.boxShadow).toBe('0 0 0 1px oklch(0.27 0.013 250)');
	});

	it('keeps the part of a rule that did resolve', () => {
		const appearance = stripeAppearance(reader({ '--_edge-control': '' }));

		expect(appearance.rules['.Input']).toEqual({
			borderRadius: '4px',
			backgroundColor: 'oklch(0.986 0.003 250)',
			fontSize: '16px'
		});
	});

	it('sends no frame at all when only its weight resolved', () => {
		// half a border is a rule that states a width against no colour, which Stripe renders as
		// its own default edge — a frame nobody chose rather than the one the form draws.
		const appearance = stripeAppearance(reader({ '--_border': '' }));

		expect(appearance.rules['.Input']).toEqual({
			borderRadius: '4px',
			backgroundColor: 'oklch(0.986 0.003 250)',
			fontSize: '16px'
		});
	});

	it('draws the frame a zero weight asked for', () => {
		// an empty string is the only "did not resolve" a reader has — ./resolve.ts hands one back
		// for a length that fell to its sentinel — so a `0px` arriving here is a weight the ramp
		// states, and a frame drawn at nothing is not the same thing as no frame. reading it as an
		// absence would be the inverse of the defect: a deliberate zero silently ignored.
		const appearance = stripeAppearance(reader({ '--_border': '0px' }));

		expect(appearance.rules['.Input']?.border).toBe('0px solid oklch(0.794 0.016 250)');
	});

	it('sends no rail edge at all when only its weight resolved', () => {
		// half a border is a width against no colour, which the provider draws as its own default
		// edge: the same answer the field's frame above gives.
		const appearance = stripeAppearance(reader({ '--_edge-control': '' }));

		expect(appearance.rules['.AccordionItem']).not.toHaveProperty('border');
		expect(appearance.rules['.AccordionItem']?.borderRadius).toBe('4px');
	});

	it('marks the open rail with the seed’s edge, and only with it', () => {
		// a rail is picked from a set, so it is marked rather than filled: the primary edge on the
		// same white face, never a primary fill under the fields it holds.
		const marked = stripeAppearance(reader());
		const unseeded = stripeAppearance(reader({ '--_p': '' }));

		expect(marked.rules['.AccordionItem--selected']?.borderColor).toBe(RESOLVED['--_p']);
		expect(marked.rules['.AccordionItem--selected']?.backgroundColor).toBe(RESOLVED['--_n1']);
		// a card that lost its brand keeps the open rail on the white face rather than sending a
		// mark against no colour.
		expect(unseeded.rules['.AccordionItem--selected']).toEqual({
			backgroundColor: RESOLVED['--_n1']
		});
	});

	// every control a pointer can act on answers it (`--_p-hover` in ./tokens.css): the outline steps
	// one rung along the ramp on a closed rail and one step along the brand on the open one.
	it('steps a rail’s edge under the pointer and holds its face', () => {
		const appearance = stripeAppearance(reader());

		expect(appearance.rules['.AccordionItem:hover']).toEqual({
			borderColor: RESOLVED['--_n10'],
			backgroundColor: RESOLVED['--_n1']
		});
		expect(appearance.rules['.AccordionItem--selected:hover']).toEqual({
			borderColor: RESOLVED['--_p-hover'],
			backgroundColor: RESOLVED['--_n1']
		});
	});

	// each hover rule is built from one step of its own, so a cascade that lost that step alone drops
	// only the edge it fed and keeps the face, or the rule, that did resolve.
	it('drops the closed rail’s and the field’s pointer edge when the ramp step did not resolve', () => {
		const appearance = stripeAppearance(reader({ '--_n10': '' }));

		expect(appearance.rules).not.toHaveProperty('.Input:hover');
		expect(appearance.rules['.AccordionItem:hover']).toEqual({
			backgroundColor: RESOLVED['--_n1']
		});
		expect(appearance.rules['.AccordionItem--selected:hover']).toEqual({
			borderColor: RESOLVED['--_p-hover'],
			backgroundColor: RESOLVED['--_n1']
		});
		expect(appearance.rules['.Input--invalid:hover']).toEqual({ borderColor: RESOLVED['--_bad'] });
	});

	it('drops the open rail’s pointer edge when the brand’s hover step did not resolve', () => {
		const appearance = stripeAppearance(reader({ '--_p-hover': '' }));

		expect(appearance.rules['.AccordionItem--selected:hover']).toEqual({
			backgroundColor: RESOLVED['--_n1']
		});
		expect(appearance.rules['.AccordionItem:hover']).toEqual({
			borderColor: RESOLVED['--_n10'],
			backgroundColor: RESOLVED['--_n1']
		});
		expect(appearance.rules['.Input:hover']).toEqual({ borderColor: RESOLVED['--_n10'] });
	});

	it('sends no refused field’s pointer rule when the danger step did not resolve', () => {
		// with nothing to hold, the provider's own refusal is left as it draws it.
		const appearance = stripeAppearance(reader({ '--_bad': '' }));

		expect(appearance.rules).not.toHaveProperty('.Input--invalid:hover');
		expect(appearance.rules['.Input:hover']).toEqual({ borderColor: RESOLVED['--_n10'] });
	});

	it('rings no rail when the ring step did not resolve', () => {
		// a ring against no colour is the provider's default ring thickened, for the reason the
		// field's ring above is dropped.
		const appearance = stripeAppearance(reader({ '--_focus-ring': '' }));

		expect(appearance.rules).not.toHaveProperty('.AccordionItem:focus-visible');
		expect(appearance.rules).not.toHaveProperty('.AccordionItem--selected:focus-visible');
	});

	it('rings the open rail as a closed one when the face’s band cannot be laid', () => {
		// with no face to lay against the primary's edge, the open rail keeps the plain ring the
		// closed rule gives it rather than a ring sent around a band of nothing.
		const appearance = stripeAppearance(reader({ '--_n1': '' }));

		expect(appearance.rules).not.toHaveProperty('.AccordionItem--selected:focus-visible');
		expect(appearance.rules['.AccordionItem:focus-visible']?.boxShadow).toBe(
			'0 0 0 1px oklch(0.27 0.013 250)'
		);
	});

	it('pads a rail and spaces the rails in a unit the frame survives', () => {
		// every one of these is an `em` step and the rail is painted where the form's root does not
		// exist, so a smaller root has to change them on this side of the frame.
		const appearance = stripeAppearance(reader({ 'font-size': '15px' }));
		const rail = appearance.rules['.AccordionItem'];

		expect([rail?.paddingTop, rail?.paddingBottom]).toEqual(['11.25px', '11.25px']);
		expect([rail?.paddingLeft, rail?.paddingRight]).toEqual(['15px', '15px']);
		expect(appearance.variables.accordionItemSpacing).toBe('18.75px');
	});

	it('returns an empty map rather than throwing when nothing resolves', () => {
		// the form still has to render on a page where the stylesheet did not adopt; Stripe on
		// its own defaults is a mismatch someone can see, an exception at mount is a form that
		// never appears.
		const appearance = stripeAppearance(() => '');

		expect(appearance).toEqual({
			theme: 'flat',
			variables: {},
			rules: { '.AccordionItem': RAIL_WITHOUT_ROOM }
		});
	});
});
