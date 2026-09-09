import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPEARANCE_INPUTS, type StripeAppearance } from './appearance';
import { LENGTH_TOKENS, NUMBER_TOKENS, resolveAppearance } from './resolve';
import tokens from './tokens.css?inline';

// the browser pool, and the only pool that can see any of this. `oklch(from …)` is resolved at
// computed-value time by a real engine and painted to sRGB by a real canvas — a lightweight DOM
// hands both back as the strings they were given, so an assertion there would be asserting the
// fixture rather than the ramp. run with `pnpm test:browser`; it is deliberately outside
// `pnpm test` and outside the deploy gate (see vitest.browser.config.ts).

const sheet = new CSSStyleSheet();
sheet.replaceSync(tokens);

const RGB = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/;

let host: HTMLElement;
let card: HTMLElement;
let hostStyle: HTMLStyleElement;

beforeEach(() => {
	// the two trees the element puts this sheet in, and both are load-bearing: the shadow root is
	// where `:host` applies, and the document is the only tree `@property` registrations are
	// collected from.
	document.adoptedStyleSheets = [sheet];

	host = document.createElement('div');
	host.id = 'donate-host';
	document.body.appendChild(host);

	const shadow = host.attachShadow({ mode: 'open' });
	shadow.adoptedStyleSheets = [sheet];

	// what the element hands the resolver: a node inside the shadow root, which is the card.
	card = document.createElement('div');
	shadow.appendChild(card);

	hostStyle = document.createElement('style');
	document.head.appendChild(hostStyle);
});

afterEach(() => {
	document.adoptedStyleSheets = [];
	host.remove();
	hostStyle.remove();
});

/** where each token of a kind comes out, once it has crossed that kind's carrier. */
type LandsAt = Record<string, (appearance: StripeAppearance) => string | undefined>;

const LENGTH_LANDS_AT: LandsAt = {
	'--_border': (a) => a.rules['.Input']?.border?.split(' ')[0],
	'--_focus-width': (a) => a.rules['.Input:focus']?.boxShadow?.split(' ')[3],
	'--_inset': (a) => a.rules['.AccordionItem']?.paddingLeft,
	'--_r': (a) => a.variables.borderRadius,
	'--_sp1': (a) => a.variables.spacingUnit,
	'--_sp3': (a) => a.rules['.AccordionItem']?.paddingTop,
	'--_t-sm': (a) => a.rules['.Label']?.fontSize
};

/** the same for the number kind, carrying the weight ./tokens.css states for each token. */
const NUMBER_LANDS_AT: Record<
	string,
	{ readonly is: string; readonly at: (appearance: StripeAppearance) => string | undefined }
> = {
	'--_w-bold': { is: '600', at: (a) => a.rules['.Label']?.fontWeight }
};

/** what a host page wrote on the element. */
function seed(declarations: string): void {
	hostStyle.textContent = `#donate-host { ${declarations} }`;
}

describe('what the provider is handed', () => {
	it('fills every variable and every rule the map declares', () => {
		const appearance = resolveAppearance(card);

		expect(Object.keys(appearance.variables).sort()).toEqual([
			'accordionItemSpacing',
			'borderRadius',
			'colorBackground',
			'colorDanger',
			'colorPrimary',
			'colorText',
			'colorTextPlaceholder',
			'colorTextSecondary',
			'fontFamily',
			'fontSizeBase',
			'spacingUnit'
		]);
		expect(Object.keys(appearance.rules).sort()).toEqual([
			'.AccordionItem',
			'.AccordionItem--selected',
			'.Input',
			'.Input:focus',
			'.Label'
		]);
	});

	// a token added to ./appearance.ts's input list and not classified in ./resolve.ts would
	// otherwise arrive as an unresolved string rather than as a failure.
	it('resolves every input the map asks for', () => {
		const appearance = resolveAppearance(card);
		const sent = JSON.stringify(appearance);

		expect(APPEARANCE_INPUTS.length).toBe(18);
		expect(sent).not.toContain('var(');
		expect(sent).not.toContain('oklch');
	});

	// the provider parses these strings inside its own frame and derives further shades from
	// them. a notation it cannot read is not a wrong color, it is no color at all.
	it('states colors in sRGB rather than in the space they are authored in', () => {
		const appearance = resolveAppearance(card);

		expect(appearance.variables.colorPrimary).toMatch(RGB);
		expect(appearance.variables.colorBackground).toMatch(RGB);
		expect(appearance.variables.colorText).toMatch(RGB);
		expect(appearance.variables.colorDanger).toMatch(RGB);
	});

	it('carries the host’s own seed into the provider’s fields', () => {
		seed('--donate-primary: oklch(0.45 0.15 25);');
		const warm = resolveAppearance(card).variables.colorPrimary ?? '';
		seed('--donate-primary: oklch(0.45 0.15 250);');
		const cool = resolveAppearance(card).variables.colorPrimary ?? '';

		const [, warmRed = '0', , warmBlue = '0'] = RGB.exec(warm) ?? [];
		const [, coolRed = '0', , coolBlue = '0'] = RGB.exec(cool) ?? [];

		expect(Number(warmRed)).toBeGreaterThan(Number(coolRed));
		expect(Number(coolBlue)).toBeGreaterThan(Number(warmBlue));
	});

	// the split, proven off a real cascade rather than off a table: the fill inside the provider's
	// frame follows the seed and the ring does not follow it anywhere. only this pool can see it —
	// `--_p` and `--_focus-ring` are unregistered custom properties, so a lightweight DOM hands back
	// the `oklch(from …)` expression and never a colour.
	it('sends the seed to the fills and a fixed rung to the ring', () => {
		seed('--donate-primary: oklch(0.45 0.15 25);');
		const warm = resolveAppearance(card);
		seed('--donate-primary: oklch(0.45 0.15 250);');
		const cool = resolveAppearance(card);

		// the fill moves with the seed and the ring stands still, which is the whole of the split.
		expect(cool.variables.colorPrimary).not.toBe(warm.variables.colorPrimary);
		expect(cool.rules['.Input:focus']?.boxShadow).toBe(warm.rules['.Input:focus']?.boxShadow);
		// and the ring is not the fill under another name: a token quietly repointed at `--_p` would
		// pass the line above on an unseeded card and fail here.
		expect(warm.rules['.Input:focus']?.boxShadow).not.toBe(
			`0 0 0 1px ${warm.variables.colorPrimary}`
		);
	});

	// inside the provider's frame there is no clamped root for an `em` to resolve against, so
	// every length crosses the boundary already stated in absolute units.
	it('states the lengths in units that survive the frame boundary', () => {
		const appearance = resolveAppearance(card);

		expect(appearance.variables.fontSizeBase).toBe('16px');
		expect(appearance.variables.spacingUnit).toBe('4px');
		expect(appearance.variables.borderRadius).toBe('8px');
		// the rail's side pad, which `[part~='payment']` in ./parts.css pulls the box out by: the
		// inset is stated off the clamped root rather than in `em`, so it is already absolute here
		// and the pair still cancels on the other side of the frame.
		expect(appearance.rules['.AccordionItem']?.paddingLeft).toBe('20px');
		// and its top pad, which is a spacing step rather than the inset: `em` on this side of the
		// frame and converted against the root the form resolved to before it crosses.
		expect(appearance.rules['.AccordionItem']?.paddingTop).toBe('12px');
		expect(appearance.rules['.Label']?.fontSize).toBe('14px');
		// the frame is assembled from two tokens rather than from a literal, so both halves have to
		// have crossed: a weight the engine resolved and a colour the canvas painted.
		expect(appearance.rules['.Input']?.border).toMatch(/^1px solid rgb\(\d+, \d+, \d+\)$/);
		expect(appearance.rules['.Input:focus']?.boxShadow).toMatch(/^0 0 0 1px rgb\(\d+, \d+, \d+\)$/);
	});

	// the carrier a length is read through is the whole of what makes an unresolved one visible,
	// and a property that carries the kind but does not hand the value back would fail silently
	// the other way — every length absent from an object nothing else complains about. the table
	// is held to the partition, so a token added to `LENGTH_TOKENS` and not asserted here is a
	// failure rather than an untested carrier.
	it('round-trips every length in the partition through its carrier', () => {
		const appearance = resolveAppearance(card);

		expect(Object.keys(LENGTH_LANDS_AT).sort()).toEqual([...LENGTH_TOKENS].sort());
		for (const [token, lands] of Object.entries(LENGTH_LANDS_AT)) {
			expect(lands(appearance), token).toMatch(/^\d+(?:\.\d+)?px$/);
		}
	});

	// the same for the number kind, and its carrier bounds what may join the partition: a number
	// outside [1, 1000] is not clamped by `font-weight`, it inherits the sentinel and is dropped.
	// a token that is not a weight therefore goes missing here rather than arriving wrong, and
	// only across the part of its range that a weight does not cover.
	it('round-trips every number in the partition through its carrier', () => {
		const appearance = resolveAppearance(card);

		expect(Object.keys(NUMBER_LANDS_AT).sort()).toEqual([...NUMBER_TOKENS].sort());
		for (const [token, lands] of Object.entries(NUMBER_LANDS_AT)) {
			expect(lands.at(appearance), token).toBe(lands.is);
		}
	});

	it('leaves nothing of its own in the card it measured', () => {
		resolveAppearance(card);

		expect(card.childElementCount).toBe(0);
	});
});

describe('a cascade the ramp did not reach', () => {
	// `@property` registrations are collected from the document tree only, so a sheet that reached
	// the engine solely through the shadow root leaves the seed with no initial value and every
	// step derived from it invalid at computed-value time. an invalid step takes the inherited
	// color, which is an ordinary color — sent on, it would be a wrong color rather than an absent
	// one.
	it('sends no color it could not resolve', () => {
		document.adoptedStyleSheets = [];

		const appearance = resolveAppearance(card);

		expect(appearance.variables.colorPrimary).toBeUndefined();
	});

	// and the whole of what a lost registration costs, which is the brand and nothing else. the
	// greys, the corners and the type are literals in ./tokens.css and reach the provider through a
	// path no registration is on — so a page that never got the document sheet still hands Stripe a
	// card in the right shape, missing only its colour. this is the assertion that would catch a
	// step quietly re-derived from a seed: it would go absent here.
	it('sends everything the seed does not feed', () => {
		document.adoptedStyleSheets = [];

		const appearance = resolveAppearance(card);

		// present and resolved, not present and empty: a step re-derived from a seed the page never
		// registered comes back as a `var()` naming nothing, which is a declared key with no colour
		// in it rather than an absent one.
		expect(appearance.variables.colorBackground).toEqual(expect.stringMatching(/\S/));
		expect(appearance.variables.colorText).toEqual(expect.stringMatching(/\S/));
		expect(appearance.variables.borderRadius).toBe('8px');
	});
});

describe('a cascade the sheet never reached at all', () => {
	// the sheet adopted into neither tree: nothing under `:host` was ever declared, so every step
	// is a `var()` naming nothing. sent as what a carrier hands back on its own, this is a card
	// with square corners, no spacing between its rails, and field labels — `MM / YY`, `CVC`, the
	// only thing naming those fields — set at `0px` and at whatever weight the host page's own
	// text happens to be.
	it('sends nothing it could not resolve rather than a page of defaults', () => {
		document.adoptedStyleSheets = [];
		if (host.shadowRoot !== null) host.shadowRoot.adoptedStyleSheets = [];

		const appearance = resolveAppearance(card);

		expect(appearance.variables).not.toHaveProperty('borderRadius');
		expect(appearance.variables).not.toHaveProperty('spacingUnit');
		// the flush stack is the one variable that survives a cascade that resolved nothing: it reads
		// no token, so there was nothing for this reader to fail to resolve.
		expect(appearance.variables.accordionItemSpacing).toBe('0px');
		// not one rule read from the cascade survives, and the whole object is the assertion: a rule
		// left holding a single declaration is a surface this form claims to have drawn on a page
		// where it resolved nothing at all. the rail's rule is the one exception, because what it
		// draws reads nothing — ./appearance.ts sends the bare container whatever resolved, and both
		// its pads are lengths and are dropped here with every other one.
		expect(appearance.rules).toEqual({
			'.AccordionItem': {
				border: 'none',
				boxShadow: 'none',
				borderRadius: '0'
			}
		});
	});
});
