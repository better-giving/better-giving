import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineDonateForm, DONATE_FORM_TAG } from '../element';
import type { CheckoutPorts } from '../ports';
import { completePayer, NAME_PATTERN } from '../value';
import type { FormConfig } from '../v1';

// the browser pool, and the only pool that can see any of this. the details step's problem edge is
// drawn from the `invalid` part token and from nothing else (./parts.css), so what the node pool
// can hold ../views.ts to is the attribute and what only a real engine can answer is the colour it
// produces. the engine's own verdict is measured here for the same reason: a lightweight DOM
// answers `false` to `input.matches(':invalid')` for a genuinely invalid input rather than
// throwing, so a claim about the two rules disagreeing would look proven there with nothing in the
// sheet at all. run with `pnpm test:browser`; it is deliberately outside `pnpm test` and outside
// the deploy gate (see vitest.browser.config.ts).
//
// the whole element is mounted rather than a shadow root assembled by hand, for the reason
// ./parts.browser.spec.ts gives: the question is about the sheets ../element.ts adopts, through
// the code that adopts them, so a hand-built host would be asserting the fixture.
//
// nothing here reads a colour literal. the danger pair is one token (`--_bad` in ./tokens.css) and
// the sentence under the field is painted with it, so the field's border is compared against the
// sentence's own colour — which is the claim worth making anyway: the edge and the words say the
// same thing.
//
// the second half of this file is about a rule rather than a paint. the browser's `type="email"`
// and `pattern` decide which sentence the donor reads, and `completePayer` (../value.ts) decides
// whether the press moves at all — so a value the engine calls valid and that function refuses is
// a press that stays put with no field to name. the containment is measured against a real engine
// because a lightweight DOM ships an email rule of its own, looser than this one, and because the
// engine sanitizes what it was handed before it judges it: a control's verdict is about
// `input.value` read back, never about the string that was written into it.

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

/** lets the configuration read settle before the card is inspected. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * lets the edges finish moving before they are read.
 *
 * `[part~='field']` and `[part~='amount-input']` carry a `border-color` transition (./motion.css),
 * and a computed value read inside one is a colour part-way between the two — which reads as the
 * wrong rule having won. so the wait is on the engine's own transitions, and a control with nothing
 * running resolves at once.
 *
 * every node whose paint the case then reads has to be named. the wait is per-control and never
 * over the whole document, because the spinner is an infinite loop (./motion.css) and a promise on
 * that one never settles.
 */
async function painted(...nodes: HTMLElement[]): Promise<void> {
	const moving = nodes.flatMap((node) => {
		// forces the pending style change to resolve: a transition started by the line above the
		// call is not an animation the engine will hand back until it has recomputed the style.
		void getComputedStyle(node).borderTopColor;
		return node.getAnimations();
	});
	await Promise.all(moving.map((transition) => transition.finished));
}

type Card = {
	readonly shadow: ShadowRoot;
	find(selector: string): HTMLElement;
};

/** one element on the page, upgraded, carrying the sheets its own code adopted. */
async function mount(config: FormConfig = CONFIG): Promise<Card> {
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
	return {
		shadow,
		find: (selector) => {
			const node = shadow.querySelector(selector);
			if (node === null) throw new Error(`no ${selector} in the shadow root`);
			return node as HTMLElement;
		}
	};
}

/** a native control, pressed the way a donor presses it. */
function press(node: Element): void {
	(node as HTMLInputElement).click();
}

/** the Continue on whichever numbered step is on screen. */
function proceed(card: Card): void {
	card.find(".step:not([hidden]) [part~='action']:not([part~='submit'])").click();
}

/** the donor at the details step, with an amount and a frequency decided. */
async function atDetailsStep(): Promise<Card> {
	const card = await mount();
	press(card.shadow.querySelectorAll("[part~='frequency-option'] input")[0] as Element);
	press(card.shadow.querySelectorAll("[part~='amount-option'] input")[0] as Element);
	proceed(card);
	return card;
}

/**
 * a colour as the engine resolves it, so two spellings of one colour compare equal.
 *
 * the same `oklch()` token serializes as `oklch()` off one property and as `oklab()` off another —
 * a border reached through ./motion.css's transition comes back in the interpolation space. mixing
 * in `srgb` puts both through one conversion, so what is compared is the colour rather than the
 * string the engine happened to build.
 */
function resolved(value: string): string {
	const probe = document.createElement('div');
	probe.style.color = `color-mix(in srgb, ${value} 100%, transparent 0%)`;
	document.body.appendChild(probe);
	const read = getComputedStyle(probe).color;
	probe.remove();
	return read;
}

/** the border the engine actually painted, off the control itself. */
function edgeOf(node: HTMLElement): string {
	return resolved(getComputedStyle(node).borderTopColor);
}

/**
 * the colour a shadow is drawn in, off the front of what the engine serialized.
 *
 * `box-shadow` comes back as the colour followed by its lengths, whichever order the declaration
 * was written in, so the colour is everything before the first length.
 */
function shadowColour(shadow: string): string {
	const at = shadow.indexOf(' 0px');
	return resolved(at === -1 ? shadow : shadow.slice(0, at));
}

/** the danger colour, read off the one surface that is painted with nothing else. */
function dangerOf(card: Card): string {
	return resolved(getComputedStyle(card.find('#email-problem')).color);
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('the details step’s problem edge', () => {
	// the premise, and the first thing measured because everything else in this block rests on it:
	// `:invalid` matches an empty required field from the moment the card is painted, and the card
	// paints nothing, because the engine's verdict is not what the sheet selects on.
	it('is not drawn on a field the donor has not been asked for yet', async () => {
		const card = await atDetailsStep();
		const email = card.find('#email');
		await painted(email);

		expect(email.matches(':invalid')).toBe(true);
		expect(edgeOf(email)).not.toBe(dangerOf(card));
	});

	it('is drawn on the field a refused press was refused for', async () => {
		const card = await atDetailsStep();
		proceed(card);
		const email = card.find('#email');
		// with the caret elsewhere, which takes a `blur()` because the refused press put it on this
		// very field. the mark and the ring are two rules and the field wears both; reading the
		// edge while it is focused is reading the ring.
		email.blur();
		await painted(email);

		expect(edgeOf(email)).toBe(dangerOf(card));

		// and the token is the whole of what drew it. the field is still `:invalid` to the engine
		// with the token taken off, so an edge that survived this would be one the sheet paints
		// from the engine's answer — which marks fields the flow accepted, having no sentence for
		// any of them.
		email.setAttribute('part', 'field');
		await painted(email);

		expect(email.matches(':invalid')).toBe(true);
		expect(edgeOf(email)).not.toBe(dangerOf(card));
	});

	// nothing in ./parts.css arranges this: the mark and the ring are two rules writing one
	// property, and the ring wins by sitting later in the file. that is what makes it worth
	// measuring rather than reading — a rule added between them, or either one moved, takes the
	// ring off a marked field with nothing else on the card changing, and the field then looks
	// identical focused and unfocused, which is a keyboard donor with nowhere to be.
	it('leaves the focus ring on a field it has marked', async () => {
		const card = await atDetailsStep();
		proceed(card);
		const email = card.find('#email') as HTMLInputElement;
		email.blur();
		await painted(email);
		const resting = getComputedStyle(email).boxShadow;

		email.focus();
		await painted(email);
		const focused = getComputedStyle(email).boxShadow;

		expect(email.getAttribute('part')).toBe('field invalid');
		expect(focused).not.toBe(resting);
		// what each of them is, so a ring that changed into something else is not read as a ring.
		// the mark is the inset second pixel on the field's own edge; the ring is laid outside it.
		expect(resting).toContain('inset');
		expect(focused).not.toContain('inset');
		// and it is the danger ring rather than the ordinary one: on a control the form has
		// already marked, the ring carries the state instead of sitting beside it.
		expect(shadowColour(focused)).toBe(dangerOf(card));
	});

	// nothing is written by hand here. the keystroke is an `input` event, which is a snapshot,
	// which is a patch — so the token the paint comes from is already off by the time the donor
	// has finished typing, and no rule has to catch up with it.
	it('comes off the field the donor has fixed, on the keystroke', async () => {
		const card = await atDetailsStep();
		proceed(card);
		const email = card.find('#email') as HTMLInputElement;

		email.focus();
		await userEvent.keyboard('donor@example.org');
		email.blur();
		await painted(email);

		expect(email.getAttribute('part')).toBe('field');
		expect(edgeOf(email)).not.toBe(dangerOf(card));
	});

	// the divergence, as a paint, and the reason the engine's verdict cannot be what the sheet
	// selects on: a rule that painted from it would put this donor's email in the same red as the
	// name they genuinely left empty, with one sentence on the card between the two and the
	// unexplained one holding a value the form accepted.
	//
	// the address is typed rather than written, because the engine sanitizes what it is handed and
	// the two paths do not land on the same string: a non-ASCII domain typed into a
	// `<input type="email">` reaches `value` punycoded and passes, so the disagreement
	// `looksLikeAnAddress` (../value.ts) is documented against is not one a keystroke reaches in
	// this engine. an underscore in a domain label is not in the HTML email rule, is untouched by
	// the sanitizer, and is the same disagreement in the same direction.
	it('leaves an email the flow accepted unmarked', async () => {
		const card = await atDetailsStep();
		const email = card.find('#email') as HTMLInputElement;
		const last = card.find('#last-name') as HTMLInputElement;

		email.focus();
		await userEvent.keyboard('donor@example_fund.org');
		card.find('#first-name').focus();
		await userEvent.keyboard('Ada');
		proceed(card);
		// the refused press puts the caret on the last name, and a focused field is showing its
		// ring rather than its mark.
		last.blur();
		await painted(email, last);

		// the premise, asserted rather than assumed: the two rules disagree about this address.
		expect(email.checkValidity()).toBe(false);
		expect(
			completePayer(
				{ method: 'card', email: email.value, firstName: 'Ada', lastName: 'Lovelace' },
				CONFIG
			)
		).not.toBeNull();
		expect(edgeOf(email)).not.toBe(dangerOf(card));
		expect(edgeOf(last)).toBe(dangerOf(card));
	});
});

describe('the browser’s own email rule against the flow’s', () => {
	// the containment that keeps a refused press nameable: the guard has to be the looser of the
	// two. an address the engine accepts and `completePayer` refuses is a Donate that stays put
	// with every field reading clean, which is a press with nothing on the card to fix.
	//
	// what is handed to the guard is `probe.value` read back rather than the string written into
	// it. `type="email"` strips the whitespace a paste brings with it before it judges anything, so
	// comparing the engine's verdict against the raw string is comparing two different values and
	// the containment it reports is not the one that runs.
	const payerWith = (email: string) =>
		completePayer({ method: 'card', email, firstName: 'Ada', lastName: 'Lovelace' }, CONFIG);

	it('never accepts an address the flow would refuse', () => {
		const probe = document.createElement('input');
		probe.type = 'email';
		document.body.appendChild(probe);

		// the awkward end of what real donors type: one-label domains, plus-addressing, an
		// apostrophe, a hyphenated domain, and the leading space a paste brings with it.
		const accepted: string[] = [];
		for (const typed of [
			'donor@example.org',
			'a@b',
			"o'brien+gala@sub.example.co.uk",
			'donor.name_2@example-fund.org',
			'  donor@example.org  ',
			'DONOR@EXAMPLE.ORG'
		]) {
			probe.value = typed;
			if (probe.checkValidity()) accepted.push(probe.value);
		}

		expect(accepted).toHaveLength(6);
		expect(accepted.filter((value) => payerWith(value) === null)).toEqual([]);
	});

	// and the direction that makes the sentence selection worth anything: the two disagree only
	// where the engine is the stricter one, which is a field the donor is told about rather than a
	// press that goes nowhere.
	it('refuses what the flow refuses, on the typos a donor actually makes', () => {
		const probe = document.createElement('input');
		probe.type = 'email';
		document.body.appendChild(probe);

		for (const typed of ['donor', 'donor at example.org', '@example.org', 'donor@']) {
			probe.value = typed;
			expect(probe.validity.typeMismatch).toBe(true);
			expect(payerWith(probe.value)).toBeNull();
		}
	});
});

// the free entry is the one control on the card that draws no ring: the caret in it is what says
// where the focus is (`[part~='amount-input'] input:focus-visible` in ../styles/parts.css). the
// general rule every input falls under would ring it, so what is asserted is that the override
// holds in a real engine, and that the transparent outline forced-colors paints from is kept.
describe('the free entry the donor has already typed into', () => {
	it('draws no ring on focus, and keeps the outline forced-colors paints', async () => {
		const card = await mount();
		(card.find('.other input') as HTMLInputElement).click();
		const entry = card.find('#amount-entry') as HTMLInputElement;
		entry.value = '73';
		entry.dispatchEvent(new Event('input', { bubbles: true }));
		await painted(entry, card.find("[part~='amount-input']"));
		expect(card.find("[part~='amount-input']").getAttribute('part')).toContain('selected');

		entry.focus();
		await painted(entry);
		const drawn = getComputedStyle(entry);

		expect(drawn.boxShadow).toBe('none');
		expect(drawn.outlineStyle).toBe('solid');
		expect(resolved(drawn.outlineColor)).toBe(resolved('transparent'));
	});
});

describe('the amount step’s problem edge', () => {
	/**
	 * how wide the danger a control is marked with is drawn, counting both halves of it.
	 *
	 * this file's own rule is that a state is two pixels (../styles/parts.css), and a marked control
	 * makes them up from an edge recoloured to the danger and one pixel of shadow inside it. the
	 * measurement is the sum rather than either number, so that it reads as zero on a box carrying
	 * neither and as two only on the one box that carries both.
	 */
	function dangerWidth(node: HTMLElement, danger: string): number {
		const style = getComputedStyle(node);
		const spread = /(-?[\d.]+)px inset/.exec(style.boxShadow)?.[1];
		const shadow =
			spread !== undefined && shadowColour(style.boxShadow) === danger ? parseFloat(spread) : 0;
		const edge = resolved(style.borderTopColor) === danger ? parseFloat(style.borderTopWidth) : 0;
		return shadow + edge;
	}

	// one refused decision is one marked box, and on a tray of shortcuts that box is the tray
	// (../styles/parts.css): the tiles and the entry standing on it carry the token and draw
	// nothing from it, so the mark is one edge around the whole choice rather than a dozen boxes
	// each saying the same thing. the tray has a border to recolour, so its two pixels are that
	// edge and one of shadow inside it. a real engine is the only place any of it is visible.
	//
	// the tile is read at index 1 rather than 0 for a reason that survives whatever the caret does:
	// a marked control that has the focus draws the ring instead of the mark
	// (`[part~='invalid']:focus-visible` in ../styles/parts.css), and this case is about the boxes
	// nothing is drawn on at all.
	it('is drawn once, on the tray the tiles stand on', async () => {
		const card = await mount();
		// the seeded amount taken back through the other tile, so the press is refused for it and
		// every option in the group is marked.
		(card.find('.other input') as HTMLInputElement).click();
		proceed(card);
		const tray = card.find('.tiles');
		const tile = card.shadow.querySelectorAll("[part~='amount-option']")[1] as HTMLElement;
		const entry = card.find("[part~='amount-input']");
		await painted(tray, tile, entry);
		const danger = dangerOf(card);

		expect(tile.getAttribute('part')).toContain('invalid');
		expect(edgeOf(tray)).toBe(danger);
		expect(dangerWidth(tray, danger)).toBe(2);
		expect(getComputedStyle(tile).boxShadow).toBe('none');
		expect(dangerWidth(tile, danger)).toBe(0);
		expect(dangerWidth(entry, danger)).toBe(0);
	});

	// and a form suggesting one amount or none has no tray to mark: the entry is the outermost box
	// there, standing on the card as every other field does, so it takes the field's own mark.
	it('is drawn on the free entry itself where the entry stands alone', async () => {
		const card = await mount({ ...CONFIG, suggestedAmountsMinor: [] });
		proceed(card);
		const entry = card.find("[part~='amount-input']");
		// with the caret elsewhere, for the reason the details block above gives: the refused press
		// put it in this very box, and a marked control that has the focus draws the ring.
		card.find("[part~='amount-input'] input").blur();
		await painted(entry);
		const danger = dangerOf(card);

		expect(card.find('.tiles').classList.contains('bare')).toBe(true);
		expect(entry.getAttribute('part')).toContain('invalid');
		expect(edgeOf(entry)).toBe(danger);
		expect(dangerWidth(entry, danger)).toBe(2);
	});
});

describe('the mark that says a field is optional', () => {
	// the other half of what the card says about its own rules, and the half a donor reads before
	// pressing anything: the note is the one control nobody has to fill in and the only one that
	// says so, which is what leaves an unmarked field reading as one the form needs. measured here
	// because both halves of the claim are a paint — that it is on the screen at all, and that it
	// is quieter than the words it qualifies rather than a second label beside them.
	it('is visible, and quieter than the words it follows', async () => {
		const card = await mount();
		const mark = card.find('.optional');
		const beside = mark.parentElement as HTMLElement;
		const marked = getComputedStyle(mark);
		const around = getComputedStyle(beside);

		expect(mark.getBoundingClientRect().width).toBeGreaterThan(0);
		expect(parseFloat(marked.fontSize)).toBeLessThan(parseFloat(around.fontSize));
		expect(resolved(marked.color)).not.toBe(resolved(around.color));
	});
});

describe('the browser’s own name rule against the flow’s', () => {
	// where the containment is narrowest: `required` is satisfied by a single space and the flow
	// trims before it counts a character, so without a pattern the two rules disagree on exactly
	// the value a donor produces by tabbing through a field with the space bar. `NAME_PATTERN`
	// (../value.ts) is what closes it, and this is where the closing is measured — a lightweight
	// DOM's `pattern` is its own implementation and proves nothing about the engine that ships it.
	const payerWith = (firstName: string) =>
		completePayer(
			{ method: 'card', email: 'donor@example.org', firstName, lastName: 'Ada' },
			CONFIG
		);

	it('agrees with the flow on every name, in both directions', () => {
		const probe = document.createElement('input');
		probe.required = true;
		probe.pattern = NAME_PATTERN;
		document.body.appendChild(probe);

		// the ones a donor types, then the ones a donor leaves behind: nothing at all, a space, a
		// held space bar, and a tab.
		for (const typed of ['Ada', ' Ada ', "O'Brien", 'Ada Lovelace', '毛', '', ' ', '   ', '\t']) {
			probe.value = typed;
			expect(probe.checkValidity()).toBe(payerWith(probe.value) !== null);
		}
	});

	it('is the rule the card actually carries, on both name fields', async () => {
		// the agreement above is worth nothing if the attribute never reaches the control.
		const card = await atDetailsStep();

		expect((card.find('#first-name') as HTMLInputElement).pattern).toBe(NAME_PATTERN);
		expect((card.find('#last-name') as HTMLInputElement).pattern).toBe(NAME_PATTERN);
	});
});
