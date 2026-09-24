// the provider's augmentation is what types `cdp()`'s `send`.
/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// the provider's own handle on the test page, aliased: this file's `page` writes css into the host
// document and is the one a reader here is looking for.
import { page as browser, cdp, userEvent } from 'vitest/browser';
import { createCoinPicker } from '../coin-picker';
import { NETWORK_TINTS } from '../coins';
import { createDepositBlock, type DepositView } from '../deposit';
import { defineDonateForm, DONATE_FORM_TAG } from '../element';
import { createRows, type Row, type RowMark } from '../embed/rows';
import type { CheckoutPorts } from '../ports';
import type { FormConfig } from '../v1';
import { createSkeleton } from '../views';
import layoutSheet from './layout.css?inline';
import partSheet from './parts.css?inline';
import tokens from './tokens.css?inline';

// the browser pool, and the only pool that can see any of this. what is measured here is which
// declaration an engine keeps when a host page's `::part()` rule and this element's own adopted
// rule both set the same property on the same part — a comparison that exists only where there is
// a real cascade with a real encapsulation boundary in it. happy-dom resolves neither. run with
// `pnpm test:browser`; it is deliberately outside `pnpm test` and outside the deploy gate (see
// vitest.browser.config.ts).
//
// the whole element is mounted rather than a shadow root assembled by hand, because the question
// is about the four sheets ../element.ts adopts, in the order it adopts them, through the code
// that adopts them. a hand-built host would be asserting the fixture.
//
// css cascading and inheritance level 5, §6.1, applies its criteria in this order: origin and
// importance, then context, then element-attached styles, then layers, then specificity, then
// order of appearance. context is the encapsulation boundary, and it is compared before layers and
// before specificity — so which of the two rules wins is settled without either one's layering or
// its specificity ever being read.
//
// the rule that produces, measured here rather than assumed: a host page's normal `::part()` rule
// takes the property, from any layer and at any specificity, and the element's own normal rule
// cannot hold it. an important declaration inside the shadow root is the only thing that can, and
// it holds against an important host rule too, because for important declarations the same
// comparison runs the other way.
//
// `overflow` on `card` is the property under test: ../styles/parts.css sets it to a literal on the
// part rather than to a token, so nothing in the reading depends on whether the ramp resolved.
//
// the second question this file answers needs the same two things and nothing else the pool has.
// ../styles/tokens.css splits the two colours a host seeds — the primary fills, the accent marks —
// on the promise that neither is ever drawn touching the other, and the place that promise is
// spent is the focus ring. which ring a control draws is settled by a selector matching rendered
// markup and by `:focus-visible` matching a real keyboard, and neither is decidable off a token
// value: a rule naming a part nothing carries resolves to nothing at all and reads as a fix.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000, 25_000, 100_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly', 'yearly'],
	paymentMethods: ['card', 'ach', 'apple_pay'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

const PORTS: CheckoutPorts = {
	quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 }),
	confirm: async () => ({ kind: 'succeeded' }),
	resume: async () => ({ kind: 'succeeded' }),
	status: async () => ({ state: 'waiting' }),
	now: () => 1_700_000_000_000
};

let tags = 0;
const written: HTMLStyleElement[] = [];

type Mounted = {
	/** the tag this element is registered under, which is what a host page's selector names. */
	readonly tag: string;
	/** the element itself, which is where the light-DOM node a provider paints into hangs. */
	readonly host: HTMLElement;
	readonly shadow: ShadowRoot;
	/** the `card` part, as the element itself drew it. */
	readonly card: HTMLElement;
};

/**
 * one device pixel, which is as close as a reading taken off drawn ink, or a fractional box against
 * an integer-rounded one, can be held.
 */
const DEVICE_PIXEL = 1;

/** lets the configuration read settle before the card is inspected. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * the transitions one control is running, finished — which is what a colour has to be read after.
 *
 * ../styles/motion.css fades the ground and the edge of every surface a donor presses over
 * `--_dur-fast`, so `getComputedStyle` on the tick a click returns on reports a colour part way
 * between the two states. that reads as the state the donor just left and passes an assertion
 * written against it, which is the failure this exists to keep out.
 *
 * a cancelled transition rejects, and a cancelled one is one that has already been overtaken —
 * whatever replaced it is in this list too.
 */
function landed(element: HTMLElement): Promise<unknown> {
	return Promise.all(
		element.getAnimations().map((animation) => animation.finished.catch(() => undefined))
	);
}

/**
 * one element on the page, upgraded, carrying the sheets its own code adopted.
 *
 * a tag per mount: a custom element registry is per document and a name is defined once, which is
 * the same reason `defineDonateForm` takes a tag in ../element.dom.spec.ts.
 */
async function mount(config: FormConfig = CONFIG): Promise<Mounted> {
	const tag = `${DONATE_FORM_TAG}-${(tags += 1)}`;
	defineDonateForm(
		{
			loadConfig: async () => config,
			checkout: (config) => ({
				input: { config, ports: PORTS },
				cadence: () => {},
				offerFund: () => {},
				offerCrypto: () => {},
				rows: () => {},
				stop: () => {}
			}),
			challenge: () => ({ reset: () => {}, stop: () => {} })
		},
		tag
	);

	const host = document.createElement(tag);
	host.setAttribute('form', config.formId);
	document.body.appendChild(host);
	await settle();

	const shadow = host.shadowRoot;
	if (shadow === null) throw new Error('the element has not upgraded');
	const card = shadow.querySelector("[part~='card']");
	if (card === null) throw new Error('the element rendered no card');
	return { tag, host, shadow, card: card as HTMLElement };
}

/** one box given what a donor would have typed into it, the way a keystroke reaches the flow. */
function fill(shadow: ShadowRoot, id: string, value: string): void {
	const field = shadow.querySelector(id) as HTMLInputElement;
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** the press onto the next step, on whichever step is on screen. */
function onward(shadow: ShadowRoot): void {
	(
		shadow.querySelector(
			".step:not([hidden]) [part~='action']:not([part~='submit'])"
		) as HTMLElement
	).click();
}

/**
 * the donor on the details step, which is where the three boxes a receipt is addressed from are.
 *
 * walked rather than un-hidden by hand: a `display: none` subtree has no used size at all, so a
 * shortcut here would measure `NaN` and pass every comparison written the other way round.
 */
async function atDetails(shadow: ShadowRoot): Promise<void> {
	const pick = (selector: string, at = 0) =>
		(shadow.querySelectorAll(selector)[at] as HTMLElement).click();

	pick("[part~='frequency-option'] input");
	pick("[part~='amount-option'] input");
	onward(shadow);
	await settle();
}

/**
 * the donor on the review step, which is the only step the fee control and the payment box are
 * drawn on.
 */
async function atReview(shadow: ShadowRoot): Promise<void> {
	await atDetails(shadow);
	fill(shadow, '#email', 'donor@example.org');
	fill(shadow, '#first-name', 'Ada');
	fill(shadow, '#last-name', 'Lovelace');
	onward(shadow);
	await settle();
}

/** one token as the `rgb(…)` an engine reports a used color in. */
function used(shadow: ShadowRoot, token: string): string {
	const probe = document.createElement('div');
	probe.style.cssText = `color: var(${token})`;
	shadow.appendChild(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

/** one length token as the px an engine resolves it to inside the card. */
function step(shadow: ShadowRoot, token: string): number {
	const probe = document.createElement('div');
	probe.style.cssText = `font-size: var(${token})`;
	shadow.appendChild(probe);
	const size = parseFloat(getComputedStyle(probe).fontSize);
	probe.remove();
	return size;
}

/**
 * the caret on one control, with the keyboard as the modality that put it there.
 *
 * every ring in ../styles/parts.css is `:focus-visible` and nothing else, which is what keeps a
 * pointer press off a tile from leaving one behind — so a spec that only called `focus()` after
 * the clicks that walk the flow would read every ring as absent and pass whatever it asserted.
 * one real key press is what puts the engine back on the keyboard.
 */
async function caretOn(element: HTMLElement): Promise<CSSStyleDeclaration> {
	await userEvent.keyboard('{Tab}');
	element.focus();
	return getComputedStyle(element);
}

/** css in the host page's own document, which is the outer encapsulation context. */
function page(css: string): void {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.appendChild(style);
	written.push(style);
}

/**
 * css in the element's own encapsulation context, beside the four sheets already there.
 *
 * a fifth adopted sheet rather than an edit to ../styles/parts.css: what the cascade compares is
 * the context a declaration is in, and a constructed sheet adopted into this shadow root is in the
 * same one every rule ../element.ts adopts is in.
 */
function shadowSheet(shadow: ShadowRoot, css: string): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(css);
	shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
}

/** whether a sheet puts any of its rules in a layer, at any depth. */
function declaresALayer(sheet: CSSStyleSheet): boolean {
	const walk = (rules: CSSRuleList): boolean =>
		Array.from(rules).some((rule) => {
			if (rule.constructor.name.startsWith('CSSLayer')) return true;
			const nested = (rule as CSSGroupingRule).cssRules;
			return nested === undefined ? false : walk(nested);
		});
	return walk(sheet.cssRules);
}

/** what the engine kept, off the part itself. */
function overflowOf(card: HTMLElement): string {
	return getComputedStyle(card).overflowX;
}

afterEach(() => {
	for (const style of written) style.remove();
	written.length = 0;
	// the root is the host document's, and one case moves it to the bottom of the card's clamp band.
	document.documentElement.style.fontSize = '';
	// and one mirrors it, which every case after would inherit.
	document.documentElement.removeAttribute('dir');
	document.body.replaceChildren();
});

describe('the sheets the element adopts', () => {
	// the premise every claim below is measured against: nothing the element brings is layered, so
	// a difference in outcome between a layered host rule and an unlayered one could only come from
	// the host's side.
	it('puts none of its own rules in a layer', async () => {
		const { shadow } = await mount();

		expect(shadow.adoptedStyleSheets.length).toBe(4);
		expect(shadow.adoptedStyleSheets.filter(declaresALayer).length).toBe(0);
	});
});

describe('a host page rule against the element’s own rule', () => {
	// what is at stake in every contest below: the element's own rule is the one in force while the
	// page writes nothing, so a part that reads as the host's value later is a part the host took.
	it('stands unopposed while the page writes nothing', async () => {
		const { card } = await mount();

		expect(overflowOf(card)).toBe('hidden');
	});

	// the integrator's own selector, exactly as `custom-elements.json` publishes it. it is the less
	// specific of the two — `[part~='card']` in ../styles/parts.css is (0,1,0) against this one's
	// (0,0,2) — so a host page that wins here has won on the encapsulation boundary and on nothing
	// else.
	it('restyles a part with the plain published selector', async () => {
		const { tag, card } = await mount();
		page(`${tag}::part(card) { overflow: scroll; }`);

		expect(overflowOf(card)).toBe('scroll');
	});

	// the same claim with specificity removed as an explanation: (0,1,2) out-specifies the element's
	// own rule as well as sitting outside it. a pair that answers differently from the one above is
	// an engine reading specificity where the cascade order says it never gets that far.
	it('restyles it with a selector that out-specifies the element’s', async () => {
		const { tag, card } = await mount();
		page(`:root ${tag}::part(card) { overflow: scroll; }`);

		expect(overflowOf(card)).toBe('scroll');
	});
});

describe('an important declaration inside the element', () => {
	// origin and importance is the first criterion of all, so this one is settled before the
	// boundary is even reached.
	it('takes the part back from a normal host rule', async () => {
		const { tag, shadow, card } = await mount();
		page(`${tag}::part(card) { overflow: scroll; }`);
		shadowSheet(shadow, "[part~='card'] { overflow: hidden !important; }");

		expect(overflowOf(card)).toBe('hidden');
	});

	// and holds it against an important one, which is the boundary being read the other way: for
	// important declarations the inner context wins. an integrator has no answer to this.
	it('holds it against an important host rule too', async () => {
		const { tag, shadow, card } = await mount();
		page(`${tag}::part(card) { overflow: scroll !important; }`);
		shadowSheet(shadow, "[part~='card'] { overflow: hidden !important; }");

		expect(overflowOf(card)).toBe('hidden');
	});
});

describe('a host page rule inside a layer', () => {
	// the lowest layer a page has, declared ahead of every other one it uses, and therefore the
	// weakest place in the host's document a declaration can sit. an unlayered rule in the same
	// document outranks it. the element's rule is unlayered — and in a different context, which is
	// compared first, so the layer is never reached and the outcome is the unlayered one above.
	it('wins from the weakest layer the page has', async () => {
		const { tag, card } = await mount();
		page(`@layer reset, theme;
			@layer reset { ${tag}::part(card) { overflow: scroll; } }`);

		expect(overflowOf(card)).toBe('scroll');
	});

	// the same rule in the strongest layer, which is what makes the one above a statement about
	// layering rather than a coincidence: if layer order decided this, the two would differ.
	it('wins from the strongest layer the page has, identically', async () => {
		const { tag, card } = await mount();
		page(`@layer reset, theme;
			@layer theme { ${tag}::part(card) { overflow: scroll; } }`);

		expect(overflowOf(card)).toBe('scroll');
	});
});

// the card's type scale, read off the drawn text rather than off the tokens behind it. every size
// in ../styles/parts.css is an `em` on the card's own clamped root, so what a rule declares and what
// a donor is shown are two different numbers and only an engine that resolved the chain reports the
// second — happy-dom hands back `1.375em` and would agree with any base at all.
//
// the rule the card is held to: 16px is the base, only a heading goes up, only an error and fine
// print go down (`--_t-md` in ../styles/tokens.css carries it). the figures a donor reads on the
// amount step are the ones that used to break it.
describe('the sizes the card draws its type at', () => {
	const px = (node: Element) => parseFloat(getComputedStyle(node).fontSize);

	/** the amount block's three surfaces: the field, the figure typed in it, and the mark beside it. */
	function amount(shadow: ShadowRoot) {
		return {
			tile: shadow.querySelector("[part~='amount-option']") as HTMLElement,
			box: shadow.querySelector("[part~='amount-input']") as HTMLElement,
			figure: shadow.querySelector("[part~='amount-input'] input") as HTMLElement,
			mark: shadow.querySelector('.adorn-lead') as HTMLElement
		};
	}

	it('sets every figure on the amount step at the card’s own base', async () => {
		const { shadow, card } = await mount();
		const { tile, figure } = amount(shadow);

		expect(px(card)).toBe(16);
		expect(px(figure)).toBe(px(card));
		expect(px(tile)).toBe(px(card));
	});

	// the symbol is drawn at the figure's size so the two read as one amount, which is a relationship
	// rather than a value: it has to survive the figure moving.
	it('keeps the currency symbol at the figure’s own size', async () => {
		const { shadow } = await mount();
		const { figure, mark } = amount(shadow);

		expect(mark.textContent).toBe('$');
		expect(px(mark)).toBe(px(figure));
	});

	// the two ends of the rule, on the same card as the base above: a step's heading is the only
	// thing over it and a refusal the only thing under it.
	it('puts the heading over that base and the error under it', async () => {
		const { shadow, card } = await mount();
		const heading = shadow.querySelector(".step:not([hidden]) [part~='heading']") as HTMLElement;
		const message = shadow.querySelector('.message') as HTMLElement;

		expect(px(heading)).toBeGreaterThan(px(card));
		expect(px(message)).toBeLessThan(px(card));
	});

	// and the consequence of the base: with the tile and the field at one size, nothing about the
	// type separates a shortcut from the control it is a shortcut past, and nothing about the box
	// does either — every box in the block is drawn at the one floor (`--_row-min` in
	// ../styles/tokens.css), and the entry is told apart by the marks in it and its caret. this is
	// the assertion that goes red if the entry is given a floor of its own again.
	it('draws the free entry at the preset’s own floor, on the narrow card', async () => {
		const { host, shadow } = await mount();
		host.style.inlineSize = '375px';
		const { tile, box, figure } = amount(shadow);
		// the box is closed until the other tile opens it (../views.ts), and a closed box has no
		// height to measure.
		(shadow.querySelector('.other input') as HTMLInputElement).click();
		await settle();

		expect(px(tile)).toBe(px(figure));
		// measured on the drawn boxes rather than read off the tokens that state them. a shortcut is
		// drawn at the target floor exactly — its block padding is a step the figure stands inside
		// and has 20px of the floor to spend, so it adds nothing — and the entry's line at 1 and its
		// padding come to less than the floor too, so the floor is what both are drawn at.
		const shortcut = tile.getBoundingClientRect().height;
		const entry = box.getBoundingClientRect().height;

		expect(shortcut).toBe(44);
		expect(entry).toBe(shortcut);
		const cadence = shadow.querySelector("[part~='frequency-option']") as HTMLElement;
		expect(cadence.getBoundingClientRect().height).toBe(shortcut);
	});

	// the inset a donor reads around what they typed is the same on every side of a one-line box, or
	// the floor's slack above and below it — never a block step wider than the inline one. every box
	// a donor types or picks in is measured, the amount entry through the input that carries its
	// padding; the textarea is the one box drawn taller than a line and is not one of these.
	//
	// it holds with no exception, the boxes carrying a label inside them included: that label is
	// seated against the box's own box rather than in room the box keeps for it, so there is no
	// band above the words for this rule to have to make an allowance for.
	it('pads no box a donor types in more above and below the words than beside them', async () => {
		const { shadow } = await mount();
		const boxes = Array.from(
			shadow.querySelectorAll(
				"input[part~='field'], select[part~='field'], [part~='amount-input'] input"
			)
		) as HTMLElement[];

		expect(boxes.length).toBeGreaterThan(3);
		for (const box of boxes) {
			const style = getComputedStyle(box);
			const block = parseFloat(style.paddingBlockStart);
			expect(block, box.id).toBe(parseFloat(style.paddingBlockEnd));
			expect(block, box.id).toBeLessThanOrEqual(parseFloat(style.paddingInlineStart));
			expect(block, box.id).toBeLessThanOrEqual(parseFloat(style.paddingInlineEnd));
		}
	});
});

describe('the free entry as laid out', () => {
	// the input covers every pixel of the surface it is typed on (`[part~='amount-input']` in
	// ../styles/parts.css), on a tray of tiles and on a bare one alike. measured on the input and not
	// the tile: the tile spanning the row says nothing about the figure inside it, and a rule from
	// another block reaching `.entry` holds the input to one column of the tray's grid, cutting
	// `Amount` short while the tile still spans the row. both axes, because a press on the surface
	// above or below a figure held to its own line lands on no input at all.
	it('gives the figure the whole of the free entry, with presets and without', async () => {
		for (const config of [CONFIG, { ...CONFIG, suggestedAmountsMinor: [] }]) {
			const { host, shadow } = await mount(config);
			try {
				host.style.inlineSize = '375px';
				const other = shadow.querySelector('.other input') as HTMLInputElement | null;
				other?.click();
				await settle();
				const box = shadow.querySelector("[part~='amount-input']") as HTMLElement;
				const figure = (
					shadow.querySelector("[part~='amount-input'] input") as HTMLElement
				).getBoundingClientRect();
				const presets = `${config.suggestedAmountsMinor.length} presets`;

				expect(box.clientWidth, presets).toBeGreaterThan(0);
				expect(Math.abs(figure.width - box.clientWidth), `${presets}: width`).toBeLessThanOrEqual(
					DEVICE_PIXEL
				);
				expect(
					Math.abs(figure.height - box.clientHeight),
					`${presets}: height`
				).toBeLessThanOrEqual(DEVICE_PIXEL);
			} finally {
				host.remove();
			}
		}
	});
});

/*
 * the pair of boxes under "Your name", whose labels stand inside them.
 *
 * a floating label is a label that moved, so what is measured is where its words are drawn rather
 * than whether a rule declaring it exists: resting they sit on the box's own middle, and once the
 * box has the caret or a value they sit on its top edge with the border knocked out behind them, at
 * a step smaller than they rested at and in from the corner the box is drawn with. the refusal the
 * box is carrying is no part of that — it stands under the box, where every other row on the card
 * stands its own. a lightweight DOM lays out none of it, and a rule that floated nothing would read
 * as a fix.
 */
describe('the labels on the pair under the name', () => {
	/**
	 * where a label's own words are drawn, which is not where its box is: the box is stretched
	 * across the control it stands in so that half of it is half of the control (`.floating` in
	 * ../styles/parts.css), and only the words inside it move against the box's edge.
	 */
	function ink(label: HTMLElement): DOMRect {
		const range = document.createRange();
		range.selectNodeContents(label);
		return range.getBoundingClientRect();
	}

	/** the middle of a box, on the axis the label travels along. */
	function middle(rect: DOMRect): number {
		return (rect.top + rect.bottom) / 2;
	}

	/**
	 * a reading off the label's own words, against the seat ../styles/parts.css gives them.
	 *
	 * within a device pixel rather than under half of one: one end of the comparison is a text ink
	 * box, and where a face seats its ink inside the line it is given is the platform's own metric
	 * rather than anything the sheet states — so the same rule, drawing the same label, puts the two
	 * ends together on one platform and half a pixel apart on another.
	 */
	function seated(drawn: number, seat: number): void {
		expect(Math.abs(drawn - seat), `the ink at ${drawn}, the seat at ${seat}`).toBeLessThanOrEqual(
			DEVICE_PIXEL
		);
	}

	/**
	 * one of the pair's boxes and the two things the row draws with it: the label naming it, which
	 * stands over the box and out of the row's flow, and the refusal it is carrying while it is
	 * refused, which is the row's own child under the box. the label holds the naming span and
	 * nothing else, so neither of the two is read off the other.
	 */
	function field(
		shadow: ShadowRoot,
		id: string
	): {
		box: HTMLElement;
		label: HTMLElement;
		row: HTMLElement;
		words: HTMLElement;
		refusal: HTMLElement;
	} {
		const box = shadow.querySelector(id) as HTMLElement;
		const label = shadow.querySelector(`label[for="${id.slice(1)}"]`) as HTMLElement;
		return {
			box,
			label,
			row: box.closest('.field-row') as HTMLElement,
			words: label.querySelector('.label-words') as HTMLElement,
			refusal: shadow.querySelector(`${id}-problem`) as HTMLElement
		};
	}

	/** the corner the box is drawn with, which is what the floated label has to start clear of. */
	function corner(box: HTMLElement): number {
		return parseFloat(getComputedStyle(box).borderStartStartRadius);
	}

	/**
	 * the colour a donor reads the box's own top edge in, whatever is putting it there: the ring
	 * where the box draws one, and the border where it does not. the ring is the outer of the two,
	 * so it is what the edge reads as; that the border under it is the same colour is its own case.
	 */
	function drawnEdge(box: HTMLElement): string {
		const painted = getComputedStyle(box);
		const ring = painted.boxShadow;
		if (ring === 'none' || ring.includes('inset')) return painted.borderTopColor;
		return (/^(?:\w+\([^)]*\)|\S+)/.exec(ring) ?? [''])[0];
	}

	/**
	 * a weight token as the engine resolved it, read the way `step` above reads a size: what the two
	 * positions are measured against is the token the sheet spends, not a number restated here.
	 */
	function weight(shadow: ShadowRoot, token: string): string {
		const probe = document.createElement('div');
		probe.style.cssText = `font-weight: var(${token})`;
		shadow.appendChild(probe);
		const resolved = getComputedStyle(probe).fontWeight;
		probe.remove();
		return resolved;
	}

	// resting: the label is centred on the box, so an empty box reads as one thing rather than as a
	// box with a caption sitting low in it. nothing is drawn beside it in this state — the box is
	// empty and holds no caret.
	it('centres the label on the box while it is empty and holds no caret', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, words } = field(shadow, '#first-name');

		seated(middle(ink(words)), middle(box.getBoundingClientRect()));
	});

	// and it holds once a refused press has something to say about the box. the sentence lands under
	// the box, in the row's own second track, and the label's seat is measured against the box's own
	// track alone — so nothing the refusal added to the column moves the words off the box's middle.
	it('keeps it there once the box is refused', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		onward(shadow);
		await settle();
		const { box, words, refusal } = field(shadow, '#first-name');

		expect(refusal.hidden).toBe(false);
		seated(middle(ink(words)), middle(box.getBoundingClientRect()));
	});

	// the two sizes, which is the whole of what the move says beyond the direction of it. floated the
	// label is an annotation on the box's edge and takes the smallest step the card has; resting it
	// stands where the value will and is drawn at the value's own reading size. one box, both
	// readings: what a donor read as a second heading was a resolved step and not a declaration.
	it('draws the floated label a step smaller than the resting one', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { label, words } = field(shadow, '#first-name');

		const resting = parseFloat(getComputedStyle(words).fontSize);

		fill(shadow, '#first-name', 'Ada');
		await landed(label);
		const floated = parseFloat(getComputedStyle(words).fontSize);

		expect(resting).toBeCloseTo(step(shadow, '--_t-md'), 1);
		expect(floated).toBeCloseTo(step(shadow, '--_t-xs'), 1);
		expect(floated).toBeLessThan(resting);
	});

	// and the floor under the smaller of them, on the smallest root the card allows. this label is
	// the field's own visible name — the one thing a donor checks a typed value against — rather
	// than the fine print `--_t-xs` in ./tokens.css leaves unfloored, so it takes the floor the four
	// other sites under that step take instead of drawing at the bottom of the clamp band.
	it('holds the floated label at its floor on the smallest root the card allows', async () => {
		document.documentElement.style.fontSize = '15px';
		const { shadow } = await mount();
		await atDetails(shadow);
		const { label, words } = field(shadow, '#first-name');

		fill(shadow, '#first-name', 'Ada');
		await landed(label);

		// and it is a case only while the step itself is genuinely under the floor here.
		expect(step(shadow, '--_t-xs')).toBeLessThan(12);
		expect(parseFloat(getComputedStyle(words).fontSize)).toBeGreaterThanOrEqual(12);
	});

	// and the two weights, which is the other half of that reading. resting, the words stand where the
	// value will and are drawn as this card's own placeholder is — the quiet weight, so what a donor
	// reads inside the box is the box waiting rather than something already typed into it
	// (`[part~='amount-input'] input::placeholder` in ../styles/parts.css is where that pair is stated).
	it('draws the resting label at the weight this card draws a placeholder at', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { words } = field(shadow, '#first-name');

		expect(getComputedStyle(words).fontWeight).toBe(weight(shadow, '--_w-normal'));
	});

	// and floated they are the box's name, at the weight every other label on the card is drawn at.
	// measured against the resting reading too: one weight in both positions is a resting label that
	// reads as a value, and it is a reading no declaration in the sheet states.
	it('returns it to a label’s own weight once it floats', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { label, words } = field(shadow, '#first-name');

		const resting = Number(getComputedStyle(words).fontWeight);

		fill(shadow, '#first-name', 'Ada');
		await landed(label);

		expect(getComputedStyle(words).fontWeight).toBe(weight(shadow, '--_w-bold'));
		expect(Number(getComputedStyle(words).fontWeight)).toBeGreaterThan(resting);
	});

	// and the two inks, which is the third of those readings. resting, the words stand where the value
	// will and take the quietest rung this card can set words in on a field's fill; floated they are
	// the box's name and are back at the ink every other label on the card is drawn at. both rungs are
	// read off the sheet rather than restated here, and the two are read against each other as well:
	// one ink in both positions is a resting label that reads as a value, and no declaration says it.
	it('draws the resting label a rung quieter than it is floated', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { label, words } = field(shadow, '#first-name');

		expect(getComputedStyle(words).color).toBe(used(shadow, '--_n10'));

		fill(shadow, '#first-name', 'Ada');
		await landed(label);

		expect(getComputedStyle(words).color).toBe(used(shadow, '--_n11'));
		expect(used(shadow, '--_n10')).not.toBe(used(shadow, '--_n11'));
	});

	// and the resting rung is the placeholder's own, because the two are the same thing on this card:
	// words standing in a value's place until a donor types. both inks are read off what was drawn
	// rather than off the token alone, so a sheet moving one of them and not the other fails here
	// (`[part~='amount-input'] input::placeholder` in ../styles/parts.css argues the pair).
	it('draws the resting label at the ink this card draws a placeholder at', async () => {
		const { shadow } = await mount();
		const entry = shadow.querySelector("[part~='amount-input'] input") as HTMLElement;
		const placeholder = getComputedStyle(entry, '::placeholder').color;

		await atDetails(shadow);
		const { words } = field(shadow, '#first-name');

		expect(placeholder).toBe(used(shadow, '--_n10'));
		expect(getComputedStyle(words).color).toBe(placeholder);
	});

	// and both of those rungs are declared on the part itself, which is the whole of what a host's
	// one `::part(label)` rule governs: an ink declared on the naming span inside the label is an ink
	// no outer rule reaches, so a host's colour would land on the floated position and be ignored
	// under it. the refusal is outside the part altogether and keeps its own ink in both positions,
	// which is what keeps a host's label colour off a sentence saying the box was refused.
	it('hands a host’s one ::part(label) rule the ink in both positions', async () => {
		const { tag, shadow } = await mount();
		await atDetails(shadow);
		onward(shadow);
		await settle();
		const { box, label, words, refusal } = field(shadow, '#first-name');
		// the case's own literal, and neither rung the sheet spends: a position still taking its own
		// declaration reads as that rung rather than as this one.
		const host = 'rgb(0, 128, 0)';
		page(`${tag}::part(label) { color: ${host}; }`);

		expect(host).not.toBe(used(shadow, '--_n10'));
		expect(host).not.toBe(used(shadow, '--_n11'));
		expect(refusal.hidden).toBe(false);

		expect(getComputedStyle(words).color).toBe(host);
		expect(getComputedStyle(refusal).color).toBe(used(shadow, '--_bad'));

		// the caret rather than a value: a value would answer the refusal and take the sentence away
		// before the floated position could be read with it.
		await caretOn(box);
		await landed(label);

		expect(getComputedStyle(words).color).toBe(host);
		expect(getComputedStyle(refusal).color).toBe(used(shadow, '--_bad'));
	});

	// and floated, the label straddles the edge rather than rising into a band inside the box: its
	// middle is on the box's own top edge, which is what leaves the box no room to reserve.
	it('sets the label on the box\u2019s top edge once the box holds a value', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label, words } = field(shadow, '#first-name');

		fill(shadow, '#first-name', 'Ada');
		await landed(label);

		seated(middle(ink(words)), box.getBoundingClientRect().top);
	});

	// the caret alone floats it too, so a donor who has tabbed into an empty box is typing under a
	// label rather than over one.
	it('floats it the same way for a caret in an empty box', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label, words } = field(shadow, '#last-name');

		await caretOn(box);
		await landed(label);

		seated(middle(ink(words)), box.getBoundingClientRect().top);
	});

	// the inline axis moves too, and the two ends of it are the whole of why the box's own inline
	// inset is a token rather than the step every other box pads by: resting, the label starts
	// exactly where the words that replace it will.
	//
	// floated it comes in to the corner the box is drawn with and no further, which is the one end
	// of this axis a declaration cannot settle: a label flush with the control's own edge leaves the
	// top-left arc standing outside the knockout as a stub beside the first letter, and what says
	// the arc is clear is the used radius of the box itself.
	it('starts the label on the words\u2019 own inset resting and clear of the corner floated', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label, words } = field(shadow, '#first-name');
		const style = getComputedStyle(box);
		// read off the box at the moment of each reading rather than once: the step is still
		// arriving (`screen-enter` in ../styles/motion.css travels it by `0.75em`), so a box
		// measured before the fill and a label measured after it are a step apart on this axis.
		const inset = () =>
			box.getBoundingClientRect().left +
			parseFloat(style.borderInlineStartWidth) +
			parseFloat(style.paddingInlineStart);

		seated(ink(words).left, inset());

		fill(shadow, '#first-name', 'Ada');
		await landed(label);

		// the notch starts where the arc ends, and the words stand inside it.
		const arc = corner(box);
		expect(arc).toBeGreaterThan(0);
		expect(ink(words).left - box.getBoundingClientRect().left).toBeGreaterThan(arc);
		seated(words.getBoundingClientRect().left, box.getBoundingClientRect().left + arc);
	});

	// standing on the edge, the label has to be painted behind or the edge reads through its words.
	// two fills and not one: the half above the edge covers the card and the half below covers the
	// box, and a single flat colour would match one of them and show as a patch on the other. the
	// band is at least the words' own line, which is what makes it an edge knocked out rather than a
	// line the words happen to sit above.
	it('knocks the edge out behind the floated label, one fill per side of it', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label, words } = field(shadow, '#first-name');

		// resting there is no edge behind the words, so there is nothing to knock out.
		expect(getComputedStyle(words).backgroundImage).toBe('none');

		fill(shadow, '#first-name', 'Ada');
		await landed(label);
		const painted = getComputedStyle(words);

		// the band's own block extent, which is the second half of `background-size`.
		const [, band = ''] = painted.backgroundSize.split(' ');

		expect(painted.backgroundImage).toContain(used(shadow, '--_n1'));
		expect(painted.backgroundImage).toContain(used(shadow, '--_n3'));
		expect(parseFloat(band)).toBeGreaterThanOrEqual(ink(words).height);
		// across the words and past the last letter, so no run of the edge is left inside the band's
		// own span of it.
		expect(words.getBoundingClientRect().width).toBeGreaterThan(ink(words).width);
		// and no further than that: the label hugs its words rather than standing across the box, so
		// the band covers the words alone. a band the width of the box is a box drawn with no top
		// edge, which is the whole reason the words are what carries it.
		expect(label.getBoundingClientRect().width).toBeLessThan(box.getBoundingClientRect().width);
	});

	// and the band is spent upward into the gap above the box and no further. it is centred on the
	// edge and half of it stands over the box, so its own height is the whole of the clearance — a
	// band drawn at the size the label used to be reaches past the legend's line and knocks a bite
	// out of the words naming the pair.
	it('keeps the band out of the row above the box', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label, words } = field(shadow, '#first-name');
		const legend = shadow.querySelector('fieldset.group > legend') as HTMLElement;

		fill(shadow, '#first-name', 'Ada');
		await landed(label);
		const [, band = ''] = getComputedStyle(words).backgroundSize.split(' ');

		const reach = box.getBoundingClientRect().top - parseFloat(band) / 2;
		expect(parseFloat(band)).toBeGreaterThan(0);
		expect(reach).toBeGreaterThan(legend.getBoundingClientRect().bottom);
	});

	/**
	 * the band a box draws along its top edge, read off the box: `width` runs from the ring's outer
	 * line to the border's inner one, and `depth` is the share of it inside the box — the border and
	 * any inset band laid on it.
	 */
	function edgeBand(box: HTMLElement): { width: number; depth: number } {
		const drawn = getComputedStyle(box);
		const border = parseFloat(drawn.borderTopWidth);
		const shadows = drawn.boxShadow === 'none' ? [] : drawn.boxShadow.split(/,(?![^(]*\))/);
		return shadows.reduce(
			(band, shadow) => {
				const spread = parseFloat(/(-?[\d.]+)px(?:\s+inset)?\s*$/.exec(shadow.trim())?.[1] ?? '0');
				return {
					width: band.width + spread,
					depth: band.depth + (/\binset\b/.test(shadow) ? spread : 0)
				};
			},
			{ width: border, depth: border }
		);
	}

	/**
	 * every state the box's edge takes while the label floats over it — a value at rest, the pointer
	 * on it, the caret in it, refused with the caret back in it, and refused with the caret elsewhere
	 * — each handed to `check` once it has landed.
	 *
	 * the ring is widened to the strong border for the length of the walk. at the token file's own
	 * values the border and the ring are one width, so a band that clears one clears the other and a
	 * notch too shallow for the ring reads as right; widened, it does not.
	 */
	async function throughEveryEdge(
		check: (state: string, box: HTMLElement, words: HTMLElement) => void
	): Promise<void> {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label, words } = field(shadow, '#first-name');
		const other = field(shadow, '#last-name').box;
		const floating = box.closest('.floating') as HTMLElement;
		floating.style.setProperty('--_focus-width', 'var(--_border-strong)');
		const landedAll = async () => {
			await landed(box);
			await landed(label);
		};

		fill(shadow, '#first-name', 'Ada');
		await landedAll();
		check('a value at rest', box, words);

		await userEvent.hover(box);
		await landedAll();
		check('under a pointer', box, words);
		await userEvent.unhover(box);

		await caretOn(box);
		await landedAll();
		check('the caret in the box', box, words);

		fill(shadow, '#first-name', '');
		fill(shadow, '#email', 'donor@example.org');
		onward(shadow);
		await settle();
		await caretOn(box);
		await landedAll();
		expect(box.getAttribute('part'), 'refused').toContain('invalid');
		check('refused, with the caret back in it', box, words);

		fill(shadow, '#first-name', '   ');
		await settle();
		await caretOn(other);
		await landedAll();
		expect(box.getAttribute('part'), 'still refused').toContain('invalid');
		expect(floating.matches(':focus-within'), 'the caret elsewhere').toBe(false);
		check('refused, with the caret elsewhere', box, words);
	}

	// the edge stops either side of the name and draws nothing over it: no run along the top of the
	// band and no sides turned down onto the box, in the edge's colour or any other. the band is the
	// knockout's two fills and nothing else.
	it('draws nothing of the edge around the floated name, in every state the edge takes', async () => {
		await throughEveryEdge((state, box, words) => {
			const painted = getComputedStyle(words).backgroundImage;
			expect(painted.match(/linear-gradient/g), `${state}: the layers`).toHaveLength(1);
			expect(painted, `${state}: the edge's colour`).not.toContain(drawnEdge(box));
		});
	});

	// and the band is what interrupts the edge: centred on the box's top, it reaches past the ring's
	// outer line above and the border's inner line below, so no part of the edge runs through the
	// name — a refused box's red breaks around it as the resting hairline does.
	it('breaks the whole edge across the floated name, in every state the edge takes', async () => {
		await throughEveryEdge((state, box, words) => {
			const top = box.getBoundingClientRect().top;
			const { width, depth } = edgeBand(box);
			const [, band = ''] = getComputedStyle(words).backgroundSize.split(' ');
			const span = words.getBoundingClientRect();
			const middle = (span.top + span.bottom) / 2;
			const half = parseFloat(band) / 2;

			seated(middle, top);
			expect(middle - half, `${state}: above the ring`).toBeLessThanOrEqual(top - (width - depth));
			expect(middle + half, `${state}: below the border`).toBeGreaterThanOrEqual(top + depth);
		});
	});

	// and the name stands inside the gap rather than at its ends: the same room at both, so the edge
	// stops a little short of the first letter and picks up a little past the last.
	it('keeps the name clear of both ends of the gap, in every state the edge takes', async () => {
		await throughEveryEdge((state, _box, words) => {
			const span = words.getBoundingClientRect();
			const drawn = ink(words);
			const before = drawn.left - span.left;
			const after = span.right - drawn.right;
			expect(before, `${state}: room before the name`).toBeGreaterThanOrEqual(DEVICE_PIXEL);
			expect(after, `${state}: room after the name`).toBeGreaterThanOrEqual(DEVICE_PIXEL);
			expect(before, `${state}: the two ends`).toBeCloseTo(after, 0);
		});
	});

	// forced colours drop every `background-image` that is not a url, so the two-fill band is gone and
	// the forced edge would run through the name. the mode has one ground on both sides of the line,
	// so a single solid one is the whole notch there. read in every state the edge takes, because the
	// focused box's edge is an outline in this mode rather than the ring.
	it('keeps the notch where the system forces its own colours, in every state the edge takes', async () => {
		const session = cdp();
		await session.send('Emulation.setEmulatedMedia', {
			features: [{ name: 'forced-colors', value: 'active' }]
		});
		try {
			expect(matchMedia('(forced-colors: active)').matches, 'the mode is on').toBe(true);
			await throughEveryEdge((state, box, words) => {
				const drawn = getComputedStyle(box);
				const top = box.getBoundingClientRect().top;
				const outside = parseFloat(drawn.outlineWidth) + parseFloat(drawn.outlineOffset);
				const inside = parseFloat(drawn.borderTopWidth);
				const ground = getComputedStyle(words).backgroundColor;
				const span = words.getBoundingClientRect();

				expect(ground, `${state}: a ground at all`).not.toBe('rgba(0, 0, 0, 0)');
				expect(ground, `${state}: a solid one`).not.toMatch(/rgba\(/);
				expect(span.top, `${state}: above the outline`).toBeLessThanOrEqual(top - outside);
				expect(span.bottom, `${state}: below the border`).toBeGreaterThanOrEqual(top + inside);
			});
		} finally {
			await session.send('Emulation.setEmulatedMedia', { features: [] });
		}
	});

	// the box keeps one height through both states and reserves nothing for either, so a donor
	// typing their name moves nothing on the step and the card's height never depends on what they
	// typed.
	it('draws the box at one height in both states and leaves the step where it is', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		const { box, label } = field(shadow, '#first-name');
		const step = shadow.querySelector('.step-details') as HTMLElement;
		const drawn = box.getBoundingClientRect().height;
		const standing = step.getBoundingClientRect().height;

		fill(shadow, '#first-name', 'Ada');
		await landed(label);

		expect(box.getBoundingClientRect().height).toBe(drawn);
		expect(step.getBoundingClientRect().height).toBe(standing);
	});

	// the refusal, drawn under the box the way every other row on the card draws its own: the row's
	// own child in the row's own column, at `.message`'s ink and step wherever it stands. nothing
	// about the label's construction reaches it, which is why it is one element on every row.
	it('draws a refused box’s refusal under the box, as a row labelled over the top draws one', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		onward(shadow);
		await settle();
		const { box, row, refusal } = field(shadow, '#first-name');

		expect(refusal.hidden).toBe(false);
		expect(refusal.tagName).toBe('P');
		expect(refusal.parentElement).toBe(row);
		expect(getComputedStyle(refusal).position).toBe('static');
		// in the refusal's own ink and at its own step, which is `.message`'s wherever it is drawn.
		expect(getComputedStyle(refusal).color).toBe(used(shadow, '--_bad'));
		expect(parseFloat(getComputedStyle(refusal).fontSize)).toBeCloseTo(step(shadow, '--_t-xs'), 1);
		expect(refusal.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			box.getBoundingClientRect().bottom
		);
	});

	// and the box that is not in the pair is drawn the way every other single box on the card is:
	// its label over it, in the row's own flow, with none of the pair's construction reaching it —
	// neither the seat, nor the knockout, nor the blank placeholder the two states are told apart by.
	// the sentence is the one thing the two rows do share, and it stands under the box on both.
	it('draws the email box\u2019s label over it, in the row\u2019s own flow', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		onward(shadow);
		await settle();
		const { box, label, row, refusal } = field(shadow, '#email');
		const style = getComputedStyle(label);

		expect(style.position).toBe('static');
		expect(style.backgroundImage).toBe('none');
		expect(label.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			box.getBoundingClientRect().top
		);
		expect(box.hasAttribute('placeholder')).toBe(false);
		expect(box.closest('.floating')).toBe(null);
		expect(label.querySelector('.label-words')).toBe(null);
		expect(refusal.hidden).toBe(false);
		expect(refusal.parentElement).toBe(row);
		expect(refusal.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			box.getBoundingClientRect().bottom
		);
	});
});

// the step marks, measured rather than declared. a mark is two boxes — the target a finger lands on
// and the shape an eye reads — held to two different floors on purpose (`--_target-min`,
// `--_row-min` and `--_mark` in ../styles/tokens.css), and what settles whether either floor is
// actually met is the laid-out box. a lightweight DOM hands back the `calc()` it was given and lays
// nothing out, so this is the only pool that can tell a target from a declaration about one.
describe('the step marks as laid out', () => {
	/** the marks on the first step's head, which is the one a fresh card shows. */
	function marks(shadow: ShadowRoot): HTMLElement[] {
		return Array.from(shadow.querySelectorAll('.step:not([hidden]) .step-dot'));
	}

	// 2.5.8's own minimum, met by each target rather than through the spacing exception, and the
	// card's own row floor in the other axis. the three stand at the end of a line that also holds
	// the step's heading, so an inline floor raised to match the block one is what pushes the
	// heading off a narrow card — the asymmetry is the decision, and this is where it is real.
	it('gives every mark a target at the floors the token file states', async () => {
		const { shadow } = await mount();

		for (const mark of marks(shadow)) {
			const box = mark.getBoundingClientRect();
			expect(box.width).toBeGreaterThanOrEqual(24);
			expect(box.height).toBeGreaterThanOrEqual(44);
		}
	});

	// the marks abut, so no two targets overlap and no strip of the line belongs to no mark. a gap
	// between them would be the second of those, and an overlap the first — a donor pressing one
	// mark and moving to the step beside it.
	it('lays the targets edge to edge, neither overlapping nor leaving a strip between', async () => {
		const { shadow } = await mount();
		const boxes = marks(shadow).map((mark) => mark.getBoundingClientRect());

		expect(boxes).toHaveLength(3);
		expect(boxes[1]?.left).toBeCloseTo(boxes[0]?.right ?? 0, 1);
		expect(boxes[2]?.left).toBeCloseTo(boxes[1]?.right ?? 0, 1);
	});

	// the drawn shape is the smaller of the two boxes and is never the target. tying them together
	// is what would either draw a mark the size of a button or shrink the target to a dot.
	it('draws a shape well inside the target it is centred in', async () => {
		const { shadow } = await mount();
		const target = marks(shadow)[0]?.getBoundingClientRect();
		const shape = marks(shadow)[0]?.querySelector('.step-mark')?.getBoundingClientRect();

		expect(shape?.width).toBeGreaterThan(0);
		expect(shape?.width).toBeLessThan(target?.width ?? 0);
		expect(shape?.height).toBeLessThan(target?.height ?? 0);
	});

	// unavailable is said in the stroke's pattern and in nothing else, because at this scale colour
	// cannot say it: every ramp step quiet enough to read as quieter is inside 0.06 lightness of the
	// available one on a 1px stroke (`--_edge-unavailable` in ../styles/tokens.css). so the edge
	// goes dashed and neither the shape nor the box a finger lands on changes size — three shapes
	// at one size read as one row of steps, and a state that moved the target would be a state
	// that moved the marks apart, and they abut.
	//
	// a fresh card is the case worth measuring: the donor is on the first step and both marks ahead
	// of them are unavailable at once, which is the reading a shrunk mark would turn into "this
	// form is one screen long".
	it('dashes the edge of a step the donor cannot reach yet and draws it at the size of the others', async () => {
		const { shadow } = await mount();
		// the card opens one press from the second step (`settledDraft` in ../checkout.machine.ts),
		// so the seeded amount is taken back first: the other tile clears it.
		(shadow.querySelector('.other input') as HTMLInputElement).click();
		await settle();
		const shapes = marks(shadow).map((mark) => mark.querySelector('.step-mark') as HTMLElement);
		const boxes = marks(shadow).map((mark) => mark.getBoundingClientRect());
		const size = (shape: HTMLElement) => shape.getBoundingClientRect();

		const current = shapes[0] as HTMLElement;
		expect(getComputedStyle(current).borderStyle).toBe('solid');
		for (const ahead of shapes.slice(1)) {
			expect(getComputedStyle(ahead).borderStyle).toBe('dashed');
			expect(size(ahead).width).toBeCloseTo(size(current).width, 2);
			expect(size(ahead).height).toBeCloseTo(size(current).height, 2);
		}
		for (const box of boxes.slice(1)) {
			expect(box.width).toBeCloseTo(boxes[0]?.width ?? 0, 2);
			expect(box.height).toBeCloseTo(boxes[0]?.height ?? 0, 2);
		}
	});

	// the third reading, which a fresh card never shows: a step the donor has passed keeps a solid
	// edge and no fill, at that same size, so the row reads as one shape in three states rather
	// than as three shapes.
	it('leaves a step the donor has passed a solid ring at the size of the one they stand on', async () => {
		const { shadow } = await mount();
		await atReview(shadow);
		const shapes = marks(shadow).map((mark) => mark.querySelector('.step-mark') as HTMLElement);
		const current = shapes[2] as HTMLElement;

		for (const passed of shapes.slice(0, 2)) {
			expect(getComputedStyle(passed).borderStyle).toBe('solid');
			expect(getComputedStyle(passed).backgroundColor).toBe('rgba(0, 0, 0, 0)');
			expect(passed.getBoundingClientRect().width).toBeCloseTo(
				current.getBoundingClientRect().width,
				2
			);
		}
		expect(getComputedStyle(current).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
	});

	// the ring is on the shape rather than on the target. the target is `--_target-min` by
	// `--_row-min` around a mark a fraction of that, so the ring goes on the mark — the one control
	// on the card where the element that takes the caret is not the one that reports it.
	it('rings the mark itself when its button holds the caret, and the ring is a circle', async () => {
		const { shadow } = await mount();
		const ring = used(shadow, '--_focus-ring');
		const button = marks(shadow)[1] as HTMLElement;
		const shape = button.querySelector('.step-mark') as HTMLElement;

		const onButton = await caretOn(button);
		expect(onButton.boxShadow).toBe('none');
		expect(onButton.outlineStyle).toBe('none');

		const onShape = getComputedStyle(shape);
		expect(onShape.outlineStyle).toBe('solid');
		expect(onShape.outlineWidth).toBe('1px');
		expect(onShape.outlineColor).toBe(ring);
		expect(onShape.outlineOffset).toBe('0px');
		// the corner is over half the box, which is what the engine reduces to a circle.
		const box = shape.getBoundingClientRect();
		expect(parseFloat(onShape.borderRadius)).toBeGreaterThanOrEqual(box.width / 2);
		// and the ring, a pixel out from the shape, stands well inside the target it is not on.
		const target = button.getBoundingClientRect();
		expect(box.left - 1).toBeGreaterThan(target.left);
		expect(box.right + 1).toBeLessThan(target.right);
		expect(box.top - 2).toBeGreaterThan(target.top);
		expect(box.bottom + 2).toBeLessThan(target.bottom);
	});
});

// the skeleton, measured against the step it stands in for. what it has to be is the height a form
// suggesting amounts comes out at, so the reflow when the configuration lands is a change of content
// and not of height — and that is a laid-out fact about two trees under one set of tokens, which a
// lightweight DOM cannot see.
describe('the shape drawn before the org’s own is known', () => {
	/** the common form: the usual five suggestions, which the shape is drawn for. */
	const DEFAULT: FormConfig = {
		...CONFIG,
		suggestedAmountsMinor: [2500, 5000, 10_000, 25_000, 50_000]
	};

	/** the skeleton, drawn inside the same card and under the same sheets as the step it mirrors. */
	function skeleton(card: HTMLElement): HTMLElement {
		card.appendChild(createSkeleton(document));
		return card.querySelector('.skeleton') as HTMLElement;
	}

	it('mirrors the first step of the default form, top to bottom', async () => {
		const { card } = await mount(DEFAULT);
		const shape = skeleton(card);
		const drawn = Array.from(shape.children).map((child) => child.className);

		expect(drawn).toEqual([
			'step-head',
			'group',
			'group',
			'skeleton-block skeleton-row',
			'skeleton-block skeleton-row',
			'skeleton-block skeleton-action'
		]);
		// and inside the two groups, a label's line over each tray, with the entry alone on its own.
		const groups = Array.from(shape.querySelectorAll('.group')).map((group) =>
			Array.from(group.children).map((child) => child.className)
		);
		expect(groups).toEqual([
			['skeleton-block skeleton-label', 'segment'],
			['skeleton-block skeleton-label', 'tiles']
		]);
		// six shortcuts on the real grid, which is what wraps them into the rows a loaded tray has.
		const tiles = shape.querySelector('.tiles') as HTMLElement;
		expect(Array.from(tiles.children).map((child) => child.className)).toEqual(
			Array.from({ length: 6 }, () => 'skeleton-block skeleton-tile')
		);
	});

	// within a row, not to the pixel: the shape stands in for the tray a form usually draws and the
	// fixture's own tile count is the org's, so what is held here is that the card does not jump by
	// a row's worth when the configuration lands.
	it('comes out within a row of that step', async () => {
		const { host, shadow, card } = await mount(DEFAULT);
		host.style.inlineSize = '375px';
		const step = shadow.querySelector('.step:not([hidden])') as HTMLElement;
		const shape = skeleton(card);
		const row = Number.parseFloat(
			getComputedStyle(shadow.querySelector('.tiles') as HTMLElement).getPropertyValue('--_row-min')
		);

		const off = Math.abs(
			shape.getBoundingClientRect().height - step.getBoundingClientRect().height
		);
		expect(off, `${off}px apart`).toBeLessThan(row);
	});

	it('draws the head at the real head’s height, with three marks at its end', async () => {
		const { shadow, card } = await mount(DEFAULT);
		const head = shadow.querySelector('.step:not([hidden]) .step-head') as HTMLElement;
		const shape = skeleton(card);
		const drawnHead = shape.querySelector('.step-head') as HTMLElement;
		const drawnMarks = Array.from(drawnHead.querySelectorAll('.skeleton-mark'));
		const realMark = shadow.querySelector('.step:not([hidden]) .step-mark') as HTMLElement;

		expect(drawnHead.getBoundingClientRect().height).toBeCloseTo(
			head.getBoundingClientRect().height,
			0
		);
		expect(drawnMarks).toHaveLength(3);
		for (const mark of drawnMarks) {
			expect(mark.getBoundingClientRect().width).toBeCloseTo(
				realMark.getBoundingClientRect().width,
				1
			);
		}
	});
});

// the box the provider's own fields appear in, which reserves two rows of the card and must not
// reserve them before there is anything to put in them.
//
// this is the browser pool's question rather than a lightweight DOM's for the same reason every
// case above is: the box holds a `<slot>` from the first paint of the card, so what is or is not
// inside it is a question about the flattened tree and about used height, and `:empty` reads
// neither.
describe('the box a payment provider paints in', () => {
	/** the payment box, off the part name a host page styles it by. */
	function paymentBox(shadow: ShadowRoot): HTMLElement {
		const box = shadow.querySelector("[part~='payment']");
		if (box === null) throw new Error('the card drew no payment box');
		return box as HTMLElement;
	}

	/** the light-DOM node the element hands a provider, which is what a provider paints into. */
	function mountNode(host: HTMLElement): HTMLElement {
		const node = host.querySelector('[slot="payment"]');
		if (node === null) throw new Error('the element opened no payment mount');
		return node as HTMLElement;
	}

	/** the sentence the element is saying out loud, off the region that outlives every card. */
	function said(shadow: ShadowRoot): string {
		return (shadow.querySelector('[role="status"]') as HTMLElement).textContent ?? '';
	}

	/** the press that spends the money, on whichever step is on screen. */
	function donate(shadow: ShadowRoot): void {
		(shadow.querySelector(".step:not([hidden]) [part~='submit']") as HTMLElement).click();
	}

	// the reserve, measured: the provider's frame arrives whole tasks after the step is drawn, and a
	// box that grows from nothing under a donor's eyes moves the button they are reaching for.
	it('holds its reserved height on the step it is drawn on', async () => {
		const { host, shadow } = await mount();
		await atReview(shadow);
		const box = paymentBox(shadow);

		expect(getComputedStyle(box).display).not.toBe('none');
		expect(box.getBoundingClientRect().height).toBeGreaterThanOrEqual(88);
		// and the node the provider is handed is inside it, which is what makes that box the one a
		// frame would be measured against.
		expect(mountNode(host).getBoundingClientRect().width).toBeGreaterThan(0);
	});

	// both channels, in a browser with a real caret in it: the box takes the caret and carries the
	// sentence by `aria-describedby`, and the region says it as well.
	it('takes the caret a refused press puts on it, and says the refusal too', async () => {
		const { shadow } = await mount();
		await atReview(shadow);
		donate(shadow);
		await settle();

		expect(shadow.activeElement).toBe(paymentBox(shadow));
		expect(said(shadow)).toBe('Please select payment method');
	});

	// and again on the press after it. the words do not change, so a region handed them a second
	// time is not a change and is announced by nobody — the region is emptied and written again a
	// task later, which is the whole of what a donor pressing Donate twice has to hear. Safari on
	// macOS focuses no button on a click, so there the caret does not move on that second press
	// either and this is the only channel left.
	it('says the refusal again on the press after it', async () => {
		const { shadow } = await mount();
		await atReview(shadow);
		donate(shadow);
		await settle();
		donate(shadow);

		expect(said(shadow)).toBe('');

		await settle();

		expect(said(shadow)).toBe('Please select payment method');
	});

	// and the state the caret's own channel does not survive, which a host page can reach on its
	// own: a `::part(payment)` rule wins over this element's own (every case above), so a page that
	// hides the box takes the caret's landing place away with it. `focus()` on a box with no layout
	// box is a no-op the platform reports to nobody.
	it('announces the refusal where the box cannot take the caret', async () => {
		const { tag, shadow } = await mount();
		await atReview(shadow);
		page(`${tag}::part(payment) { display: none }`);
		donate(shadow);
		await settle();

		expect(shadow.activeElement).not.toBe(paymentBox(shadow));
		expect(said(shadow)).toBe('Please select payment method');
	});
});

// the rows drawn beside the provider's frame (../embed/rows.ts) adopt a sheet of their own, and a
// closed row that still draws its panel puts a processor's branded button on screen under a name
// nobody opened. `hidden` is an attribute and whether it hides is a cascade, so only a real engine
// can say.
// the coin list adopts a sheet of its own after the card's paint (../coin-picker.ts), and `hidden` is
// only as strong as the rule that answers it there: a class drawing a box `display: grid` would put a
// closed list, a tick on every coin and a refusal under every one back on screen.
describe('the coin list inside the crypto option', () => {
	const mounts: HTMLElement[] = [];
	afterEach(() => {
		for (const node of mounts.splice(0)) node.remove();
	});

	/**
	 * a coin's logo, inline: the served path is the processor's own and this pool reaches no network,
	 * so a fetched one would arrive as the `error` the picker removes the image on — which is the
	 * fallback rather than the case the rules below measure.
	 */
	const LOGO =
		'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 8 8%22%3E%3Ccircle cx=%224%22 cy=%224%22 r=%224%22 fill=%22%23123456%22/%3E%3C/svg%3E';

	// the tokens reach the list by inheritance from the card around it, which `data-donate-root` in
	// ./tokens.css stands in for; without them every colour the ring cases compare resolves to one.
	function drawn(refused: boolean, problem = '') {
		const picker = createCoinPicker(document);
		const card = document.createElement('div');
		card.setAttribute('data-donate-root', '');
		const sheet = document.createElement('style');
		sheet.textContent = tokens;
		card.append(sheet, picker.host);
		document.body.appendChild(card);
		mounts.push(card);
		picker.update(
			{
				value: 'btc',
				options: [
					{
						value: 'btc',
						label: 'BTC',
						name: 'Bitcoin',
						network: 'Bitcoin',
						logo: LOGO,
						refused: false
					},
					{
						value: 'sol',
						label: 'SOL',
						name: 'Solana',
						network: 'Solana',
						refused
					}
				],
				onChange: () => {}
			},
			problem
		);
		return picker.host.shadowRoot as ShadowRoot;
	}

	/** the box's edge and ring while its input holds a keyboard caret, closed and then opened. */
	async function ringed(root: ShadowRoot) {
		const box = root.querySelector('.picker') as HTMLElement;
		const input = box.querySelector('input') as HTMLInputElement;
		const edge = () => {
			const style = getComputedStyle(box);
			return { border: style.borderTopColor, ring: style.boxShadow };
		};
		const rest = edge();
		await caretOn(input);
		const closed = { open: box.dataset.state === 'open', ...edge() };
		await userEvent.keyboard('{ArrowDown}');
		await vi.waitFor(() => {
			if (box.dataset.state !== 'open') throw new Error('the list is not open');
		});
		const open = { open: box.dataset.state === 'open', ...edge() };
		return { rest, closed, open };
	}
	// drawn, rather than laid out: an unchosen row's tick keeps its box and hides the mark.
	const shown = (node: Element | null) =>
		node !== null && node.checkVisibility({ visibilityProperty: true });

	/** the box pressed, and the list once the machine has opened it (../coin-picker.ts). */
	async function opened(root: ShadowRoot): Promise<void> {
		(root.querySelector('.picker') as HTMLElement).click();
		await vi.waitFor(() => {
			if (!root.querySelector('.coin-list')?.checkVisibility())
				throw new Error('the list is not open');
		});
	}

	it('draws no list, no tick and no refusal while closed and nothing is refused', async () => {
		const root = drawn(false);

		expect(shown(root.querySelector('.coin-list'))).toBe(false);
		expect(shown(root.querySelector('.no-match'))).toBe(false);
		expect(shown(root.querySelector('#coin-problem'))).toBe(false);
	});

	// the status stands outside the list so it is in the tree while the list is closed, and takes no
	// room on the card there.
	it('keeps the no-match status off the page while it stands beside the closed list', async () => {
		const root = drawn(false);
		const status = root.querySelector('[role="status"]') as HTMLElement;
		const row = root.querySelector('.field-row') as HTMLElement;
		const box = root.querySelector('.picker') as HTMLElement;

		expect(status.getBoundingClientRect().width).toBeLessThanOrEqual(1);
		expect(row.getBoundingClientRect().bottom).toBe(box.getBoundingClientRect().bottom);
	});

	// the seat every refusal on the card takes (`a refusal under its box` below), though the closed
	// list stands between the box and the sentence here.
	it('says a refusal close under its box, at the step every refusal takes', async () => {
		const root = drawn(false, 'Choose a coin to give');
		const box = root.querySelector('.picker') as HTMLElement;
		const refusal = root.querySelector('#coin-problem') as HTMLElement;

		expect(shown(refusal)).toBe(true);
		expect(refusal.getBoundingClientRect().top - box.getBoundingClientRect().bottom).toBeCloseTo(
			step(root, '--_sp1'),
			0
		);
	});

	it('opens the list on a press, ticks only the picked coin and says the refusal under a refused one', async () => {
		const root = drawn(true);
		await opened(root);
		const [btc, sol] = [...root.querySelectorAll('[role="option"]')];

		expect(shown(root.querySelector('.coin-list'))).toBe(true);
		expect(shown(root.querySelector('.no-match'))).toBe(false);
		expect(shown(btc?.querySelector('.tick') ?? null)).toBe(true);
		expect(shown(sol?.querySelector('.tick') ?? null)).toBe(false);
		expect(shown(btc?.querySelector('.message') ?? null)).toBe(false);
		expect(shown(sol?.querySelector('.message') ?? null)).toBe(true);
	});

	// the search box stands in a value's place exactly as the card's own boxes do, so it is drawn at
	// the rung they are (`[part~='amount-input'] input::placeholder` in ../styles/parts.css argues the pair):
	// this sheet is adopted into a root of its own and is the one place the card's rung can drift.
	it('draws its placeholder at the rung the card draws a placeholder at', async () => {
		const root = drawn(false);
		const input = root.querySelector('.picker input') as HTMLInputElement;

		expect(getComputedStyle(input, '::placeholder').color).toBe(used(root, '--_n10'));
	});

	// the box is the field and its input draws nothing, so a ring given only to the open box leaves a
	// keyboard donor on a closed one — tabbed in, back from Escape — with no mark of where they are.
	it('rings the closed box its caret is in with the open box’s ring, in the accent', async () => {
		const root = drawn(false);
		const { rest, closed, open } = await ringed(root);

		expect(closed.open).toBe(false);
		expect(open.open).toBe(true);
		expect(rest.ring).toBe('none');
		expect(closed.border).toBe(used(root, '--_focus-ring'));
		expect({ border: closed.border, ring: closed.ring }).toEqual({
			border: open.border,
			ring: open.ring
		});
	});

	// the list is a field: what it shows closed, what a donor types and every row it opens to are set
	// at the size and weight a field beside it is, so nothing in it reads larger than the words around.
	it.each(['16px', '18px'])(
		'sets every word of the list at the size and weight of a field beside it, at a %s card',
		async (size) => {
			const root = drawn(false);
			const card = (root.host as HTMLElement).parentElement as HTMLElement;
			card.style.fontSize = size;
			const neighbour = document.createElement('div');
			const shadow = neighbour.attachShadow({ mode: 'open' });
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(partSheet);
			shadow.adoptedStyleSheets = [sheet];
			const field = document.createElement('input');
			field.setAttribute('part', 'field');
			shadow.appendChild(field);
			card.appendChild(neighbour);
			const type = (node: Element | null) => {
				const style = getComputedStyle(node as Element);
				return `${style.fontSize} ${style.fontWeight}`;
			};
			const closed = ['input', '.chosen .coin-ticker'].map((selector) =>
				type(root.querySelector(selector))
			);
			await opened(root);
			const open = [type(root.querySelector('[role="option"] .coin-ticker'))];

			expect([...closed, ...open]).toEqual(Array(3).fill(type(field)));
		}
	);

	// a ticker is read against a wallet's, character for character; a network's name is prose.
	it('sets the ticker in the monospace stack and the network in the card’s face', async () => {
		const root = drawn(false);
		const family = (selector: string) =>
			getComputedStyle(root.querySelector(selector) as Element).fontFamily;
		const closed = family('.chosen .coin-ticker');
		await opened(root);

		expect(closed).toBe(family('[role="option"] .coin-ticker'));
		expect(family('[role="option"] .coin-ticker')).toContain('ui-monospace');
		expect(family('[role="option"] .net')).toContain('system-ui');
	});

	// the mark's width is the row's to lose: a logo that was blocked leaves the lettered shape under
	// it, and a text column measured against each row's own mark would start the words at one x on
	// the rows whose image arrived and at another on the rows whose did not.
	it('starts every row’s words at one x, whichever mark the row drew', async () => {
		const root = drawn(false);
		await opened(root);
		const rows = [...root.querySelectorAll<HTMLElement>('[role="option"]')];
		const marks = rows.map((row) => (row.querySelector('img') === null ? 'letter' : 'logo'));
		const lefts = () =>
			rows.map(
				(row) => (row.querySelector('.coin-ticker') as HTMLElement).getBoundingClientRect().left
			);
		const before = lefts();

		expect(marks).toEqual(['logo', 'letter']);
		expect(new Set(before).size).toBe(1);

		// and the column is the list's rather than each row's, which is the whole of what holds once
		// two marks differ: one drawn wider moves the words on every row, not only on its own.
		const wide = root.querySelector('[role="option"] .logo') as HTMLElement;
		wide.style.inlineSize = '3em';

		expect(new Set(lefts()).size).toBe(1);
		expect(lefts()[1]).toBeGreaterThan(before[1] as number);
	});

	// the ticker and the pill are two lines rather than one run that wraps, so a network of two words
	// settles on the second line instead of pushing the row's height around.
	it('sets the ticker over the pill on lines of their own, whatever the network is called', async () => {
		const root = drawn(false);
		await opened(root);
		const row = root.querySelector('[role="option"]') as HTMLElement;
		const ticker = row.querySelector('.coin-ticker') as HTMLElement;
		const pill = row.querySelector('.net') as HTMLElement;
		const before = ticker.getBoundingClientRect();

		expect(pill.getBoundingClientRect().top).toBeGreaterThanOrEqual(before.bottom);
		expect(pill.getBoundingClientRect().left).toBe(before.left);

		pill.textContent = 'Binance Smart Chain';
		expect(ticker.getBoundingClientRect()).toEqual(before);
	});

	// the mark stands on the middle of the pair rather than on the first line of it: the two lines are
	// fixed, so there is no wrap for it to drift away from.
	it('centres the mark on the two lines beside it', async () => {
		const root = drawn(false);
		await opened(root);
		const row = root.querySelector('[role="option"]') as HTMLElement;
		const mark = (row.querySelector('.logo') as HTMLElement).getBoundingClientRect();
		const ticker = (row.querySelector('.coin-ticker') as HTMLElement).getBoundingClientRect();
		const pill = (row.querySelector('.net') as HTMLElement).getBoundingClientRect();

		expect(mark.top + mark.height / 2).toBeCloseTo(ticker.top + (pill.bottom - ticker.top) / 2, 1);
	});

	// which entry a network takes is a rule over its own words (`networkTint` in ../coins.ts) and no
	// table, so the only thing a sheet can get wrong is whether the entry it picked paints at all: a
	// `data-tint` no rule answers leaves the pill with no ground, which renders as a word among words
	// and reads as finished.
	it('gives every entry of the network palette a ground and an ink of its own', async () => {
		const root = drawn(false);
		const row = root.querySelector('.field-row') as HTMLElement;
		const painted = [...Array(NETWORK_TINTS).keys()].map((tint) => {
			const pill = document.createElement('span');
			pill.className = 'net';
			pill.dataset.tint = String(tint);
			row.appendChild(pill);
			const style = getComputedStyle(pill);
			const pair = `${style.backgroundColor} on ${style.color}`;
			pill.remove();
			return pair;
		});

		expect(new Set(painted).size).toBe(NETWORK_TINTS);
		expect(painted.filter((pair) => pair.includes('rgba(0, 0, 0, 0)'))).toEqual([]);
	});

	// the logo is the processor's own image and the letter under it is what a blocked or broken one
	// leaves showing, so the two share the mark's one cell: an image that did not fill it would leave
	// the letter beside it, and one drawn on its own transparency would leave the letter under it.
	it('stands the coin’s logo in the mark, over the letter it falls back to', async () => {
		const root = drawn(false);
		await opened(root);
		const mark = root.querySelector('[role="option"] .logo') as HTMLElement;
		const image = mark.querySelector('img') as HTMLImageElement;
		const letter = mark.querySelector('.initial') as HTMLElement;

		// the second coin's entry carries no path, so its own letter is what its mark shows.
		const bare = root.querySelectorAll('[role="option"] .initial')[1] as HTMLElement;

		expect(image.getBoundingClientRect()).toEqual(mark.getBoundingClientRect());
		expect(getComputedStyle(letter).visibility).toBe('hidden');
		expect(getComputedStyle(bare).visibility).toBe('visible');
	});

	// the crypto option stands in the card, which clips its own overflow, and the card in whatever box
	// a host puts it in: a list opened inside either is cut at its edge, or covered by the host's own
	// stacking.
	it('floats the open list over a host box that clips, transforms and stacks above it', async () => {
		const root = drawn(false);
		const card = (root.host as HTMLElement).parentElement as HTMLElement;
		const frame = document.createElement('div');
		frame.style.cssText =
			'position: relative; overflow: hidden; transform: translateZ(0); inline-size: 400px;';
		frame.appendChild(card);
		document.body.appendChild(frame);
		mounts.push(frame);
		const cover = document.createElement('div');
		cover.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647;';
		document.body.appendChild(cover);
		mounts.push(cover);

		await opened(root);
		const last = await vi.waitFor(() => {
			const rows = [...root.querySelectorAll<HTMLElement>('[role="option"]')];
			const row = rows.at(-1);
			if (row === undefined || !row.checkVisibility()) throw new Error('the list is not open');
			if (row.getBoundingClientRect().top < frame.getBoundingClientRect().bottom)
				throw new Error('the list is not placed');
			return row;
		});
		const at = last.getBoundingClientRect();

		expect(at.bottom).toBeGreaterThan(frame.getBoundingClientRect().bottom);
		expect(
			root
				.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2)
				?.closest('[role="option"]')
		).toBe(last);
	});

	it('rings a refused closed box its caret is in with the refused open box’s ring', async () => {
		const root = drawn(false, 'Choose a coin.');
		const { rest, closed, open } = await ringed(root);

		expect(closed.open).toBe(false);
		expect(closed.border).toBe(used(root, '--_bad'));
		expect(closed.ring).not.toBe(rest.ring);
		expect({ border: closed.border, ring: closed.ring }).toEqual({
			border: open.border,
			ring: open.ring
		});
	});
});

// the address screen: the account of what is being sent, and under it the one thing the donor is
// asked to do. its values are what a donor retypes or checks, where `0` and `O`, `l` and `1` must
// not share a shape; the words around them stay in the card's face.
describe('the address screen', () => {
	const mounts: HTMLElement[] = [];
	const blocks: DepositView[] = [];
	afterEach(() => {
		for (const block of blocks.splice(0)) block.stop();
		for (const node of mounts.splice(0)) node.remove();
		vi.restoreAllMocks();
	});

	/** longer than any sentence this card draws at one line of the address's own size. */
	const LONG =
		'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae';

	function drawn({
		width = '375px',
		address = LONG,
		seed
	}: {
		width?: string;
		address?: string;
		seed?: string;
	} = {}): HTMLElement {
		const mount = document.createElement('div');
		const shadow = mount.attachShadow({ mode: 'open' });
		shadow.adoptedStyleSheets = [tokens, partSheet, layoutSheet].map((css) => {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);
			return sheet;
		});
		const block = createDepositBlock(document, () => {});
		blocks.push(block);
		shadow.appendChild(block.root);
		// the card's inset, which a Copy's target reaches into past the sentence's end.
		mount.style.cssText = `display: block; box-sizing: border-box; inline-size: ${width}; padding: var(--_inset);`;
		if (seed !== undefined) {
			// a host that inks its own page light-on-dark, which the card's text inherits from.
			mount.style.setProperty('--donate-primary', seed);
			mount.style.color = 'white';
			mount.style.background = 'black';
		}
		document.body.appendChild(mount);
		mounts.push(mount);
		block.update({
			ticker: 'XRP',
			network: 'Ripple',
			networkWarning: 'Send on this network only, or your gift may not reach Acme Relief Fund.',
			gift: { figure: '19.36', worth: '$25.00' },
			fee: { figure: '0.70', worth: '$0.90' },
			total: { figure: '20.06', worth: '$25.90' },
			instruction: {
				lead: 'Send ',
				toAddress: ' to this address ',
				andMemo: ' and include memo '
			},
			address,
			memo: '3198472051',
			qr: ['1110111', '1010101', '1110111', '0001000', '1110111', '1010101', '1110111'],
			expiry: {
				left: 6 * 24 * 60 * 60 * 1000,
				moment: 'September 24, 2026 at 3:42 PM',
				words: (left, unit) => `Expires in ${left} ${unit}${left === 1 ? '' : 's'}`
			},
			status: 'Waiting for your gift'
		});
		return block.root;
	}

	/**
	 * what a piece draws across, which a full-width block's own box does not say: a box for a drawn
	 * object, the two halves' boxes for a cut line (whose range would span the characters it hides),
	 * and the laid-out text for the rest.
	 */
	const drawnExtent = (piece: HTMLElement): { left: number; right: number } => {
		if (piece.matches('.qr, button')) return piece.getBoundingClientRect();
		if (piece.matches('.line')) {
			const [head, tail] = [...piece.children].map((half) => half.getBoundingClientRect());
			return { left: (head as DOMRect).left, right: (tail as DOMRect).right };
		}
		const range = document.createRange();
		range.selectNodeContents(piece);
		return range.getBoundingClientRect();
	};

	/** a used colour as the sRGB bytes a screen, and a camera, would see. */
	const bytes = (color: string): readonly number[] => {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext('2d') as CanvasRenderingContext2D;
		context.fillStyle = color;
		context.fillRect(0, 0, 1, 1);
		return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
	};

	/**
	 * the two values inside the sentence. each highlighted run is itself the control that copies it,
	 * so these are the buttons.
	 */
	const runs = (root: HTMLElement) => {
		const [address, memo] = [...root.querySelectorAll<HTMLButtonElement>('button.run')];
		return { address: address as HTMLButtonElement, memo: memo as HTMLButtonElement };
	};

	it('sets every figure, the address and the memo in the monospace stack', () => {
		const values = [...drawn().querySelectorAll('.value:not(.name)')].map(
			(node) => getComputedStyle(node).fontFamily
		);

		// the three entries, the figure inside the sentence, and the two values copied out of it.
		expect(values).toHaveLength(6);
		for (const stack of values) {
			expect(stack).toContain('ui-monospace');
			expect(stack.endsWith('monospace')).toBe(true);
		}
	});

	it('ranks the ticker under the figure it follows, on the figure’s own line', () => {
		const root = drawn();
		const amount = root.querySelector('.entry.total .value.amount') as HTMLElement;
		const figure = amount.querySelector('.figure') as HTMLElement;
		const ticker = amount.querySelector('.ticker') as HTMLElement;
		const read = (node: HTMLElement) => {
			const style = getComputedStyle(node);
			return { size: Number.parseFloat(style.fontSize), weight: Number(style.fontWeight) };
		};

		const value = read(figure);
		const unit = read(ticker);
		expect(unit.size).toBeLessThan(value.size);
		expect(unit.weight).toBeLessThan(value.weight);
		// both halves are one string to anything reading the card rather than looking at it.
		expect(amount.textContent).toBe('20.06 XRP');
		// one line, the ticker after the figure and sharing its line rather than sitting under it.
		const [left, right] = [figure.getBoundingClientRect(), ticker.getBoundingClientRect()];
		expect(right.left).toBeGreaterThanOrEqual(left.right - 1);
		expect(right.top).toBeLessThan(left.bottom);
		expect(left.top).toBeLessThan(right.bottom);
	});

	it('ranks the total over the entries it totals, and its worth under both', () => {
		const root = drawn();
		const size = (selector: string) =>
			Number.parseFloat(getComputedStyle(root.querySelector(selector) as Element).fontSize);

		expect(size('.entry.total .value.amount')).toBeGreaterThan(size('.entry .value.amount'));
		expect(size('.entry .worth')).toBeLessThan(size('.entry .value.amount'));
	});

	it('leaves the network’s name, the labels and the sentence in the card’s face', () => {
		const root = drawn();
		const family = (selector: string) =>
			getComputedStyle(root.querySelector(selector) as Element).fontFamily;

		expect(family('.value.name')).toContain('system-ui');
		expect(family('[part~="label"]')).toContain('system-ui');
		expect(family('.instruction')).toContain('system-ui');
	});

	it.each(['375px', '560px'])(
		'stands every piece of the instruction on one centre line at %s',
		(width) => {
			const root = drawn({ width });
			const box = root.getBoundingClientRect();
			const centre = box.left + box.width / 2;
			const pieces = [...root.querySelectorAll<HTMLElement>('.qr, .expiry, .status')];

			expect(pieces).toHaveLength(3);
			for (const piece of pieces) {
				const ink = drawnExtent(piece);
				const named = piece.className;
				expect({ named, centred: Math.abs((ink.left + ink.right) / 2 - centre) < 1.5 }).toEqual({
					named,
					centred: true
				});
			}
			// the sentence takes the whole column and centres its own lines, which is what keeps a
			// value that drops to a line of its own on the same centre as the code under it.
			const sentence = root.querySelector('.instruction') as HTMLElement;
			expect(getComputedStyle(sentence).textAlign).toBe('center');
			expect(sentence.getBoundingClientRect().width).toBeCloseTo(box.width, 0);
		}
	);

	it('reads the account, then the sentence, the code, the send-by and the status', () => {
		const root = drawn();
		const box = (selector: string) =>
			(root.querySelector(selector) as HTMLElement).getBoundingClientRect();
		const entries = [...root.querySelectorAll<HTMLElement>('.entry')].map(
			(row) => row.getBoundingClientRect().top
		);

		const order = [
			...entries,
			box('.instruction').top,
			box('.qr').top,
			box('.expiry').top,
			box('.status').top
		];
		expect(order).toEqual([...order].sort((a, b) => a - b));
		// the send-by stands on the code it closes: nearer the modules over it than the status under it.
		const onTheCode = box('.expiry').top - box('.qr').bottom;
		const offTheStatus = box('.status').top - box('.expiry').bottom;
		expect(onTheCode).toBeLessThan(offTheStatus);
	});

	it.each(['375px', '560px'])(
		'sets every entry on one row, on one set of columns at %s',
		(width) => {
			const root = drawn({ width });
			const rows = [...root.querySelectorAll<HTMLElement>('.entry:not(.network)')];
			const edges = new Set<number>();

			expect(rows).toHaveLength(3);
			for (const row of rows) {
				const named = (row.querySelector('[part~="label"]') as HTMLElement).textContent;
				const label = (row.querySelector('[part~="label"]') as HTMLElement).getBoundingClientRect();
				const value = (row.querySelector('.value') as HTMLElement).getBoundingClientRect();
				const worth = (row.querySelector('.worth') as HTMLElement).getBoundingClientRect();
				edges.add(Math.round(worth.right));

				// three boxes across in that order and all three on the one line: no row is propped open
				// and none wraps.
				const shares = (one: DOMRect, two: DOMRect) => one.top < two.bottom && two.top < one.bottom;
				expect({
					named,
					across: label.right <= value.left + 1 && value.right <= worth.left + 1,
					together: shares(label, worth) && shares(value, worth),
					inside: worth.right <= root.getBoundingClientRect().right + 1
				}).toEqual({ named, across: true, together: true, inside: true });
			}
			// one grid: every row's last column ends on the same edge.
			expect(edges.size).toBe(1);
		}
	);

	it('separates the rows by the block’s own gap and props none of them open', () => {
		const root = drawn();
		const rows = [...root.querySelectorAll<HTMLElement>('.entry:not(.network):not(.total)')];
		const line = (row: HTMLElement) =>
			Number.parseFloat(getComputedStyle(row.querySelector('.value') as Element).lineHeight);

		for (const row of rows) {
			// one line of text and nothing more: no padding of its own, no height it is held to.
			expect(row.getBoundingClientRect().height).toBeCloseTo(line(row), 0);
		}
	});

	it('lays the network’s caution over the rows under it rather than among them', async () => {
		const root = drawn();
		const mark = root.querySelector('.caution') as HTMLButtonElement;
		const caution = root.querySelector('.attention') as HTMLElement;
		const under = root.querySelector('.entry:not(.network)') as HTMLElement;
		const before = under.getBoundingClientRect().top;

		await userEvent.click(mark);

		const band = caution.getBoundingClientRect();
		expect(under.getBoundingClientRect().top).toBeCloseTo(before, 0);
		// it stands on the warning band's own ground, over the rows it covers.
		expect(band.bottom).toBeGreaterThan(before);
		expect(bytes(getComputedStyle(caution).backgroundColor)).not.toEqual(
			bytes(getComputedStyle(root).backgroundColor)
		);
		const middle = band.left + band.width / 2;
		expect(
			(root.getRootNode() as ShadowRoot).elementFromPoint(middle, band.top + band.height / 2)
		).toBe(caution);
	});

	it('narrows the value rather than the mark beside it when the card narrows', () => {
		const wide = runs(drawn({ width: '560px' })).address;
		const narrow = runs(drawn({ width: '375px' })).address;
		const width = (run: HTMLElement, selector: string) =>
			(run.querySelector(selector) as HTMLElement).getBoundingClientRect().width;

		expect(width(narrow, '.mark')).toBeCloseTo(width(wide, '.mark'), 0);
		expect(width(narrow, '.line')).toBeLessThan(width(wide, '.line'));
	});

	it('keeps a long address on one line, with both of its ends in view', () => {
		const root = drawn();
		const line = runs(root).address.querySelector('.line') as HTMLElement;
		const head = line.querySelector('.head') as HTMLElement;
		const tail = line.querySelector('.tail') as HTMLElement;
		const edge = root.getBoundingClientRect();

		expect(line.textContent).toBe(LONG);
		expect(line.getBoundingClientRect().height).toBeLessThan(
			Number.parseFloat(getComputedStyle(line).fontSize) * 2
		);
		expect(head.scrollWidth).toBeGreaterThan(head.clientWidth);
		expect(LONG.startsWith(head.textContent ?? '')).toBe(true);
		expect(tail.textContent?.length).toBeGreaterThan(0);
		expect(tail.scrollWidth).toBeLessThanOrEqual(tail.clientWidth);
		expect(head.getBoundingClientRect().left).toBeGreaterThanOrEqual(edge.left);
		expect(tail.getBoundingClientRect().right).toBeLessThanOrEqual(edge.right);
	});

	it('draws an address that fits whole, with nothing cut', () => {
		const root = drawn({ width: '560px', address: 'rDEVxFAKExADDRESSxNOTxREALxXRP0000' });
		const head = runs(root).address.querySelector('.head') as HTMLElement;

		expect(head.scrollWidth).toBeLessThanOrEqual(head.clientWidth);
	});

	it('draws the QR dark on white, four modules of ground around it and two underneath', () => {
		const root = drawn({ seed: '#0a0a0a' });
		const qr = root.querySelector('.qr') as HTMLElement;
		const style = getComputedStyle(qr);

		for (const channel of bytes(style.backgroundColor)) expect(channel).toBeGreaterThanOrEqual(245);
		for (const channel of bytes(getComputedStyle(qr.querySelector('path') as Element).fill)) {
			expect(channel).toBeLessThanOrEqual(80);
		}
		// the fixture's first and last row and column each hold a dark module, so the path spans the
		// code and the ground around it is the quiet zone itself.
		const code = (qr.querySelector('path') as SVGPathElement).getBoundingClientRect();
		const ground = qr.getBoundingClientRect();
		const module = code.width / 7;
		expect(code.left - ground.left).toBeCloseTo(4 * module, 0);
		expect(ground.right - code.right).toBeCloseTo(4 * module, 0);
		expect(code.top - ground.top).toBeCloseTo(4 * module, 0);
		// two underneath, so the send-by sits on the code rather than a second line height away.
		expect(ground.bottom - code.bottom).toBeCloseTo(2 * module, 0);
	});

	it('sizes the code so its own margin is the line height between it and the words', () => {
		const root = drawn();
		const qr = root.querySelector('.qr') as HTMLElement;
		const code = (qr.querySelector('path') as SVGPathElement).getBoundingClientRect();
		const line = Number.parseFloat(
			getComputedStyle(root.querySelector('.instruction') as Element).lineHeight
		);

		expect((code.width / 7) * 4).toBeCloseTo(line, 0);
	});

	it('makes the whole run the control, with the mark inside it as affordance alone', () => {
		const root = drawn();
		const { address } = runs(root);
		const shadow = root.getRootNode() as ShadowRoot;
		const line = Number.parseFloat(
			getComputedStyle(root.querySelector('.instruction') as Element).lineHeight
		);
		const box = address.getBoundingClientRect();
		const mark = address.querySelector('.mark') as HTMLElement;

		// one control per value and no control inside it: the mark is decoration and carries no target
		// of its own, so two runs cannot cover the same pixel however the sentence wraps.
		expect(address.querySelectorAll('button')).toHaveLength(0);
		expect(mark.getAttribute('aria-hidden')).toBe('true');
		expect(address.getAttribute('aria-label')).toBe('Copy address');
		// the value is the control's description, so a reader is told what it copies as well as that
		// it copies.
		const value = address.querySelector('.line') as HTMLElement;
		expect(address.getAttribute('aria-describedby')).toBe(value.id);
		// the run is one line box of the sentence and the mark is the glyph's own size inside it.
		expect(box.height).toBeCloseTo(line, 0);
		// and the line it sits on keeps the prose's own leading: this fixture puts the two runs on
		// consecutive lines, and a control that bent the text would show up as the gap between them.
		const below = runs(root).memo.getBoundingClientRect();
		expect(below.top - box.top).toBeLessThanOrEqual(line + 1.5);
		expect(mark.getBoundingClientRect().width).toBeLessThan(box.width);
		// a press lands on the control anywhere on its ground — on the value, and on the mark.
		for (const x of [box.left + 2, box.right - 2]) {
			expect(shadow.elementFromPoint(x, box.top + box.height / 2)?.closest('button')).toBe(address);
		}
	});

	it('never covers one run’s ground with the other’s, at any value length', () => {
		const overlap = (address: string, memo: string): number => {
			const root = drawn({ address });
			(runs(root).memo.querySelector('.line') as HTMLElement).textContent = memo;
			const [one, two] = [runs(root).address, runs(root).memo].map((run) =>
				run.getBoundingClientRect()
			);
			const across =
				Math.min((one as DOMRect).right, (two as DOMRect).right) -
				Math.max((one as DOMRect).left, (two as DOMRect).left);
			const down =
				Math.min((one as DOMRect).bottom, (two as DOMRect).bottom) -
				Math.max((one as DOMRect).top, (two as DOMRect).top);
			return Math.min(across, down);
		};

		// the two controls are inline boxes of the same paragraph, so whatever the values are and
		// wherever the sentence breaks, neither reaches into the other.
		for (const [address, memo] of [
			['rDEVxFAKExADDRESSxNOTxREALxXRP0000', '104729'],
			['rDEVxFAKExADDRESSxNOTxREALxXRP0000', '9876543210987654'],
			['rDEVxFAKEXRP0000', '104729'],
			['rDEVxFAKEXRP0000', '10']
		]) {
			expect({
				address,
				memo,
				overlapping: overlap(address as string, memo as string) > 0
			}).toEqual({ address, memo, overlapping: false });
		}
	});

	it('holds the run’s mark through every outcome, with a mark and no word in each', () => {
		const button = runs(drawn()).address;
		const shown = () =>
			[...button.querySelectorAll<HTMLElement>('.copy-face')].filter(
				(face) => getComputedStyle(face).visibility === 'visible'
			);
		const first = (button.querySelector('.mark') as HTMLElement).getBoundingClientRect();

		for (const outcome of ['ready', 'copied', 'failed']) {
			button.dataset.outcome = outcome;
			expect(shown()).toHaveLength(1);
			expect(shown()[0]?.querySelector('svg')?.getBoundingClientRect().width).toBeGreaterThan(0);
			const box = (button.querySelector('.mark') as HTMLElement).getBoundingClientRect();
			// the same box in every state, so no word in the sentence moves on a press.
			expect({
				outcome,
				words: shown()[0]?.textContent,
				width: box.width,
				height: box.height
			}).toEqual({ outcome, words: '', width: first.width, height: first.height });
		}
	});

	it('rings the run on its own edge, and paints its ground under a press', async () => {
		const root = drawn();
		const button = runs(root).address;
		const resting = getComputedStyle(button).backgroundColor;
		const ring = await caretOn(button);
		const shadow = root.getRootNode() as ShadowRoot;

		// the ring hugs the ground a donor presses, with no gap and in the card's own ring colour
		// rather than in anything the control's own tone changes.
		expect(ring.boxShadow).toContain(used(shadow, '--_focus-ring'));
		expect(ring.outlineOffset === '' || Number.parseFloat(ring.outlineOffset) === 0).toBe(true);
		expect(bytes(resting)).not.toEqual(bytes(used(shadow, '--_n4')));
	});

	it('leaves no ring on a run a pointer pressed', async () => {
		const button = runs(drawn()).address;
		await userEvent.click(button);

		expect(getComputedStyle(button).boxShadow).toBe('none');
		// the pointer outlives this test, and the run is wide enough to park it over whatever the next
		// card draws in that column — which would be read as a hover state nobody asked for.
		await userEvent.unhover(button);
	});

	it('shows the whole address, selected, when the clipboard refuses', async () => {
		const root = drawn();
		const button = runs(root).address;
		const line = button.querySelector('.line') as HTMLElement;
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

		button.click();
		await vi.waitFor(() => expect(button.dataset.outcome).toBe('failed'));

		const edge = root.getBoundingClientRect();
		expect(line.getBoundingClientRect().height).toBeGreaterThan(
			Number.parseFloat(getComputedStyle(line).fontSize) * 2
		);
		expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
		expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(edge.right);
		expect(document.getSelection()?.toString().replace(/\s/g, '')).toBe(LONG);
	});
});

describe('a payment row drawn beside the provider’s frame', () => {
	const mounts: HTMLElement[] = [];
	afterEach(() => {
		for (const node of mounts.splice(0)) node.remove();
	});

	function drawn(mark: RowMark = 'paypal'): {
		mount: HTMLElement;
		panel: HTMLElement;
		content: HTMLElement;
		row: Row;
	} {
		const mount = document.createElement('div');
		document.body.appendChild(mount);
		mounts.push(mount);
		const content = document.createElement('button');
		content.textContent = 'PayPal';
		const row = createRows(mount).draw('PayPal', mark, content);
		const panel = mount.firstElementChild?.shadowRoot?.querySelector('[role="region"]');
		if (!(panel instanceof HTMLElement)) throw new Error('the row drew no panel');
		return { mount, panel, content, row };
	}

	it('draws nothing of its panel while closed', () => {
		const { panel, content } = drawn();

		expect(getComputedStyle(panel).display).toBe('none');
		expect(content.getBoundingClientRect().height).toBe(0);
	});

	it('draws the panel once opened, and hides it again on close', () => {
		const { panel, content, row } = drawn();

		row.expand();
		expect(getComputedStyle(panel).display).not.toBe('none');
		expect(content.getBoundingClientRect().height).toBeGreaterThan(0);

		row.collapse();
		expect(getComputedStyle(panel).display).toBe('none');
	});

	// the name starts where the provider's own rows start theirs, about 37px in from the mark's start
	// on a 16px root — measured against its frame, which no test can reach into. the offset is the
	// glyph and the head's gap after it (`.head` and `.mark` in ./rows.css). every row is measured,
	// the fund's included: one mark box for all three is what keeps the name at one x, and the name
	// is the last thing in every head.
	it.each(['paypal', 'venmo', 'fund'] as const)(
		'draws the %s mark at the padding edge and the name a gap after it',
		(mark) => {
			const { head } = measured(mark);
			const glyph = head.querySelector('.mark') as SVGElement;
			const name = head.querySelector('.name') as HTMLElement;
			const headStyle = getComputedStyle(head);
			const paddingEdge =
				head.getBoundingClientRect().left + parseFloat(headStyle.paddingInlineStart);
			const offset = name.getBoundingClientRect().left - paddingEdge;

			expect(head.firstElementChild).toBe(glyph);
			expect(head.lastElementChild).toBe(name);
			expect(glyph.getBoundingClientRect().left).toBeCloseTo(paddingEdge, 1);
			expect(offset).toBeCloseTo(
				glyph.getBoundingClientRect().width + parseFloat(headStyle.columnGap),
				1
			);
			expect(Math.abs(offset - 37)).toBeLessThanOrEqual(1);
		}
	);

	// the open row is said in ink and ground and in nothing else. a name that went bold on the press
	// would be re-laid out under the pointer that pressed it, which is the rule
	// `[part~='amount-option']` in ./parts.css is held to and the whole reason `--_w-medium` exists
	// (./tokens.css). read on the drawn word as well as on the declaration, because a weight the
	// stack's tail resolves to the same glyphs would pass one and not the other.
	it('opens a row in ink and ground alone, at the weight the closed row draws its name at', () => {
		const { head, row } = measured('fund');
		const name = head.querySelector('.name') as HTMLElement;
		const band = head.parentElement as HTMLElement;
		const closed = getComputedStyle(head);
		const weight = closed.fontWeight;
		const ink = closed.color;
		const ground = getComputedStyle(band).backgroundColor;
		const resting = name.getBoundingClientRect().width;

		row.expand();

		expect(getComputedStyle(head).fontWeight).toBe(weight);
		expect(name.getBoundingClientRect().width).toBe(resting);
		expect(getComputedStyle(head).color).not.toBe(ink);
		expect(getComputedStyle(band).backgroundColor).not.toBe(ground);
	});

	// the fund's mark is Chariot's single-colour icon, every path `currentColor` (../embed/rows.ts), so
	// the head's own `color` is what paints it — and the head's colour is one thing closed and another
	// open (`.head` in ./rows.css). read in both states, because a glyph that took the ink once and
	// then sat still would pass an assertion written against either one of them.
	it('draws the fund mark in the row’s own ink, and moves it with the row’s state', () => {
		const { head, row } = measured('fund');
		const glyph = head.querySelector('.mark') as SVGElement;
		const fills = () =>
			new Set([...glyph.querySelectorAll('path')].map((path) => getComputedStyle(path).fill));

		const closed = getComputedStyle(head).color;
		expect(fills()).toEqual(new Set([closed]));

		row.expand();
		const open = getComputedStyle(head).color;

		expect(open).not.toBe(closed);
		expect(fills()).toEqual(new Set([open]));
	});

	// and the processors' rows take nothing from that ink: a brand's mark is drawn in the brand's
	// colours, which the head's own `color` would take back from a glyph filled `currentColor`.
	//
	// raw-colour-ok: the trademarks' own fills, as ../embed/rows.ts states them — `#008CFF`, the one
	// colour PayPal's and Venmo's files both state, and NOWPayments' `#68AAFF`.
	it.each([
		['paypal', 'rgb(0, 140, 255)'],
		['venmo', 'rgb(0, 140, 255)'],
		['crypto', 'rgb(104, 170, 255)']
	] as const)('fills the %s mark with the brand’s colours', (mark, brand) => {
		const { head } = measured(mark);
		const fills = [...head.querySelectorAll('.mark path')].map(
			(path) => getComputedStyle(path).fill
		);

		expect(fills.length).toBeGreaterThan(0);
		expect(fills).toContain(brand);
		expect(fills).not.toContain(getComputedStyle(head).color);
	});

	function measured(mark: RowMark): { head: HTMLElement; row: Row } {
		document.documentElement.style.fontSize = '16px';
		// the card's tokens reach a row through its slot; `[data-donate-root]` is the light-dom scope
		// the same sheet declares them on.
		page(tokens);
		const { mount, panel, row } = drawn(mark);
		mount.setAttribute('data-donate-root', '');
		return {
			head: (panel.getRootNode() as ShadowRoot).querySelector('.head') as HTMLElement,
			row
		};
	}
});

// a used size rather than a declared one, which is the other thing only a real engine hands back:
// the switch is a drawn track a little over an em tall, and what carries it to a target is the label
// around it — whose height is a line of text against a stated floor, and which of the two wins is a
// layout only a real engine performs.
describe('the target under the fee decision', () => {
	/**
	 * the fee row's rule and the words either side of it: the gift's row, whose one line is its box,
	 * and the decision's own words, which stand inside a target taller than they are.
	 */
	function aroundTheRule(shadow: ShadowRoot): { above: number; below: number; words: HTMLElement } {
		const row = shadow.querySelector('.row.fee') as HTMLElement;
		const gift = row.previousElementSibling as HTMLElement;
		const words = row.querySelector('.fee-decision > .row-label') as HTMLElement;
		const rule = row.getBoundingClientRect().top;
		const edge = rule + parseFloat(getComputedStyle(row).borderTopWidth);
		return {
			above: rule - gift.getBoundingClientRect().bottom,
			below: words.getBoundingClientRect().top - edge,
			words
		};
	}

	// the rule sets the decision apart from the gift above it, so it stands as far from one row's
	// words as from the other's. measured on both ends of the clamp band, where a length stated
	// against the card's own line and words set a step smaller than it part furthest.
	it.each([['15px'], ['16px'], ['18px']])(
		'stands the rule midway between the gift and the words, at a %s root',
		async (root) => {
			document.documentElement.style.fontSize = root;
			const { shadow } = await mount();
			await atReview(shadow);
			const { above, below } = aroundTheRule(shadow);

			expect(above).toBeGreaterThan(0);
			expect(
				Math.abs(above - below),
				`${above} over the rule, ${below} under it`
			).toBeLessThanOrEqual(DEVICE_PIXEL);
		}
	);

	// a host column narrow enough to wrap the decision's words, which then fill the target's height
	// themselves and leave no room over them to take back: the rule stays where it stood, and so does
	// the sentence under them.
	it('keeps the rule and the sentence off the words once they wrap', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = 'display: block; inline-size: 200px';
		await atReview(shadow);
		const { above, below, words } = aroundTheRule(shadow);
		const range = document.createRange();
		range.selectNodeContents(words);
		const note = shadow.querySelector('.fee-note') as HTMLElement;

		expect(range.getClientRects().length, 'wrapped').toBeGreaterThan(1);
		expect(
			Math.abs(above - below),
			`${above} over the rule, ${below} under it`
		).toBeLessThanOrEqual(DEVICE_PIXEL);
		expect(note.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			words.getBoundingClientRect().bottom
		);
	});

	// 44px is the floor this component lays every target against (`--_row-min` in ./tokens.css),
	// measured on the smallest root the card allows, which is where a floor stated in px and a line
	// of text set in em are furthest apart.
	it('clears the floor, on the smallest root the card allows', async () => {
		document.documentElement.style.fontSize = '15px';
		const { shadow } = await mount();
		await atReview(shadow);
		const decision = shadow.querySelector('.fee-decision') as HTMLElement;
		expect(decision.hidden).toBe(false);

		// the sentence under the words overlaps the target and keeps its own press.
		const note = shadow.querySelector('.fee-note') as HTMLElement;
		const drawn = note.getBoundingClientRect();
		expect(shadow.elementFromPoint(drawn.left + 1, drawn.top + 1)).toBe(note);

		// the target is what a press lands on, not the box the words are laid out in, so it is read
		// by pressing: down the switch's column and the words', with the sentence and the figure under
		// it taken off the page so that only the target's own reach is counted.
		for (const beside of shadow.querySelectorAll<HTMLElement>('.fee-note, .row.fee .figure')) {
			beside.style.visibility = 'hidden';
		}
		const words = decision.querySelector('.row-label') as HTMLElement;
		const gift = (decision.closest('.row.fee') as HTMLElement)
			.previousElementSibling as HTMLElement;
		const middle = (rect: DOMRect) => [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
		for (const [x = 0, y = 0] of [
			middle(words.getBoundingClientRect()),
			middle((decision.querySelector('.switch') as HTMLElement).getBoundingClientRect())
		]) {
			const pressed = (at: number) => decision.contains(shadow.elementFromPoint(x, at));
			let top = y;
			while (pressed(top - 0.5)) top -= 0.5;
			let bottom = y;
			while (pressed(bottom + 0.5)) bottom += 0.5;
			expect(bottom - top, `the target at x=${x}`).toBeGreaterThanOrEqual(44 - DEVICE_PIXEL);
			// and short of the gift's row, which keeps every press of its own.
			expect(top).toBeGreaterThan(gift.getBoundingClientRect().bottom);
		}
	});

	// the thumb is placed with logical insets and moved with a physical `translate`, so which way it
	// travels is the one thing about this control that a mirrored document can get wrong — and it
	// gets it wrong by carrying the thumb off the end of its own track, which no computed style
	// reports and only a laid-out box shows.
	it.each([['ltr'], ['rtl']])('keeps the thumb inside its track in a %s document', async (dir) => {
		document.documentElement.setAttribute('dir', dir);
		const { shadow } = await mount();
		await atReview(shadow);
		const track = shadow.querySelector('.fee-decision [part~="checkbox"]') as HTMLInputElement;
		const thumb = shadow.querySelector('.fee-decision .switch-thumb') as HTMLElement;

		// on by default, which is the end the travel is spent reaching.
		expect(track.checked).toBe(true);
		expect(thumb.getBoundingClientRect().left).toBeGreaterThanOrEqual(
			track.getBoundingClientRect().left
		);
		expect(thumb.getBoundingClientRect().right).toBeLessThanOrEqual(
			track.getBoundingClientRect().right
		);
	});

	// the pill, on the drawn track rather than on the token that states it — the one shape on this
	// card outside the two corners `--_r` and `--_r-in` state (`--_switch-radius` in ./tokens.css).
	// read against the card beside it, because a track that quietly fell back to `--_r-in` would be
	// a rounded rectangle nobody notices until it is next to the thing it must not look like.
	it('draws the track as a pill and nothing else on the card with it', async () => {
		const { shadow, card } = await mount();
		await atReview(shadow);
		const track = shadow.querySelector('.fee-decision [part~="checkbox"]') as HTMLElement;
		const radius = (element: HTMLElement) =>
			parseFloat(getComputedStyle(element).borderTopLeftRadius);

		expect(radius(track)).toBeCloseTo(track.getBoundingClientRect().height / 2, 1);
		expect(radius(track)).toBeGreaterThan(radius(card));
		expect(radius(card)).toBe(8);
	});

	// and the track is deliberately under it. a hit box grown around the switch itself would be a
	// second target inside the first, overlapping the sentence under the row — the label is the
	// target, and the drawn control is what the target contains.
	it('leaves the track itself under the floor, because the label is the target', async () => {
		document.documentElement.style.fontSize = '15px';
		const { shadow } = await mount();
		await atReview(shadow);
		const track = shadow.querySelector('.fee-decision [part~="checkbox"]') as HTMLElement;
		const box = track.getBoundingClientRect();

		expect(box.height).toBeLessThan(44);
		expect(box.width).toBeLessThan(44);
		// and it is a drawn shape rather than the platform's box, which is the whole reason this one
		// carries geometry of its own.
		expect(getComputedStyle(track).appearance).toBe('none');
	});
});

// what the decision does to the money, and the figure it does it by, on one line of the receipt.
// the two are placed by grid auto-flow rather than stated cell by cell (`.fee-note` and
// `.row.fee .figure` in ./parts.css), so whether they land on the same line is the engine's answer
// and not the sheet's — happy-dom places nothing and would agree with a note stacked above the
// figure just as readily.
describe('the sentence under the fee decision and its figure', () => {
	/**
	 * one rect per line box, which a border box cannot give: the sentence is the one line of this
	 * receipt that wraps, and where its first line ends is the whole question on a narrow card.
	 */
	function lines(node: Element): DOMRect[] {
		const range = document.createRange();
		range.selectNodeContents(node);
		return Array.from(range.getClientRects());
	}

	type Fee = { readonly note: HTMLElement; readonly figure: HTMLElement };

	function fee(shadow: ShadowRoot): Fee {
		return {
			note: shadow.querySelector('.fee-note') as HTMLElement,
			figure: shadow.querySelector('.row.fee .figure') as HTMLElement
		};
	}

	it('sets them on the same line, the sentence in the label column and the figure in its own', async () => {
		const { shadow } = await mount();
		await atReview(shadow);
		const { note, figure } = fee(shadow);

		expect(note.hidden).toBe(false);
		expect(figure.textContent).not.toBe('');

		const first = lines(note)[0] as DOMRect;
		const number = figure.getBoundingClientRect();

		// the same line: the two boxes are set on a shared baseline at two different type sizes, so
		// their edges do not coincide and what says they share a line is that they overlap at all.
		expect(number.top).toBeLessThan(first.bottom);
		expect(number.bottom).toBeGreaterThan(first.top);
		// and each in its own column, which is what keeps the overlap from being a collision.
		expect(number.left).toBeGreaterThanOrEqual(note.getBoundingClientRect().right);
	});

	// the narrow card, where the sentence is longer than the column holding it. the figure stays on
	// the line the sentence starts on rather than following it down or being pushed off the row.
	it('keeps the figure on the first line while the sentence wraps under it', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = 'display: block; inline-size: 320px';
		await atReview(shadow);
		const { note, figure } = fee(shadow);
		const drawn = lines(note);
		const number = figure.getBoundingClientRect();

		expect(drawn.length).toBeGreaterThan(1);
		expect(number.top).toBeLessThan((drawn[0] as DOMRect).bottom);
		expect(number.bottom).toBeGreaterThan((drawn[0] as DOMRect).top);
		// clear of the second line rather than sitting over it.
		expect(number.bottom).toBeLessThanOrEqual((drawn[1] as DOMRect).top);
		expect(number.left).toBeGreaterThanOrEqual(note.getBoundingClientRect().right);
	});
});

// one treatment across every surface a donor operates, measured off the drawn box rather than read
// off the sheet. a fill and a hairline are both `var()` chains a lightweight DOM hands back as the
// string it was given, and what is at stake is whether the same two values landed on all four
// controls — which is a comparison between resolved colours and nothing else.
describe('the surfaces a donor operates', () => {
	/** one token as the `rgb(…)` an engine reports a used colour in, resolved inside the card. */
	function token(shadow: ShadowRoot, name: string): string {
		const probe = document.createElement('div');
		probe.style.cssText = `color: var(${name})`;
		shadow.appendChild(probe);
		const colour = getComputedStyle(probe).color;
		probe.remove();
		return colour;
	}

	/**
	 * every control a donor types into or sets, one per kind.
	 *
	 * taken from the whole card rather than from the step on screen: the two stand on two different
	 * screens, and a computed fill is a computed value on a hidden element as much as on a drawn one.
	 *
	 * the frequency track is not one of them and is asserted below instead. it is a container of
	 * controls rather than a control, which is the half of `--_edge-control`'s argument the receipt
	 * also falls under.
	 */
	function operated(shadow: ShadowRoot): HTMLElement[] {
		return [shadow.querySelector('[part~="field"]')].filter(
			(node): node is HTMLElement => node !== null
		);
	}

	it('gives every field and both trays the tiles’ own fill, and the free entry the card’s', async () => {
		const { shadow } = await mount();
		// a tile nobody has chosen: the first is chosen from the first paint and stands raised.
		const tile = shadow.querySelector(
			'[part~="amount-option"]:not([part~="selected"])'
		) as HTMLElement;
		const fill = getComputedStyle(tile).backgroundColor;

		expect(fill).toBe(token(shadow, '--_n3'));
		const drawn = [
			shadow.querySelector('[part~="field"]') as HTMLElement,
			shadow.querySelector('.segment') as HTMLElement,
			shadow.querySelector('.tiles') as HTMLElement
		];
		for (const control of drawn) expect(getComputedStyle(control).backgroundColor).toBe(fill);
		// the entry stands on the tray at the ground a chosen tile rises to, not on the tray's own fill.
		const entry = shadow.querySelector('[part~="amount-input"]') as HTMLElement;
		expect(getComputedStyle(entry).backgroundColor).toBe(token(shadow, '--_n1'));
	});

	it('keeps a hairline at the control edge on every one of them', async () => {
		const { shadow } = await mount();
		const edge = token(shadow, '--_edge-control');

		expect(operated(shadow)).toHaveLength(1);
		for (const control of operated(shadow)) {
			const drawn = getComputedStyle(control);
			expect(drawn.borderTopColor).toBe(edge);
			expect(Number.parseFloat(drawn.borderTopWidth)).toBe(1);
		}
	});

	// and the container half of the same decision, which goes the other way: a container's edge
	// identifies nothing, so the receipt is no frame and no fill at all (../styles/tokens.css argues
	// both halves at `--_edge-control`).
	//
	// the two trays are that same half and they draw a frame anyway, in the one hairline every box on
	// this card is drawn with: a tray bounds the group the way the card's edge bounds the card and
	// identifies no control on it, and a field beside it is drawn as the same kind of box rather
	// than a heavier one. what identifies a chosen option is that it is raised, and no tile on
	// either tray draws an edge at all.
	it('frames both trays in the card’s one hairline, and no tile on them', async () => {
		const { shadow } = await mount();
		const tile = shadow.querySelector('[part~="amount-option"]') as HTMLElement;

		for (const tray of ['.segment', '.tiles']) {
			const drawn = getComputedStyle(shadow.querySelector(tray) as HTMLElement);
			expect(Number.parseFloat(drawn.borderTopWidth), tray).toBe(1);
			expect(drawn.borderTopColor, tray).toBe(token(shadow, '--_n7'));
			expect(drawn.borderTopColor, tray).toBe(token(shadow, '--_edge-control'));
		}
		expect(Number.parseFloat(getComputedStyle(tile).borderTopWidth)).toBe(0);
	});

	it('leaves the receipt bare: no fill, no frame, no pad', async () => {
		const { shadow } = await mount();
		await atReview(shadow);
		const receipt = shadow.querySelector('[part~="summary"]') as HTMLElement;
		const drawn = getComputedStyle(receipt);

		expect(drawn.backgroundColor).toBe('rgba(0, 0, 0, 0)');
		expect(Number.parseFloat(drawn.borderTopWidth)).toBe(0);
		expect(Number.parseFloat(drawn.paddingLeft)).toBe(0);
		// the rules inside it are not the frame and stay: the block is read as a statement of account.
		const total = shadow.querySelector('.row.total') as HTMLElement;
		expect(Number.parseFloat(getComputedStyle(total).borderTopWidth)).toBe(1);
	});
});

// the one elevation this component draws, on the one box it is allowed on — and after the chip
// started travelling, the box it is allowed on is the track's own `::before` rather than any
// option. what makes this the browser pool's question three times over: a shadow is a resolved
// colour, the state that would drop it is a `:focus-visible` match that needs a real keyboard, and
// where the chip stands is a used position nothing else in this repo lays out.
describe('the chip the chosen cadence stands under', () => {
	/** the lift as this card resolves it, which is the string a drawn shadow has to carry. */
	function lift(shadow: ShadowRoot): string {
		const probe = document.createElement('div');
		probe.style.cssText = 'box-shadow: var(--_lift)';
		shadow.appendChild(probe);
		const drawn = getComputedStyle(probe).boxShadow;
		probe.remove();
		return drawn;
	}

	function options(shadow: ShadowRoot): HTMLElement[] {
		return Array.from(shadow.querySelectorAll('.step:not([hidden]) [part~="frequency-option"]'));
	}

	function track(shadow: ShadowRoot): HTMLElement {
		return shadow.querySelector('.step:not([hidden]) .segment') as HTMLElement;
	}

	/** the chip, as the engine placed and painted it. */
	function chip(shadow: ShadowRoot): CSSStyleDeclaration {
		return getComputedStyle(track(shadow), '::before');
	}

	// the card opens with a cadence chosen (`settledDraft` in ../checkout.machine.ts), so the chip is
	// on the track from the first paint. it is placed there rather than travelled to: a chip sliding
	// in from the leading edge as a card appears is an animation reporting a decision nobody made.
	it('stands under the cadence the card opened on, without travelling to it', async () => {
		const { shadow } = await mount();
		const first = options(shadow)[0] as HTMLElement;

		expect(track(shadow).hasAttribute('data-thumb')).toBe(true);
		expect(track(shadow).hasAttribute('data-sliding')).toBe(false);
		expect(first.getAttribute('part')).toContain('selected');
		expect(chip(shadow).translate).toBe(`${first.offsetLeft}px ${first.offsetTop}px`);
	});

	it('stands over the chosen option and lifts off the track it is drawn on', async () => {
		const { shadow } = await mount();
		const drawn = options(shadow);
		const chosen = drawn[1] as HTMLElement;
		(chosen.querySelector('input') as HTMLInputElement).click();
		await settle();
		// the chip travels to a cadence a donor picks, so its position is read after the travel has
		// finished — `getComputedStyle` mid-transition reports the interpolated value, which at the
		// first frame is still the option it left. `subtree` is what reaches it: the transition runs
		// on the track's `::before`, and `getAnimations()` without it returns the element's own only.
		await Promise.all(
			track(shadow)
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined))
		);
		const painted = chip(shadow);

		expect(chosen.getAttribute('part')).toContain('selected');
		// the chip is the option's own box, moved: same width, same height, and standing where the
		// option stands within the track.
		expect(Number.parseFloat(painted.width)).toBe(chosen.offsetWidth);
		expect(Number.parseFloat(painted.height)).toBe(chosen.offsetHeight);
		expect(painted.translate).toBe(`${chosen.offsetLeft}px ${chosen.offsetTop}px`);
		expect(painted.boxShadow).toBe(lift(shadow));
		// and the options themselves carry none of it. the lift is the track's now, so an option
		// that kept one would be a second chip under the first.
		for (const option of drawn) expect(getComputedStyle(option).boxShadow).toBe('none');
	});

	// the trap this case exists for, in the shape it takes now: every ring in ../styles/parts.css is
	// a `box-shadow`, so a rule ringing the option a donor tabbed onto must not be able to reach the
	// chip's own — and the chip's edge and lift have to survive a focus they are no longer on the
	// same element as. a chip that went flat while its option stayed marked, bold and ringed is
	// something no computed colour, no snapshot and no other pool in this repo can see.
	it('keeps the chip whole while its option holds the caret', async () => {
		const { shadow } = await mount();
		const chosen = options(shadow)[0] as HTMLElement;
		const radio = chosen.querySelector('input') as HTMLInputElement;
		radio.click();
		await settle();
		await userEvent.keyboard('{Tab}');
		radio.focus();

		const painted = chip(shadow);
		expect(painted.boxShadow).toBe(lift(shadow));
		// the hairline forced-colors paints is an outline laid inside the chip, and focus does not
		// move it.
		expect(Number.parseFloat(painted.outlineOffset)).toBeLessThan(0);
		expect(Number.parseFloat(painted.outlineWidth)).toBeGreaterThan(0);
		// and the ring is on the option, which is the control that actually holds the caret.
		const ringed = getComputedStyle(chosen);
		expect(ringed.boxShadow).not.toBe('none');
		expect(ringed.boxShadow).not.toContain(lift(shadow));
	});

	/**
	 * the track narrowed until its options rewrap, which is the one layout this fixture has to force.
	 *
	 * on the track rather than on the host, and that is a fact about the card rather than a shortcut:
	 * the card does not lay out below its own content, so at every host width this element accepts,
	 * three cadences at `.segment`'s own floor share one row. `FREQUENCIES` has exactly three
	 * members, so the wrap a donor actually meets is a rewrap under a resize — which the test below
	 * this one is — and this is how the chip's behaviour across one is reached at all.
	 */
	function wrap(shadow: ShadowRoot): void {
		track(shadow).style.inlineSize = '160px';
		options(shadow)[0]?.offsetTop;
	}

	// the movement, and the one limit on it. the chip travels along a row because a donor can follow
	// it there; across a wrap there is no path to follow, so the switch is plain. the wrap is read
	// off where the options were actually laid out, because the cadence count is the deployment's
	// and the width is the host page's — neither is knowable from here.
	it('travels along a row and switches plainly across a wrap', async () => {
		const { shadow } = await mount();
		const inputs = options(shadow).map(
			(option) => option.querySelector('input') as HTMLInputElement
		);

		inputs[0]?.click();
		await settle();
		expect(track(shadow).hasAttribute('data-sliding')).toBe(false);

		inputs[1]?.click();
		await settle();
		expect(track(shadow).hasAttribute('data-sliding')).toBe(true);

		// narrow enough that the three cadences no longer share one row. the track is narrowed rather
		// than the host, because the card will not lay out below its own content: at every host width
		// this element accepts, three cadences at the floor `.segment` gives them fit on one row.
		wrap(shadow);
		const rows = new Set(options(shadow).map((option) => option.offsetTop));
		expect(rows.size).toBeGreaterThan(1);

		inputs[2]?.click();
		await settle();
		expect(track(shadow).hasAttribute('data-sliding')).toBe(false);
	});

	// the move no press causes. a phone turning or a window being dragged rewraps the track under a
	// chip placed against the old layout, and the flow sends nothing when it does — so the card
	// listens for the one rewrap it can hear and puts the chip back on the next frame. it never
	// travels there: a donor who rotated their phone did not switch cadence, and a chip animating
	// across a layout change would read as the form choosing for them.
	it('puts the chip back where the options went when the window changes size', async () => {
		const { shadow } = await mount();
		const inputs = options(shadow).map(
			(option) => option.querySelector('input') as HTMLInputElement
		);
		inputs[0]?.click();
		await settle();
		inputs[2]?.click();
		await settle();
		expect(track(shadow).hasAttribute('data-sliding')).toBe(true);

		// a layout the chip was not placed against: the options rewrap under it and the flow sends
		// nothing when they do.
		wrap(shadow);
		const chosen = options(shadow)[2] as HTMLElement;
		expect(new Set(options(shadow).map((option) => option.offsetTop)).size).toBeGreaterThan(1);

		window.dispatchEvent(new Event('resize'));
		await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

		expect(chip(shadow).translate).toBe(`${chosen.offsetLeft}px ${chosen.offsetTop}px`);
		expect(track(shadow).hasAttribute('data-sliding')).toBe(false);
	});
});

// the chosen option, which after the brand stopped filling it is said by a raised ground and a bold
// word, on the track's chip and on the tile alike. what makes this a browser question rather than a
// declaration one is the cascade: a chosen option is
// matched by its unselected neighbour's `:hover` rule, by the segment's ring rule and by the base
// focus rule, all at the same specificity or higher, and which of them keeps `background`,
// `outline` and `box-shadow` is settled by order in a sheet no lightweight DOM assembles.
describe('the option a donor chose', () => {
	/** one token as the used color an engine reports it in. */
	function used(shadow: ShadowRoot, token: string): string {
		const probe = document.createElement('div');
		probe.style.cssText = `color: var(${token})`;
		shadow.appendChild(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return color;
	}

	// the ground is on the option in the amount grid and on the track's own chip in the frequency
	// segment — one box that travels between the cadences rather than three that appear and
	// disappear (`.segment[data-thumb]::before` in ../styles/parts.css). neither draws an edge: both
	// stand raised on a tray that is already bounded, and what each carries in an edge's place is a
	// transparent hairline for forced-colors to paint. this reads the surface under the word,
	// whichever element draws it.
	it.each([
		[
			'the frequency track',
			"[part~='frequency-option']",
			(shadow: ShadowRoot) =>
				getComputedStyle(
					shadow.querySelector('.step:not([hidden]) .segment') as HTMLElement,
					'::before'
				)
		],
		['the amount grid', "[part~='amount-option']", null]
	])('is raised rather than filled on %s', async (_name, selector, surfaceOf) => {
		// ../styles/motion.css fades the ground and the edge over `--_dur-fast`, so every colour below
		// is read after the transitions land rather than at the tick the click returned on — which is
		// mid-fade, and reads as whatever the option was before the donor chose it.
		const { host, shadow } = await mount();
		// a seeded card: an unseeded one draws `--_p` at the ladder's own darkest rung, where a fill
		// and a word in it are the same colour and every assertion below would pass on either.
		host.style.cssText = '--donate-primary: oklch(0.45 0.18 25);';
		const drawn = Array.from(
			shadow.querySelectorAll(`.step:not([hidden]) ${selector}`)
		) as HTMLElement[];
		const chosen = drawn[0] as HTMLElement;
		const neighbour = drawn[1] as HTMLElement;
		(chosen.querySelector('input') as HTMLInputElement).click();
		await settle();
		await landed(chosen);

		const primary = used(shadow, '--_p');
		const surface = surfaceOf === null ? getComputedStyle(chosen) : surfaceOf(shadow);
		expect(chosen.getAttribute('part')).toContain('selected');
		// the ramp's own top step, and not the brand: the ground is what makes a primary word legible
		// rather than what says chosen, and `--_n3` — where its neighbours stand — misses 4.5:1.
		expect(surface.backgroundColor).toBe(used(shadow, '--_n1'));
		expect(surface.backgroundColor).not.toBe(primary);
		// the word is the option's on both, because the word is the thing that has to be read.
		expect(getComputedStyle(chosen).color).toBe(primary);
		// no edge: a hairline nobody sees until forced-colors paints it, laid inside the box so
		// picking one moves nothing beside it.
		expect(surface.outlineColor).toBe('rgba(0, 0, 0, 0)');
		expect(surface.outlineWidth).toBe('1px');
		expect(Number.parseFloat(surface.outlineOffset)).toBeLessThan(0);
		// and the lift under it, which is the whole of what the raised ground casts.
		expect(surface.boxShadow).not.toBe('none');
		expect(chosen.getBoundingClientRect().height).toBe(neighbour.getBoundingClientRect().height);
	});

	// one weight resting and chosen, which is what keeps the press from moving anything. the box is
	// a grid column either way, so what has to be measured is the word inside it: at two weights the
	// glyphs widen under the finger that chose them and every figure on the row shifts against a
	// line that was where the donor was reading.
	it.each([
		['the frequency track', "[part~='frequency-option']"],
		['the amount grid', "[part~='amount-option']"]
	])('draws a chosen word at the width it rested at on %s', async (_name, selector) => {
		const { host, shadow } = await mount();
		host.style.cssText = '--donate-primary: oklch(0.45 0.18 25);';
		const drawn = Array.from(
			shadow.querySelectorAll(`.step:not([hidden]) ${selector}`)
		) as HTMLElement[];
		// the second, because the first is chosen from the first paint and has no resting width to
		// have been measured at.
		const option = drawn[1] as HTMLElement;
		const word = option.querySelector('span') as HTMLElement;
		const resting = word.getBoundingClientRect().width;
		const weight = getComputedStyle(option).fontWeight;

		(option.querySelector('input') as HTMLInputElement).click();
		await settle();
		await landed(option);

		expect(option.getAttribute('part')).toContain('selected');
		expect(word.getBoundingClientRect().width).toBe(resting);
		expect(getComputedStyle(option).fontWeight).toBe(weight);
	});
});

// the three controls that answered a pointer with nothing until the rule at `--_p-hover` in
// ../styles/tokens.css was stated. every one of them is a selector that renders perfectly while
// matching nothing a donor can reach, so ../element.dom.spec.ts asserting the rule exists is half
// of it: this is the half that puts a real pointer on the real element the flow draws.
describe('what a pointer is answered with', () => {
	/** the element under a real pointer, with whatever the hover moved settled. */
	async function hovered(element: HTMLElement): Promise<CSSStyleDeclaration> {
		await userEvent.hover(element);
		await landed(element);
		return getComputedStyle(element);
	}

	/**
	 * one control read while it is genuinely being pressed, and released after.
	 *
	 * `:active` matches while a device is holding the control down and at no other time, and no
	 * event this file dispatched would set it: a synthetic `mousedown` is untrusted and matches
	 * nothing at all, which is a reading of the resting colour that passes against a rule nobody
	 * wrote. the pointer has no held half in this provider's api — every one of its mouse actions
	 * completes — so the press held here is the keyboard's, which puts the same engine state on the
	 * same selector.
	 *
	 * read through a callback rather than returned as a declaration, because the reading has to
	 * happen while the key is still down. the release completes the activation, so a box pressed
	 * here comes back with its tick the other way round.
	 */
	async function underPress<T>(
		element: HTMLElement,
		read: (style: CSSStyleDeclaration) => T
	): Promise<T> {
		element.focus();
		await userEvent.keyboard('{Space>}');
		await landed(element);
		const held = read(getComputedStyle(element));
		await userEvent.keyboard('{/Space}');
		await landed(element);

		return held;
	}

	// the note and the tribute stand on the amount step, so a fresh card already draws two of them.
	// unticked the box is the field's construction, so it answers the way a field does.
	it('steps the tick box to the edge a field steps to', async () => {
		const { shadow } = await mount();
		const box = shadow.querySelector(".step:not([hidden]) [part~='checkbox']") as HTMLInputElement;

		expect((await hovered(box)).borderTopColor).toBe(used(shadow, '--_n11'));
		expect(used(shadow, '--_n11')).not.toBe(used(shadow, '--_edge-control'));
	});

	// the quiet action is the primary drawn as ink, so it steps the way the other two words the
	// seed draws do. the card is seeded, because on an unseeded one `--_p` and `--_p-hover` are two
	// near-blacks and the assertion would pass on a rule that never landed.
	//
	// the notify press inside the tribute is the one of the two this control is drawn as that a
	// donor can reach on a step: the other is the takeover's second button, which is hidden until
	// a screen has a use for it. so the tribute is opened and the press it reveals is the target.
	it('steps the quiet action to the ink a chosen word steps to', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = '--donate-primary: oklch(0.45 0.18 25);';
		const tribute = shadow.querySelectorAll(
			".step:not([hidden]) [part~='checkbox']"
		)[1] as HTMLInputElement;
		tribute.click();
		await settle();
		const notify = shadow.querySelector(
			".step:not([hidden]) [part~='action-quiet']"
		) as HTMLElement;

		expect((await hovered(notify)).color).toBe(used(shadow, '--_p-hover'));
		expect(used(shadow, '--_p-hover')).not.toBe(used(shadow, '--_p'));
	});

	// a form suggesting nothing draws the entry alone on a bare tray, which is the one shape this
	// box has an edge in — on a tray of tiles it is the box already chosen and is exempt at the
	// rule. so the bare card is the card this has to be measured on.
	it('steps the free entry on a bare tray to that same edge', async () => {
		const { shadow } = await mount({ ...CONFIG, suggestedAmountsMinor: [] });
		const entry = shadow.querySelector(
			".step:not([hidden]) .bare > [part~='amount-input']"
		) as HTMLElement;

		expect((await hovered(entry)).borderTopColor).toBe(used(shadow, '--_n11'));
		expect(used(shadow, '--_n11')).not.toBe(used(shadow, '--_edge-control'));
	});

	// the tick box under a finger, which is the only acknowledgement a touch is ever given: a phone
	// has no hover, so a box that answered the press with nothing would answer a phone with nothing.
	// unticked it is the field's construction, so it steps its edge one rung past where the pointer
	// left it.
	it('steps the unticked tick box one rung past the edge a pointer leaves it on', async () => {
		const { shadow } = await mount();
		const box = shadow.querySelector(".step:not([hidden]) [part~='checkbox']") as HTMLInputElement;

		expect(await underPress(box, (style) => style.borderTopColor)).toBe(used(shadow, '--_n12'));
		expect(used(shadow, '--_n12')).not.toBe(used(shadow, '--_n11'));
	});

	// ticked it is a primary fill, so it steps to the fill's own press shade like every other block
	// of the brand. the card is seeded for the reason the quiet action above is: on an unseeded one
	// the two brand steps are near-blacks a hundredth apart and the reading would pass against the
	// hover rule.
	it('steps the ticked tick box to the fill a pressed action takes', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = '--donate-primary: oklch(0.45 0.18 25);';
		const box = shadow.querySelector(".step:not([hidden]) [part~='checkbox']") as HTMLInputElement;
		box.click();
		await settle();
		await landed(box);

		expect(await underPress(box, (style) => style.backgroundColor)).toBe(
			used(shadow, '--_p-press')
		);
		expect(used(shadow, '--_p-press')).not.toBe(used(shadow, '--_p-hover'));
	});
});

describe('the ring and the brand never touch', () => {
	// a brand at the band's ceiling, so it is as far from the ring's own darkest rung as the clamp
	// allows and a ring drawn from the wrong token is a different string rather than a near miss.
	const SEEDS = '--donate-primary: oklch(0.5 0.18 25);';

	it('rings every control the primary has not filled in a rung of the ladder', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = SEEDS;
		await atReview(shadow);
		const primary = used(shadow, '--_p');
		const ring = used(shadow, '--_focus-ring');
		const boxes = Array.from(shadow.querySelectorAll("[part~='checkbox']")).filter(
			(box) => (box as HTMLElement).getClientRects().length > 0
		);

		// the platform's own box and the switch drawn over one are both here, and the rule is the
		// same for both: the ring outside, and the primary that fills a checked box or a set track
		// nowhere in the ring at all.
		expect(boxes.length).toBeGreaterThan(0);
		for (const box of boxes) {
			const drawn = (await caretOn(box as HTMLElement)).boxShadow;
			expect(drawn).toContain(ring);
			expect(drawn).not.toContain(primary);
		}
	});

	// the other half of the invariant: a control the primary *marks* has two dark edges a pixel apart
	// at its own edge, so the ring is laid outside a band of the ladder rather than taken back. that
	// the band is listed first is what makes it the separator — a band drawn outside the ring
	// separates nothing. the fee switch set on is the control that shows it: its track is the
	// primary from edge to edge, and the chosen tiles on the amount step are raised rather than
	// edged, so nothing there is marked at its edge any more.
	it('rings a control the primary marks with a band of the ladder between the two', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = SEEDS;
		await atReview(shadow);
		const primary = used(shadow, '--_p');
		const ring = used(shadow, '--_focus-ring');
		const band = used(shadow, '--_n1');

		const track = shadow.querySelector('.fee-decision [part~="checkbox"]') as HTMLInputElement;
		expect(track.checked).toBe(true);
		const drawn = await caretOn(track);

		// the mark survives the ring: the fill is the mark, and the ring is laid past a band of it.
		expect(drawn.backgroundColor).toBe(primary);
		expect(drawn.boxShadow).toContain(ring);
		expect(drawn.boxShadow).toContain(band);
		expect(drawn.boxShadow.indexOf(band)).toBeLessThan(drawn.boxShadow.indexOf(ring));
	});

	it('rings a control the primary has filled inside itself, in neither of them', async () => {
		const { host, shadow } = await mount();
		host.style.cssText = SEEDS;
		await atReview(shadow);
		// the one on the step the donor is standing on. every earlier step keeps its own, hidden, and
		// `focus()` on a control with no layout box does nothing at all — which would read here as a
		// button that draws no ring rather than as the wrong button.
		const action = shadow.querySelector(".step:not([hidden]) [part~='action']") as HTMLElement;
		const drawn = await caretOn(action);

		// the near-white the fill takes, and the ring here is the outline rather than a shadow. the
		// ladder's darkest rung laid outside this fill is the one adjacency the split refuses, and a
		// primary ring outside it reads as the button growing — so the shadow every unfilled control
		// rings itself with is taken back rather than recoloured.
		expect(drawn.outlineColor).not.toBe(used(shadow, '--_focus-ring'));
		expect(drawn.outlineColor).not.toBe(used(shadow, '--_p'));
		expect(drawn.outlineColor).toBe(used(shadow, '--_on-p'));
		expect(drawn.boxShadow).toBe('none');
		// and it is drawn inside the fill rather than on the fill's own edge. how far inside is a
		// question for the painted pixels below; that it is inside at all is this one.
		expect(Number.parseFloat(drawn.outlineOffset)).toBeLessThan(0);
	});
});

// the same ring, read off the pixels an engine painted rather than off the declaration that asked
// for them — and this is the one question in this file no computed style can answer. a ring drawn
// on the fill's own outermost band and a ring drawn a band in from it are the same string in
// `getComputedStyle`, and only the second of them is visible at 1×: the first has the control's
// edge for an outer neighbour and the near-white card immediately past that, so it reads as the
// button lightening at its rim rather than as a line. what says which was drawn is that the ring's
// two neighbours are the same colour as each other, which is the fill on both sides of it.
//
// the action is the subject because it is the one control the primary fills. the amount tile was,
// until the brand stopped filling it — a chosen tile is now a near-white box with a primary edge and
// rings itself outside that edge, which is the case two describes above.
//
// both ends of the fill band are here, because the fill is what the ring is measured against: a
// seeded card carries a host's own colour clamped into the band, and an unseeded one carries the
// neutral ladder's darkest rung (`--_p` in ../styles/tokens.css).
describe('the ring a primary-filled control draws inside itself, as painted', () => {
	type Rgb = readonly [number, number, number];

	/**
	 * a viewport the provider can shoot pixel for pixel, and the page's own is restored after.
	 *
	 * the pool's default viewport is taller than the browser window holding it, so the page is drawn
	 * scaled down to fit and every band in the shot is scaled with it — a hairline ring lands across
	 * blended pixels and belongs to no colour. every other case in this file measures boxes rather
	 * than pixels and is indifferent to which of the two it is laid out in.
	 */
	let held: readonly [number, number] = [0, 0];

	beforeEach(async () => {
		held = [window.innerWidth, window.innerHeight];
		await browser.viewport(600, 700);
	});

	afterEach(async () => {
		await browser.viewport(held[0], held[1]);
	});

	/** one pixel as WCAG's own luminance, which is the space a margin between two of them is in. */
	function luminance([red, green, blue]: Rgb): number {
		const channel = (value: number): number => {
			const unit = value / 255;
			return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
	}

	function contrastRatio(a: Rgb, b: Rgb): number {
		const light = Math.max(luminance(a), luminance(b));
		const dark = Math.min(luminance(a), luminance(b));
		return (light + 0.05) / (dark + 0.05);
	}

	/** the widest a channel differs, which is the one question a ratio cannot answer: sameness. */
	function apart(a: Rgb, b: Rgb): number {
		return Math.max(...a.map((channel, index) => Math.abs(channel - (b[index] as number))));
	}

	/**
	 * the painted pixels down one column of the page, from a control's top edge inward.
	 *
	 * the column is taken at the control's mid width, where the corner radius is out of the way and
	 * no glyph has started yet. the whole viewport is shot rather than one element: a rect is
	 * already in the viewport's own coordinates, and asking the provider for one element's box would
	 * be asking it to reach a node inside a shadow root.
	 */
	async function columnInto(box: DOMRect, depth: number): Promise<Rgb[]> {
		const shot = await browser.screenshot({ save: false });
		const image = new Image();
		image.src = `data:image/png;base64,${shot}`;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const surface = canvas.getContext('2d') as CanvasRenderingContext2D;
		surface.drawImage(image, 0, 0);

		// one shot pixel per css pixel, which is what makes a band of a stated width readable at all.
		expect(image.naturalWidth).toBe(window.innerWidth);

		const x = Math.floor(box.left + box.width / 2);
		return Array.from({ length: depth }, (_, step) => {
			const [red, green, blue] = surface.getImageData(x, Math.ceil(box.top) + step, 1, 1).data;
			return [red, green, blue] as unknown as Rgb;
		});
	}

	/** the action on the step the donor is standing on, with the keyboard as what put the caret there. */
	async function focusedAction(shadow: ShadowRoot): Promise<HTMLElement> {
		const action = shadow.querySelector(".step:not([hidden]) [part~='action']") as HTMLElement;
		// a real key press first: `:focus-visible` matches nothing while the engine is on the pointer,
		// and every assertion below would read a ring that is not drawn as a ring in the wrong place.
		await userEvent.keyboard('{Tab}');
		action.focus();
		return action;
	}

	it.each([
		['a seeded card', '--donate-primary: #0f766e;'],
		['an unseeded card', '']
	])('lays the fill on both sides of it, on %s', async (_name, declarations) => {
		const { host, shadow } = await mount();
		host.style.cssText = declarations;
		const action = await focusedAction(shadow);

		// the ring is the one near-white on a fill the band keeps dark at every point, so the
		// brightest pixel of the run is it, wherever it was drawn.
		const column = await columnInto(action.getBoundingClientRect(), 10);
		const ring = column.reduce((a, b) => (luminance(a) > luminance(b) ? a : b));
		const drawn = column.map((pixel, index) => (apart(pixel, ring) <= 8 ? index : -1));
		const first = drawn.find((index) => index >= 0) as number;
		const last = drawn.reduce((held, index) => (index >= 0 ? index : held), -1);

		// a band of fill outside the ring: the edge pixel is not the ring, which is the whole of what
		// went wrong when the ring was drawn at offset zero.
		expect(first).toBeGreaterThanOrEqual(1);
		const outside = column[first - 1] as Rgb;
		const inside = column[last + 1] as Rgb;

		// and a real margin on both sides of it rather than a lightening of one edge. 3:1 is the floor
		// a boundary carries, and `--_on-p` clears it on every fill the band allows.
		expect(contrastRatio(ring, outside)).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(ring, inside)).toBeGreaterThanOrEqual(3);
		// the two neighbours are one colour, which is what makes the ring a line within the control
		// rather than its rim: the fill is on both sides of it.
		expect(apart(outside, inside)).toBeLessThanOrEqual(8);
	});
});

// the two closed choices' list (../select.ts) stands in the top layer, a flattening away from the
// card it belongs to, and is still in the element's own shadow tree — so the element's sheets dress
// it and a host's `::part()` reaches it like any other surface.
describe('the list a closed choice opens', () => {
	const CHOICE: FormConfig = {
		...CONFIG,
		program: {
			mode: 'choice',
			options: [
				{ id: 'prg_water', name: 'Clean water' },
				{ id: 'prg_school', name: 'Schools' }
			]
		}
	};

	async function opened(): Promise<Mounted & { box: HTMLElement; list: HTMLElement }> {
		const mounted = await mount(CHOICE);
		const box = mounted.shadow.querySelector<HTMLElement>('#program');
		if (box === null) throw new Error('no program box');
		box.focus();
		await userEvent.keyboard('{ArrowDown}');
		const list = await vi.waitFor(() => {
			const found = mounted.shadow.querySelector<HTMLElement>("[part~='select-list']");
			if (found === null || !found.checkVisibility()) throw new Error('the list is not open');
			return found;
		});
		return { ...mounted, box, list };
	}

	it('draws the list on the card’s ground and the row under the keys on a field’s fill', async () => {
		const { card, box, list } = await opened();
		const highlighted = await vi.waitFor(() => {
			const row = list.querySelector<HTMLElement>("[part~='select-option'][data-highlighted]");
			if (row === null) throw new Error('no row is highlighted');
			return row;
		});

		expect(getComputedStyle(list).backgroundColor).toBe(getComputedStyle(card).backgroundColor);
		expect(getComputedStyle(highlighted).backgroundColor).toBe(
			getComputedStyle(box).backgroundColor
		);
	});

	/** a `box-shadow` value as this card resolves it. */
	function shadowOf(root: ShadowRoot, value: string): string {
		const probe = document.createElement('div');
		probe.style.boxShadow = value;
		root.appendChild(probe);
		const drawn = getComputedStyle(probe).boxShadow;
		probe.remove();
		return drawn;
	}

	// opened from the keys, the machine focuses the list itself, and that focus is keyboard-visible.
	it('lifts a list the keys opened rather than ringing it, and the open box keeps its ring', async () => {
		const { shadow, box, list } = await opened();
		await vi.waitFor(() => {
			if (!list.matches(':focus-visible')) throw new Error('the list holds no visible focus');
		});

		expect(getComputedStyle(list).boxShadow).toBe(shadowOf(shadow, 'var(--_lift)'));
		expect(getComputedStyle(box).boxShadow).toBe(
			shadowOf(shadow, '0 0 0 var(--_focus-width) var(--_focus-ring)')
		);
	});

	it('marks the chosen row `selected` and no other', async () => {
		const { list } = await opened();
		const rows = Array.from(list.querySelectorAll<HTMLElement>("[role='option']"));

		expect(rows.map((row) => row.getAttribute('part'))).toEqual([
			'select-option selected',
			'select-option',
			'select-option'
		]);
	});

	it('lets a host restyle the box, the list and a row with the published selectors', async () => {
		const { tag, box, list } = await opened();
		page(
			`${tag}::part(field) { cursor: help; } ${tag}::part(select-list) { cursor: wait; } ${tag}::part(select-option) { cursor: move; }`
		);
		const row = list.querySelector<HTMLElement>("[part~='select-option']");
		if (row === null) throw new Error('no row');

		expect(getComputedStyle(box).cursor).toBe('help');
		expect(getComputedStyle(list).cursor).toBe('wait');
		expect(getComputedStyle(row).cursor).toBe('move');
	});

	// an operator names the causes, and a long one is a list a phone cannot hold at its one line. the
	// list stops at the room the viewport leaves it and the row's words wrap inside that.
	it('keeps a long cause inside a phone’s width, wrapping its words', async () => {
		const held = [window.innerWidth, window.innerHeight] as const;
		await browser.viewport(375, 812);
		try {
			const long = 'Emergency shelter, food and clean water for families displaced by flooding';
			const mounted = await mount({
				...CHOICE,
				program: { mode: 'choice', options: [{ id: 'prg_flood', name: long }] }
			});
			const box = mounted.shadow.querySelector<HTMLElement>('#program');
			if (box === null) throw new Error('no program box');
			box.focus();
			await userEvent.keyboard('{ArrowDown}');
			const row = await vi.waitFor(() => {
				const found = Array.from(
					mounted.shadow.querySelectorAll<HTMLElement>("[part~='select-option']")
				).find((option) => option.textContent === long);
				if (found === undefined || !found.checkVisibility()) throw new Error('no long row');
				return found;
			});
			const list = row.closest<HTMLElement>("[part~='select-list']");

			await vi.waitFor(() => {
				expect(list?.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
				expect(list?.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
			});
			expect(row.scrollWidth).toBe(row.clientWidth);
		} finally {
			await browser.viewport(held[0], held[1]);
		}
	});

	// the tick stands on the chosen row alone, and a row without it keeps its column: a list whose
	// width followed which row held the tick would overhang the box by a tick when the longest
	// option is the chosen one.
	it('draws the list at one width whichever row is chosen', async () => {
		const mounted = await mount(CHOICE);
		mounted.shadow.querySelector<HTMLElement>(".tribute [part~='checkbox']")?.click();
		const box = mounted.shadow.querySelector<HTMLElement>('#tribute-kind');
		if (box === null) throw new Error('no tribute kind box');
		const widthOpen = async (): Promise<number> => {
			box.focus();
			await userEvent.keyboard('{ArrowDown}');
			const list = await vi.waitFor(() => {
				const found = mounted.shadow.querySelector<HTMLElement>('#tribute-kind-list');
				if (found === null || !found.checkVisibility()) throw new Error('the list is not open');
				return found;
			});
			return list.getBoundingClientRect().width;
		};
		const resting = await widthOpen();
		await userEvent.keyboard('{End}');
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() =>
			expect(box.querySelector('[data-chosen]')?.textContent).toBe('In memory of')
		);

		expect(await widthOpen()).toBe(resting);
	});
});

/*
 * a refusal belongs to the box it is about, so it stands close under that box and well clear of the
 * next thing on the step: at the row's own gap it stood as far under its box as the label stands
 * over it, and with the line's own leading on top it read as detached from the box it names.
 */
describe('a refusal under its box', () => {
	it('stands close under its box, nearer it than the next row', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		onward(shadow);
		await settle();
		const box = shadow.querySelector('#email') as HTMLElement;
		const refusal = shadow.querySelector('#email-problem') as HTMLElement;
		const next = (box.closest('.field-row') as HTMLElement).nextElementSibling as HTMLElement;
		const under = refusal.getBoundingClientRect().top - box.getBoundingClientRect().bottom;
		const beyond = next.getBoundingClientRect().top - refusal.getBoundingClientRect().bottom;

		expect(refusal.hidden).toBe(false);
		expect(under).toBeCloseTo(step(shadow, '--_sp1'), 0);
		expect(under).toBeLessThan(beyond);
	});

	/**
	 * the amount step with every refusal it can show on screen at once: a figure under the floor, the
	 * note ticked and left empty, and the tribute ticked with its name empty and only the person to
	 * tell's email given.
	 */
	async function amountRefused(width: string): Promise<ShadowRoot> {
		const { host, shadow } = await mount();
		host.style.inlineSize = width;
		(shadow.querySelectorAll("[part~='frequency-option'] input")[0] as HTMLElement).click();
		for (const tick of shadow.querySelectorAll(".step:not([hidden]) [part~='checkbox']"))
			(tick as HTMLElement).click();
		await settle();
		fill(shadow, '#amount-entry', '0.01');
		(shadow.querySelector('.field-row > button') as HTMLElement).click();
		await settle();
		fill(shadow, '#tribute-notify-email', 'someone@example.org');
		onward(shadow);
		await settle();
		return shadow;
	}

	/** how far a refusal stands under what it refuses, against the step every refusal takes. */
	function seatedUnder(shadow: ShadowRoot, refused: Element, id: string): void {
		const refusal = shadow.querySelector(id) as HTMLElement;
		expect(refusal.hidden, id).toBe(false);
		expect(
			refusal.getBoundingClientRect().top - refused.getBoundingClientRect().bottom,
			id
		).toBeCloseTo(step(shadow, '--_sp1'), 0);
	}

	// the same seat on every refusal the amount step draws: under the tray, under the note, under the
	// honoree's name and under the person to tell. at both widths, because the honoree's name shares
	// the select's line on a wide card and takes a line of its own on a narrow one.
	it.each(['375px', '560px'])(
		'stands as close under each thing the amount step refuses at %s',
		async (width) => {
			const shadow = await amountRefused(width);
			const at = (selector: string) => shadow.querySelector(selector) as HTMLElement;

			seatedUnder(shadow, at('.tiles'), '#amount-problem');
			seatedUnder(shadow, at('#note'), '#note-problem');
			seatedUnder(shadow, at('#tribute-honoree'), '#tribute-honoree-problem');
			seatedUnder(shadow, at('#tribute-notify-name'), '#tribute-notify-name-problem');
		}
	);

	// the same seat where the label stands inside the box, whose row is laid out as a grid instead.
	it('stands as close under a box whose label stands inside it', async () => {
		const { shadow } = await mount();
		await atDetails(shadow);
		onward(shadow);
		await settle();
		const box = shadow.querySelector('#first-name') as HTMLElement;
		const refusal = shadow.querySelector('#first-name-problem') as HTMLElement;

		expect(refusal.hidden).toBe(false);
		expect(refusal.getBoundingClientRect().top - box.getBoundingClientRect().bottom).toBeCloseTo(
			step(shadow, '--_sp1'),
			0
		);
	});
});
