import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CONFIG_DEADLINE_MS,
	defineDonateForm,
	DONATE_FORM_TAG,
	OBSERVED_ATTRIBUTES,
	type FormBoot,
	type FormRuntime
} from './element';
import { PART_NAMES, ROLE_TOKENS, STATE_TOKENS } from './parts';
import type { CheckoutPorts } from './ports';
import type { Failure } from './checkout.machine';
import {
	PAYMENT_METHODS,
	type FormConfig,
	type Frequency,
	type PaymentMethod,
	type Program,
	type QuoteRequest
} from './v1';
import { DEFAULT_SHAPE } from './views';
import { APPEARANCE_INPUTS } from './styles/appearance';
import partStyles from './styles/parts.css?inline';
import layoutStyles from './styles/layout.css?inline';
import motionStyles from './styles/motion.css?inline';
import tokenStyles from './styles/tokens.css?inline';

// the dom pool. what a lightweight DOM can prove about a custom element is structure, attributes,
// events, slots and the upgrade lifecycle, and that is the whole of what is asserted here. layout,
// the `@container` breakpoints are in ./styles/layout.browser.spec.ts and anything the colour ramp
// derives is in ./styles/tokens.browser.spec.ts and ./styles/resolve.browser.spec.ts instead,
// because a lightweight DOM computes `oklch(from …)` as the string it was handed and lays nothing
// out.
//
// each test registers its own tag. a custom element registry is per document and a name can be
// defined once, so a test that needed a different configuration would otherwise be stuck with the
// first one. `defineDonateForm` takes the tag for that reason and for no other; every page gets
// the default.

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
		venmo: { percent: 0.0349, fixedMinor: 49 }
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

type Mounted = {
	readonly host: HTMLElement;
	readonly shadow: ShadowRoot;
	find(selector: string): HTMLElement;
	all(selector: string): HTMLElement[];
	text(selector: string): string;
	/**
	 * the payment provider reporting which rail its own fields are collecting for.
	 *
	 * this card draws no rail control, so this is how a donor picks one here: the provider's
	 * picker lives inside its own frame, and the runtime is handed a callback to report it
	 * through. `null` is the reading for a picker with nothing chosen in it.
	 */
	rail(method: PaymentMethod | null): void;
	/** the payment provider reporting that its own fields never came up. */
	unavailable(failure: Failure): void;
	/** the challenge widget handing over a token it has just minted. */
	token(value: string): void;
	/** the challenge widget reporting that it will never mint one. */
	challengeUnavailable(failure: Failure): void;
};

function view(
	host: HTMLElement
): Omit<Mounted, 'rail' | 'unavailable' | 'token' | 'challengeUnavailable'> {
	const shadow = host.shadowRoot;
	if (shadow === null) throw new Error('the element has not upgraded');
	const find = (selector: string): HTMLElement => {
		const node = shadow.querySelector(selector);
		if (node === null) throw new Error(`no ${selector} in the shadow root`);
		return node as HTMLElement;
	};
	return {
		host,
		shadow,
		find,
		all: (selector) => Array.from(shadow.querySelectorAll(selector)) as HTMLElement[],
		text: (selector) => find(selector).textContent ?? ''
	};
}

/** lets a configuration read settle before the card is inspected. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

type Options = {
	readonly config?: FormConfig;
	readonly loadConfig?: FormRuntime['loadConfig'];
	readonly ports?: Partial<CheckoutPorts>;
	/** the payment token a redirect came back with, which boots the flow into a resume. */
	readonly resume?: { readonly paymentToken: string };
	/** where the runtime was told a payment provider may paint, recorded rather than used. */
	readonly mounted?: (node: HTMLElement) => void;
	/** one entry per payment surface the element let go of. */
	readonly torn?: () => void;
	/** which boot the element said it was asking for, once per checkout it asked for. */
	readonly boots?: (boot: FormBoot) => void;
	/** where the runtime was told the challenge widget may draw, recorded rather than used. */
	readonly challenged?: (node: HTMLElement) => void;
	/** one entry per reset the element asked the challenge widget for. */
	readonly resets?: () => void;
	/** one entry per widget the element took off the page. */
	readonly stopped?: () => void;
	/** every cadence the card reported to the payment surface, in the order it reported them. */
	readonly cadences?: (frequency: Frequency | undefined) => void;
	readonly attributes?: Readonly<Record<string, string>>;
	readonly children?: string;
};

/** registers a tag, mounts one element on it and waits for its configuration. */
async function mount(options: Options = {}): Promise<Mounted> {
	const tag = `${DONATE_FORM_TAG}-${(tags += 1)}`;
	let report: (method: PaymentMethod | null) => void = () => {};
	let stop: (failure: Failure) => void = () => {};
	let minted: (token: string) => void = () => {};
	let unchallengeable: (failure: Failure) => void = () => {};
	defineDonateForm(
		{
			loadConfig: options.loadConfig ?? (async () => options.config ?? CONFIG),
			challenge: (_config, node, onToken, onUnavailable) => {
				options.challenged?.(node);
				minted = onToken;
				unchallengeable = onUnavailable;
				return {
					reset: () => options.resets?.(),
					stop: () => options.stopped?.()
				};
			},
			checkout: (config, mount, onRail, onUnavailable, boot) => {
				options.mounted?.(mount);
				options.boots?.(boot);
				report = onRail;
				stop = onUnavailable;
				return {
					input: {
						config,
						ports: { ...PORTS, ...options.ports },
						...(options.resume === undefined ? {} : { resume: options.resume })
					},
					cadence: (frequency) => options.cadences?.(frequency),
					stop: () => options.torn?.()
				};
			}
		},
		tag
	);
	const host = document.createElement(tag);
	for (const [name, value] of Object.entries(options.attributes ?? { form: 'frm_a8x2k9' })) {
		host.setAttribute(name, value);
	}
	if (options.children !== undefined) host.innerHTML = options.children;
	document.body.appendChild(host);
	await settle();
	return {
		...view(host),
		rail: (method) => report(method),
		unavailable: (failure) => stop(failure),
		token: (value) => minted(value),
		challengeUnavailable: (failure) => unchallengeable(failure)
	};
}

/**
 * what an upgrade delivers, and the two halves of it a spec has to hand.
 *
 * the snippet's own path is markup the parser placed and connected, with the defining script
 * arriving after it — the reverse of `mount` above, which defines a tag and then constructs an
 * element on it. an upgrade is where this element is handed both a connect reaction and an
 * attribute reaction for markup nobody touched, and `boots exactly once` below is what that pair
 * is held to.
 */
type Upgrade = {
	/**
	 * the element on the page, read back off the document rather than held.
	 *
	 * happy-dom upgrades by replacing the node with an instance of the new class, where an engine
	 * swaps the prototype of the node already there. a reference taken before the script arrives is
	 * therefore a different object from the one that upgraded, and holding one is how a spec ends up
	 * asserting against markup nothing is driving.
	 */
	host(): HTMLElement;
	/** every form id the runtime was asked to read a configuration for, in order. */
	readonly reads: string[];
	/** one entry per element group the runtime was asked to build, holding the node it was given. */
	readonly groups: HTMLElement[];
	/** the defining script arriving, which is what upgrades markup already on the page. */
	define(): void;
	/**
	 * the attribute reaction an upgrade carries beside its connect one, delivered by hand.
	 *
	 * happy-dom runs an upgrade's connect reaction and enqueues none of the attribute reactions the
	 * html spec puts beside it, so `customElements.define` alone does not produce the pair here.
	 * the arguments are the ones a real engine carries on that reaction: the attribute's current
	 * value against no previous one, on an element that is already connected.
	 */
	reaction(name: string): void;
};

/** markup on the page, with the script that defines it still to arrive. */
function placed(attributes: Readonly<Record<string, string>> = { form: 'frm_a8x2k9' }): Upgrade {
	const tag = `${DONATE_FORM_TAG}-upgrade-${(tags += 1)}`;
	const written = Object.entries(attributes)
		.map(([name, value]) => ` ${name}="${value}"`)
		.join('');
	document.body.insertAdjacentHTML('beforeend', `<${tag}${written}></${tag}>`);
	const host = (): HTMLElement => document.querySelector(tag) as HTMLElement;
	const reads: string[] = [];
	const groups: HTMLElement[] = [];
	return {
		host,
		reads,
		groups,
		define: () =>
			defineDonateForm(
				{
					loadConfig: async (formId) => {
						reads.push(formId);
						return CONFIG;
					},
					checkout: (config, mount) => {
						groups.push(mount);
						return { input: { config, ports: PORTS }, cadence: () => {}, stop: () => {} };
					},
					challenge: () => ({ reset: () => {}, stop: () => {} })
				},
				tag
			),
		reaction: (name) => {
			const node = host() as HTMLElement & {
				attributeChangedCallback(name: string, previous: string | null, next: string | null): void;
			};
			node.attributeChangedCallback(name, null, node.getAttribute(name));
		}
	};
}

/** a native radio or checkbox, pressed the way a donor presses it. */
function press(node: HTMLElement): void {
	(node as HTMLInputElement).click();
}

/** types into a field and fires the event its listener is bound to. */
function type(node: HTMLElement, value: string): void {
	(node as HTMLInputElement).value = value;
	node.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * takes the seeded amount back: the card opens with the lowest suggestion chosen (`settledDraft` in
 * ./checkout.machine.ts), and a test about a donor who has decided nothing starts by pressing the
 * other tile, which clears the figure and opens the box.
 */
function withdraw(card: Mounted): void {
	const options = card.all('[part~="amount-option"] input');
	press(options[options.length - 1] as HTMLElement);
}

/** the Continue on whichever numbered step is on screen, pressed the way a donor presses it. */
function proceed(card: Mounted): void {
	card.find('.step:not([hidden]) [part~="action"]:not([part~="submit"])').click();
}

/**
 * the mark standing for step `step` on whichever numbered step is on screen.
 *
 * the way back through the form, and the only one: every head draws all three, so the mark for a
 * step behind the donor is what a `Back` used to be and the one for a step ahead is a shortcut
 * past the screens between.
 */
function dot(card: Mounted, step: number): HTMLElement {
	return card.all('.step:not([hidden]) .step-dot')[step - 1] as HTMLElement;
}

/** the donor at the details step, with an amount and a frequency decided. */
async function atDetailsStep(options: Options = {}): Promise<Mounted> {
	const card = await mount(options);
	press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
	press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
	proceed(card);
	return card;
}

/** the donor at the review step, with the details behind it given and a rail reported. */
async function atReview(options: Options = {}): Promise<Mounted> {
	const card = await atReviewBeforeRail(options);
	card.rail('card');
	return card;
}

/**
 * the donor at the review step with no rail reported, which is where every donor arrives.
 *
 * the fee is priced per rail, and the rail is chosen inside the payment provider's own fields on
 * this very step — so every donor stands here for a moment with none reported. the card rate is
 * what the row states until one is (`displayRail` in ./checkout.machine.ts), which is why this
 * fixture and `atReview` above show the same figures on the config above.
 */
async function atReviewBeforeRail(options: Options = {}): Promise<Mounted> {
	const card = await atDetailsStep(options);
	type(card.find('#email'), 'donor@example.org');
	type(card.find('#first-name'), 'Ada');
	type(card.find('#last-name'), 'Lovelace');
	proceed(card);
	return card;
}

/**
 * a config that publishes no rule for the rail the row would price against.
 *
 * `feeRules` is untrusted JSON keyed by rail and the type saying every rail carries a rule does not
 * make the response carry one — which is the input `estimateFee` in ./fee.ts takes `undefined` for.
 * the cast is that gap, written down rather than worked around.
 */
const NO_RULE_FOR_CARD: FormConfig = {
	...CONFIG,
	feeRules: { ach: CONFIG.feeRules.ach } as FormConfig['feeRules']
};

/** the donor at the review step where nothing on the card can price the fee. */
async function atUnpricedReview(options: Options = {}): Promise<Mounted> {
	return atReviewBeforeRail({ config: NO_RULE_FOR_CARD, ...options });
}

/**
 * the press that spends the money, and wherever it landed.
 *
 * the fixture the mandate, the verification screens and every ending run through. under three
 * steps a matching quote is charged without stopping, so this is one press rather than two —
 * a case that wants the correction screen is `atCorrection` below.
 */
async function atSubmitted(options: Options = {}): Promise<Mounted> {
	const card = await atReview(options);
	card.find('[part~="submit"]').click();
	await settle();
	return card;
}

/** a deployment offering every rail, so a case can commit the one it is about. */
const EVERY_RAIL: FormConfig = { ...CONFIG, paymentMethods: [...PAYMENT_METHODS] };

/**
 * the press that spends the money, on a named rail.
 *
 * the fee is declined on the way past so the figure the donor was shown is the bare amount on every
 * rail, which is what lets one quote settle against all six: covered, each rail grosses up to a
 * total of its own and a fixed quote would route four of them onto the correction screen.
 */
async function atSubmittedOn(method: PaymentMethod, options: Options = {}): Promise<Mounted> {
	const card = await atReviewBeforeRail({
		config: EVERY_RAIL,
		...options,
		ports: {
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 0, totalMinor: 2500 }),
			...options.ports
		}
	});
	card.rail(method);
	press(card.find('.row.fee [part~="checkbox"]'));
	card.find('[part~="submit"]').click();
	await settle();
	return card;
}

/**
 * the correction screen: authority charging a figure the donor was not shown.
 *
 * $25.00 on a card estimates to $26.06 and the server here says $26.50, which is the one thing
 * that routes a donor to this screen at all.
 */
async function atCorrection(options: Options = {}): Promise<Mounted> {
	return atSubmitted({
		...options,
		ports: {
			quote: async () => ({ paymentToken: 'pi_1', feeMinor: 150, totalMinor: 2650 }),
			...options.ports
		}
	});
}

/** the takeover's own primary control, whichever screen is on the card. */
function primary(card: Mounted): HTMLElement {
	return card.find('.takeover > [part~="action"]');
}

/** the takeover's secondary control. */
function secondary(card: Mounted): HTMLElement {
	return card.find('.takeover > [part~="action-quiet"]');
}

/** what one element on the card says, or nothing at all when it is not on screen. */
function shows(card: Mounted, selector: string): string {
	const node = card.find(selector);
	return node.hidden ? '' : (node.textContent ?? '');
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('the upgrade lifecycle', () => {
	it('renders the host’s own placeholder before it upgrades', async () => {
		// ssr hosts render nothing of ours until the script runs, so what is on screen in that
		// window is whatever the host put in the slot — as ordinary light DOM, with no shadow root
		// in the picture at all.
		const tag = `${DONATE_FORM_TAG}-pre-${(tags += 1)}`;
		const host = document.createElement(tag);
		host.setAttribute('form', 'frm_a8x2k9');
		host.innerHTML = '<p slot="loading">Loading the donation form</p>';
		document.body.appendChild(host);

		expect(host.shadowRoot).toBeNull();
		expect(host.textContent).toBe('Loading the donation form');
	});

	// through `view`, whose `find` throws where there is no shadow root at all: read off a stale
	// reference, `host.shadowRoot?.querySelector(…)` is `undefined` and every absence assertion
	// about it passes without an element having upgraded at all.
	it('upgrades an element the parser had already placed', async () => {
		const page = placed();
		page.define();
		await settle();

		expect(view(page.host()).all('[part~="amount-option"]')).toHaveLength(5);
	});

	// the defect this pins: two configuration reads a millisecond apart, two payment surfaces
	// mounted into one slot, and the second frame sitting at zero height in front of the donor. an
	// upgrade is the snippet's normal path — the markup is parsed and connected, the script arrives
	// later — and it delivers an attribute reaction as well as a connect one, both on an element
	// that is already connected, so both reach the boot.
	//
	// counts rather than existence: "a configuration was read" and "a mount node exists" both pass
	// on the defect. which of the two reactions arrives first is deliberately not what this asserts
	// against — the element boots for the form its attributes name and does not boot again for the
	// same one, whichever reaction says it first.
	it('boots exactly once through an upgrade, however many reactions it carries', async () => {
		const page = placed();
		page.define();
		page.reaction('form');
		await settle();

		expect(page.reads).toEqual(['frm_a8x2k9']);
		expect(page.groups).toHaveLength(1);
		expect(page.host().querySelectorAll('[slot="payment"]')).toHaveLength(1);
	});

	// the other half of booting once, and the reason the fix is not "stop reacting to the
	// attribute": a form id that changes names a different form, and an element that ignored it
	// would go on rendering the one nobody asked for. what the upgrade must not cost is this.
	it('still replaces the form when the id changes after an upgrade', async () => {
		const page = placed();
		page.define();
		page.reaction('form');
		await settle();
		page.host().setAttribute('form', 'frm_second');
		await settle();

		expect(page.reads).toEqual(['frm_a8x2k9', 'frm_second']);
		expect(page.groups).toHaveLength(2);
		expect(page.host().querySelectorAll('[slot="payment"]')).toHaveLength(1);
	});

	// booting once is per connection, not once ever. an element taken off the page and put back is
	// one whose flow, payment mount and challenge were all stopped on the way out — so the failure
	// this catches is the opposite one to the upgrade's: a donation form that comes back blank,
	// with nothing on it and nothing said.
	//
	// the wait between the two is what makes this a departure rather than a move: the teardown is
	// deferred by a task so that the disconnect/connect pair a move arrives as can be told apart
	// (`#leaving` in ./element.ts), and a removal and an insertion in one task is that pair exactly.
	it('boots again for the same form when it is put back into the document', async () => {
		const page = placed();
		page.define();
		page.reaction('form');
		await settle();
		const host = page.host();
		host.remove();
		await settle();
		document.body.appendChild(host);
		await settle();

		expect(page.reads).toEqual(['frm_a8x2k9', 'frm_a8x2k9']);
		expect(page.groups).toHaveLength(2);
		expect(host.querySelectorAll('[slot="payment"]')).toHaveLength(1);
	});

	// a move is a disconnect and a connect in one task, and the html spec says so at
	// https://html.spec.whatwg.org/multipage/custom-elements.html#preserving-custom-element-state-when-moved:
	// an element reparented by `Node.insertBefore` is disconnected from and reconnected to the DOM,
	// so both reactions fire. host pages reparent for reasons of their own — a framework reordering a
	// list, a tab panel moved, a modal promoted to a portal — and none of them is a donor walking
	// away.
	it('reads no configuration again when it is only moved within the page', async () => {
		const page = placed();
		page.define();
		page.reaction('form');
		await settle();
		const host = page.host();
		const elsewhere = document.createElement('section');
		document.body.appendChild(elsewhere);
		elsewhere.appendChild(host);
		await settle();

		expect(page.reads).toEqual(['frm_a8x2k9']);
		expect(page.groups).toHaveLength(1);
		expect(host.querySelectorAll('[slot="payment"]')).toHaveLength(1);
	});

	// the same move from the donor's end, which is the whole reason it matters: the contact fields
	// are theirs and the card number is inside the provider's frame, and a re-boot takes both without
	// a word. the field is read back rather than the card counted, because a card rebuilt from the
	// skeleton has an `#email` too — an empty one.
	it('keeps the donation a donor is part-way through when it is moved', async () => {
		const card = await atDetailsStep();
		type(card.find('#email'), 'donor@example.org');
		const elsewhere = document.createElement('section');
		document.body.appendChild(elsewhere);
		elsewhere.appendChild(card.host);
		await settle();

		expect((card.find('#email') as HTMLInputElement).value).toBe('donor@example.org');
	});

	// `Element.moveBefore()` moves without disconnecting at all, and an element that declares this
	// callback is handed it in place of the disconnect/connect pair. it is not the whole answer — the
	// feature is Baseline limited (Chrome/Edge 133, Firefox 144, no Safari;
	// https://api.webstatus.dev/v1/features/move-before), and every other move still fires the pair —
	// so this is declared beside the deferral rather than instead of it.
	it('answers a browser that can move it without disconnecting it at all', async () => {
		const card = await mount();
		const host = card.host as HTMLElement & { connectedMoveCallback?: unknown };

		expect(typeof host.connectedMoveCallback).toBe('function');
	});

	it('keeps honouring the host’s placeholder while the configuration is in flight', async () => {
		// the host's placeholder matches the host's page better than anything written here does, so
		// it is kept rather than replaced the instant the script runs.
		const card = await mount({
			children: '<p slot="loading">Loading the donation form</p>',
			loadConfig: () => new Promise(() => {})
		});

		expect(card.shadow.querySelector('slot[name="loading"]')).not.toBeNull();
		expect(card.shadow.querySelector('.skeleton')).toBeNull();
	});

	it('draws its own skeleton only where the host supplied none', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.shadow.querySelector('.skeleton')).not.toBeNull();
	});

	it('stands the skeleton inside the card’s padding', async () => {
		// `.card-body` is the only box on this card that pads (`--_inset` in ./styles/layout.css), and
		// every other state the element draws goes through it — the unavailable card builds its own
		// in ./views.ts. a skeleton appended to `[part~='card']` instead sits one pixel of border off
		// the host's own edge and shifts the full inset inward the moment the configuration lands,
		// which is a card that moves under a donor who is already looking at it.
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.shadow.querySelector('.card-body .skeleton')).not.toBeNull();
	});

	it('sizes the skeleton from the shape the default form has', async () => {
		// so the reflow when the real configuration lands is a change of content and not a change
		// of height: every cadence, and no shortcut, because a form is created with none.
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.all('.skeleton-segment')).toHaveLength(DEFAULT_SHAPE.frequencies);
		expect(card.all('.skeleton-tile')).toHaveLength(DEFAULT_SHAPE.amounts);
	});

	it('draws what the first step draws, in its order', async () => {
		// the head, the cadences, the box a donor types the amount into, the two optional asks and
		// the button — what `build` in ./views.ts puts on the first step of every form. a shape
		// drawn without any of them is short by a whole control, and the card grows under a donor at
		// the moment the configuration lands, which is what the shape is there to stop.
		// ./styles/parts.browser.spec.ts measures the height; this holds the list.
		const card = await mount({ loadConfig: () => new Promise(() => {}) });
		const drawn = Array.from(card.find('.skeleton').children).map((child) => child.className);

		expect(drawn).toEqual([
			'step-head',
			'group',
			'group',
			'skeleton-block skeleton-row',
			'skeleton-block skeleton-row',
			'skeleton-block skeleton-action'
		]);
		expect(card.all('.step-head .skeleton-mark')).toHaveLength(3);
	});

	it('reports the wait on the card rather than only in the skeleton’s shape', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.find('[part~="card"]').getAttribute('aria-busy')).toBe('true');
	});

	it('drops the skeleton and the slot in the same breath as the first real paint', async () => {
		const card = await mount();

		expect(card.shadow.querySelector('.skeleton')).toBeNull();
		expect(card.shadow.querySelector('slot[name="loading"]')).toBeNull();
		expect(card.all('[part~="amount-option"]')).toHaveLength(5);
	});

	it('abandons a read for a form that has left the document', async () => {
		// the response would otherwise land on an element nobody is looking at, and on the way past
		// would replace the shadow content of one that has been detached.
		let aborted = false;
		const card = await mount({
			loadConfig: (_formId, signal) =>
				new Promise(() => {
					signal.addEventListener('abort', () => {
						aborted = true;
					});
				})
		});
		card.host.remove();
		// the teardown is a task behind the departure, so that a move is not one (`#leaving` in
		// ./element.ts). the read is still abandoned before anything could have landed on it.
		await settle();

		expect(aborted).toBe(true);
	});

	it('boots again on a new form and abandons the read for the old one', async () => {
		const asked: string[] = [];
		const card = await mount({
			loadConfig: async (formId) => {
				asked.push(formId);
				return CONFIG;
			}
		});
		card.host.setAttribute('form', 'frm_other');
		await settle();

		expect(asked).toEqual(['frm_a8x2k9', 'frm_other']);
	});
});

describe('the attribute surface', () => {
	it('observes the two attributes it publishes and no third', () => {
		expect([...OBSERVED_ATTRIBUTES]).toEqual(['form', 'variant']);
	});

	it('renders an unrecognised variant as the one it has, rather than refusing', async () => {
		// the attribute arrives from a snippet somebody pasted. a form that renders nothing over a
		// typo in a presentation hint is a worse answer than one that renders plainly.
		const card = await mount({ attributes: { form: 'frm_a8x2k9', variant: 'modal' } });

		expect(card.find('[part~="card"]').getAttribute('data-variant')).toBe('inline');
		expect(card.all('[part~="amount-option"]').length).toBeGreaterThan(0);
	});

	it('renders the same way when no variant is given at all', async () => {
		const card = await mount();

		expect(card.find('[part~="card"]').getAttribute('data-variant')).toBe('inline');
	});

	it('names the missing attribute when it was not told which form to render', async () => {
		// CLAUDE.md keeps a 4xx body readable by an agent with no console, and the same reader is
		// the one looking at this card.
		const card = await mount({ attributes: {} });

		expect(card.text('.unavailable')).toContain('not told which form');
		expect(card.text('.unavailable-fix')).toContain('form attribute');
	});

	it('names what a configuration must carry when the response could not be read', async () => {
		const card = await mount({ loadConfig: async () => ({ formId: 'frm_a8x2k9' }) });

		expect(card.text('.unavailable')).toContain('frm_a8x2k9');
		expect(card.text('.unavailable-fix')).toContain('deductibilityStatement');
	});

	it('keeps the sentence a failed read carried, including its fix', async () => {
		const card = await mount({
			loadConfig: async () => {
				throw Object.assign(new Error('This origin is not on the form’s allowlist.'), {
					fix: 'Add https://example.org to the form’s allowed origins in /admin.'
				});
			}
		});

		expect(card.text('.unavailable')).toContain('allowlist');
		expect(card.text('.unavailable-fix')).toContain('/admin');
	});
});

describe('a configuration read that did not land', () => {
	/** a read that fails as many times as it is told to and then answers. */
	function failsFirst(times: number, attempts: string[]): FormRuntime['loadConfig'] {
		return async (formId) => {
			attempts.push(formId);
			if (attempts.length <= times) throw new Error('the network went away');
			return CONFIG;
		};
	}

	// the defect this pins: a read that fails leaves a donor on that card for the life of the page.
	// a phone that lost signal for the two seconds the read takes comes back and nothing retries,
	// and the host cannot retry either — a boot left live for the form the attribute names makes
	// setting it to the same id a no-op.
	it('offers a way back onto a form whose configuration read failed', async () => {
		const attempts: string[] = [];
		const card = await mount({ loadConfig: failsFirst(1, attempts) });
		card.find('[part~="action"]').click();
		await settle();

		expect(attempts).toEqual(['frm_a8x2k9', 'frm_a8x2k9']);
		expect(card.all('[part~="amount-option"]')).toHaveLength(5);
	});

	// the host's own lever, and the reason it is the same id rather than a different one: the form
	// on the page did not change, the read for it failed. a boot left live for a form it never
	// rendered leaves `removeAttribute` and `setAttribute` — which flashes the card for a form
	// nobody named in between — as the only way back.
	it('boots again when the host sets the same form id after a failed read', async () => {
		const attempts: string[] = [];
		const card = await mount({ loadConfig: failsFirst(1, attempts) });
		card.host.setAttribute('form', 'frm_a8x2k9');
		await settle();

		expect(attempts).toEqual(['frm_a8x2k9', 'frm_a8x2k9']);
		expect(card.all('[part~="amount-option"]')).toHaveLength(5);
	});

	// and the other half of that: a form that rendered is not re-read because something set the
	// attribute it already booted on. an upgrade delivers exactly that pair — a connect reaction and
	// an attribute reaction for markup nobody touched — and two reads there are two payment surfaces
	// in one slot.
	it('does not boot again when the id is set to the one already on screen', async () => {
		const attempts: string[] = [];
		const card = await mount({ loadConfig: failsFirst(0, attempts) });
		card.host.setAttribute('form', 'frm_a8x2k9');
		await settle();

		expect(attempts).toEqual(['frm_a8x2k9']);
	});
});

// every outward call this form makes is bounded at thirty seconds — the payment provider's mount
// (./embed/stripe.ts), the challenge script (./embed/turnstile.ts), every port the flow reaches
// through (`PORT_TIMEOUT_MS` in ./checkout.machine.ts) — and the one that runs first is no
// exception. unbounded, it leaves a donor behind a captive portal or in front of a stalled origin
// on the skeleton for the life of the page, which is indistinguishable from a read still in flight.
describe('a configuration read that never answers', () => {
	it('gives up on it and says so, rather than shimmering forever', async () => {
		vi.useFakeTimers();
		try {
			const signals: AbortSignal[] = [];
			const mounting = mount({
				loadConfig: (_formId, signal) => {
					signals.push(signal);
					return new Promise(() => {});
				}
			});
			await vi.advanceTimersByTimeAsync(0);
			const card = await mounting;
			await vi.advanceTimersByTimeAsync(CONFIG_DEADLINE_MS);

			expect(card.shadow.querySelector('.skeleton')).toBeNull();
			expect(card.text('.unavailable-fix')).toContain('frm_a8x2k9');
			expect(card.text('.unavailable-fix')).toContain('30 seconds');
			// the read is dropped as well as reported: a body that lands after this card would
			// otherwise paint a form over a screen the donor has already been asked to act on.
			expect(signals[0]?.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	// the deadline is over the read, not over the element: a read that answered leaves nothing armed
	// to paint over the form thirty seconds later.
	it('leaves nothing armed over a read that answered', async () => {
		vi.useFakeTimers();
		try {
			const mounting = mount();
			await vi.advanceTimersByTimeAsync(0);
			const card = await mounting;
			await vi.advanceTimersByTimeAsync(CONFIG_DEADLINE_MS);

			expect(card.all('[part~="amount-option"]')).toHaveLength(5);
		} finally {
			vi.useRealTimers();
		}
	});
});

// a live region announces what arrives in it while it is already on the page. built as part of the
// card that carries its first sentence, the region and the sentence are one mutation — which is
// what assistive technology that diffs the tree per task drops — and there is no region at all
// between the element mounting and its configuration landing. so it is the element's rather than
// the card's, and it outlives every card shown in it.
describe('the live region', () => {
	it('is on the page before there is anything to say', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.find('[role="status"]').getAttribute('aria-live')).toBe('polite');
		expect(card.text('[role="status"]')).toBe('Loading the donation form.');
	});

	// the resume is the case this exists for: a donor back from their bank boots straight onto the
	// screen whose whole job is to say "Working on your gift" out loud, which makes it the one
	// announcement guaranteed to be first — and it landed in a region that did not exist a moment
	// earlier.
	it('speaks a first screen through the region that was already there', async () => {
		let land: (config: FormConfig) => void = () => {};
		const card = await mount({
			loadConfig: () =>
				new Promise<FormConfig>((resolve) => {
					land = resolve;
				}),
			resume: { paymentToken: 'pi_1_secret_x' },
			ports: { resume: () => new Promise(() => {}) }
		});
		const region = card.find('[role="status"]');
		land(CONFIG);
		await settle();

		expect(card.find('[role="status"]')).toBe(region);
		expect(region.textContent).toBe('Working on your gift.');
	});

	// the card that says a form cannot be rendered has the same defect from the other end: a
	// `role="alert"` inserted already holding its sentence is announced to nobody at all. it goes
	// through the region that was already there, and carries no role of its own — two channels is
	// the same refusal read out twice.
	//
	// the sentence and not the fix beside it. `role="status"` is atomic, so the region re-reads
	// whatever it holds whole, and the fix names a publishable key, an env var or a screen in
	// /admin — forty words of field names addressed to whoever administers the deployment. it stays
	// visible on the card, which is where the person or the agent wiring the embed reads it.
	it('speaks a card that cannot render through that region, once', async () => {
		const card = await mount({ loadConfig: async () => ({ formId: 'frm_a8x2k9' }) });
		const said = card.text('[role="status"]');

		expect(said).toContain('could not be read');
		expect(said).not.toContain('deductibilityStatement');
		expect(card.text('.unavailable-fix')).toContain('deductibilityStatement');
		expect(card.shadow.querySelectorAll('[role="alert"]')).toHaveLength(0);
	});

	it('is the same region after a boot for another form', async () => {
		const card = await mount();
		const region = card.find('[role="status"]');
		card.host.setAttribute('form', 'frm_other');
		await settle();

		expect(card.find('[role="status"]')).toBe(region);
	});

	// the same node is not the same thing as a node that stayed. a card swap that replaces the whole
	// tree takes the region out and puts it back in the task it is then written in — which is
	// exactly the mutation this region exists to avoid, on the element's own sentences: the one
	// telling a donor the form could not be loaded is the likeliest announcement here to be dropped.
	it('is never taken out of the tree to put a card in', async () => {
		const card = await mount();
		const region = card.find('[role="status"]');
		const removed: Node[] = [];
		const watch = new MutationObserver((records) => {
			for (const record of records) removed.push(...Array.from(record.removedNodes));
		});
		watch.observe(card.shadow, { childList: true });
		card.host.setAttribute('form', 'frm_other');
		await settle();
		watch.disconnect();

		expect(removed).not.toContain(region);
		expect(card.find('[role="status"]')).toBe(region);
	});

	// and the first sentence of all, which is the one case where the region cannot have been in the
	// tree already: it is inserted and written in the same connect. a task between the two is what
	// makes the insertion and the sentence two mutations rather than one.
	it('writes its first sentence a task after the region reaches the tree', async () => {
		const tag = `${DONATE_FORM_TAG}-deferred-${(tags += 1)}`;
		defineDonateForm(
			{
				loadConfig: () => new Promise<FormConfig>(() => {}),
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
		host.setAttribute('form', 'frm_a8x2k9');
		document.body.appendChild(host);
		const region = host.shadowRoot?.querySelector('[role="status"]') as HTMLElement;

		expect(region.textContent).toBe('');

		await settle();

		expect(region.textContent).toBe('Loading the donation form.');
	});
});

// every word this element says is English, whatever the page around it is written in: `locale`
// reaches `Intl` and nothing else, so it moves the digits and the date and never a sentence. dropped
// into a host that declares another language, an undeclared shadow tree is a card — refusal
// included — spoken with that language's phonetics.
describe('the language the card is spoken in', () => {
	it('declares it on the card', async () => {
		const card = await mount();

		expect(card.find('[part~="card"]').getAttribute('lang')).toBe('en');
	});

	it('declares it on the card the wait is spent on', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.find('[part~="card"]').getAttribute('lang')).toBe('en');
	});

	it('declares it on the card that cannot render', async () => {
		const card = await mount({ loadConfig: async () => ({ formId: 'frm_a8x2k9' }) });

		expect(card.find('[part~="card"]').getAttribute('lang')).toBe('en');
	});

	// the region is a sibling of the card rather than a child of it, so a declaration on the card
	// covers none of what the element actually says out loud.
	it('declares it on the region every announcement goes through', async () => {
		const card = await mount();

		expect(card.find('[role="status"]').getAttribute('lang')).toBe('en');
	});

	// the host element is in the page's own DOM and its attributes are the integrator's. a `lang`
	// written there is this element editing markup it does not own.
	it('declares nothing on the host element', async () => {
		const card = await mount();

		expect(card.host.hasAttribute('lang')).toBe(false);
	});
});

describe('the style adoption', () => {
	it('puts the token sheet in the document as well as in the shadow root', async () => {
		// `@property` registrations are collected from the document tree only. a token sheet that
		// reached the engine solely through a shadow root would leave the five seeds with no initial
		// value and every derived step invalid, which is a blank card rather than a fallback.
		const card = await mount();

		expect(document.adoptedStyleSheets.length).toBeGreaterThan(0);
		expect(card.shadow.adoptedStyleSheets).toHaveLength(4);
		expect(card.shadow.adoptedStyleSheets[0]).toBe(document.adoptedStyleSheets[0]);
	});

	it('adopts one set of sheets however many elements a page holds', async () => {
		const before = document.adoptedStyleSheets.length;
		await mount();
		await mount();

		expect(document.adoptedStyleSheets.length).toBe(before);
	});

	// the document adoption is done once per document and then never looked at again, and the array
	// belongs to the host page: a design system that assigns rather than appends takes the token
	// sheet off with it, and with it every `@property` registration the seeds derive from. that is a
	// blank card taking money, on a page nothing here can see.
	it('puts the token sheet back when the host page assigns the array out from under it', async () => {
		const card = await mount();
		const token = card.shadow.adoptedStyleSheets[0];
		document.adoptedStyleSheets = [];
		card.host.setAttribute('form', 'frm_other');
		await settle();

		expect(document.adoptedStyleSheets).toContain(token);
	});

	// an element moved into another document keeps a shadow root holding four sheets constructed in
	// the document it came from, and a constructed sheet may only be adopted by the document it was
	// constructed in — so what it is holding is not adoptable and the card is styled by nothing.
	// there is no rebuild without this callback: `#mount` returns early on a shadow root that exists.
	it('rebuilds its sheets from the document it was adopted into', async () => {
		const card = await mount();
		const frame = document.createElement('iframe');
		document.body.appendChild(frame);
		const other = frame.contentDocument as Document;
		other.body.appendChild(card.host);
		// happy-dom moves the node without running the reaction the html spec puts beside it, the way
		// it delivers no attribute reaction on an upgrade — so it is delivered by hand, on an element
		// whose `ownerDocument` is already the new one, which is what an engine does.
		(card.host as HTMLElement & { adoptedCallback(): void }).adoptedCallback();

		expect(card.shadow.adoptedStyleSheets).toHaveLength(4);
		expect(other.adoptedStyleSheets).toContain(card.shadow.adoptedStyleSheets[0]);
		expect(document.adoptedStyleSheets).not.toContain(card.shadow.adoptedStyleSheets[0]);
	});
});

describe('the part vocabulary as rendered', () => {
	it('emits no token that is not in the published vocabulary', async () => {
		// the assertion that keeps a permanent contract permanent: a fourteenth name shipped by
		// accident fails here rather than being discovered by a host whose rule stops working.
		const known = new Set<string>([...PART_NAMES, ...STATE_TOKENS, ...ROLE_TOKENS]);
		// a takeover rather than a numbered step: the takeovers are where a fourteenth name
		// is most tempting, because each of them has a heading, a message and two controls that
		// look like they want naming of their own.
		const card = await atSubmitted();
		const emitted = card
			.all('[part]')
			.flatMap((node) => (node.getAttribute('part') ?? '').split(' '));

		expect(emitted).toContain('heading');
		expect(emitted.filter((token) => token.length > 0 && !known.has(token))).toEqual([]);
	});

	it('carries exactly one name in every part list', async () => {
		// a part list is one name plus tokens. two names in one list would make `::part(a)` and
		// `::part(b)` reach the same surface, and the vocabulary stops being a map of surfaces.
		const names = new Set<string>(PART_NAMES);
		const card = await atSubmitted();
		const wrong = card.all('[part]').filter((node) => {
			const tokens = (node.getAttribute('part') ?? '').split(' ').filter((t) => t.length > 0);
			return tokens.filter((token) => names.has(token)).length !== 1;
		});

		expect(wrong).toEqual([]);
	});

	it('names no layout container and no message', async () => {
		const card = await mount();

		expect(card.find('.tiles').hasAttribute('part')).toBe(false);
		expect(card.find('#amount-problem').hasAttribute('part')).toBe(false);
		expect(card.find('#note-problem').hasAttribute('part')).toBe(false);
		expect(card.find('#email-problem').hasAttribute('part')).toBe(false);
		expect(card.find('#payment-problem').hasAttribute('part')).toBe(false);
		// and the mark saying a field is optional, for the same reason: one a host could paint out
		// is a card that asks for a field it does not need without saying so. how far through the
		// donor is is the same argument about the same donor, and it now covers three nodes and
		// carries more than it did: painted out, the form has no stated end and no way back.
		expect(card.find('.optional').hasAttribute('part')).toBe(false);
		// counted before they are asked about: `some` and `every` over nothing both answer the way
		// this test wants, so a renamed class would leave it green over an empty selection.
		expect(card.all('.step-count')).toHaveLength(3);
		expect(card.all('.step-dots')).toHaveLength(3);
		expect(card.all('.step-dot')).toHaveLength(9);
		expect(card.all('.step-mark')).toHaveLength(9);
		expect(card.all('.step-count').some((node) => node.hasAttribute('part'))).toBe(false);
		expect(card.all('.step-dots').some((node) => node.hasAttribute('part'))).toBe(false);
		expect(card.all('.step-dot').some((node) => node.hasAttribute('part'))).toBe(false);
		expect(card.all('.step-mark').some((node) => node.hasAttribute('part'))).toBe(false);
		// the words are on the card for a screen reader, out of the tree rather than out of the
		// document: they are what the heading is described by, and what the marks are named for is
		// where each of them goes.
		expect(card.all('.step-count').every((node) => node.hasAttribute('hidden'))).toBe(true);
		expect(card.all('.step-count').map((node) => node.textContent)).toEqual([
			'Step 1 of 3',
			'Step 2 of 3',
			'Step 3 of 3'
		]);
		// the takeover's own surfaces, and the two that carry semantic colour: a host who could
		// restyle the block naming a deadline, or the sentence saying a total changed, could
		// restyle either into something a donor does not read.
		expect(card.find('.takeover').hasAttribute('part')).toBe(false);
		expect(card.find('.attention').hasAttribute('part')).toBe(false);
		expect(card.find('.mandate').hasAttribute('part')).toBe(false);
		expect(card.find('.receipt-slot').hasAttribute('part')).toBe(false);
	});

	it('sets no disabled attribute on any control, in any state', async () => {
		// double-submit is prevented by the flow's shape, never by an attribute — any second entry
		// point walks straight past one. ./connect.spec.ts asserts no getter emits the prop; this is
		// the other half, that nothing here invents it.
		//
		// the payer is completed first because `SUBMIT` is guarded by `payerIsComplete`: pressed on
		// an incomplete one the machine correctly stays put, and a busy state that was never entered
		// would prove nothing about what a busy state renders.
		const card = await atReview({ ports: { quote: () => new Promise(() => {}) } });
		card.find('[part~="submit"]').click();

		expect(card.all('[disabled]')).toEqual([]);
		expect(card.find('.step-give [part~="submit"]').getAttribute('part')).toContain('busy');
	});
});

describe('the amount step', () => {
	it('offers one tile per amount the deployment suggests, then the other tile, then the free entry', async () => {
		const card = await mount();

		expect(card.all('[part~="amount-option"]')).toHaveLength(5);
		expect(card.all('[part~="amount-option"]')[4]?.textContent).toBe('Other');
		expect(card.all('[part~="amount-input"]')).toHaveLength(1);
		// the entry is the other tile's to show: closed until that tile is chosen.
		expect(card.find('[part~="amount-input"]').hidden).toBe(true);
	});

	// the other tile is a radio in the presets' own group, so it is one press or one arrow away
	// from them, and what it chooses is the box under it: the box opens, takes the caret, and the
	// preset that was lit goes out — the figure it wrote is cleared with it, because a figure left
	// standing in a box the donor was told to type into is a gift the next press would charge.
	it('opens the free entry on the other tile, with the caret in it and the preset put out', async () => {
		const card = await mount();
		press(card.all('[part~="amount-option"] input')[1] as HTMLElement);
		expect((card.find('#amount-entry') as HTMLInputElement).value).toBe('100');

		press(card.all('[part~="amount-option"] input')[4] as HTMLElement);

		expect(card.find('[part~="amount-input"]').hidden).toBe(false);
		expect(card.shadow.activeElement).toBe(card.find('#amount-entry'));
		expect((card.find('#amount-entry') as HTMLInputElement).value).toBe('');
		// the tile stays on the tray while the box is open, chosen, so no preset reads as chosen over
		// the box and a preset press is what closes it.
		expect(card.all('[part~="amount-option"]')[4]?.hidden).toBe(false);
		expect(card.all('[part~="amount-option"]')[4]?.getAttribute('part')).toBe(
			'amount-option selected'
		);
		expect(card.all('[part~="amount-option"]')[1]?.getAttribute('part')).toBe('amount-option');
	});

	// the card opens one press from a gift: the lowest suggestion is chosen for the donor
	// (`settledDraft` in ./checkout.machine.ts), and the box under it stays shut.
	it('opens with the lowest preset chosen and the free entry shut', async () => {
		const card = await mount();

		expect(card.all('[part~="amount-option"]')[0]?.getAttribute('part')).toBe(
			'amount-option selected'
		);
		expect(card.find('[part~="amount-input"]').hidden).toBe(true);
	});

	// one suggestion is no choice, so no tile is drawn for it: the box stands alone, on no tray,
	// already holding the figure the flow was seeded with.
	it('draws no tile for a single suggestion and writes it into the free entry', async () => {
		const card = await mount({
			loadConfig: async () => ({ ...CONFIG, suggestedAmountsMinor: [2500] })
		});

		expect(card.all('[part~="amount-option"]')).toHaveLength(0);
		expect(card.find('.tiles').classList.contains('bare')).toBe(true);
		expect(card.find('[part~="amount-input"]').hidden).toBe(false);
		expect((card.find('#amount-entry') as HTMLInputElement).value).toBe('25');
		expect(card.find('[part~="amount-input"]').getAttribute('part')).toBe('amount-input selected');
	});

	it('closes the free entry again on a preset', async () => {
		const card = await mount();
		press(card.all('[part~="amount-option"] input')[4] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[1] as HTMLElement);

		expect(card.find('[part~="amount-input"]').hidden).toBe(true);
		expect(card.all('[part~="amount-option"]')[4]?.getAttribute('part')).toBe('amount-option');
		expect(card.all('[part~="amount-option"]')[1]?.getAttribute('part')).toBe(
			'amount-option selected'
		);
	});

	// a form suggesting no amounts has nothing to be other than: the box is the whole block, open
	// from the first paint, and no tile stands over it.
	it('shows the free entry alone, and no other tile, where no amount is suggested', async () => {
		const card = await mount({
			loadConfig: async () => ({ ...CONFIG, suggestedAmountsMinor: [] })
		});

		expect(card.all('[part~="amount-option"]')).toHaveLength(0);
		expect(card.find('[part~="amount-input"]').hidden).toBe(false);
	});

	it('offers the frequencies the deployment enabled, in the contract’s own order', async () => {
		const card = await mount();

		expect(card.all('[part~="frequency-option"]').map((node) => node.textContent)).toEqual([
			'One-time',
			'Monthly',
			'Yearly'
		]);
	});

	// a tile is an offer and a receipt row is a statement (`formatOffer` in ./money.ts). the pair is
	// asserted from one screen rather than from two, because what makes the split visible is the same
	// amount reading two ways: `$25` where it is offered and `$25.00` where it is charged.
	it('offers a whole amount without its zero fraction and charges it with one', async () => {
		const card = await mount();

		expect(card.all('[part~="amount-option"]').map((node) => node.textContent)).toEqual([
			'$25',
			'$100',
			'$250',
			'$1,000',
			'Other'
		]);

		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.text('.row .figure')).toBe('$25.00');
	});

	// the two currency marks, and which end each stands at. the code was in front of the figure and
	// competing with the placeholder for the same corner of an empty box; the symbol leads now and
	// the code trails, so what a donor reads before typing is one mark and one label.
	it('sets the currency symbol before the figure and the code after it', async () => {
		const card = await mount();
		const tile = card.find('[part~="amount-input"]');
		const marks = Array.from(tile.children).map((node) => node.textContent);

		expect(card.text('.adorn-lead')).toBe('$');
		expect(card.text('.adorn-trail')).toBe('USD');
		// and in that order in the tree, which is what puts each on the side it names.
		expect(marks).toEqual(['$', '', 'USD']);
	});

	it('draws no leading mark for a currency the locale writes no symbol for', async () => {
		// `CHF` is its own symbol in `en-US`, so a card drawing both marks would say the currency
		// twice — once at each end of the same box.
		const card = await mount({ config: { ...CONFIG, currency: 'chf' } });

		expect(card.all('.adorn-lead')).toEqual([]);
		expect(card.text('.adorn-trail')).toBe('CHF');
	});

	it('reports a chosen tile with the selected token rather than with a name of its own', async () => {
		const card = await mount();
		press(card.all('[part~="amount-option"] input')[1] as HTMLElement);

		expect(card.all('[part~="amount-option"]')[1]?.getAttribute('part')).toBe(
			'amount-option selected'
		);
		expect(card.all('[part~="amount-option"]')[0]?.getAttribute('part')).toBe('amount-option');
	});

	it('sends what a donor typed into the free entry through the flow', async () => {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		type(card.find('#amount-entry'), '30');
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.text('.row .figure')).toBe('$30.00');
	});

	it('reads the free entry as chosen only while no preset is', async () => {
		const card = await mount();
		type(card.find('#amount-entry'), '30');

		expect(card.find('[part~="amount-input"]').getAttribute('part')).toBe('amount-input selected');

		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);

		expect(card.find('[part~="amount-input"]').getAttribute('part')).toBe('amount-input');
	});

	// the tiles and the box are two views of one number, which is what the model has always said:
	// `AmountDraft` carries one `amountMinor` and no record of which control set it. so a preset
	// press writes its figure into the box, and the box is the amount rather than an alternative to
	// it.
	it('puts the pressed preset’s own figure in the box', async () => {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		type(card.find('#amount-entry'), '60');
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);

		// the figure alone: the currency is drawn by the marks at either end of the box, and a
		// second one inside it would state the currency twice.
		expect((card.find('#amount-entry') as HTMLInputElement).value).toBe('25');

		proceed(card);

		expect(card.text('.row .figure')).toBe('$25.00');
	});

	// and what the box then holds reads back as the same amount, which is what makes the two views
	// one: a figure written by a press is indistinguishable from one a donor typed.
	it('writes a figure the box itself would read back', async () => {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[3] as HTMLElement);
		const written = (card.find('#amount-entry') as HTMLInputElement).value;
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		type(card.find('#amount-entry'), written);
		proceed(card);

		expect(card.text('.row .figure')).toBe('$1,000.00');
	});

	// the other direction, which the projection drives and the view overrules: the flow marks the
	// preset a typed figure equals, and drawing that would close the box under a donor mid-word
	// (`otherChosen` in ./views.ts). so the other tile holds, the preset stays out, and the box
	// keeps what was typed exactly as it was typed — the amount is the flow's one number either way.
	it('keeps the box open and the preset out when what was typed equals a preset', async () => {
		const card = await mount();
		press(card.all('[part~="amount-option"] input')[4] as HTMLElement);
		type(card.find('#amount-entry'), '25');

		expect(card.all('[part~="amount-option"]')[0]?.getAttribute('part')).toBe('amount-option');
		expect(card.all('[part~="amount-option"]')[4]?.getAttribute('part')).toBe(
			'amount-option selected'
		);
		expect(card.find('[part~="amount-input"]').hidden).toBe(false);
		expect((card.find('#amount-entry') as HTMLInputElement).value).toBe('25');

		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.text('.row .figure')).toBe('$25.00');
	});

	// the box is the amount and the tiles are shortcuts into it, so it is no longer the alternative
	// its old placeholder called it.
	it('names the box for the amount rather than for what it is not', async () => {
		const card = await mount();

		expect((card.find('#amount-entry') as HTMLInputElement).placeholder).toBe('Amount');
		expect(card.text("label[for='amount-entry']")).toBe('Amount');
	});

	it('takes the amount back when the donor empties the free entry', async () => {
		// a box the donor has emptied is a gift they have withdrawn. leaving the last figure live
		// behind it is a donor looking at an empty box while the flow still holds the amount the
		// next press would charge.
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		type(card.find('#amount-entry'), '60');
		type(card.find('#amount-entry'), '');
		proceed(card);

		expect(card.all('.step').map((step) => step.hidden)).toEqual([false, true, true, true]);
		expect(card.find('#amount-problem').hidden).toBe(false);
	});

	it('answers a withdrawal on the step the amount is decided on and on no other', async () => {
		// past Continue there is a gift the flow has committed and a quote may be minted against,
		// so an event reaching the free entry from behind that step changes nothing: the machine
		// drops what the state it is in does not handle.
		const card = await atDetailsStep();
		type(card.find('#amount-entry'), '');
		dot(card, 1).click();

		expect(card.all('[part~="amount-option"]')[0]?.getAttribute('part')).toBe(
			'amount-option selected'
		);

		proceed(card);

		expect(card.all('.step').map((step) => step.hidden)).toEqual([true, false, true, true]);
	});

	// and an empty box is not the same event as a box holding letters. one is a decision being
	// taken back, the other is a value nothing can read — including the halves of a figure a donor
	// is part way through typing — and the figure they last gave stands until they give another.
	it('keeps the last figure while the box holds something it cannot read', async () => {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		type(card.find('#amount-entry'), '60');
		type(card.find('#amount-entry'), 'abc');
		proceed(card);

		expect(card.text('.row .figure')).toBe('$60.00');
	});

	// a control offering one option is not a choice, so a deployment that enabled one cadence draws
	// none at all — not a disabled track, not a one-option track. the difference is what a donor is
	// asked: with one cadence there is nothing to decide and nothing to say about it.
	describe('a deployment that enabled one cadence', () => {
		const oneCadence = { ...CONFIG, frequencies: ['monthly'] as const };

		it('draws no frequency control at all', async () => {
			const card = await mount({ config: oneCadence });

			expect(card.all('[part~="frequency-option"]')).toEqual([]);
			expect(card.all('.segment')).toEqual([]);
		});

		// settled rather than asked for. the value the flow carries forward is the same shape it is
		// on every other deployment, so nothing past this step can tell that no control was drawn.
		it('carries the one cadence into the gift without asking for it', async () => {
			const card = await mount({ config: oneCadence });
			press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
			proceed(card);

			expect(card.all('.step').map((step) => step.hidden)).toEqual([true, false, true, true]);
			expect(card.text('.row .row-label')).toBe('Monthly gift');
		});

		// and the press is refused for the amount alone, which is the only decision left on the step.
		it('refuses a press for the amount alone', async () => {
			const card = await mount({ config: oneCadence });
			withdraw(card);
			card.find('[part~="action"]:not([part~="submit"])').click();

			expect(card.all('#frequency-problem')).toEqual([]);
			expect(card.find('#amount-problem').hidden).toBe(false);
		});
	});

	// the chip on the frequency track is placed from the options' own used boxes, so anything that
	// rewraps them has to put it back. the window changing size is the one such thing this element
	// can hear, and the listener it hears it on holds a closure over the track — so it has to go
	// when the element does. a leaked one is a rewrap computed against a card that has left the
	// page, on a page this component does not own.
	// asserted off the pair of calls rather than off anything the card draws, because a leak is a
	// fact about the listener and not about a rendered box: what the handler would compute on a
	// detached card is the same as what it computes on a live one, so no reading of the tree can
	// tell whether it ran. where the chip actually lands on a rewrap is
	// "puts the chip back where the options went when the window changes size" in
	// ./styles/parts.browser.spec.ts, which needs an engine that lays out.
	it('stops listening for a rewrap when the element leaves the page', async () => {
		const added = vi.spyOn(window, 'addEventListener');
		const removed = vi.spyOn(window, 'removeEventListener');
		const resize = (spy: typeof added): unknown[] =>
			spy.mock.calls.filter(([type]) => type === 'resize').map(([, handler]) => handler);

		const card = await mount();
		// this card's own handler, held by reference: a teardown deferred from an earlier case in
		// this file lands inside the wait above, so the removals are not empty to begin with.
		const [mine] = resize(added);
		expect(resize(added)).toHaveLength(1);
		expect(resize(removed)).not.toContain(mine);

		card.host.remove();
		await settle();

		expect(resize(removed)).toContain(mine);
	});

	it('opens with a cadence chosen, so no press is ever refused for one', async () => {
		// the card used to open on an empty track and refuse every press until a donor answered a
		// question with an obvious answer. one-time is that answer, and the whole refusal goes with
		// it: there is no message under the group, no role carrying a state it can no longer be in,
		// and no `invalid` token on an option.
		const card = await mount();
		const chosen = card.all('[part~="frequency-option"] input') as HTMLInputElement[];

		expect(chosen.map((option) => option.checked)).toEqual([true, false, false]);

		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.all('#frequency-problem')).toEqual([]);
		expect(card.all('[part~="frequency-option"]')[0]?.getAttribute('part')).not.toContain(
			'invalid'
		);
		expect(card.find('.segment').closest('fieldset')?.hasAttribute('aria-invalid')).toBe(false);
	});

	it('names the amount it is missing rather than doing nothing when pressed', async () => {
		// the flow drops a press it has no decision for, and a button that silently does nothing is
		// how a donor concludes the form is broken.
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.find('#amount-problem').hidden).toBe(false);
	});

	it('marks the free entry invalid to a screen reader, not only to a stylesheet', async () => {
		// `aria-invalid` is not a global attribute: the `group` a `<fieldset>` maps to does not
		// support it, so it is written only where a role takes it. the amount fieldset holds a text
		// box beside its radios, is therefore no radiogroup, and carries the sentence instead — the
		// box beside them carries the state.
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();
		const amounts = card.find('#amount-problem').parentElement;

		expect(card.find('#amount-entry').getAttribute('aria-invalid')).toBe('true');
		expect(amounts?.hasAttribute('role')).toBe(false);
		expect(amounts?.hasAttribute('aria-invalid')).toBe(false);
		expect(amounts?.getAttribute('aria-describedby')).toBe('amount-problem');
	});

	it('names the bounds the org published on the amount it asks for', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.find('#amount-problem').hidden).toBe(false);
		expect(card.find('#amount-problem').textContent).toBe('between $5 and $50,000');
	});

	it('ties the message to the control with aria-describedby, never to a tooltip', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();
		const group = card.find('#amount-problem').parentElement;

		expect(group?.getAttribute('aria-describedby')).toBe('amount-problem');
		expect(card.all('[part~="amount-option"]')[0]?.getAttribute('part')).toContain('invalid');
		expect(card.all('[title]')).toEqual([]);
	});

	// and the caret lands in the box the tiles gave way to, which is the only place a missing amount
	// ever sends it: the other tile is what `withdraw` above presses, and the entry is open in the
	// tiles' place from that press onward.
	it('lands the caret on the free entry when the other tile is holding', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.shadow.activeElement).toBe(card.find('#amount-entry'));
	});

	// `hidden` is no protection here. a description is read off the id it points at whether the node
	// is on screen or not, so a box wired to the refusal from the first paint announces the amount a
	// donor has not typed yet as already wrong.
	it('describes the free entry by nothing until a press has been refused', async () => {
		const card = await mount();

		expect(card.find('#amount-entry').hasAttribute('aria-describedby')).toBe(false);
	});

	// and it is marked by nothing either. the state is written on the press that was refused for the
	// amount and on no other patch, so a donor heading for a preset tile never meets a box reporting
	// itself invalid while it sits empty and untouched.
	it('marks the free entry invalid only once a press has been refused for it', async () => {
		const card = await mount();

		expect(card.find('#amount-entry').hasAttribute('aria-invalid')).toBe(false);

		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);

		expect(card.find('#amount-entry').hasAttribute('aria-invalid')).toBe(false);
	});

	// and once there is a refusal, one node points at the sentence rather than two. the fieldset is
	// the one that does: the caret lands inside it wherever the refusal put it, and the sentence is
	// said out loud besides (the region test below). the box carries `aria-invalid`, which is the
	// state the fieldset's role cannot hold.
	it('points one node at the amount sentence when a press is refused, not two', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();
		const described = card.all('[aria-describedby~="amount-problem"]');

		expect(described).toHaveLength(1);
		expect(described[0]?.tagName).toBe('FIELDSET');
	});

	it('clears the message once the decision it asked for is made', async () => {
		const card = await mount();
		card.find('[part~="action"]:not([part~="submit"])').click();
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);

		expect(card.find('#amount-problem').hidden).toBe(true);
	});

	// the same rule the details step and the review step keep about a press they were refused on:
	// asking is a thing a press does, and returning to a step is not a press. without it a donor who
	// was refused once carries the mark for the life of the card — they correct it, walk forward,
	// come back and empty the box, and the step reports a refusal for a press nobody made.
	it('forgets a refused press the donor walked away from', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.find('#amount-problem').hidden).toBe(false);

		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);
		dot(card, 1).click();
		type(card.find('#amount-entry'), '40');
		type(card.find('#amount-entry'), '');

		expect(card.find('.step:not([hidden])')).toBe(card.all('.step')[0]);
		expect(card.find('#amount-problem').hidden).toBe(true);
		expect(card.find('#amount-entry').hasAttribute('aria-invalid')).toBe(false);
		expect(card.text('[role="status"]')).toBe('');
	});

	// the sentence hangs off a `<fieldset>`, and the caret the refused press moves goes to a radio
	// inside one — a group's description is not reliably announced from a descendant, and a refusal
	// nobody hears is the same button silently doing nothing. so the region carries it, for the
	// same reason the failure screen's does: one channel that does not depend on how a given screen
	// reader treats a group.
	it('says the decisions a refused press was missing out loud', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();
		// the wait a press-driven sentence takes: it is said again on every press, and saying
		// something twice is a clear and a write a task apart (`#announce` in ./element.ts).
		await settle();

		expect(card.text('[role="status"]')).toBe(card.text('#amount-problem'));
	});

	// the second press is the whole of this one, and it is the same defect the review step's refusal
	// was given `repeated` for: a `role="status"` node handed the sentence it is already holding is
	// not a change, and nothing announces it. so the region is emptied and written again a task
	// later, which is the shortest gap assistive technology reads as two sentences rather than one.
	it('says the refusal again on a second press that moved nothing', async () => {
		const card = await mount();
		withdraw(card);
		card.find('[part~="action"]:not([part~="submit"])').click();
		await settle();
		const said = card.text('[role="status"]');

		expect(said).not.toBe('');

		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.text('[role="status"]')).toBe('');

		await settle();

		expect(card.text('[role="status"]')).toBe(said);
	});

	// the caret is already on the first missing decision, which is where the refused press put it.
	// a second press that moved it — off and back, or anywhere else — would take a donor mid-read
	// off what they were reading, so the press says its words again rather than moving anything.
	it('leaves the caret where the first refusal put it', async () => {
		const card = await mount();
		card.find('[part~="action"]:not([part~="submit"])').click();
		const landed = card.shadow.activeElement as HTMLElement;
		let refocused = 0;
		landed.addEventListener('focus', () => (refocused += 1));

		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.shadow.activeElement).toBe(landed);
		expect(refocused).toBe(0);
	});

	it('drops a sentence from what it says as soon as that decision is made', async () => {
		const card = await mount();
		card.find('[part~="action"]:not([part~="submit"])').click();
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);

		expect(card.text('[role="status"]')).toBe('');
	});

	it('says nothing at all once every decision the press asked for is made', async () => {
		const card = await mount();
		card.find('[part~="action"]:not([part~="submit"])').click();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);

		expect(card.text('[role="status"]')).toBe('');
	});

	// the note is the one decision on this step whose sentence is on the control itself rather than
	// on a group, and the refused press puts the caret on that control — so it is announced by
	// arriving there, and a copy on the region would be the same refusal twice.
	it('leaves the note’s own sentence to the field the caret lands on', async () => {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		press(card.all('.check-row [part~="checkbox"]')[0] as HTMLElement);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect(card.find('#note-problem').hidden).toBe(false);
		expect(card.shadow.activeElement).toBe(card.find('#note'));
		expect(card.text('[role="status"]')).toBe('');
	});

	it('reveals the note only when the donor asks for it', async () => {
		const card = await mount();
		const disclosure = card.all('.check-row [part~="checkbox"]')[0] as HTMLElement;

		expect(card.find('.note .disclosure-body').hidden).toBe(true);

		press(disclosure);

		expect(card.find('.note .disclosure-body').hidden).toBe(false);
	});

	// the tick and the field it reveals are one item on the step rather than two, so the step's own
	// rhythm falls above the pair instead of between them — a revealed field a whole step away from
	// the tick that revealed it reads as a second thing rather than as the disclosure opening.
	// "opens the field closer to its tick than the step keeps its own groups" in
	// ./styles/layout.browser.spec.ts is the gap itself, which a lightweight DOM cannot see.
	it('keeps the note under the tick that opens it', async () => {
		const card = await mount();
		const note = card.find('.step:not([hidden]) .note');

		expect(note.parentElement?.className).toBe('step');
		expect(Array.from(note.children).map((child) => child.className)).toEqual([
			'check-row',
			'disclosure-body'
		]);
	});

	it('carries the note through to the flow', async () => {
		const card = await mount();
		press(card.all('.check-row [part~="checkbox"]')[0] as HTMLElement);
		type(card.find('#note'), 'for the gala');
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		card.find('[part~="action"]:not([part~="submit"])').click();

		expect((card.find('#note') as HTMLTextAreaElement).value).toBe('for the gala');
	});
});

// the note is optional until the donor says otherwise, and ticking the box is them saying it. the
// tick is a value the flow holds — `note: ''` against an absent one — so which control is marked
// here is `state.missing`'s answer like every other refusal on this step, and never the checkbox's
// own `checked`.
describe('the note the donor asked to write', () => {
	/** the disclosure, which is the first of the card's two checkboxes. */
	function disclosure(card: Mounted): HTMLElement {
		return card.all('.check-row [part~="checkbox"]')[0] as HTMLElement;
	}

	/** the donor with a gift decided and the note opened, which is the whole of the refusal. */
	async function withNoteOpened(): Promise<Mounted> {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		press(disclosure(card));
		return card;
	}

	/** presses Continue, whichever step the card is on. */
	function proceed(card: Mounted): void {
		card.find('.step:not([hidden]) [part~="action"]:not([part~="submit"])').click();
	}

	it('says nothing about an empty note until a press has asked', async () => {
		const card = await withNoteOpened();

		expect(card.find('#note-problem').hidden).toBe(true);
		expect(card.find('#note').hasAttribute('aria-invalid')).toBe(false);
		expect(card.find('#note').getAttribute('part')).toBe('field');
	});

	it('refuses the press and marks the note the donor left blank', async () => {
		// the defect this pins: the press proceeds silently, carrying a note the donor asked to
		// write and never wrote.
		const card = await withNoteOpened();
		proceed(card);

		expect(card.all('.step')[0]?.hidden).toBe(false);
		expect(card.find('#note-problem').hidden).toBe(false);
		expect(card.text('#note-problem')).toBe('required, or untick to skip');
		expect(card.find('#note').getAttribute('part')).toBe('field invalid');
		expect(card.find('#note').getAttribute('aria-invalid')).toBe('true');
		expect(card.find('#note').getAttribute('aria-describedby')).toBe('note-problem');
		expect(card.shadow.activeElement).toBe(card.find('#note'));
	});

	it('counts a note of only whitespace as one nobody wrote', async () => {
		// the note is trimmed on the way to the endpoint, so a space is a press refused with the
		// field reading full — which is the silence this message exists to end.
		const card = await withNoteOpened();
		type(card.find('#note'), '   ');
		proceed(card);

		expect(card.all('.step')[0]?.hidden).toBe(false);
		expect(card.find('#note-problem').hidden).toBe(false);
	});

	it('carries a written note forward, exactly as the press always did', async () => {
		const card = await withNoteOpened();
		type(card.find('#note'), 'for the gala');
		proceed(card);

		expect(card.all('.step')[1]?.hidden).toBe(false);
	});

	it('leaves the note optional for a donor who never asked for one', async () => {
		// the word on the label is still true: an untouched note is a gift that proceeds, and the
		// tick is the only thing that makes it required.
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);

		expect(card.all('.step')[1]?.hidden).toBe(false);
	});

	it('names the note beside every other decision the press was refused for', async () => {
		// the amount step reports every decision it is missing at once, and the note is one of
		// them rather than a second press's worth of refusal.
		const card = await mount();
		withdraw(card);
		press(disclosure(card));
		proceed(card);

		expect(card.find('#amount-problem').hidden).toBe(false);
		expect(card.find('#note-problem').hidden).toBe(false);
		// and the caret lands on the first of them rather than on the last one marked. the box and
		// not a tile, because `withdraw` above leaves the other tile holding.
		expect(card.shadow.activeElement).toBe(card.find('#amount-entry'));
	});

	it('takes the mark off as the donor types, without waiting for a blur', async () => {
		// live from the refused press onward. a mark that waited for the field to be left is a
		// donor typing under a red edge that has nothing left to say.
		const card = await withNoteOpened();
		proceed(card);
		type(card.find('#note'), 'f');

		expect(card.find('#note-problem').hidden).toBe(true);
		expect(card.find('#note').getAttribute('part')).toBe('field');
		expect(card.find('#note').hasAttribute('aria-invalid')).toBe(false);
		expect(card.find('#note').hasAttribute('aria-describedby')).toBe(false);
	});

	it('clears the refusal when the donor unticks the box instead', async () => {
		// the other way out of it, and the one the message names: a donor who changes their mind
		// about writing anything is a donor with nothing left to fix.
		const card = await withNoteOpened();
		proceed(card);
		press(disclosure(card));

		expect(card.find('.note .disclosure-body').hidden).toBe(true);
		expect(card.find('#note-problem').hidden).toBe(true);
		expect(card.find('#note').getAttribute('part')).toBe('field');

		proceed(card);

		expect(card.all('.step')[1]?.hidden).toBe(false);
	});

	it('discards what was typed when the note is closed again', async () => {
		const card = await withNoteOpened();
		type(card.find('#note'), 'for the gala');
		press(disclosure(card));
		press(disclosure(card));

		expect((card.find('#note') as HTMLTextAreaElement).value).toBe('');
	});
});

// a gift given for somebody else. the second disclosure on this step and the same construction as
// the first, so what is asserted here is what is different: four boxes, and two pairings between
// them that the flow holds rather than the controls.
describe('the gift the donor dedicates', () => {
	/** the tribute's tick, which is the second of the amount step's two disclosures. */
	function tick(card: Mounted): HTMLElement {
		return card.all('.check-row [part~="checkbox"]')[1] as HTMLElement;
	}

	/** the press that opens and shuts the notify pair, which is the only way those two boxes are drawn. */
	function openNotify(card: Mounted): void {
		card.find('.tribute [part~="action-quiet"]').click();
	}

	/** the donor with a gift decided and the tribute opened. */
	async function withTributeOpened(): Promise<Mounted> {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		press(tick(card));
		return card;
	}

	it('reveals the block only when the donor asks for it, and sits like the note', async () => {
		// the pair of classes is the whole guarantee that the two disclosures cannot come to open
		// differently: one rule in ./styles/layout.css draws both, and this is what would fail if
		// the tribute grew a construction of its own.
		const card = await mount();
		const tribute = card.find('.step:not([hidden]) .tribute');

		expect(tribute.parentElement?.className).toBe('step');
		expect(Array.from(tribute.children).map((child) => child.className)).toEqual([
			'check-row',
			'disclosure-body'
		]);
		expect(card.find('.tribute .disclosure-body').hidden).toBe(true);

		press(tick(card));

		expect(card.find('.tribute .disclosure-body').hidden).toBe(false);
	});

	it('opens on a kind the select is already showing', async () => {
		// a two-member choice with no unset reading, so the control's resting state is an answer.
		// the flow is seeded with the same value, which is what stops the screen and the model
		// saying different things about one gift.
		const card = await withTributeOpened();
		const select = card.find('#tribute-kind') as HTMLSelectElement;

		expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
			['honor', 'In honor of'],
			['memory', 'In memory of']
		]);
		expect(select.value).toBe('honor');
	});

	it('says nothing about an unnamed honoree until a press has asked', async () => {
		// a donor who has just opened the block is not scolded for not having typed yet. the same
		// gate the note is under, and it is the step's own `asked` rather than a second one.
		const card = await withTributeOpened();

		expect(card.find('#tribute-honoree-problem').hidden).toBe(true);
		expect(card.find('#tribute-honoree').getAttribute('part')).toBe('field');
		expect(card.find('#tribute-honoree').hasAttribute('aria-invalid')).toBe(false);
	});

	it('refuses the press and marks the honoree the donor never named', async () => {
		const card = await withTributeOpened();
		proceed(card);

		expect(card.all('.step')[0]?.hidden).toBe(false);
		expect(card.find('#tribute-honoree-problem').hidden).toBe(false);
		expect(card.text('#tribute-honoree-problem')).toBe('required, or untick to skip');
		expect(card.find('#tribute-honoree').getAttribute('part')).toBe('field invalid');
		expect(card.find('#tribute-honoree').getAttribute('aria-invalid')).toBe('true');
		expect(card.find('#tribute-honoree').getAttribute('aria-describedby')).toBe(
			'tribute-honoree-problem'
		);
		expect(card.shadow.activeElement).toBe(card.find('#tribute-honoree'));
	});

	it('lets a donor who named nobody to tell straight through', async () => {
		// the case the pairing rule exists for and the easy one to get wrong: both boxes blank is a
		// donor who asked for nobody to be told, and it stops nothing.
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		proceed(card);

		expect(card.all('.step')[1]?.hidden).toBe(false);
	});

	// telling someone is a second decision inside the block, so it is offered as a press rather than
	// as two boxes a donor has to read past. nobody is told by default and blank boxes are how that
	// is said, so the boxes stay off the card until the press is made.
	it('offers the person to tell as a press, and draws no boxes until it is made', async () => {
		const card = await withTributeOpened();
		const opener = card.find('.tribute [part~="action-quiet"]');

		expect(opener.hidden).toBe(false);
		expect(opener.textContent).toBe('+ Notify recipient');
		expect(opener.getAttribute('aria-expanded')).toBe('false');
		expect(opener.getAttribute('aria-controls')).toBe('tribute-notify');
		expect(card.find('#tribute-notify').hidden).toBe(true);
	});

	it('opens the pair on that press and lands the caret in the first of the two', async () => {
		const card = await withTributeOpened();
		openNotify(card);
		const opener = card.find('.tribute [part~="action-quiet"]');

		expect(card.find('#tribute-notify').hidden).toBe(false);
		expect(opener.textContent).toBe('\u2212 Notify recipient');
		expect(opener.getAttribute('aria-expanded')).toBe('true');
		expect(card.shadow.activeElement).toBe(card.find('#tribute-notify-name'));
	});

	// and the way back out is the same control. blank on both boxes is what tells nobody, so the
	// press writes that rather than leaving a name in the draft behind a box nobody can see — a
	// recipient the endpoint would still be handed.
	it('takes the pair back on a second press, and the draft with it', async () => {
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		type(card.find('#tribute-notify-email'), 'james@example.org');
		openNotify(card);
		const opener = card.find('.tribute [part~="action-quiet"]');

		expect(card.find('#tribute-notify').hidden).toBe(true);
		expect(opener.textContent).toBe('+ Notify recipient');
		expect(opener.getAttribute('aria-expanded')).toBe('false');
		expect((card.find('#tribute-notify-name') as HTMLInputElement).value).toBe('');
		expect((card.find('#tribute-notify-email') as HTMLInputElement).value).toBe('');
	});

	// untaking the whole block takes the pair with it, which is the same shutting the second press
	// makes: the press is the only way the pair is ever asked for, and a donor who took the
	// dedication back asked for none of what was inside it. what would otherwise survive is a press
	// nothing on the card records — the block comes back on a re-tick with the pair still open, and
	// the boxes behind it still holding a recipient.
	it('shuts the pair when the donor unticks the block it stands in', async () => {
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		type(card.find('#tribute-notify-email'), 'james@example.org');
		press(tick(card));
		const opener = card.find('.tribute [part~="action-quiet"]');

		expect(card.find('#tribute-notify').hidden).toBe(true);
		expect(opener.textContent).toBe('+ Notify recipient');
		expect(opener.getAttribute('aria-expanded')).toBe('false');
		expect((card.find('#tribute-notify-name') as HTMLInputElement).value).toBe('');
		expect((card.find('#tribute-notify-email') as HTMLInputElement).value).toBe('');
		// and the block itself comes back shut on a re-tick rather than opening on the pair the
		// donor took back.
		press(tick(card));

		expect(card.find('#tribute-notify').hidden).toBe(true);
	});

	// and what leaves for the endpoint carries the dedication and no recipient. blank on both is
	// what `settle` (../value.ts) reads as `notify: null`, and `flatTribute` in ./checkout.machine.ts
	// sends the two fields only where that is not null — so a name still in the draft would arrive
	// on the request whatever the screen was showing.
	it('sends the dedication and no recipient once the pair is taken back', async () => {
		const posted: QuoteRequest[] = [];
		const card = await mount({
			ports: {
				quote: async (request) => {
					posted.push(request);
					return { paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 };
				}
			}
		});
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		press(tick(card));
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		type(card.find('#tribute-notify-email'), 'james@example.org');
		openNotify(card);
		proceed(card);
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		card.rail('card');
		card.find('[part~="submit"]').click();
		await settle();

		expect(posted).toHaveLength(1);
		expect(posted[0]?.tributeHonoree).toBe('Margaret Chen');
		expect(posted[0]?.tributeNotifyName).toBeUndefined();
		expect(posted[0]?.tributeNotifyEmail).toBeUndefined();
	});

	// the marks go with the values. a pair refused for half an answer and then taken back is not a
	// pair the donor still owes an answer for, so the step stops asking for it.
	it('clears a refusal on the pair when the donor takes it back', async () => {
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		proceed(card);

		expect(card.find('#tribute-notify-email-problem').hidden).toBe(false);

		openNotify(card);

		expect(card.find('#tribute-notify').hidden).toBe(true);
		expect(card.find('#tribute-notify-email-problem').hidden).toBe(true);
		expect(card.find('#tribute-notify-email').getAttribute('part')).toBe('field');

		proceed(card);

		expect(card.all('.step')[1]?.hidden).toBe(false);
	});

	it('refuses a person to tell who has a name and no address, and the other way round', async () => {
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		proceed(card);

		expect(card.all('.step')[0]?.hidden).toBe(false);
		expect(card.find('#tribute-notify-email-problem').hidden).toBe(false);
		expect(card.find('#tribute-notify-name-problem').hidden).toBe(true);
		expect(card.shadow.activeElement).toBe(card.find('#tribute-notify-email'));

		type(card.find('#tribute-notify-name'), '');
		type(card.find('#tribute-notify-email'), 'james@example.org');
		proceed(card);

		expect(card.all('.step')[0]?.hidden).toBe(false);
		expect(card.find('#tribute-notify-name-problem').hidden).toBe(false);
		expect(card.shadow.activeElement).toBe(card.find('#tribute-notify-name'));
	});

	it('refuses an address for the person to tell that is not one', async () => {
		// the mail goes to somebody who never gave us their address, on the domain every receipt
		// also leaves from — so a value that is plainly not an address is caught here rather than
		// becoming a bounce scored against that domain.
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		type(card.find('#tribute-notify-email'), 'james');
		proceed(card);

		expect(card.all('.step')[0]?.hidden).toBe(false);
		expect(card.find('#tribute-notify-email-problem').hidden).toBe(false);
	});

	it('clears the refusal when the donor unticks the box instead', async () => {
		// the other way out, and the one the message names. closing takes every one of the block's
		// decisions out of the set at once rather than clearing three marks by hand.
		const card = await withTributeOpened();
		proceed(card);
		press(tick(card));

		expect(card.find('.tribute .disclosure-body').hidden).toBe(true);
		expect(card.find('#tribute-honoree-problem').hidden).toBe(true);
		expect(card.find('#tribute-honoree').getAttribute('part')).toBe('field');

		proceed(card);

		expect(card.all('.step')[1]?.hidden).toBe(false);
	});

	it('discards every box when the tribute is closed again', async () => {
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		openNotify(card);
		type(card.find('#tribute-notify-name'), 'James Okonkwo');
		press(tick(card));
		press(tick(card));

		expect((card.find('#tribute-honoree') as HTMLInputElement).value).toBe('');
		expect((card.find('#tribute-notify-name') as HTMLInputElement).value).toBe('');
	});

	it('holds each box to the cap the endpoint holds it to', async () => {
		// the caps are the app's own `MAX_NAME` and `MAX_EMAIL`, restated in ../value.ts because
		// this package imports nothing from that app. set as the attribute, so a paste is truncated
		// where it happens rather than refused after the donor has moved on.
		const card = await withTributeOpened();

		openNotify(card);

		expect(card.find('#tribute-honoree').getAttribute('maxlength')).toBe('200');
		expect(card.find('#tribute-notify-name').getAttribute('maxlength')).toBe('200');
		expect(card.find('#tribute-notify-email').getAttribute('maxlength')).toBe('320');
		// never `required`: the pair is optional, and a browser refusing a blank one would refuse
		// exactly the donor the pairing rule exists to let through.
		expect((card.find('#tribute-notify-email') as HTMLInputElement).required).toBe(false);
		expect((card.find('#tribute-notify-email') as HTMLInputElement).type).toBe('email');
	});

	it('carries the whole block through to the flow and back', async () => {
		// what the donor opened survives a trip to the next step and back, holding what they typed
		// — the disclosure is the flow's answer rather than the checkbox's own `checked`.
		const card = await withTributeOpened();
		type(card.find('#tribute-honoree'), 'Margaret Chen');
		(card.find('#tribute-kind') as HTMLSelectElement).value = 'memory';
		card.find('#tribute-kind').dispatchEvent(new Event('change', { bubbles: true }));
		proceed(card);
		card.find('.step:not([hidden]) .step-dot')?.click();

		expect(card.find('.tribute .disclosure-body').hidden).toBe(false);
		expect((card.find('#tribute-honoree') as HTMLInputElement).value).toBe('Margaret Chen');
		expect((card.find('#tribute-kind') as HTMLSelectElement).value).toBe('memory');
	});
});

// where the gift goes, which a form either pins, offers a choice of, or does not carry at all. the
// three shapes are one config field (`Program` in ./v1.ts) and they draw three different cards.
describe('the cause a gift is credited to', () => {
	const CHOICE: Program = {
		mode: 'choice',
		options: [
			{ id: 'prg_water', name: 'Clean water' },
			{ id: 'prg_school', name: 'Schools' }
		]
	};
	const PINNED: Program = { mode: 'pinned', name: 'Clean water' };

	/** the picker, or `null` on a card that draws none. */
	function picker(card: Mounted): HTMLSelectElement | null {
		return card.shadow.querySelector('#program');
	}

	/** the receipt's own line, or `null` on a card that states no cause. */
	function line(card: Mounted): HTMLElement | null {
		return card.shadow.querySelector('.row.program');
	}

	/** the picker, operated the way a donor operates one. */
	function pick(card: Mounted, id: string): void {
		const select = picker(card) as HTMLSelectElement;
		select.value = id;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	}

	/** a donor at the review step of a form that offered them a choice, having made it or not. */
	async function reviewing(program: Program, id?: string): Promise<Mounted> {
		const card = await mount({ config: { ...CONFIG, program } });
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		if (id !== undefined) pick(card, id);
		proceed(card);
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		return card;
	}

	it('draws neither a picker nor a line on a form that carries no program', async () => {
		// the ordinary form, and the reason the whole block is drawn off the config rather than
		// hidden: a card with nothing to say about a cause has no line to leave blank.
		const card = await atReview();

		expect(picker(card)).toBeNull();
		expect(line(card)).toBeNull();
	});

	it('offers the org’s causes under the gift going where it is needed most', async () => {
		const card = await mount({ config: { ...CONFIG, program: CHOICE } });
		const select = picker(card) as HTMLSelectElement;

		expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
			['', 'Where it’s needed most'],
			['prg_water', 'Clean water'],
			['prg_school', 'Schools']
		]);
		// the resting option is an answer rather than a blank, so the card asks nothing of a donor
		// who leaves it alone.
		expect(select.value).toBe('');
	});

	it('stands under the amount and over the note, on the step the gift is decided on', async () => {
		// a fact about the gift, like the two disclosures under it, and asked for before the donor is
		// asked for anything about themselves.
		const card = await mount({ config: { ...CONFIG, program: CHOICE } });
		const step = card.all('.step')[0] as HTMLElement;

		expect(Array.from(step.children).map((child) => child.className)).toEqual([
			'step-head',
			'group',
			'group',
			'field-row program',
			'disclosure note',
			'disclosure tribute',
			''
		]);
	});

	it('draws no picker where the form is pinned to one cause', async () => {
		// there is nothing to ask: the pin is the form's, and the server writes it onto the gift.
		const card = await mount({ config: { ...CONFIG, program: PINNED } });

		expect(picker(card)).toBeNull();
	});

	it('names the pinned cause on the review step', async () => {
		const card = await reviewing(PINNED);

		expect(card.text('.row.program .row-label')).toBe('Program');
		expect(card.text('.row.program .program-name')).toBe('Clean water');
	});

	it('names the cause the donor chose on the review step', async () => {
		const card = await reviewing(CHOICE, 'prg_school');

		expect(card.text('.row.program .program-name')).toBe('Schools');
	});

	it('states where a gift with no cause chosen is going', async () => {
		// the same words the option carries, because it is the same answer — a blank line here would
		// read as a question the donor left unanswered.
		const card = await reviewing(CHOICE);

		expect(card.text('.row.program .program-name')).toBe('Where it’s needed most');
	});

	it('keeps the choice through a trip to the next step and back', async () => {
		const card = await mount({ config: { ...CONFIG, program: CHOICE } });
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		pick(card, 'prg_water');
		proceed(card);
		card.find('.step:not([hidden]) .step-dot')?.click();

		expect((picker(card) as HTMLSelectElement).value).toBe('prg_water');
	});
});

describe('the details step', () => {
	it('replaces the amount step rather than sitting under it', async () => {
		const card = await atDetailsStep();
		const steps = card.all('.step');

		expect(steps.map((step) => step.hidden)).toEqual([true, false, true, true]);
	});

	it('names itself and says how far through the donor is', async () => {
		// the words saying how many screens are left are what a donor who cannot see the marks is
		// told, and the heading is what focus lands on when the step arrives — so the two are one
		// block and the heading is described by the words rather than followed by them.
		const card = await atDetailsStep();
		const step = card.find('.step-details');

		expect(step.querySelector('.step-count')?.textContent).toBe('Step 2 of 3');
		expect(step.querySelector('[part~="heading"]')?.textContent).toBe('Your details');
		expect(step.querySelector('[part~="heading"]')?.getAttribute('aria-describedby')).toBe(
			step.querySelector('.step-count')?.id
		);
	});

	// fields only. the receipt, the total and the provider's own fields are all on the step after
	// this one, and a figure stated twice a screen apart is a figure a donor has to reconcile for
	// themselves.
	it('states no gift figure, no fee and no total', async () => {
		const card = await atDetailsStep();
		card.rail('card');

		expect(card.find('.step-details').contains(card.find('[part~="summary"]'))).toBe(false);
		expect(card.find('.step-details').contains(card.find('[part~="payment"]'))).toBe(false);
	});

	it('draws no wallet control, on a deployment that lists both wallets', async () => {
		// nothing in this package opens a wallet sheet, so a button for one would take a donor's
		// authorization and have nowhere to spend it. asserted on the config that lists them,
		// which is the only one on which the absence means anything.
		const card = await atDetailsStep({
			config: { ...CONFIG, paymentMethods: ['card', 'ach', 'apple_pay', 'google_pay'] }
		});

		expect(card.text('.step-details')).not.toContain('Apple Pay');
		expect(card.text('.step-details')).not.toContain('Google Pay');
	});

	it('leaves the contact consent unticked', async () => {
		// pre-ticked consent is not consent, and the liability lands on the deploying org.
		const card = await atDetailsStep();
		const consent = card.all('.check-row [part~="checkbox"]').at(-1) as HTMLInputElement;

		expect(consent.checked).toBe(false);
	});

	it('carries the donor’s details through to the flow', async () => {
		const card = await atDetailsStep();
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');

		expect((card.find('#email') as HTMLInputElement).value).toBe('donor@example.org');
		expect((card.find('#first-name') as HTMLInputElement).value).toBe('Ada');
	});

	it('goes back to the amount step without losing the decision', async () => {
		const card = await atDetailsStep();
		dot(card, 1).click();
		const steps = card.all('.step');

		expect(steps[0]?.hidden).toBe(false);
		expect(card.all('[part~="amount-option"]')[0]?.getAttribute('part')).toContain('selected');
	});
});

describe('the review step', () => {
	it('names itself and says how far through the donor is', async () => {
		const card = await atReview();
		const step = card.find('.step-give');

		expect(step.querySelector('.step-count')?.textContent).toBe('Step 3 of 3');
		expect(step.querySelector('[part~="heading"]')?.textContent).toBe('Review');
	});

	it('states the gift, the fee and the total on ruled lines', async () => {
		const card = await atReview();
		const figures = card.all('[part~="summary"] .figure').map((node) => node.textContent);

		expect(card.text('[part~="summary"] .row .row-label')).toBe('One-time gift');
		expect(figures).toEqual(['$25.00', '+ $1.06', '$26.06']);
	});

	// the total is the one figure on this card that moves without the screen changing and without
	// the caret moving: the fee decision rewrites it under a donor who is watching the switch they
	// just pressed. an `<output>` carries `role="status"`, so the new figure is announced off the
	// element itself rather than through an `aria-live` and an id this file would have to keep
	// pointing at it.
	it('states the total in an element that announces a figure that moves', async () => {
		const card = await atReview();

		expect(card.find('.row.total .figure').tagName).toBe('OUTPUT');
	});

	// and the two lines above it are not. a donor who moved the total would otherwise hear all three
	// numbers on a press that changed one, which is the row read out rather than the news in it.
	it('leaves the gift and the fee as figures that say nothing on their own', async () => {
		const card = await atReview();
		const quiet = card
			.all('[part~="summary"] .row:not(.total) .figure')
			.map((node) => node.tagName);

		expect(quiet).toEqual(['SPAN', 'SPAN']);
	});

	// the same node, rewritten. a region rebuilt on the patch is a region an assistive technology
	// meets as new rather than as changed, and the press that moved the money is the one press this
	// card has nothing else to tell a donor about.
	it('rewrites the total in place when the fee decision moves it', async () => {
		const card = await atReview();
		const total = card.find('.row.total .figure');
		expect(total.textContent).toBe('$26.06');

		press(card.find('.row.fee [part~="checkbox"]'));

		expect(total.textContent).toBe('$25.00');
	});

	// the one screen where the region is turned off. the correction screen states both figures
	// through the announcer — "It is now $26.50, not $26.06" — and the figure moving under that
	// sentence would be the new total read out twice, to the donor who has just been told it moved.
	it('goes quiet on the screen whose whole news is that the total moved', async () => {
		const corrected = await atCorrection();
		expect(corrected.find('.row.total .figure').getAttribute('aria-live')).toBe('off');

		const card = await atReview();

		expect(card.find('.row.total .figure').hasAttribute('aria-live')).toBe(false);
	});

	it('restates the money on the control that spends it', async () => {
		const card = await atReview();

		expect(card.text('[part~="submit"]')).toBe('Donate $26.06');
	});

	// the step shows nothing else the donor typed, so it says where the receipt is going and leaves
	// the mark for the details step as the way to change it.
	it('names the address the receipt is going to', async () => {
		const card = await atReview();

		expect(shows(card, '.step-give .aside')).toBe('Receipt to donor@example.org');
	});

	// the sentence renders on every screen that states a total, and this is the one where a
	// monthly donor would otherwise be charged having never been told the gift repeats.
	it('states the ongoing obligation beside the first charge', async () => {
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[1] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		card.rail('card');

		expect(shows(card, '.receipt-note')).toBe('Then $26.06 monthly until you cancel.');
	});

	it('says nothing about repeating on a gift that is given once', async () => {
		const card = await atReview();

		expect(shows(card, '.receipt-note')).toBe('');
	});

	// the fee is priced per rail, so the figure on the control has to follow the donor across the
	// provider's own picker. nothing on this card knows which rail that is except the report.
	it('reprices the gift when the provider says the donor moved to another rail', async () => {
		const card = await atReview();
		expect(card.text('[part~="submit"]')).toBe('Donate $26.06');

		card.rail('ach');

		expect(card.text('[part~="submit"]')).toBe('Donate $25.21');
	});

	// the rail is chosen inside the provider's own fields on this step, so every donor stands here
	// with none reported for as long as it takes them to fill those fields in. a row that priced
	// nothing until then is the fee decision asked with no number attached to either answer.
	it('prices the fee at the card rate before the provider reports a rail', async () => {
		const card = await atReviewBeforeRail();

		expect(card.find('.row.fee .figure').textContent).toBe('+ $1.06');
		expect(card.text('[part~="submit"]')).toBe('Donate $26.06');
	});

	// `null` is a real answer from the provider — a collapsed picker, or a selection this form does
	// not take — and it puts the row back where every donor found it rather than blanking it. the
	// figure the flow states is the one it would charge, and a donor who has chosen no rail is a
	// donor the card rate is the honest quote for.
	it('goes back to the card rate once the provider reports no rail', async () => {
		const card = await atReview();
		card.rail('ach');
		expect(card.find('.row.fee .figure').textContent).toBe('+ $0.21');

		card.rail(null);

		expect(card.find('.row.fee .figure').textContent).toBe('+ $1.06');
		expect(card.text('[part~="submit"]')).toBe('Donate $26.06');
	});

	// the display default is the first rail the deployment offers, in the order ./v1.ts lists them,
	// and a deployment that does not offer card must not be quoted at card's price. every rail but
	// ach settles as a card, so this is the one configuration where the default is visible.
	it('prices the default against the rails the deployment actually offers', async () => {
		const card = await atReviewBeforeRail({
			config: { ...CONFIG, paymentMethods: ['ach'] }
		});

		expect(card.find('.row.fee .figure').textContent).toBe('+ $0.21');
		expect(card.text('[part~="submit"]')).toBe('Donate $25.21');
	});

	// the provider's fields are mounted for the life of the card and its script arrives when it
	// arrives, so a report can land before the donor has reached the payment step. dropped there,
	// it is a rail the flow never hears about again — the provider re-reports only on a change.
	it('keeps a rail the provider reported before the donor reached the payment step', async () => {
		const card = await mount();
		card.rail('ach');
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);

		expect(card.text('[part~="submit"]')).toBe('Donate $25.21');
	});

	it('offers the fee decision only where the org made it optional', async () => {
		const card = await atReview();

		expect(card.find('.fee-decision').hidden).toBe(false);
	});

	// a control offering a decision states which way that decision is currently set, on itself. read
	// off the figure beside it instead, the setting is an inference from money — and the column is
	// empty on the reading where the donor has declined, which is exactly the setting a donor would
	// be inferring.
	it('states which way the fee decision is set, on the control itself', async () => {
		const card = await atReview();
		const box = card.find('.row.fee [part~="checkbox"]') as HTMLInputElement;

		expect(card.text('.fee-decision')).toBe('Cover the processing fee');
		expect(box.checked).toBe(true);
	});

	// what a decision does is on the card rather than in an accessible name, which a sighted donor
	// never reads. it is stated in both readings, because a donor declining is deciding where the fee
	// comes from rather than declining an extra — and both readings name the fee, because the money
	// is the whole of what the decision is about.
	it('names the fee and what the org receives in both readings of the decision', async () => {
		const card = await atReview();
		expect(shows(card, '.fee-note')).toBe(
			'You add $1.06 so Acme Relief Fund receives the full $25.00.'
		);

		press(card.find('.row.fee [part~="checkbox"]'));

		// the deducted fee is the opposite quantity from the one above and not a rearrangement of it:
		// 2.9% + 30c taken out of $25.00 is $1.03, where covering it costs the donor $1.06. neither
		// sentence calls its figure "the fee", because the two figures are different and a donor
		// reading both would see one named thing change price rather than change payer.
		expect(shows(card, '.fee-note')).toBe(
			'Acme Relief Fund pays $1.03 out of your gift and receives $23.97.'
		);
	});

	// the fee is priced per rail on both sides of the decision, so a donor who moves rails is told
	// what that did to the money either way round. ach at 0.8% and no flat charge is a different
	// number in both readings.
	it('reprices both readings when the donor moves to another rail', async () => {
		const card = await atReview();
		card.rail('ach');

		expect(shows(card, '.fee-note')).toBe(
			'You add $0.21 so Acme Relief Fund receives the full $25.00.'
		);

		press(card.find('.row.fee [part~="checkbox"]'));

		expect(shows(card, '.fee-note')).toBe(
			'Acme Relief Fund pays $0.20 out of your gift and receives $24.80.'
		);
	});

	// read out with the control rather than found by looking for it, the way a field's own sentence
	// is: the line is what the decision means, and a donor who hears the label alone hears a switch
	// with no consequence attached to it.
	it('ties that line to the control it is about', async () => {
		const card = await atReview();

		expect(card.find('.row.fee [part~="checkbox"]').getAttribute('aria-describedby')).toBe(
			card.find('.fee-note').id
		);
	});

	// the figure column is named once however the row is being read. while the row is a decision the
	// label beside it names the control rather than the money, so without this the figure is the one
	// number in the receipt standing next to nothing that says what it is.
	it('names the fee figure while the label beside it names the control', async () => {
		const card = await atReview();

		expect(shows(card, '.row.fee .vh')).toBe('Processing fee');
		expect(card.find('.row.fee > .row-label').hidden).toBe(true);
	});

	// and it goes off again with the figure it names. the name exists so the figure is not a bare
	// number in a list of named ones; where the column is empty there is no number for it to stand
	// beside, and a name read out over nothing is a figure the row never stated.
	it('takes the figure’s name off wherever the column is empty', async () => {
		const card = await atReview();

		press(card.find('.row.fee [part~="checkbox"]'));

		expect(card.find('.row.fee .figure').textContent).toBe('');
		expect(card.find('.row.fee .vh').hidden).toBe(true);
	});

	// the figure moves under a donor who is looking at the control they just pressed, so the new
	// total is the one thing on this card that has to be said as well as shown.
	it('says the new total out loud when the donor changes the decision', async () => {
		const card = await atReview();

		press(card.find('.row.fee [part~="checkbox"]'));
		await settle();

		expect(card.text('[role="status"]')).toBe('Total today is $25.00.');
	});

	// and says nothing where nothing moved. a config carrying no rule for the rail the row prices
	// against leaves both readings of the decision totalling the same figure — the box reports its
	// own new setting, and a live region repeating a total that did not change teaches a donor to
	// stop listening to it.
	it('says nothing out loud when the decision moves no money', async () => {
		const card = await atUnpricedReview();

		press(card.find('.row.fee [part~="checkbox"]'));
		await settle();

		expect(card.text('[role="status"]')).toBe('');
	});

	// the sentence belongs to the press that asked for it and to no patch after it. carried, the
	// total would be read out again on the next thing that happened to the card — here, the provider
	// reporting the donor moved to another rail.
	it('does not carry the total onto the next patch', async () => {
		const card = await atReview();
		press(card.find('.row.fee [part~="checkbox"]'));
		await settle();

		card.rail('ach');
		await settle();

		expect(card.text('[role="status"]')).toBe('');
	});

	// the box is a form control inside the card's form, so Enter on it implicitly submits — and the
	// default button on this step is the one that spends the money. a checkbox is operated with
	// Space, so the keystroke has nothing to do here and everything to do on the control it reaches.
	it('does not let Enter on the fee control reach the button that spends the money', async () => {
		const card = await atReview();
		const pressed = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

		card.find('.row.fee [part~="checkbox"]').dispatchEvent(pressed);

		expect(pressed.defaultPrevented).toBe(true);
	});

	// the control is the donor's whole way to decline the fee, and the two figures beside it are
	// what "decline" means: the row states no fee and the button that spends the money states the
	// gift alone. a press that lands on the flow and is never read back is a control that moves
	// money silently in one direction and not the other.
	it('takes the fee off the receipt and the total when the donor declines to cover it', async () => {
		const card = await atReview();
		expect(card.find('.row.fee .figure').textContent).toBe('+ $1.06');

		press(card.find('.row.fee [part~="checkbox"]'));

		expect(card.find('.row.fee .figure').textContent).toBe('');
		expect(card.text('[part~="submit"]')).toBe('Donate $25.00');
	});

	// the column holds what the donor pays, which is what every other figure in this receipt is: the
	// gift above it and the total under it are both money leaving the donor's account. a declined fee
	// adds nothing to that, so the column has nothing to add — and the row still says so, in the
	// switch that names the decision and the line under it that prices both sides of it.
	it('leaves the column empty for a fee the donor is not paying', async () => {
		const card = await atReview();

		press(card.find('.row.fee [part~="checkbox"]'));

		expect(card.find('.row.fee').hidden).toBe(false);
		expect(card.find('.row.fee .figure').textContent).toBe('');
		expect(card.text('.fee-decision')).toBe('Cover the processing fee');
		expect(shows(card, '.fee-note')).toBe(
			'Acme Relief Fund pays $1.03 out of your gift and receives $23.97.'
		);
	});

	// and back again, on the same control: a decision a donor can only make once is a decision they
	// cannot correct after reading what it did to the total.
	it('puts the fee back when the donor presses the same control again', async () => {
		const card = await atReview();
		const box = card.find('.row.fee [part~="checkbox"]') as HTMLInputElement;
		press(box);

		press(box);

		expect(box.checked).toBe(true);
		expect(card.find('.row.fee .figure').textContent).toBe('+ $1.06');
		expect(card.text('[part~="submit"]')).toBe('Donate $26.06');
	});

	// a config the form cannot price the rail from is a misconfiguration, and the decision is still
	// the donor's to make: the row keeps its control and states the setting, because a switch that
	// vanished with the figure would take a choice off the card over a rate nobody typed.
	it('still draws the decision where nothing on the card can price it', async () => {
		const card = await atUnpricedReview();

		expect(card.find('.row.fee').hidden).toBe(false);
		expect(card.find('.row.fee .figure').textContent).toBe('');
		expect(card.find('.row.fee .vh').hidden).toBe(true);
		expect((card.find('.row.fee [part~="checkbox"]') as HTMLInputElement).checked).toBe(true);
		expect(card.text('[part~="submit"]')).toBe('Donate $25.00');
	});

	// the line is held to the same rule as the figure. "receives the full $25.00" is true of the
	// decision at that moment and reads as false: the total beside it also says $25.00, so the only
	// thing on the row claiming anything is being added is the sentence saying it is.
	it('says nothing about what covering does where nothing priced it', async () => {
		const card = await atUnpricedReview();

		expect(shows(card, '.fee-note')).toBe('');
		expect(card.find('.row.fee [part~="checkbox"]').hasAttribute('aria-describedby')).toBe(false);
	});

	// the declined reading has a sentence that survives the missing price: it says where the fee
	// comes from rather than what it costs, and that holds with no figure to name.
	it('says where a declined fee comes from even where nothing priced it', async () => {
		const card = await atUnpricedReview();

		press(card.find('.row.fee [part~="checkbox"]'));

		expect(shows(card, '.fee-note')).toBe(
			'Acme Relief Fund pays the processing fee out of your $25.00.'
		);
	});

	// 2.5.3. a donor driving this form by voice says the words they can see, so the name has to be
	// those words — which it is structurally here, the box sitting inside the label that carries
	// them. the assertion is that nothing has since been written over the top of it.
	it('names the fee control with the words printed on it, in both states', async () => {
		const card = await atReview();
		const box = card.find('.row.fee [part~="checkbox"]');

		expect(box.closest('label')?.textContent).toBe('Cover the processing fee');
		expect(box.hasAttribute('aria-label')).toBe(false);
		press(box);
		expect(box.closest('label')?.textContent).toBe('Cover the processing fee');
		expect(box.hasAttribute('aria-label')).toBe(false);
	});

	it('drops the fee line once the press is past and there is no fee to state', async () => {
		// the row is a control while the donor is on this step and a statement of the money
		// afterwards. a donor who declined leaves nothing to state, so a row carried onto the next
		// screen would be a label with an empty column beside it and a control that does nothing.
		const card = await atReview({
			ports: {
				quote: async () => ({
					paymentToken: 'pi_1',
					feeMinor: 0,
					totalMinor: 2500,
					mandate: { text: 'By clicking, you authorize the debit of your account.' }
				})
			}
		});
		press(card.find('.row.fee [part~="checkbox"]'));
		card.find('[part~="submit"]').click();
		await settle();

		expect(card.find('.row.fee').hidden).toBe(true);
	});

	it('reports a working flow through aria-busy and a live region', async () => {
		const card = await atReview();

		// and carries the flag on no control that is not working. `aria-busy="false"` is the
		// default state written out, which is what `toggleAttribute` in ./views.ts exists to keep
		// off the tree — a card at rest with the attribute on every button reads as a card that
		// decided to say so.
		expect(card.all('[part~="action"]').some((node) => node.hasAttribute('aria-busy'))).toBe(false);

		card.find('[part~="submit"]').click();

		expect(card.find('[part~="submit"]').getAttribute('aria-busy')).toBe('true');
		expect(card.find('[role="status"]').getAttribute('aria-live')).toBe('polite');
		expect(card.text('[role="status"]')).toBe('Working on your gift.');
	});

	// the two are written in the same patch, so where the flag sits decides whether the words are
	// ever heard: `aria-busy` over a live region is an instruction to hold its changes back until it
	// clears, and a region marked busy at the moment it is given the words for the wait says nothing
	// at all. the mark belongs on the interior holding the steps, which is what is actually working.
	it('keeps the live region out of the subtree it marks busy', async () => {
		const card = await atReview();
		card.find('[part~="submit"]').click();

		expect(card.text('[role="status"]')).toBe('Working on your gift.');
		expect(card.find('[role="status"]').closest('[aria-busy="true"]')).toBeNull();
		expect(card.find('.card-body').getAttribute('aria-busy')).toBe('true');
	});

	// the press spans a mint and a charge with no screen between them, and the two are different
	// news to a donor who cannot see the spinner: one is a form being submitted, the other is money
	// moving.
	it('says the charge is happening once the mint is done, not the same four words twice', async () => {
		const card = await atReview({ ports: { confirm: () => new Promise(() => {}) } });
		card.find('[part~="submit"]').click();
		await settle();

		expect(card.text('[role="status"]')).toBe('Confirming your gift with your card issuer.');
	});

	it('goes back to the details step without losing what was typed', async () => {
		const card = await atReview();
		dot(card, 2).click();

		expect(card.all('.step').map((step) => step.hidden)).toEqual([true, false, true, true]);
		expect((card.find('#email') as HTMLInputElement).value).toBe('donor@example.org');
	});
});

// three marks on the head of every numbered step: where the donor is, and the way to every other
// step they may stand on. they are the only way back through the form, so they are controls in the
// accessibility tree rather than the ornament they were — each named for the screen it stands for,
// and each drawn as available or not from the flow's own answer.
describe('the step marks', () => {
	/** the marks on whichever numbered step is on screen. */
	function dots(card: Mounted): HTMLElement[] {
		return card.all('.step:not([hidden]) .step-dot');
	}

	/** which of those marks is the filled one, in the order they are drawn. */
	function filled(card: Mounted): boolean[] {
		return dots(card).map((node) => node.classList.contains('current'));
	}

	/**
	 * what each mark is called, which is the whole of what a donor who cannot see them is told.
	 *
	 * two sources because the marks are two kinds of object: the ones a donor may press are named by
	 * the words inside them, and the one they are standing on is a `role="img"` whose children are
	 * presentational, so its name can only come from the attribute.
	 */
	function names(card: Mounted): string[] {
		return dots(card).map((node) => node.getAttribute('aria-label') ?? node.textContent ?? '');
	}

	/**
	 * which marks the card is offering as somewhere to go, in the order they are drawn.
	 *
	 * a mark is offered when it is a control the flow would take: the one for the step the donor is
	 * standing on is neither, and reads here the way an unavailable one does.
	 */
	function offered(card: Mounted): boolean[] {
		return dots(card).map(
			(node) => node.tagName === 'BUTTON' && node.getAttribute('aria-disabled') !== 'true'
		);
	}

	it('draws one mark per step and fills the one the donor is on', async () => {
		const card = await mount();

		expect(dots(card)).toHaveLength(3);
		expect(filled(card)).toEqual([true, false, false]);
	});

	it('takes the donor to the step a mark stands for', async () => {
		const card = await atReview();

		dot(card, 1).click();

		expect(card.all('.step').map((step) => step.hidden)).toEqual([false, true, true, true]);
		expect(filled(card)).toEqual([true, false, false]);
	});

	it('takes a donor forward through a step they have already completed', async () => {
		// the marks are a way through the form in both directions, which is what makes them worth
		// more than the one-step control they replaced: a donor who went back to change a figure
		// returns to the receipt without walking the screen between.
		const card = await atReview();
		dot(card, 1).click();
		dot(card, 3).click();

		expect(card.find('.step-give').hidden).toBe(false);
	});

	it('moves nothing when the mark stands for a step the donor has not earned', async () => {
		const card = await mount();

		dot(card, 3).click();

		expect(card.all('.step').map((step) => step.hidden)).toEqual([false, true, true, true]);
	});

	// the flow decides and the mark says so; the two are one expression (`stepIsReachable` in
	// ./checkout.machine.ts), so a mark a donor is offered is a mark that moves them.
	it('draws a step it will not take the donor to as unavailable', async () => {
		const card = await mount();
		withdraw(card);
		expect(offered(card)).toEqual([false, false, false]);

		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		expect(offered(card)).toEqual([false, true, false]);
	});

	it('never draws a step behind the donor as unavailable', async () => {
		const card = await atReview();

		expect(offered(card)).toEqual([true, true, false]);
	});

	/**
	 * `aria-disabled` and never the attribute, and the reason is both halves of this component.
	 *
	 * `disabled` takes a control out of the tab order and out of most announcement, which on a step
	 * indicator loses the fact that the step exists at all — a donor would be told the form has two
	 * screens on the first one and three on the last. and the machine's own header bans it outright
	 * (./checkout.machine.ts): a rendering detail bounds nothing, and the guard on the
	 * transition is what actually refuses the press.
	 */
	it('leaves an unavailable mark in the tree and in the tab order', async () => {
		const card = await mount();
		withdraw(card);

		expect(dot(card, 2).hasAttribute('disabled')).toBe(false);
		expect(dot(card, 2).getAttribute('aria-disabled')).toBe('true');
		expect(dot(card, 2).hasAttribute('tabindex')).toBe(false);
	});

	// a name that is a bare number tells a donor arriving on the control out of context nothing
	// about where it goes, and these are reached by tab from anywhere on the step.
	//
	// the one the donor is standing on is named for the screen and nothing else. it is the third
	// place one head would otherwise say the same ordinal — after the count and the heading the
	// count describes — and it is the one that carries none of its weight: `aria-current` below
	// already says this is where the donor is, and a mark saying so is reached in context or not
	// at all.
	it('names every mark for the screen it stands for and where that falls', async () => {
		const card = await atDetailsStep();

		expect(names(card)).toEqual(['Your gift, step 1 of 3', 'Your details', 'Review, step 3 of 3']);
	});

	// the one the donor is standing on is a position rather than a control: pressing it would ask
	// the flow for the screen already in front of them.
	it('draws the current step as a mark rather than as a control', async () => {
		const card = await atDetailsStep();

		expect(dot(card, 2).tagName).toBe('SPAN');
		expect(dot(card, 2).getAttribute('aria-current')).toBe('step');
		expect(dot(card, 1).tagName).toBe('BUTTON');
		expect(dot(card, 1).hasAttribute('aria-current')).toBe(false);
	});

	// a role, so that all three marks are one kind of thing to move between. the two a donor may
	// press are buttons and the third is a bare `<span>` without this: a screen reader walking the
	// card by control finds two marks on a head that draws three, and the missing one is always
	// the step the donor is on.
	it('gives the mark the donor is standing on a role of its own', async () => {
		const card = await atDetailsStep();

		expect(dot(card, 2).getAttribute('role')).toBe('img');
		expect(dot(card, 2).getAttribute('aria-label')).toBe('Your details');
		// `img` takes its name from the author and makes its children presentational, so words left
		// inside it would be a name nothing reads.
		expect(dot(card, 2).textContent).toBe('');
	});

	// the heading is where focus lands on every step change, and the words under it are the whole
	// of what says how far through that arrival is.
	//
	// `hidden` rather than visually hidden, and it is the difference between saying it once and
	// saying it twice: read as loose text as well as through the reference, browse mode announces
	// the ordinal, then the heading, then the ordinal again. a description resolves out of a hidden
	// node — the reference is what includes it
	// (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-describedby)
	// — so the words are still there for the arrival that needs them.
	it('keeps the words describing the heading, out of the tree and reachable through it', async () => {
		const card = await atDetailsStep();
		const step = card.find('.step-details');

		expect(step.querySelector('.step-count')?.hasAttribute('hidden')).toBe(true);
		expect(step.querySelector('.step-count')?.classList.contains('vh')).toBe(false);
		expect(step.querySelector('.step-count')?.textContent).toBe('Step 2 of 3');
		expect(step.querySelector('[part~="heading"]')?.getAttribute('aria-describedby')).toBe(
			step.querySelector('.step-count')?.id
		);
	});

	it('gives the takeover no marks, because it is not a numbered step', async () => {
		const card = await atSubmitted();

		expect(card.find('.takeover').hidden).toBe(false);
		expect(dots(card)).toEqual([]);
	});
});

// Enter is how a donor who never touches a mouse finishes a text field, and the platform's own
// implicit submission is what carries it: it clicks the form's default button, which is the first
// submit button in the form in tree order
// (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission).
// so what is asserted here is the shape that makes that land on the right control — one form, one
// submit button at a time, and a submission that never becomes a navigation.
describe('the Enter key', () => {
	/** the card's own form, and there is one. */
	function form(card: Mounted): HTMLFormElement {
		return card.find('form') as HTMLFormElement;
	}

	/** every control Enter could reach from a text field on the screen the card is showing. */
	function reachable(card: Mounted): HTMLElement[] {
		return card.all('button[type="submit"]');
	}

	it('cancels the submission rather than letting the card navigate', async () => {
		// the card is embedded in a page it does not own. an uncancelled submission navigates that
		// page away from itself, mid-gift, to nowhere.
		const card = await mount();
		const submission = new Event('submit', { bubbles: true, cancelable: true });
		form(card).dispatchEvent(submission);

		expect(submission.defaultPrevented).toBe(true);
	});

	it('never lets the engine report validity in words of its own', async () => {
		// the fields carry `required` and `pattern` for the sentence they choose, and a validated
		// submission answers them with a browser bubble in the browser's language, drawn over a card
		// that says what is wrong in the org's.
		const card = await mount();

		expect(form(card).hasAttribute('novalidate')).toBe(true);
	});

	it('reaches the primary of the screen on the card and nothing behind it', async () => {
		const card = await mount();
		const onAmount = reachable(card);

		expect(onAmount).toHaveLength(1);
		expect(onAmount[0]).toBe(card.find('.step:not([hidden]) [part~="action"]'));

		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);
		const onDetails = reachable(card);

		expect(onDetails).toHaveLength(1);
		expect(onDetails[0]).toBe(card.find('.step:not([hidden]) [part~="action"]'));
	});

	it('reaches the control that spends the money on the step that spends it', async () => {
		const card = await atReview();
		const onGive = reachable(card);

		expect(onGive).toHaveLength(1);
		expect(onGive[0]).toBe(card.find('[part~="submit"]'));
	});

	it('reaches the takeover control that submits the gift', async () => {
		const card = await atCorrection();

		expect(reachable(card)).toEqual([primary(card)]);
	});

	/**
	 * a `<button>` in a form is a submit button unless it says otherwise, and the marks are three of
	 * them on every step.
	 *
	 * on the review step the form's default button is Donate, so a mark left at its default type
	 * would take Enter or Space — the two keys that press a focused button — and spend the money
	 * from a control that says it navigates.
	 */
	it('never lets a mark on the step head become the button Enter reaches', async () => {
		const card = await atReview();

		expect(card.all('.step:not([hidden]) .step-dot[type="button"]')).toHaveLength(2);
		expect(reachable(card)).toEqual([card.find('[part~="submit"]')]);
	});

	it('reaches nothing on a screen whose primary is not a submission', async () => {
		// "Try again" restarts a refused gift and spends nothing, so no keystroke on the card
		// presses it.
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});

		expect(shows(card, '.takeover > [part~="action"]')).toBe('Try again');
		expect(reachable(card)).toEqual([]);
	});
});

// what a lightweight DOM can and cannot see about this is measured rather than assumed: it
// implements `willValidate`, `checkValidity()` and the `validity` flags on a bare input inside a
// shadow root with no form owner, which is the whole of what the message selection reads. what it
// does not do is paint, so every assertion here is about the attribute a field carries and never
// about the colour it is drawn in — the `invalid` part token is the whole of what this pool can
// hold ./views.ts to. the paint that token produces is measured in ./styles/validity.browser.spec.ts.
// hiding a step hides the control that held focus, and focus falls to the document body with
// nothing announced. over three steps that would happen twice per gift, and again on every
// takeover — so the heading of the screen that arrives takes it, which is what `tabindex="-1"` on
// each of them is for.
describe('where focus goes when the screen changes', () => {
	it('takes no focus at all on the first paint, on a page it does not own', async () => {
		const card = await mount();

		expect(card.shadow.activeElement).toBeNull();
	});

	it('lands on the heading of the step the donor advanced to', async () => {
		const card = await atDetailsStep();

		expect(card.shadow.activeElement).toBe(card.find('.step-details [part~="heading"]'));
	});

	it('lands on the heading of the step the donor went back to', async () => {
		const card = await atDetailsStep();
		dot(card, 1).click();

		expect(card.shadow.activeElement).toBe(card.find('.step:not([hidden]) [part~="heading"]'));
	});

	it('lands on the heading of a takeover the flow arrived at', async () => {
		const card = await atSubmitted();

		expect(card.shadow.activeElement).toBe(card.find('.takeover [part~="heading"]'));
	});

	// the one screen change that is a whole new card. the press that asked for it took the control
	// holding focus off the page, so the caret would otherwise land on the host's own document.
	it('lands on the first step’s heading when the donor starts a second gift', async () => {
		const card = await atSubmitted();
		secondary(card).click();
		await settle();

		expect(card.shadow.activeElement).toBe(card.find('.step:not([hidden]) [part~="heading"]'));
		expect(card.shadow.activeElement?.textContent).toBe('Your gift');
	});

	// the two must not collide: a refused press changes no screen, so nothing moves focus off the
	// field the refusal put it on.
	it('leaves a refused press its own caret', async () => {
		const card = await atDetailsStep();
		proceed(card);

		expect(card.shadow.activeElement).toBe(card.find('#email'));
	});

	it('carries every step heading a tabindex, or the caret would have nowhere to land', async () => {
		const card = await mount();
		const headings = card.all('[part~="heading"]');

		expect(headings.length).toBeGreaterThan(0);
		expect(headings.every((node) => node.getAttribute('tabindex') === '-1')).toBe(true);
	});
});

// a card replaced is not a screen changed: the whole tree goes, and with it whatever node was
// holding the caret. the element takes the caret back if and only if it already had it — a press of
// ours is what took it away, and a boot that a changed attribute or a first connection asked for
// moved nobody's and must not move one on a page this element does not own.
describe('the caret across a reboot', () => {
	/** a boot that answers once and then never again, which is what leaves a loading card up. */
	function answersOnce(): FormRuntime['loadConfig'] {
		let reads = 0;
		return async () => {
			reads += 1;
			return reads === 1 ? CONFIG : new Promise<never>(() => {});
		};
	}

	// the skeleton is hidden from the accessibility tree and a host's own placeholder is theirs to
	// word, so the wait needs a node of this element's own for the caret to land on and announce.
	it('carries the wait on a heading the caret can land on', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });
		const heading = card.find('[part~="card"] h2');

		expect(heading.textContent).toBe('Loading the donation form.');
		expect(heading.getAttribute('tabindex')).toBe('-1');
		expect(heading.classList.contains('vh')).toBe(true);
		// and no `::part()` name on it. a host's own `::part(heading) { position: static }` would
		// bring a node that is meant to be heard and not seen onto the screen.
		expect(heading.hasAttribute('part')).toBe(false);
	});

	it('says the wait through the region on a boot that took no caret', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.shadow.activeElement).toBeNull();
		expect(card.text('[role="status"]')).toBe('Loading the donation form.');
	});

	// and never both. the caret landing on the heading announces the heading, so a copy on the
	// region is the same sentence read out twice.
	it('takes the caret onto the wait, and stays out of the region, when it held one', async () => {
		const card = await atSubmitted({ loadConfig: answersOnce() });
		secondary(card).click();

		expect(card.shadow.activeElement).toBe(card.find('[part~="card"] h2'));
		expect(card.text('[role="status"]')).toBe('Your gift went through.');
	});

	// without one, the card that cannot render is the one screen this element shows with no heading
	// on it at all, and a reader navigating by heading finds nothing where the form was. the
	// sentence is the heading rather than a heading being added above it: one node, and it reads
	// from its own content, so it needs no name of its own.
	it('heads the card that cannot render with the sentence itself', async () => {
		const card = await mount({ loadConfig: async () => ({ formId: 'frm_a8x2k9' }) });
		const heading = card.find('.unavailable');

		expect(heading.tagName).toBe('H2');
		expect(heading.getAttribute('tabindex')).toBe('-1');
		expect(card.all('.unavailable')).toHaveLength(1);
		// the fix stays behind it in reading order, and the way back behind that.
		expect(heading.nextElementSibling?.className).toBe('unavailable-fix');
		expect(card.find('.card-body > [part~="action"]').textContent).toBe('Try again');
	});

	it('takes the caret onto the card that cannot render, where the last card held it', async () => {
		let reads = 0;
		const card = await mount({
			loadConfig: async () => {
				reads += 1;
				throw new Error(reads === 1 ? 'The first read failed.' : 'The second read failed.');
			}
		});
		const retry = card.find('.card-body > [part~="action"]');
		// the press is what takes the node holding the caret off the page, which is the whole of the
		// condition — happy-dom moves focus on neither a click nor a `<button>`, so it is said here.
		retry.focus();
		retry.click();
		await settle();

		expect(card.text('.unavailable')).toBe('The second read failed.');
		expect(card.shadow.activeElement).toBe(card.find('.unavailable'));
		// and the region stayed out of it: the caret carries the sentence on this card, so a copy
		// there would be the same refusal twice.
		expect(card.text('[role="status"]')).toBe('The first read failed.');
	});

	it('leaves a caret it never had wherever the host page put it', async () => {
		const card = await mount({ loadConfig: answersOnce() });
		card.host.setAttribute('form', 'frm_other');

		expect(card.shadow.activeElement).toBeNull();
	});
});

describe('the details step’s refusals', () => {
	it('says nothing at all until a press has asked', async () => {
		// the timing is the product decision. a donor who has not yet pressed Continue is a donor
		// mid-form, and marking the email they have not reached is the form arguing with them.
		const card = await atDetailsStep();

		expect(card.find('#email-problem').hidden).toBe(true);
		expect(card.find('#email').hasAttribute('aria-invalid')).toBe(false);
		expect(card.find('#email').getAttribute('part')).toBe('field');
	});

	it('names the field it is missing rather than doing nothing when pressed', async () => {
		// the defect this pins: the press changes no snapshot, so nothing re-renders and the
		// donor sees no response to it at all.
		const card = await atDetailsStep();
		proceed(card);

		expect(card.find('#email-problem').hidden).toBe(false);
		expect(card.text('#email-problem')).toBe('required for your receipt');
		expect(card.text('#first-name-problem')).toBe('required');
		expect(card.find('#email').getAttribute('part')).toBe('field invalid');
		expect(card.find('#email').getAttribute('aria-invalid')).toBe('true');
	});

	it('stays on the step it refused rather than carrying the donor forward', async () => {
		const card = await atDetailsStep();
		proceed(card);

		expect(card.find('.step-details').hidden).toBe(false);
		expect(card.find('.step-give').hidden).toBe(true);
	});

	it('chooses the sentence from the rule the value broke', async () => {
		// `required` and `type="email"` are set from the projection and the engine says which of
		// them a value failed; the words stay ours, which is why `reportValidity()` is never
		// called — its bubble is drawn in the browser's language, not the page's.
		const card = await atDetailsStep();
		type(card.find('#email'), 'donor at example.org');
		proceed(card);

		expect(card.text('#email-problem')).toBe('not an email address');
	});

	it('ties each sentence to its own field with aria-describedby', async () => {
		const card = await atDetailsStep();
		proceed(card);
		const described = card.find('#email').getAttribute('aria-describedby') ?? '';

		expect(described).toBe('email-problem');
		expect(card.find('#last-name').getAttribute('aria-describedby')).toBe('last-name-problem');
		// what it points at, rather than only that it points somewhere: an id naming a node that is
		// hidden or empty is a field a reader is told has a description and hears nothing of.
		expect(card.find(`#${described}`).hidden).toBe(false);
		expect(card.text(`#${described}`)).toBe('required for your receipt');

		type(card.find('#email'), 'donor@example.org');

		// and it is taken off with the mark, so nothing points at a sentence that has gone quiet.
		expect(card.find('#email').hasAttribute('aria-describedby')).toBe(false);
	});

	it('moves the caret to the first field the press was refused for', async () => {
		// a refused press that leaves the caret where it was is a donor scrolling a card looking for
		// what happened — and it must not collide with the focus a screen change moves, which is why
		// a refusal changes no screen.
		const card = await atDetailsStep();
		type(card.find('#email'), 'donor@example.org');
		proceed(card);

		expect(card.shadow.activeElement).toBe(card.find('#first-name'));
	});

	it('takes the mark off a field the moment the donor fixes it', async () => {
		const card = await atDetailsStep();
		proceed(card);
		type(card.find('#email'), 'donor@example.org');

		expect(card.find('#email-problem').hidden).toBe(true);
		expect(card.find('#email').getAttribute('part')).toBe('field');
		expect(card.find('#email').hasAttribute('aria-invalid')).toBe(false);
		// and leaves the ones still missing where they are.
		expect(card.find('#first-name-problem').hidden).toBe(false);
	});

	it('refuses a name that is only spaces, and says so on the field', async () => {
		// `required` passes on a space and the flow trims before it counts one, so without the
		// pattern this is a press refused with every field reading clean — the caret dumped
		// somewhere and nothing on the card saying why.
		const card = await atDetailsStep();
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), '   ');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);

		expect(card.find('#first-name-problem').hidden).toBe(false);
		expect(card.text('#first-name-problem')).toBe('required');
		expect(card.find('#first-name').getAttribute('part')).toBe('field invalid');
		expect(card.shadow.activeElement).toBe(card.find('#first-name'));
		// and the control carries the same rule, so the engine refuses it too rather than leaving
		// this file as the only place the space is caught. the two are held to agreeing against a
		// real engine in ./styles/validity.browser.spec.ts.
		expect((card.find('#first-name') as HTMLInputElement).pattern).not.toBe('');
		expect((card.find('#last-name') as HTMLInputElement).pattern).not.toBe('');
	});

	it('marks what the flow refused rather than what the browser would have', async () => {
		// the two rules are not one rule, and this is the behaviour that follows from it: marking
		// from the control would put a red edge on an address the flow accepted and refuse a press
		// the flow allowed.
		//
		// the address is chosen for the engine this pool ships rather than for any browser. every
		// implementation of `type="email"` draws the line somewhere different — a lightweight DOM
		// refuses an accented domain outright, where a browser punycodes it into something it then
		// accepts, and each takes values the other does not. what is asserted below is only that
		// the two rules here disagree and that the flow's is the one that decides. a divergence a
		// real engine has, on a value a donor can type, is ./styles/validity.browser.spec.ts's to
		// measure, and it is a different value for exactly this reason.
		const card = await atDetailsStep();
		type(card.find('#email'), 'donor@exämple.de');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);

		// the premise, asserted rather than assumed: the engine and the flow disagree about it.
		expect((card.find('#email') as HTMLInputElement).checkValidity()).toBe(false);
		expect(card.find('#email-problem').hidden).toBe(true);
		expect(card.find('#email').getAttribute('part')).toBe('field');
		expect(card.find('#email').hasAttribute('aria-invalid')).toBe(false);
		// and the press was allowed: the flow's rule is the one that decided.
		expect(card.find('.step-give').hidden).toBe(false);
	});

	// one refusal, one channel. each sentence is tied to its own field and the refused press moves
	// the caret to the first of them, so arriving there is the announcement — a region saying the
	// same words in the same breath is the refusal read out twice (WCAG 4.1.3).
	it('leaves a refusal that moved the caret to the field the caret landed on', async () => {
		const card = await atDetailsStep();
		proceed(card);
		await settle();

		expect(card.shadow.activeElement).toBe(card.find('#email'));
		expect(card.find('#email').getAttribute('aria-describedby')).toBe('email-problem');
		expect(card.text('[role="status"]')).toBe('');
	});

	// the other half, and the press that has no other channel: the caret is already on the field the
	// refusal would send it to, so `focus()` announces nothing. that is every press after the first,
	// and in Safari on macOS — where a click focuses no button — a mouse donor's second press. every
	// sentence at once, the way the amount step says its own.
	it('says the refusal out loud on a press that moved no caret', async () => {
		const card = await atDetailsStep();
		proceed(card);
		await settle();

		expect(card.text('[role="status"]')).toBe('');

		proceed(card);
		await settle();

		expect(card.text('[role="status"]')).toBe(
			`${card.text('#email-problem')}, ${card.text('#first-name-problem')}, ${card.text('#last-name-problem')}`
		);
	});

	// and it stops saying it the moment the donor does anything but press again. a region reading
	// out the fields still to fill in while they are typing one is talking over them.
	it('goes quiet again as soon as the donor starts fixing what it named', async () => {
		const card = await atDetailsStep();
		proceed(card);
		proceed(card);
		await settle();

		expect(card.text('[role="status"]')).not.toBe('');

		type(card.find('#email'), 'donor@example.org');

		expect(card.find('#email-problem').hidden).toBe(true);
		expect(card.text('[role="status"]')).toBe('');
	});

	it('leaves the caret where the first refusal put it', async () => {
		const card = await atDetailsStep();
		proceed(card);
		const landed = card.shadow.activeElement as HTMLElement;
		let refocused = 0;
		landed.addEventListener('focus', () => (refocused += 1));

		proceed(card);

		expect(card.shadow.activeElement).toBe(landed);
		expect(refocused).toBe(0);
	});

	it('forgets a refusal the donor walked away from', async () => {
		// the marks belong to a press, and coming back to the step is not one. a donor met by an
		// email in red before they have pressed anything on this visit is a form arguing with them
		// about a field they were already going to fill in.
		const card = await atDetailsStep();
		proceed(card);

		expect(card.find('#email').getAttribute('part')).toBe('field invalid');

		dot(card, 1).click();
		proceed(card);

		expect(card.find('.step-details').hidden).toBe(false);
		expect(card.find('#email').getAttribute('part')).toBe('field');
		expect(card.find('#email-problem').hidden).toBe(true);
		expect(card.find('#email').hasAttribute('aria-invalid')).toBe(false);
	});

	it('carries the platform’s own rules on the fields it asks for', async () => {
		// the rules the projection sets do three jobs and none of them is the paint: the keyboard a
		// phone offers, the `validity` read that chooses which sentence a marked field shows, and a
		// second gate under `completePayer` (./value.ts). the attribute reaching the control is
		// what every one of them rests on.
		const card = await atDetailsStep();
		proceed(card);

		expect((card.find('#email') as HTMLInputElement).required).toBe(true);
		expect((card.find('#email') as HTMLInputElement).type).toBe('email');
		expect((card.find('#first-name') as HTMLInputElement).required).toBe(true);
		expect((card.find('#last-name') as HTMLInputElement).required).toBe(true);
	});

	it('says which field is optional rather than decorating the ones that are not', async () => {
		// a donor who learns a field was required by being refused for it learnt it too late
		// (WCAG 3.3.2). the card says it the other way round: the two disclosures are the things on
		// it nobody has to fill in and the only controls that carry a mark, so an unmarked field is
		// one the form needs. the marker is visible — a `vh` one would say it to a reader and not
		// to the donor who is looking at the card.
		//
		// every mark is on a tick that opens a block, and none is on a box inside one: a word
		// qualifying the ask covers everything the ask reveals, and repeating it under the tick
		// would be the card saying the same thing about the same block twice.
		const card = await mount();

		expect(card.all('.optional').map((mark) => mark.closest('.check-row')?.textContent)).toEqual([
			'Add a note (optional)',
			'Dedicate this gift (optional)'
		]);
	});
});

describe('the review step’s one refusal', () => {
	it('says nothing at all until a press has asked', async () => {
		const card = await atReview();

		expect(card.find('#payment-problem').hidden).toBe(true);
	});

	it('tells a donor with no usable rail that the payment details are what is missing', async () => {
		// the provider's fields are in a frame on its own origin and no `checkValidity()` reaches
		// them, so an unfinished card arrives here as a rail this control cannot charge. without
		// this branch the press is a button that does nothing.
		const card = await atReview();
		card.rail(null);
		card.find('[part~="submit"]').click();

		expect(card.find('#payment-problem').hidden).toBe(false);
		expect(card.shadow.activeElement).toBe(card.find('[part~="payment"]'));
	});

	it('says the payment refusal on the box the caret lands on, and on the region as well', async () => {
		// the box is where the refused press puts the caret and it carries the sentence itself, by a
		// role, a name and `aria-describedby`. the region carries it too, because the caret landing
		// is not something this element can rely on: Safari on macOS focuses no button on a click, so
		// a mouse donor's second press re-focuses a box the caret is already on. `aria-invalid` is
		// deliberately absent: `group` does not support it.
		const card = await atReview();
		card.rail(null);
		card.find('[part~="submit"]').click();
		const box = card.find('[part~="payment"]');
		await settle();

		expect(box.getAttribute('role')).toBe('group');
		expect(box.getAttribute('aria-label')).toBe('Payment details');
		expect(box.getAttribute('aria-describedby')).toBe('payment-problem');
		expect(box.hasAttribute('aria-invalid')).toBe(false);
		expect(card.shadow.activeElement).toBe(box);
		expect(card.text('#payment-problem')).toBe('required');
		expect(card.text('[role="status"]')).toBe('required');
	});

	// the second press is the whole of this one. a `role="status"` node handed the sentence it is
	// already holding is not a change, and nothing announces it — so the region is emptied and
	// written again a task later, which is the shortest gap assistive technology reads as two
	// sentences rather than one.
	it('says the refusal again on a press that moved nothing', async () => {
		const card = await atReview();
		card.rail(null);
		card.find('[part~="submit"]').click();
		await settle();

		expect(card.text('[role="status"]')).toBe('required');

		// the caret is already on the box, which is where a Safari donor's second press finds it.
		card.find('[part~="payment"]').focus();
		card.find('[part~="submit"]').click();

		expect(card.text('[role="status"]')).toBe('');

		await settle();

		expect(card.text('[role="status"]')).toBe('required');
	});

	it('clears the payment sentence once the provider reports a rail it can charge', async () => {
		const card = await atReview();
		card.rail(null);
		card.find('[part~="submit"]').click();
		card.rail('card');

		expect(card.find('#payment-problem').hidden).toBe(true);
		expect(card.find('[part~="payment"]').hasAttribute('aria-describedby')).toBe(false);
		expect(card.text('[role="status"]')).toBe('');
	});

	it('reads a rail the deployment does not offer as no rail this control may charge', async () => {
		// the config's own list is the gate `completePayer` keeps, and a rail outside it is a report
		// from nowhere — a refusal with nothing named is the silence this whole block exists to end.
		const card = await atReview();
		card.rail('google_pay');
		card.find('[part~="submit"]').click();

		expect(card.find('#payment-problem').hidden).toBe(false);
	});

	it('does not read a second press during a charge as a refusal', async () => {
		// `quoting` projects as `working` on both sides of the press, so a guard comparing only
		// "did the step change" reads a dropped second press as a refused first one — and marks a
		// card the flow is already charging.
		const card = await atReview({ ports: { quote: () => new Promise<never>(() => {}) } });
		card.find('[part~="submit"]').click();
		await settle();
		card.find('[part~="submit"]').click();

		expect(card.find('[part~="submit"]').getAttribute('aria-busy')).toBe('true');
		expect(card.find('#payment-problem').hidden).toBe(true);
	});

	it('forgets a refusal the donor walked away from', async () => {
		const card = await atReview();
		card.rail(null);
		card.find('[part~="submit"]').click();

		expect(card.find('#payment-problem').hidden).toBe(false);

		dot(card, 2).click();
		proceed(card);

		expect(card.find('.step-give').hidden).toBe(false);
		expect(card.find('#payment-problem').hidden).toBe(true);
	});
});

describe('the refusal a retried gift carries back to the payment box', () => {
	it('leaves the reason the rail gave on the box the retry lands at', async () => {
		// the defect this pins: the decline is on the takeover, `RETRY` routes back to the review
		// step, and the entry there clears the failure (`beginAttempt` in ./checkout.machine.ts) —
		// so the donor arrives at the payment box with nothing on the card saying the card was
		// refused. from where they are sitting the press did nothing.
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});
		primary(card).click();
		await settle();

		expect(card.find('.step-give').hidden).toBe(false);
		expect(card.find('#payment-problem').hidden).toBe(false);
		expect(card.text('#payment-problem')).toBe('Your card was declined.');
		expect(card.find('[part~="payment"]').getAttribute('aria-describedby')).toBe('payment-problem');
	});

	// the node is written only on the step it belongs to, rather than written everywhere and kept
	// off the screen by the step around it being hidden. a sentence drawn on a screen nobody is
	// looking at is one `hidden` attribute away from being read out on it.
	it('writes nothing on the payment box while a takeover holds the card', async () => {
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});

		expect(card.text('#payment-problem')).toBe('');
		expect(card.find('#payment-problem').hidden).toBe(true);
		expect(card.find('[part~="payment"]').hasAttribute('aria-describedby')).toBe(false);
	});

	it('does not carry the reason onto the screen the second attempt succeeds on', async () => {
		// the takeover is patched from its descriptor with no node conditional on which screen is
		// painted (`paintTakeover` in ./views.ts), and the sentence carried onto the review step is
		// held to the same rule: a refusal that outlived the gift it belonged to would be a decline
		// printed under "Thank you".
		let attempts = 0;
		const card = await atSubmitted({
			ports: {
				confirm: async () => {
					attempts += 1;
					return attempts === 1
						? ({ kind: 'declined', message: 'Your card was declined.' } as const)
						: ({ kind: 'succeeded' } as const);
				}
			}
		});
		primary(card).click();
		await settle();
		card.find('[part~="submit"]').click();
		await settle();

		expect(shows(card, '.takeover [part~="heading"]')).toBe('Thank you');
		expect(shows(card, '.takeover .message')).toBe('');
		expect(card.find('#payment-problem').hidden).toBe(true);
	});

	// the ten transitions into `failed` that are not an issuer saying no. the port that mints the
	// intent rejected, so nothing here is a report about the donor's card — and a sentence in the
	// payment box would read as one, over fields they can retype all day without changing the
	// answer. it carries no `fix` either, which is why an absent one cannot be what tells the two
	// apart (`toFailure` in ./checkout.machine.ts).
	it('leaves the box silent when the gift failed for something the rail never saw', async () => {
		const card = await atReview({
			ports: {
				quote: async () => {
					throw new Error('This form is not accepting donations right now.');
				}
			}
		});
		card.find('[part~="submit"]').click();
		await settle();

		expect(shows(card, '.takeover .message')).toBe(
			'This form is not accepting donations right now.'
		);

		primary(card).click();
		await settle();

		expect(card.find('.step-give').hidden).toBe(false);
		expect(card.text('#payment-problem')).toBe('');
		expect(card.find('#payment-problem').hidden).toBe(true);
		expect(card.find('[part~="payment"]').hasAttribute('aria-describedby')).toBe(false);
	});
});

describe('the correction screen', () => {
	it('takes the whole card and leaves no step under it', async () => {
		const card = await atCorrection();
		const steps = card.all('.step');

		expect(steps.map((step) => step.hidden)).toEqual([true, true, true, false]);
	});

	// not "Confirm your gift". the donor pressed Donate on the step behind this screen and believes
	// they have already confirmed; a heading that asked again reads as the form having lost the
	// press rather than as the figure having moved.
	it('names the thing that happened rather than asking for a confirmation again', async () => {
		const card = await atCorrection();

		expect(card.text('.takeover [part~="heading"]')).toBe('The total changed');
	});

	it('is the receipt, at the size the money is consented to', async () => {
		const card = await atCorrection();

		expect(card.find('[part~="summary"]').parentElement?.className).toBe('receipt-slot');
		expect(card.text('.row.total .row-label')).toBe('Charged today');
		expect(card.text('.row.total .figure')).toBe('$26.50');
	});

	it('carries the same receipt node it had on the review step', async () => {
		// the claim the moved node makes: the total being authorized is recognisably the total just
		// seen, which a second block rendered from the same numbers would not be.
		const card = await atReview({
			ports: { quote: async () => ({ paymentToken: 'pi_1', feeMinor: 150, totalMinor: 2650 }) }
		});
		const before = card.find('[part~="summary"]');
		card.find('[part~="submit"]').click();
		await settle();

		expect(card.find('[part~="summary"]')).toBe(before);
	});

	it('restates the authoritative total on the control that authorizes it', async () => {
		// a different verb from the press that reached here, and the aside is why: it says "since
		// you pressed Donate", which names a control that has to still be the one on the step
		// behind this screen.
		const card = await atCorrection();

		expect(card.text('.takeover > [part~="submit"]')).toContain('Give $26.50');
	});

	it('names both figures, because a silent correction is worse than never estimating', async () => {
		const card = await atCorrection();

		expect(shows(card, '.takeover .aside')).toBe(
			'The total changed since you pressed Donate. It is now $26.50, not $26.06.'
		);
		expect(card.find('.row.total .figure').hasAttribute('data-changed')).toBe(true);
	});

	// always. this screen is reached only where the figure moved, so its existence is the news and
	// there is no match left for an announcement to stay quiet on.
	it('announces the change rather than leaving it to be noticed', async () => {
		const card = await atCorrection();

		expect(card.text('[role="status"]')).toBe(shows(card, '.takeover .aside'));
	});

	it('echoes the rail the gift is about to go down', async () => {
		const card = await atCorrection();

		expect(shows(card, '.takeover .aside ~ .aside')).toBe('Paying by Card');
	});

	// the receipt is one node that travels, so anything inside it that only works on one screen
	// has to be taken off on the others. the flow answers no fee decision past the review step, so
	// what is left is the ledger reading of the same row: the fee as an entry in the account.
	it('carries no fee control onto a screen that could not act on one', async () => {
		const card = await atCorrection();

		expect(card.find('.fee-decision').hidden).toBe(true);
		expect(card.find('.fee-note').hidden).toBe(true);
		expect(shows(card, '.row.fee > .row-label')).toBe('Processing fee');
		expect(card.find('.row.fee .figure').textContent).toBe('+ $1.50');
	});

	// the step behind this screen is the payment step, so a control naming the amount would send a
	// donor looking for a figure they cannot change there.
	it('goes back to the review step, and names the thing they can change on it', async () => {
		const card = await atCorrection();

		expect(secondary(card).textContent).toBe('Change payment method');

		secondary(card).click();

		expect(card.all('.step').map((step) => step.hidden)).toEqual([true, true, false, true]);
	});

	it('states the ongoing obligation in the same block as the first charge', async () => {
		const card = await mount({
			ports: { quote: async () => ({ paymentToken: 'pi_1', feeMinor: 150, totalMinor: 2650 }) }
		});
		press(card.all('[part~="frequency-option"] input')[1] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		card.rail('card');
		card.find('[part~="submit"]').click();
		await settle();

		expect(shows(card, '.receipt-note')).toBe('Then $26.50 monthly until you cancel.');
	});

	it('stays on the correction screen while the confirmation is in flight', async () => {
		// the flow collapses confirming into the same `working` a quote is, so a projection that
		// read it literally would drop the donor back onto the payment form mid-press.
		const card = await atCorrection({ ports: { confirm: () => new Promise(() => {}) } });
		primary(card).click();
		const steps = card.all('.step');

		expect(steps.map((step) => step.hidden)).toEqual([true, true, true, false]);
		expect(primary(card).getAttribute('part')).toContain('busy');
	});

	it('sets no disabled attribute on the control that authorizes the money', async () => {
		const card = await atCorrection({ ports: { confirm: () => new Promise(() => {}) } });
		primary(card).click();

		expect(card.all('[disabled]')).toEqual([]);
	});

	// the gifts a rule keyed off the estimate would have stopped on this screen forever: a donor
	// charged the figure on the button is a donor with nothing to correct, however that figure was
	// arrived at — and declining the fee is the ordinary way to arrive at one with no estimate
	// behind it.
	it('is never reached where the charge is the figure the donor pressed', async () => {
		const matched = await atSubmitted();
		const declined = await atReview({
			ports: { quote: async () => ({ paymentToken: 'pi_1', feeMinor: 0, totalMinor: 2500 }) }
		});
		press(declined.find('.row.fee [part~="checkbox"]'));
		declined.find('[part~="submit"]').click();
		await settle();

		expect(matched.text('.takeover [part~="heading"]')).toBe('Thank you');
		expect(declined.text('.takeover [part~="heading"]')).toBe('Thank you');
	});
});

describe('the mandate', () => {
	const MANDATE = {
		paymentToken: 'pi_1',
		feeMinor: 106,
		totalMinor: 2606,
		mandate: { text: 'By clicking, you authorize the debit of your account.' }
	};

	it('renders the provider’s own wording, verbatim', async () => {
		const card = await atSubmitted({ ports: { quote: async () => MANDATE } });

		expect(card.text('.mandate')).toBe('By clicking, you authorize the debit of your account.');
	});

	it('names the act as an authorization rather than as a gift', async () => {
		const card = await atSubmitted({ ports: { quote: async () => MANDATE } });

		expect(card.text('.takeover > [part~="submit"]')).toContain('Authorize $26.06');
		expect(shows(card, '.takeover > [part~="submit"] ~ .aside')).toContain('Acme Relief Fund');
	});

	it('never gates the control on having scrolled the wording', async () => {
		// the provider requires the wording be displayed beside an affirmative act, and pressing
		// the button is that act. requiring a scroll first is a keyboard trap.
		const card = await atSubmitted({ ports: { quote: async () => MANDATE } });

		expect(card.all('[disabled]')).toEqual([]);
		expect(card.find('.mandate').getAttribute('tabindex')).toBe('0');
	});

	// the tab stop above is what makes this necessary. a focusable `<div>` is a generic with no name,
	// so a keyboard donor lands in the one block on the card they are being asked to agree to and
	// hears nothing at all. `group` rather than `region`: a region is a landmark, and this component
	// is inside somebody else's page
	// (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/group_role).
	it('names the wording well that the caret can land in', async () => {
		const card = await atSubmitted({ ports: { quote: async () => MANDATE } });
		const well = card.find('.mandate');

		expect(well.getAttribute('role')).toBe('group');
		expect(well.getAttribute('aria-label')).toBe('Payment authorization');
	});

	it('returns to the review step when the donor declines, rather than failing', async () => {
		// refusing to authorize a debit is a change of rail, not an error — and the picker is the
		// provider's own fields, which are on the review step.
		const card = await atSubmitted({ ports: { quote: async () => MANDATE } });
		secondary(card).click();
		const steps = card.all('.step');

		expect(steps.map((step) => step.hidden)).toEqual([true, true, false, true]);
	});
});

describe('the verification screens', () => {
	const deadline = 1_700_000_000_000 + 10 * 24 * 60 * 60 * 1000;
	const awaiting = {
		confirm: async () => ({ kind: 'awaiting_microdeposits' as const, expiresAt: deadline })
	};

	it('states the deadline as a date rather than as a window', async () => {
		// the donor may read this page days after it was painted, by which point "within 10 days"
		// names nothing they can check.
		const card = await atSubmitted({ ports: awaiting });

		expect(shows(card, '.attention')).toMatch(/\b20\d{2}\b/);
		expect(shows(card, '.attention')).not.toMatch(/\bdays\b/);
	});

	it('keeps the receipt in future tense and says nothing has been taken', async () => {
		const card = await atSubmitted({ ports: awaiting });

		expect(card.text('.row.total .row-label')).toBe('To be charged');
		expect(shows(card, '.receipt-note')).toBe('Nothing has been charged yet.');
		expect(card.text('.row.total .figure')).toBe('$26.06');
	});

	it('reads as a task rather than as a failure', async () => {
		const card = await atSubmitted({ ports: awaiting });

		expect(card.text('.takeover [part~="heading"]')).toBe('Check your bank account');
		expect(card.find('.message').hidden).toBe(true);
	});

	it('offers a fresh start once the window has closed', async () => {
		const card = await atSubmitted({
			ports: { confirm: async () => ({ kind: 'verification_expired' as const }) }
		});

		expect(shows(card, '.takeover > [part~="action"]')).toBe('Start again');

		primary(card).click();
		const steps = card.all('.step');

		expect(steps.map((step) => step.hidden)).toEqual([true, true, false, true]);
	});
});

describe('the endings', () => {
	it('thanks the donor and keeps the record of what happened', async () => {
		const card = await atSubmitted();

		expect(card.text('.takeover [part~="heading"]')).toBe('Thank you');
		expect(card.find('.receipt-slot').hidden).toBe(false);
		expect(card.text('.row.total .row-label')).toBe('Charged today');
		// the only ending with a way back to the first step. it is the quiet control, because this
		// donor is owed no act — the loud one on the two recovery screens is a repair.
		expect(shows(card, '.takeover > [part~="action-quiet"]')).toBe('Back to start');
		expect(primary(card).hidden).toBe(true);
	});

	it('starts a second gift on an empty form rather than on the last one', async () => {
		// the way back is a fresh boot rather than a state on the flow: a payment provider's own
		// fields still hold the card the donor entered and the challenge token is spent, and only a
		// boot rebuilds either. it is also why nothing is carried over — this form is embedded on
		// pages nobody here can see, including shared ones, and a name and email left on the screen
		// belong to the donor who has already gone.
		const card = await mount();
		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		type(card.find('#amount-entry'), '25');
		proceed(card);
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		card.rail('card');
		card.find('[part~="submit"]').click();
		await settle();
		// the gift landed, rather than any other ending: this control is on one screen only.
		expect(card.text('.takeover [part~="heading"]')).toBe('Thank you');

		secondary(card).click();
		await settle();

		expect(card.all('.step').map((step) => step.hidden)).toEqual([false, true, true, true]);
		// the free entry is never written from the projection, so a figure that survived a rebuilt
		// card would be the last donor's amount on this one's form.
		expect((card.find('#amount-entry') as HTMLInputElement).value).toBe('');
		expect((card.find('#email') as HTMLInputElement).value).toBe('');
		expect(card.find('.receipt-slot').hidden).toBe(true);
	});

	it('keeps the sentence a refusal carried', async () => {
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});

		expect(shows(card, '.takeover .message')).toBe('Your card was declined.');
		expect(shows(card, '.takeover > [part~="action"]')).toBe('Try again');
	});

	// one sentence, delivered once, and the region is the channel it goes down. the node on the card
	// carries no `role="alert"` of its own: a refusal announced from both is the same decline read
	// out twice to the donor least able to skip past it.
	it('says a refusal through the region rather than a live region of its own', async () => {
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});

		expect(card.text('[role="status"]')).toBe('Your card was declined.');
		expect(card.shadow.querySelectorAll('[role="alert"]')).toHaveLength(0);
	});

	// the two screens below are why the region rather than the card carries it: both are reached
	// from a takeover rather than from a numbered step, so the screen does not change, the caret does
	// not move, and the heading whose text is replaced under an already-focused node is announced to
	// nobody.
	it('says a decline that answered the correction screen', async () => {
		const card = await atCorrection({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});
		primary(card).click();
		await settle();

		expect(shows(card, '.takeover .message')).toBe('Your card was declined.');
		expect(card.text('[role="status"]')).toBe('Your card was declined.');
	});

	it('says a decline that answered the mandate', async () => {
		const card = await atSubmitted({
			ports: {
				quote: async () => ({
					paymentToken: 'pi_1',
					feeMinor: 106,
					totalMinor: 2606,
					mandate: { text: 'By clicking, you authorize the debit of your account.' }
				}),
				confirm: async () => ({
					kind: 'declined' as const,
					message: 'Your bank refused the debit.'
				})
			}
		});
		primary(card).click();
		await settle();

		expect(shows(card, '.takeover .message')).toBe('Your bank refused the debit.');
		expect(card.text('[role="status"]')).toBe('Your bank refused the debit.');
	});

	it('empties the refusal on the way out, so no later screen carries the last one’s', async () => {
		// the takeover is one section patched per screen, so a sentence left on it is a decline
		// rendered under the words of whatever the donor reached next.
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'declined' as const, message: 'Your card was declined.' })
			}
		});
		const message = card.find('.takeover .message');
		primary(card).click();

		expect(message.textContent).toBe('');
		expect(message.hidden).toBe(true);
	});

	it('offers nothing to press where nobody can say whether the money moved', async () => {
		// a confirmation with no answer leaves an intent that may have succeeded, and what became of
		// it is settled by the webhook rather than by this page. an ending with a control on it is a
		// donor asked to chase an answer that is already on its way to them.
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'indeterminate' as const }),
				resume: async () => ({ kind: 'indeterminate' as const })
			}
		});

		expect(card.text('.takeover [part~="heading"]')).toBe('Still confirming your gift');
		expect(primary(card).hidden).toBe(true);
		expect(secondary(card).hidden).toBe(true);
	});

	// the two endings are not the same news, and the heading is the whole of what most donors read.
	// headed like the gift that landed, an outcome nobody here can vouch for is a completion the
	// donor believes in — and the only correction they ever get is an email that may not come.
	it('heads an outcome nobody can vouch for differently from one that landed', async () => {
		const landed = await atSubmitted();
		const unknown = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'indeterminate' as const }),
				resume: async () => ({ kind: 'indeterminate' as const })
			}
		});

		expect(landed.text('.takeover [part~="heading"]')).toBe('Thank you');
		expect(unknown.text('.takeover [part~="heading"]')).toBe('Still confirming your gift');
	});

	it('claims no receipt on a gift nothing here knows landed', async () => {
		// deliberately weaker than the success screen, which says a receipt is on its way. nothing
		// on this path read an outcome, so the copy names what was sent and who will write, and
		// makes no claim that the money moved.
		const card = await atSubmitted({
			ports: {
				confirm: async () => ({ kind: 'indeterminate' as const }),
				resume: async () => ({ kind: 'indeterminate' as const })
			}
		});
		const body = shows(card, '.takeover .prose');

		expect(body).toContain('sent to your card issuer for confirmation');
		expect(body).toContain('will email you when it goes through');
		expect(body).toContain('charge you a second time');
		expect(body).not.toContain('receipt');
	});

	it('says who is deciding and offers nothing to press', async () => {
		const card = await atSubmitted({
			ports: { confirm: async () => ({ kind: 'redirecting' as const }) }
		});

		expect(card.text('.takeover [part~="heading"]')).toBe('Continue with your card issuer');
		expect(card.find('.takeover > [part~="action"]').hidden).toBe(true);
		// a gift is in flight here, and a start-over beside it is a donor who thinks it failed
		// paying twice.
		expect(secondary(card).hidden).toBe(true);
	});

	it('separates money in flight from money received', async () => {
		// an ACH debit can still fail after it is accepted, so "thank you, it is done" is a claim
		// the webhook has not made yet.
		const card = await atSubmitted({
			ports: { confirm: async () => ({ kind: 'processing' as const }) }
		});

		expect(card.text('.takeover [part~="heading"]')).toBe('Your gift is on its way');
		expect(card.text('.row.total .row-label')).toBe('To be charged');
		expect(secondary(card).hidden).toBe(true);
	});
});

// every screen a donor waits under, on each rail a gift can be committed to and on the page that
// was handed none. asserted rail by rail rather than once, because a sentence hard-coded to one of
// them passes any single reading of it — and a donor who pressed PayPal being told to continue at
// their bank is the defect these cases exist for.
describe('the waiting screens, per rail', () => {
	/** the cold return: a page handed a payment token and nothing else, with no payer of its own. */
	async function atColdResume(outcome: 'redirecting' | 'processing' | 'indeterminate') {
		const card = await mount({
			resume: { paymentToken: 'pi_1_secret_x' },
			ports: {
				resume: async () => ({ kind: outcome }),
				confirm: async () => ({ kind: outcome })
			}
		});
		await settle();
		return card;
	}

	it('names where the donor was sent, and asks them to stay put wherever that is', async () => {
		const bank = await atSubmittedOn('ach', {
			ports: { confirm: async () => ({ kind: 'redirecting' as const }) }
		});
		expect(bank.text('.takeover [part~="heading"]')).toBe('Continue at your bank');
		expect(shows(bank, '.takeover .prose')).toContain('Your bank is checking this payment.');

		const card = await atSubmittedOn('card', {
			ports: { confirm: async () => ({ kind: 'redirecting' as const }) }
		});
		expect(card.text('.takeover [part~="heading"]')).toBe('Continue with your card issuer');
		expect(shows(card, '.takeover .prose')).toContain('Your card issuer is checking this payment.');

		const paypal = await atSubmittedOn('paypal', {
			ports: { confirm: async () => ({ kind: 'redirecting' as const }) }
		});
		expect(paypal.text('.takeover [part~="heading"]')).toBe('Continue in PayPal');
		expect(shows(paypal, '.takeover .prose')).toContain('PayPal is checking this payment.');

		const venmo = await atSubmittedOn('venmo', {
			ports: { confirm: async () => ({ kind: 'redirecting' as const }) }
		});
		expect(venmo.text('.takeover [part~="heading"]')).toBe('Continue in Venmo');

		const cold = await atColdResume('redirecting');
		expect(cold.text('.takeover [part~="heading"]')).toBe('Continue with this payment');
		expect(shows(cold, '.takeover .prose')).toContain('This payment is being checked.');

		// the one sentence that is the same on all of them, and the reason it is: wherever the donor
		// was sent, this page is what they come back to.
		for (const screen of [bank, card, paypal, venmo, cold]) {
			expect(shows(screen, '.takeover .prose')).toContain(
				'Keep this window open until you are sent back.'
			);
		}
	});

	it('promises business days on the bank rail and on no other', async () => {
		const bank = await atSubmittedOn('ach', {
			ports: { confirm: async () => ({ kind: 'processing' as const }) }
		});
		expect(shows(bank, '.takeover .prose')).toContain(
			'Bank transfers usually take 4 to 5 business days to settle.'
		);
		expect(bank.text('.row.total .row-label')).toBe('To be charged');

		// a PayPal approval is not a transfer and carries no schedule this deployment could keep —
		// and it is that rail's ordinary ending rather than its rare one, because the browser never
		// captures on it (`outcomeOfTermination` in ./embed/paypal.ts).
		const paypal = await atSubmittedOn('paypal', {
			ports: { confirm: async () => ({ kind: 'processing' as const }) }
		});
		expect(shows(paypal, '.takeover .prose')).toContain(
			'PayPal has your approval and the payment has not finished clearing.'
		);

		const venmo = await atSubmittedOn('venmo', {
			ports: { confirm: async () => ({ kind: 'processing' as const }) }
		});
		expect(shows(venmo, '.takeover .prose')).toContain('Venmo has your approval');

		const card = await atSubmittedOn('card', {
			ports: { confirm: async () => ({ kind: 'processing' as const }) }
		});
		expect(shows(card, '.takeover .prose')).toContain('This payment has not finished clearing.');

		const cold = await atColdResume('processing');

		for (const screen of [paypal, venmo, card, cold]) {
			expect(shows(screen, '.takeover .prose')).not.toContain('business days');
		}
		// every rail still says the money has not landed, which is why this screen is not the
		// thank-you.
		for (const screen of [bank, paypal, venmo, card, cold]) {
			expect(shows(screen, '.takeover .prose')).toContain('has been told your gift is coming');
		}
	});

	it('names who is still holding a gift nobody read the outcome of', async () => {
		const unanswered = { confirm: async () => ({ kind: 'indeterminate' as const }) };
		const bank = await atSubmittedOn('ach', {
			ports: { ...unanswered, resume: async () => ({ kind: 'indeterminate' as const }) }
		});
		const venmo = await atSubmittedOn('venmo', {
			ports: { ...unanswered, resume: async () => ({ kind: 'indeterminate' as const }) }
		});
		const card = await atSubmittedOn('card', {
			ports: { ...unanswered, resume: async () => ({ kind: 'indeterminate' as const }) }
		});
		const cold = await atColdResume('indeterminate');

		expect(shows(bank, '.takeover .prose')).toContain('sent to your bank for confirmation');
		expect(shows(venmo, '.takeover .prose')).toContain('sent to Venmo for confirmation');
		expect(shows(card, '.takeover .prose')).toContain('sent to your card issuer for confirmation');
		// a cold return has no rail to name, so it names none rather than the wrong one.
		expect(shows(cold, '.takeover .prose')).toContain('Your gift has been sent for confirmation.');

		for (const screen of [bank, venmo, card, cold]) {
			expect(screen.text('.takeover [part~="heading"]')).toBe('Still confirming your gift');
			expect(shows(screen, '.takeover .prose')).toContain(
				'Nothing here will charge you a second time.'
			);
		}
	});

	it('says who is being asked, in the one sentence a donor hears rather than reads', async () => {
		const held = { confirm: () => new Promise<never>(() => {}) };
		const bank = await atSubmittedOn('ach', { ports: held });
		const paypal = await atSubmittedOn('paypal', { ports: held });
		const card = await atSubmittedOn('card', { ports: held });

		expect(bank.text('[role="status"]')).toBe('Confirming your gift with your bank.');
		expect(paypal.text('[role="status"]')).toBe('Confirming your gift with PayPal.');
		expect(card.text('[role="status"]')).toBe('Confirming your gift with your card issuer.');
	});

	// the two outcomes only the bank rail reaches: `outcomeOfTermination` in ./embed/paypal.ts
	// returns neither. so neither screen is worded off the rail, and asserting that is what stops a
	// later pass making them rail-generic and losing the bank's words.
	it('leaves the microdeposit and expired screens the same words on every rail', async () => {
		const said: string[] = [];
		for (const rail of ['ach', 'paypal'] as const) {
			const verifying = await atSubmittedOn(rail, {
				ports: { confirm: async () => ({ kind: 'awaiting_microdeposits' as const }) }
			});
			const expired = await atSubmittedOn(rail, {
				ports: { confirm: async () => ({ kind: 'verification_expired' as const }) }
			});
			said.push(shows(verifying, '.takeover .prose'), shows(expired, '.takeover .prose'));
		}

		expect(said[0]).toContain('Two small deposits are on their way to your account.');
		expect(said[1]).toContain('The window for verifying your bank account has closed');
		expect(said.slice(2)).toEqual(said.slice(0, 2));
	});
});

describe('the resume', () => {
	it('shows a donor back from their bank what is happening, never an empty form', async () => {
		// the worst frame this component could paint: a blank donation form in front of somebody
		// who has already paid, on the org's own page.
		const card = await mount({
			resume: { paymentToken: 'pi_1_secret_x' },
			ports: { resume: () => new Promise(() => {}) }
		});

		expect(card.all('.step').map((step) => step.hidden)).toEqual([true, true, true, false]);
		expect(card.text('.takeover [part~="heading"]')).toBe('Finishing your gift');
	});
});

describe('the card carries no identity of its own', () => {
	// the form is rendered inside the organisation's own site, in that site's own context and
	// credibility, so restating who is asking is a block a donor has already read on the page
	// around the card. the org's registered name and tax number are still required to serve a form
	// and are still printed on the receipt (packages/app/src/lib/server/org/receipt-fields.ts) —
	// what went is the card's copy of them.
	it('names no organisation, tax number or tax status on the screen taking the money', async () => {
		const card = await atDetailsStep();
		const drawn = card.text('[part~="card"]');

		expect(drawn).not.toContain('12-3456789');
		expect(drawn).not.toContain('EIN');
		expect(drawn).not.toContain('No goods or services');
		expect(drawn).not.toContain('501(c)');
	});

	// the tag the footer was a `<div>` for is still the trap the `<form>` below it answers: a
	// `<footer>` with no sectioning ancestor is a `contentinfo` landmark wherever it is written,
	// shadow root included, and this card is dropped into pages that have a footer of their own.
	it('adds no landmark to the page it is embedded in', async () => {
		const card = await atDetailsStep();

		expect(card.all('footer')).toEqual([]);
	});
});

describe('the stylesheets', () => {
	// comments stripped before any of this is scanned. these two files explain their own rules at
	// length — including the words `transition`, `animation` and `!important`, each written to say
	// there isn't one — so a scan of the raw text asserts against the prose rather than against
	// what the browser is handed.
	const declarations = (sheet: string) => sheet.replace(/\/\*[\s\S]*?\*\//g, '');
	const still = `${declarations(partStyles)}\n${declarations(layoutStyles)}`;
	const moving = declarations(motionStyles);
	const css = `${still}\n${moving}`;
	// kept out of `css` above rather than folded into it: the token file is where every colour
	// literal in this component is authored, so a sheet holding the ramp cannot be swept by the
	// case below that refuses one.
	const tokenSheet = declarations(tokenStyles);

	// every absence below is checked against a non-empty string first. vitest replaces a CSS
	// import with `''` unless `css: true` is set on the pool, and an assertion that a stylesheet
	// contains no colour literal passes perfectly against nothing at all.
	it('is scanning the stylesheets rather than four empty strings', async () => {
		expect(still.length).toBeGreaterThan(1000);
		expect(moving.length).toBeGreaterThan(500);
		expect(tokenSheet.length).toBeGreaterThan(1000);
	});

	it('declares no transition and no animation outside the motion sheet', async () => {
		// a reflow here is a host resizing their own layout, and animating two columns into one
		// produces a scramble that reads as a defect rather than as feedback. everything that does
		// move is in one file, so what may move is one file's worth of reading.
		expect(still.length).toBeGreaterThan(1000);
		expect(still).not.toMatch(/\btransition\b/);
		expect(still).not.toMatch(/\banimation\b/);
	});

	it('animates nothing a container query changes and nothing that resizes the card', async () => {
		// the two rules the motion sheet exists under: a reflow the host caused must not be
		// animated, and the card must never change its own height inside a page it cannot see. the
		// receipt's growth and the press feedback both use `scale`, which paints without reflowing.
		const animated = moving.match(/(?:transition|animation)(?:-property)?:[^;]*/g) ?? [];

		expect(animated.length).toBeGreaterThan(0);
		expect(
			animated
				.filter((rule) =>
					/\b(grid-template-columns|display|order|width|height|block-size|inline-size|font-size|padding|margin)\b/.test(
						rule
					)
				)
				.map((rule) => rule.replace(/\s+/g, ' '))
		).toEqual([
			// the disclosure is the one exception, and only for the discrete `display` jump: without
			// it the closing half of the row collapse is not shown at all, because the attribute
			// that hides the note computes `display: none`.
			'transition: grid-template-rows var(--_move-state), opacity var(--_move-state), display var(--_move-state) allow-discrete'
		]);
	});

	it('reads every duration from a token, which is where reduced motion collapses', async () => {
		// the collapse is total rather than a list of exceptions. tokens.css re-points
		// `--_dur-fast` and `--_dur-screen` to zero under `reduce`, so a literal here is the one
		// way a rule added later can go on moving for a reader who asked for none — a guard block
		// would be a hand-maintained list of selectors that quietly stops being complete instead.
		expect(moving).toMatch(/var\(--_dur-/);
		expect(moving).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
		expect(moving).not.toContain('prefers-reduced-motion');
	});

	it('protects no surface from the host that names it', async () => {
		// the list is empty and the assertion is that it is empty rather than that it is short. an
		// inner important declaration is the only thing that survives a host's own, so an entry here
		// is a decision that a host who was handed a `::part()` name may not actually use it — and
		// this element now makes none. the one it made was the identity footer's font-size, and the
		// footer has left the card. the count is of rules rather than of declarations.
		const protectedRules = css
			.split('}')
			.filter((rule) => rule.includes('!important'))
			.map((rule) => rule.split('{')[0]?.trim());

		expect(protectedRules).toEqual([]);
	});

	it('states the container breakpoints in em, so the root clamp still governs them', async () => {
		// inside an `@container` condition an `em` resolves against the query container's own
		// font-size, which tokens.css clamps into [15px, 18px]. a `rem` would resolve against the
		// host document's root — the exact value the clamp exists to defend against — and a host
		// running `html { font-size: 62.5% }` would put two names side by side in a 200px sidebar.
		//
		// the amount grid is no longer one of them and is the reason there are two conditions rather
		// than three: it wraps on the width its own tiles need, so there is no breakpoint left to
		// state. the floor it wraps against is an `em` for this same reason, and
		// ./styles/layout.browser.spec.ts is where that is measured rather than read.
		const conditions = declarations(layoutStyles).match(/@container donate \([^)]*\)/g) ?? [];

		expect(conditions).toEqual([
			'@container donate (min-width: 24em)',
			'@container donate (min-width: 26em)'
		]);
	});

	it('derives every colour from a token and names none of its own', async () => {
		// a literal here would be a second copy of the ramp that drifts from ./styles/tokens.css
		// silently, and a host's seed would stop reaching that surface.
		expect(css.length).toBeGreaterThan(1000);
		expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(css).not.toMatch(/\b(rgb|rgba|hsl|oklch)\(/);
	});

	// every compound selector in the still sheets, one per comma, so a part can be asked whether a
	// rule of its own answers a state.
	const compounds = still
		.split('}')
		.flatMap((rule) => (rule.split('{')[0] ?? '').split(','))
		.map((selector) => selector.trim());

	// the parts of `parts` no rule of their own paints in `state`. anchored at the start of the
	// compound the selector begins with, so a rule painting an ancestor's state onto something else
	// does not answer for the part. `.fee-decision [part~='checkbox']:hover` holds the same text and
	// answers only for the switch it draws.
	const unanswered = (parts: readonly string[], state: string) =>
		parts.filter(
			(name) =>
				!compounds.some((compound) =>
					new RegExp(`^\\[part~='${name}'\\](?:\\[[^\\]]*\\]|:not\\([^)]*\\))*:${state}`).test(
						compound
					)
				)
		);

	// the rule stated at `--_p-hover` in ./styles/tokens.css: every control a pointer can act on
	// carries a hover step. the list is the operable half of `PART_NAMES` (./parts.ts) — the five
	// names left out are a container, a heading, a label, a ledger and the box a provider paints
	// in, and a pointer does nothing to any of them. this is the one case that can see an absence:
	// a control answering a pointer with nothing renders perfectly and reads as finished.
	it('answers the pointer on every part a pointer can act on', async () => {
		const operable = [
			'field',
			'checkbox',
			'frequency-option',
			'amount-option',
			'amount-input',
			'action',
			'action-quiet'
		];

		expect(unanswered(operable, 'hover')).toEqual([]);
	});

	// the press half of the same rule, and the half a phone is answered by: a touch never hovers,
	// so the press step is the whole of what a finger is told. the list is the operable half above
	// less the three a press repaints nothing on — the two boxes a donor types into, where the
	// caret is the answer, and the quiet action, whose press is the `scale` in ./styles/motion.css
	// and so is not in the sheets this scans.
	it('answers the press on every part a press repaints', async () => {
		const repainted = ['checkbox', 'frequency-option', 'amount-option', 'action'];

		expect(unanswered(repainted, 'active')).toEqual([]);
	});

	it('names every transition it makes rather than composing one at the rule', async () => {
		// a duration and a curve put together at the rule is a pairing nothing holds, and this is
		// the one sheet a new movement is added to — the next one is written by copying the line
		// above it. so a rule reads a name: `--_move-state`, `--_move-enter` and `--_move-press` in
		// ./styles/tokens.css, where the pairing is decided once. the spinner is the exception —
		// a loop rather than a movement between two states — and ./styles/motion.css's own header
		// is where that carve-out is stated, because the header is what a reader adding a movement
		// opens.
		const timed = (moving.match(/(?:transition|animation):[^;]*/g) ?? []).filter((rule) =>
			/var\(--_/.test(rule)
		);

		expect(timed.length).toBeGreaterThan(0);
		expect(timed.filter((rule) => !/var\(--_move-|var\(--_dur-spin\)/.test(rule))).toEqual([]);
		expect(moving).not.toMatch(/var\(--_ease-/);
	});

	it('carries no step nothing spends', async () => {
		// derived from the token file rather than listed, so it fails for a name that stops being
		// read tomorrow and not only for the ones dropped when it was written. a name is spent by a
		// sheet, by another token, or by the set the payment provider is handed.
		//
		// the two unread rungs of the neutral ramp are the one exemption and the ladder in
		// ./styles/tokens.css argues it: a scale is read by counting along it, and one with holes
		// in it is no longer one anybody can count along. every other name is a value a reader has
		// to decide about, so one nothing spends is a decision with no consumer to check it against.
		const exempt = ['--_n8', '--_n9'];
		const handedOver = APPEARANCE_INPUTS as readonly string[];
		const declared = [...tokenSheet.matchAll(/^\s*(--_[\w-]+)\s*:/gm)].flatMap(
			(match) => match[1] ?? []
		);
		const swept = `${tokenSheet}\n${css}`;
		const unspent = declared.filter(
			(token) =>
				!exempt.includes(token) &&
				!handedOver.includes(token) &&
				!new RegExp(`var\\(${token}(?![\\w-])`).test(swept)
		);

		expect(declared.length).toBeGreaterThan(50);
		expect(unspent).toEqual([]);
	});
});

describe('where a payment provider paints', () => {
	// the defect this pins: Stripe's Payment Element cannot complete its mount inside a shadow
	// root. it builds its container there, fires `loaderstart`, and never reaches `ready` — the
	// frame stays two pixels high and no donation can be completed on any site. mounted into an
	// ordinary light-DOM node it reaches `ready` in the same page, which is why the node handed
	// over is a child of the host rather than of the shadow tree.
	//
	// asserted structurally because the handshake itself is not assertable offline. "a mount node
	// exists" passes on the defect; "the mount node is not in the shadow root" is the invariant
	// that does not.
	it('hands the runtime a node that is not inside the shadow root', async () => {
		const mounts: HTMLElement[] = [];
		const card = await mount({ mounted: (node) => void mounts.push(node) });
		const node = mounts[0] as HTMLElement;

		expect(mounts).toHaveLength(1);
		expect(card.shadow.contains(node)).toBe(false);
		expect(node.parentNode).toBe(card.host);
	});

	// by `::part()` name would be the obvious way and is the wrong one: the part vocabulary is a
	// permanent contract for a host page to style with, and mounting is not what it was drawn for.
	// the box keeps its name and keeps resolving, and the provider's fields reach it through a slot
	// rather than by being appended into it.
	it('projects that node back through the payment part, which still resolves', async () => {
		const mounts: HTMLElement[] = [];
		const card = await mount({ mounted: (node) => void mounts.push(node) });
		const node = mounts[0] as HTMLElement;
		const box = card.find('[part~="payment"]');
		const slot = box.querySelector('slot[name="payment"]') as HTMLSlotElement | null;

		expect(slot).not.toBeNull();
		expect(node.getAttribute('slot')).toBe('payment');
		expect(slot?.assignedNodes()).toContain(node);
	});

	// nothing is put in the box before there is a surface to paint in it, and what keeps the box
	// itself off the screen until a provider paints is the `hidden` attribute `#openPaymentBox` in
	// ./element.ts sets — a question about the flattened tree and about used height, which is why
	// "the box a payment provider paints in" lives in ./styles/parts.browser.spec.ts.
	it('puts nothing in that box until there is a payment surface for it', async () => {
		const card = await mount({ loadConfig: () => new Promise(() => {}) });

		expect(card.shadow.querySelector('slot[name="payment"]')).toBeNull();
		expect(card.host.querySelector('[slot="payment"]')).toBeNull();
	});

	// the box's visibility is state this element sets rather than a selector, and it has to be: the
	// slot above is a child of that box from the first paint of the card, so `:empty` — which reads
	// the box's own children — is false from then on however little a provider ever paints.
	//
	// what the state is set to at this moment is the whole of it. the node handed over is projected
	// into this box, so a box out of the layout is a mount into a subtree with no box: a provider
	// that defers drawing until it has one would never draw, and nothing here would ever hear
	// otherwise. so the box is in the layout before the node is handed over, on every boot.
	it('hands the provider a box that is in the layout, on every boot', async () => {
		// `string | boolean`, because `hidden` also takes `until-found`: the reading is kept as the
		// idl gives it so that a box hidden that way is not read here as a box on the screen.
		const hiddenAtMount: (string | boolean)[] = [];
		const card = await mount({
			mounted: (node) => {
				const box = (node.parentElement as HTMLElement).shadowRoot?.querySelector(
					'[part~="payment"]'
				);
				hiddenAtMount.push((box as HTMLElement).hidden);
			}
		});
		card.host.setAttribute('form', 'frm_second');
		await settle();

		expect(hiddenAtMount).toEqual([false, false]);
	});

	// the node is outside the shadow encapsulation, so nothing collects it for us: an element that
	// left the document and came back, or was pointed at another form, would otherwise leave one
	// dead mount node in the host's page per boot.
	it('leaves exactly one mount node behind across a teardown and a re-boot', async () => {
		const mounts: HTMLElement[] = [];
		const card = await mount({ mounted: (node) => void mounts.push(node) });
		card.host.remove();
		document.body.appendChild(card.host);
		await settle();
		card.host.setAttribute('form', 'frm_second');
		await settle();

		expect(mounts.length).toBeGreaterThan(1);
		expect(card.host.querySelectorAll('[slot="payment"]')).toHaveLength(1);
		expect(card.shadow.querySelectorAll('slot[name="payment"]')).toHaveLength(1);
	});

	// a disconnected element paints nothing, and what it left in the host's page is the host's
	// problem rather than ours. removing it is the other half of creating it.
	it('takes its mount node with it when it leaves the document', async () => {
		const card = await mount();
		card.host.remove();
		await settle();

		expect(card.host.querySelector('[slot="payment"]')).toBeNull();
	});

	// removing that node is the DOM half and it is not the only half. what the provider built
	// is registered inside its own script — subscriptions and an armed mount deadline — and none of
	// it is collected by taking the node it painted in off the page.
	it('tells the payment surface to let go when the element leaves the document', async () => {
		let torn = 0;
		const card = await mount({ torn: () => (torn += 1) });
		card.host.remove();
		await settle();

		expect(torn).toBe(1);
	});

	// a runtime cannot tell a second element on the page from an element booting a second time: both
	// are a second checkout for one form id, and the two want opposite answers about the return a
	// payment provider sent the donor back with. so this element says which it is asking for, and
	// everything after its first is a second one — a press of Back to start, a Try again, an
	// attribute that changed, a re-insertion into the page.
	it('asks for a first boot once and for another kind on every boot after it', async () => {
		const boots: FormBoot[] = [];
		const card = await atSubmitted({ boots: (boot) => void boots.push(boot) });

		expect(boots).toEqual(['first']);

		secondary(card).click();
		await settle();

		expect(boots).toEqual(['first', 'again']);
	});

	// the same door a second gift goes through, and where one live surface per gift is at stake: a
	// replacement that goes up first leaves the one it replaced reporting into a stopped flow.
	it('stops the surface it is replacing before it builds another', async () => {
		let torn = 0;
		const mounts: HTMLElement[] = [];
		const card = await mount({
			torn: () => (torn += 1),
			mounted: (node) => void mounts.push(node)
		});
		card.host.setAttribute('form', 'frm_second');
		await settle();

		expect(torn).toBe(1);
		expect(mounts).toHaveLength(2);
	});

	// a move is not a departure, so the surface a donor is typing into is not one to let go of.
	it('lets go of nothing when it is only moved within the page', async () => {
		let torn = 0;
		const card = await mount({ torn: () => (torn += 1) });
		const elsewhere = document.createElement('section');
		document.body.appendChild(elsewhere);
		elsewhere.appendChild(card.host);
		await settle();

		expect(torn).toBe(0);
	});

	// a document with no browsing context — `document.implementation.createHTMLDocument()`, and
	// `adoptNode` is how an element reaches one. nothing there renders and nothing there can be
	// deferred against: there is no view to take a timer from, so a teardown put behind a task is one
	// that never runs, and the payment surface, the challenge widget and the mount node all outlive
	// the element that built them. the deferral is only there to tell a move apart, and nothing moves
	// an element in a document nobody is looking at.
	it('lets go at once when it leaves a document with no browsing context', async () => {
		let torn = 0;
		const card = await mount({ torn: () => (torn += 1) });
		const other = document.implementation.createHTMLDocument();
		other.body.appendChild(other.adoptNode(card.host));
		// happy-dom runs no connect reaction in a document with no browsing context, where an engine
		// enqueues one from the insertion itself — so the half of the adoption it drops is delivered
		// by hand, the way this file delivers an upgrade's attribute reaction and `adoptedCallback`.
		// it is what leaves the element live in the new document: the departure from the old one is
		// deferred, and arriving cancels that.
		const node = card.host as HTMLElement & {
			connectedCallback(): void;
			disconnectedCallback(): void;
		};
		node.connectedCallback();
		await settle();

		expect(other.defaultView).toBeNull();
		expect(torn).toBe(0);

		node.disconnectedCallback();

		expect(torn).toBe(1);
	});

	// a surface is let go of before it is asked to stop, so a provider that refuses is refusing once.
	// held past the ask, a surface that threw is still on the element, and the next stop — the
	// element leaving the page, or the boot after it — asks the provider to destroy a group it has
	// already destroyed.
	it('asks a surface that refused to let go for nothing a second time', async () => {
		let torn = 0;
		const card = await mount({
			torn: () => {
				torn += 1;
				throw new Error('the provider refused to let go');
			}
		});

		expect(() => card.host.setAttribute('form', 'frm_second')).toThrow();
		expect(torn).toBe(1);

		card.host.remove();
		await settle();

		expect(torn).toBe(1);
	});

	// the other half of the defect: the card fields never appear and nothing says so — no console
	// line, no state change, and a donor sitting in front of a form with nowhere to type a card
	// number. It ends on the failure screen the flow already has, carrying the adapter's own words.
	it('turns a payment surface that never came up into a screen the donor can read', async () => {
		const card = await mount();
		card.unavailable({
			message: 'This form cannot take a payment right now.',
			fix: 'Check the publishable key.'
		});

		expect(shows(card, '.takeover .message')).toBe('This form cannot take a payment right now.');
	});

	// the `fix` beside that message names a key, a variable or a screen in /admin, and it is
	// addressed to whoever administers the deployment — who is not the person looking at this card.
	// it stays on the wire, because `/api/v1` is a permanent contract and an agent wiring the embed
	// reads it; what it does not do is reach a donor, who can act on none of it.
	it('keeps the operator’s instructions off the donor’s screen', async () => {
		const card = await mount();
		card.unavailable({
			message: 'This form cannot take a payment right now.',
			fix: 'Check the publishable key.'
		});

		expect(card.text('.takeover')).not.toContain('publishable key');
	});

	// past a press there is an intent at the processor and possibly a charge against it, and the
	// provider reporting on its own fields says nothing about what happened to that money.
	it('does not let that report end a gift that has already been submitted', async () => {
		const card = await atSubmitted();
		card.unavailable({ message: 'This form cannot take a payment right now.' });

		expect(card.text('.takeover [part~="heading"]')).toBe('Thank you');
	});

	// the rail is chosen inside that box, so this card draws no picker of its own and writes nothing
	// back onto it — the provider reports its own selection instead (`onRail` in ./element.ts).
	it('draws no rail control of its own and writes nothing onto that box', async () => {
		const card = await atDetailsStep();

		expect(card.all('.method')).toHaveLength(0);
		expect(card.find('[part~="payment"]').hasAttribute('data-method')).toBe(false);
	});

	// the provider's fields are drawn for a gift collected once or for the first collection of one
	// collected again, and only the flow knows which the donor committed to. told the wrong one, a
	// donor authorizes a schedule having been shown none of the terms it repeats under.
	it('tells the payment surface the cadence the donor committed to', async () => {
		const reported: (Frequency | undefined)[] = [];
		const card = await mount({ cadences: (frequency) => void reported.push(frequency) });
		press(card.all('[part~="frequency-option"] input')[1] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);

		expect(reported.at(0)).toBeUndefined();
		expect(reported.at(-1)).toBe('monthly');
	});

	// the radio is pressed several times before anything is committed, and each press is a gift the
	// donor has not decided on yet. what reaches the surface is what `commitAmount` settled.
	it('says nothing while the donor is still deciding between cadences', async () => {
		const reported: (Frequency | undefined)[] = [];
		const card = await mount({ cadences: (frequency) => void reported.push(frequency) });
		press(card.all('[part~="frequency-option"] input')[1] as HTMLElement);
		press(card.all('[part~="frequency-option"] input')[2] as HTMLElement);

		expect(reported.every((frequency) => frequency === undefined)).toBe(true);
	});
});

describe('the anti-abuse challenge', () => {
	/** the quote port, recording the request it was handed rather than the answer it gave. */
	function recordingQuote(posted: QuoteRequest[]): Partial<CheckoutPorts> {
		return {
			quote: async (request) => {
				posted.push(request);
				return { paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 };
			}
		};
	}

	// the defect this pins, and the one assertion in this file that catches it. every other part of
	// the token's path is there — the machine accepts `SET_TURNSTILE_TOKEN` in any state, `connect`
	// publishes `setTurnstileToken`, the config carries the sitekey — and with nothing calling any
	// of it every donation on every site is refused for arriving with no token. a test that the
	// machine *accepts* a token passes against exactly that.
	it('carries the token the widget minted into the request that spends it', async () => {
		const posted: QuoteRequest[] = [];
		const card = await atDetailsStep({ ports: recordingQuote(posted) });
		card.token('tok_from_the_widget');
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		card.rail('card');
		card.find('[part~="submit"]').click();
		await settle();

		expect(posted).toHaveLength(1);
		expect(posted[0]?.turnstileToken).toBe('tok_from_the_widget');
	});

	// after the control, because the challenge is what stands behind pressing Continue rather than a
	// field on the way to it — and last, because nothing is drawn there in the ordinary case and a
	// box in the middle of the column would hold a gap open for a widget most donors never see.
	it('draws the widget last on the step it lives in', async () => {
		const drawn: HTMLElement[] = [];
		const card = await atDetailsStep({ challenged: (node) => void drawn.push(node) });
		const step = card.find('.step-details');

		expect(drawn).toHaveLength(1);
		expect(card.shadow.contains(drawn[0] as HTMLElement)).toBe(true);
		expect(step.lastElementChild).toBe(drawn[0]);
		expect(step.contains(drawn[0] as HTMLElement)).toBe(true);
	});

	// every step but the one on screen is `hidden`, and a challenge rendered into a subtree with no
	// box is one nobody can be asked to solve. it is drawn on arrival at the details step, which is
	// the last moment it can be drawn without the donor waiting on it — and from there it has that
	// step's typing and the whole review step to finish in.
	it('draws the widget two screens before the press that spends its token', async () => {
		const drawn: HTMLElement[] = [];
		const card = await mount({ challenged: (node) => void drawn.push(node) });

		expect(drawn).toHaveLength(0);
		expect(card.find('.step-details').hasAttribute('hidden')).toBe(true);

		press(card.all('[part~="frequency-option"] input')[0] as HTMLElement);
		press(card.all('[part~="amount-option"] input')[0] as HTMLElement);
		proceed(card);

		expect(drawn).toHaveLength(1);
		expect(card.find('.step-details').hasAttribute('hidden')).toBe(false);
		// and the step whose press spends it is still ahead of the donor.
		expect(card.find('.step-give').hasAttribute('hidden')).toBe(true);
	});

	// a token is valid once and for five minutes, so the one the request carried is spent whether
	// the server honoured it or refused it. without this the donor's second press fails for a
	// different reason than their first — `challenge_failed` on a token already redeemed — and no
	// amount of trying again moves it.
	it('resets the widget once the token it minted has been spent', async () => {
		let resets = 0;
		const card = await atSubmitted({ resets: () => (resets += 1) });

		expect(card.text('.takeover [part~="heading"]')).toBe('Thank you');
		expect(resets).toBe(1);
	});

	// the retry path, end to end: a refused submission, the donor's Try again, and a second press
	// that carries the token the reset produced rather than the one the server already spent.
	it('carries a fresh token into the attempt after a refused one', async () => {
		const posted: QuoteRequest[] = [];
		let resets = 0;
		const card = await atDetailsStep({
			resets: () => (resets += 1),
			ports: {
				quote: async (request) => {
					posted.push(request);
					throw { message: 'This gift was refused.', fix: 'Try again.' };
				}
			}
		});
		card.token('tok_first');
		type(card.find('#email'), 'donor@example.org');
		type(card.find('#first-name'), 'Ada');
		type(card.find('#last-name'), 'Lovelace');
		proceed(card);
		card.rail('card');
		card.find('[part~="submit"]').click();
		await settle();

		expect(resets).toBe(1);
		// what the reset produced, arriving the way every token does.
		card.token('tok_second');
		// the retry lands on the review step, which is the earliest one still short of anything.
		primary(card).click();
		card.rail('card');
		card.find('[part~="submit"]').click();
		await settle();

		expect(posted.map((request) => request.turnstileToken)).toEqual(['tok_first', 'tok_second']);
	});

	// the same hole the payment surface has. a challenge that will never mint a token leaves every
	// press to be refused by the endpoint with a sentence written for a developer, so the widget's
	// own error and timeout callbacks end here instead — on the screen the flow already has.
	it('turns a challenge that will never mint a token into a screen the donor can read', async () => {
		const card = await atDetailsStep();
		card.challengeUnavailable({
			message: 'This form could not run its security check.',
			fix: 'Check TURNSTILE_SITE_KEY.'
		});

		expect(shows(card, '.takeover .message')).toBe('This form could not run its security check.');
		// and the env-var name it came with is not on the donor's screen; see the payment surface's
		// own case above.
		expect(card.text('.takeover')).not.toContain('TURNSTILE_SITE_KEY');
	});

	// past a press there is an intent at the processor and possibly a charge against it, and the
	// challenge reporting on itself says nothing about what happened to that money.
	it('does not let that report end a gift that has already been submitted', async () => {
		const card = await atSubmitted();
		card.challengeUnavailable({ message: 'This form could not run its security check.' });

		expect(card.text('.takeover [part~="heading"]')).toBe('Thank you');
	});

	// the widget holds a registration inside the provider's own script, which no amount of
	// replacing the shadow tree collects. removing it is the other half of drawing it.
	it('takes the widget off the page when the element leaves the document', async () => {
		let stopped = 0;
		const card = await atDetailsStep({ stopped: () => (stopped += 1) });
		card.host.remove();
		await settle();

		expect(stopped).toBe(1);
	});
});
