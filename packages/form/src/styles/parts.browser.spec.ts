import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// the provider's own handle on the test page, aliased: this file's `page` writes css into the host
// document and is the one a reader here is looking for.
import { page as browser, userEvent } from 'vitest/browser';
import { defineDonateForm, DONATE_FORM_TAG } from '../element';
import type { CheckoutPorts } from '../ports';
import type { FormConfig } from '../v1';
import { createSkeleton } from '../views';

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
	provider: { name: 'stripe', publishableKey: 'pk_live_x' },
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
		google_pay: { percent: 0.029, fixedMinor: 30 }
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

/**
 * the donor on the review step, which is the only step the fee control and the payment box are
 * drawn on.
 *
 * walked rather than un-hidden by hand: a `display: none` subtree has no used size at all, so a
 * shortcut here would measure `NaN` and pass every comparison written the other way round.
 */
async function atReview(shadow: ShadowRoot): Promise<void> {
	const pick = (selector: string, at = 0) =>
		(shadow.querySelectorAll(selector)[at] as HTMLElement).click();
	const fill = (id: string, value: string) => {
		const field = shadow.querySelector(id) as HTMLInputElement;
		field.value = value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const onward = () =>
		(
			shadow.querySelector(
				".step:not([hidden]) [part~='action']:not([part~='submit'])"
			) as HTMLElement
		).click();

	pick("[part~='frequency-option'] input");
	pick("[part~='amount-option'] input");
	onward();
	fill('#email', 'donor@example.org');
	fill('#first-name', 'Ada');
	fill('#last-name', 'Lovelace');
	onward();
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
		expect(said(shadow)).toBe('required');
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

		expect(said(shadow)).toBe('required');
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
		expect(said(shadow)).toBe('required');
	});
});

// a used size rather than a declared one, which is the other thing only a real engine hands back:
// the switch is a drawn track a little over an em tall, and what carries it to a target is the label
// around it — whose height is a line of text against a stated floor, and which of the two wins is a
// layout only a real engine performs.
describe('the target under the fee decision', () => {
	// 44px is the floor this component lays every target against (`--_row-min` in ./tokens.css),
	// measured on the smallest root the card allows, which is where a floor stated in px and a line
	// of text set in em are furthest apart.
	it('clears the floor, on the smallest root the card allows', async () => {
		document.documentElement.style.fontSize = '15px';
		const { shadow } = await mount();
		await atReview(shadow);
		const decision = shadow.querySelector('.fee-decision') as HTMLElement;

		expect(decision.hidden).toBe(false);
		expect(decision.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
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
