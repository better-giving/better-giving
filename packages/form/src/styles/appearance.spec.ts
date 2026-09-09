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
	'--_focus-ring': 'oklch(0.27 0.002 264)',
	'--_n1': 'oklch(0.995 0.001 264)',
	'--_n11': 'oklch(0.49 0.002 264)',
	'--_n12': 'oklch(0.27 0.002 264)',
	'--_n3': 'oklch(0.965 0.001 264)',
	'--_edge-control': 'oklch(0.855 0.001 264)',
	'--_bad': 'oklch(0.495 0.19 27)',
	'--_r': '8px',
	'--_border': '1px',
	'--_focus-width': '1px',
	'--_inset': '20px',
	'--_sp1': '0.25em',
	'--_sp3': '0.75em',
	'--_t-sm': '0.875em',
	'--_w-bold': '600',
	'font-family': 'system-ui, sans-serif',
	'font-size': '16px'
};

/** the rail's container off a cascade that resolved: nothing of its own, and the room around it. */
const RAIL = {
	border: 'none',
	boxShadow: 'none',
	borderRadius: '0',
	paddingTop: '12px',
	paddingLeft: '20px',
	paddingRight: '20px'
};

/** and off one that did not: both pads are read from tokens, so only the bare pair is left. */
const RAIL_WITHOUT_ROOM = {
	border: 'none',
	boxShadow: 'none',
	borderRadius: '0'
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
			colorBackground: 'oklch(0.995 0.001 264)',
			colorText: 'oklch(0.27 0.002 264)',
			colorTextSecondary: 'oklch(0.49 0.002 264)',
			colorTextPlaceholder: 'oklch(0.49 0.002 264)',
			colorDanger: 'oklch(0.495 0.19 27)',
			fontFamily: 'system-ui, sans-serif',
			fontSizeBase: '16px',
			borderRadius: '8px',
			spacingUnit: '4px',
			// the step's own rhythm: with the rails drawn bare, space is all that parts them.
			accordionItemSpacing: '0px'
		});
		expect(appearance.rules).toEqual({
			// the control edge and the border weight are both read, so the card fields carry the
			// same frame the form's own fields do rather than a restatement of it.
			'.Input': {
				border: '1px solid oklch(0.855 0.001 264)',
				backgroundColor: 'oklch(0.995 0.001 264)'
			},
			// each rail is its own container in the stack and draws no edge and no lift; the side
			// pad is room for a block the provider paints wider than the rail's content, and
			// `[part~='payment']` in ./parts.css pulls the box back onto the seam by that step.
			// the top pad is what keeps the method's name off the top edge of the fill the open
			// rail carries.
			'.AccordionItem': RAIL,
			// the open rail carries the ramp's faint fill, so which method is expanded is legible
			// from the band rather than only from what is under it.
			'.AccordionItem--selected': { backgroundColor: 'oklch(0.965 0.001 264)' },
			// the ring is the accent's, not the primary's: a ring is a line rather than a fill, and
			// the same swap is made on every focused control the form draws itself.
			'.Input:focus': { boxShadow: '0 0 0 1px oklch(0.27 0.002 264)' },
			'.Label': {
				fontSize: '14px',
				color: 'oklch(0.49 0.002 264)',
				fontWeight: '600'
			}
		});
	});

	it('asks for exactly the properties it declares', () => {
		const { read, asked } = recordingReader();
		stripeAppearance(read);

		expect([...new Set(asked)].sort()).toEqual([...APPEARANCE_INPUTS].sort());
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
		const appearance = stripeAppearance(reader({ 'font-size': '' }));

		expect(appearance.variables).not.toHaveProperty('fontSizeBase');
		expect(appearance.variables.spacingUnit).toBe('0.25em');
	});

	it('omits a variable whose token did not resolve, and keeps the rest', () => {
		const appearance = stripeAppearance(reader({ '--_p': '' }));

		expect(appearance.variables).not.toHaveProperty('colorPrimary');
		expect(appearance.variables.colorText).toBe('oklch(0.27 0.002 264)');
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

		// the one variable left reads no token: the rails stack flush, which is a length stated in
		// ./appearance.ts rather than a step off the ladder that failed to resolve.
		expect(appearance.variables).toEqual({ accordionItemSpacing: '0px' });
		// the one rule left is the rail, and both the lengths it reads — the top pad and the side
		// room — are dropped here with every other one rather than sent carrying the var().
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
		expect(appearance.rules['.Input:focus']?.boxShadow).toBe('0 0 0 1px oklch(0.27 0.002 264)');
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

		expect(appearance.rules['.Input:focus']?.boxShadow).toBe('0 0 0 1px oklch(0.27 0.002 264)');
	});

	it('keeps the part of a rule that did resolve', () => {
		const appearance = stripeAppearance(reader({ '--_edge-control': '' }));

		expect(appearance.rules['.Input']).toEqual({
			backgroundColor: 'oklch(0.995 0.001 264)'
		});
	});

	it('sends no frame at all when only its weight resolved', () => {
		// half a border is a rule that states a width against no colour, which Stripe renders as
		// its own default edge — a frame nobody chose rather than the one the form draws.
		const appearance = stripeAppearance(reader({ '--_border': '' }));

		expect(appearance.rules['.Input']).toEqual({
			backgroundColor: 'oklch(0.995 0.001 264)'
		});
	});

	it('draws the frame a zero weight asked for', () => {
		// an empty string is the only "did not resolve" a reader has — ./resolve.ts hands one back
		// for a length that fell to its sentinel — so a `0px` arriving here is a weight the ramp
		// states, and a frame drawn at nothing is not the same thing as no frame. reading it as an
		// absence would be the inverse of the defect: a deliberate zero silently ignored.
		const appearance = stripeAppearance(reader({ '--_border': '0px' }));

		expect(appearance.rules['.Input']?.border).toBe('0px solid oklch(0.855 0.001 264)');
	});

	it('draws the rails bare whatever the cascade resolved', () => {
		// the rail's edge and lift read no token, so a cascade that lost its edge, its weight and
		// its seed still hands the provider the same bare container rather than one Stripe frames
		// itself.
		const appearance = stripeAppearance(
			reader({ '--_edge-control': '', '--_border': '', '--_p': '' })
		);

		expect(appearance.rules['.AccordionItem']).toEqual(RAIL);
	});

	it('fills the open rail from the ramp rather than from the seed', () => {
		// the fill is a rung, so a card that lost its brand still says which method is open. it is
		// the same faint step the ramp already rests other things on — the ramp doing its job, not a
		// meaning borrowed from one of them.
		const appearance = stripeAppearance(reader({ '--_p': '' }));

		expect(appearance.rules['.AccordionItem--selected']).toEqual({
			backgroundColor: 'oklch(0.965 0.001 264)'
		});
	});

	it('leaves the open rail unpainted when the faint step did not resolve', () => {
		// a rule with nothing in it is a claim that the open rail was drawn. without the step the
		// open rail is told from the closed ones only by the fields standing under it.
		const appearance = stripeAppearance(reader({ '--_n3': '' }));

		expect(appearance.rules).not.toHaveProperty('.AccordionItem--selected');
		expect(appearance.rules).toHaveProperty('.AccordionItem');
	});

	it('keeps a rail name off the top edge of its band, in a unit the frame survives', () => {
		// the open rail is filled, so it has a top edge of its own for the name to sit against. the
		// step is `em` and the rail is painted where the form's root does not exist, so what a
		// smaller root has to change is the pad as well: a length sent as `0.75em` there resolves
		// against whatever font size the provider applied.
		const appearance = stripeAppearance(reader({ 'font-size': '15px' }));

		expect(appearance.rules['.AccordionItem']?.paddingTop).toBe('11.25px');
	});

	it('pads each rail by the inset the card body itself is padded by', () => {
		// the pad and the pull `[part~='payment']` in ./parts.css draws are one decision: the box
		// goes out to the card's own edges by the body's inset and the pad puts the fields back on
		// the seam every other control sits on. the two are the same token, so this is the half of
		// that pair a spec can see — the other half is a length in a stylesheet.
		const appearance = stripeAppearance(reader());

		expect([
			appearance.rules['.AccordionItem']?.paddingLeft,
			appearance.rules['.AccordionItem']?.paddingRight
		]).toEqual(['20px', '20px']);
		// and it is the inset rather than the spacing unit: a fixture where the two matched would
		// pass with either token feeding the pad.
		expect(appearance.variables.spacingUnit).not.toBe('20px');
	});

	it('returns an empty map rather than throwing when nothing resolves', () => {
		// the form still has to render on a page where the stylesheet did not adopt; Stripe on
		// its own defaults is a mismatch someone can see, an exception at mount is a form that
		// never appears.
		const appearance = stripeAppearance(() => '');

		expect(appearance).toEqual({
			theme: 'flat',
			variables: { accordionItemSpacing: '0px' },
			rules: { '.AccordionItem': RAIL_WITHOUT_ROOM }
		});
	});
});
