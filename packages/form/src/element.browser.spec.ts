import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { PRE_UPGRADE_RESERVATION_CSS, RESERVED_MIN_HEIGHT } from './embed/reservation';
import { defineDonateForm, DONATE_FORM_TAG } from './element';
import type { CheckoutPorts } from './ports';
import type { FormConfig, PaymentMethod } from './v1';

// what a lightweight DOM cannot see about the element, all of it engine behaviour:
//
//  - its stylesheets: which document a constructed sheet belongs to, and what a card renders as when
//    the `@property` registrations its seeds derive from are not in the tree — the whole reason
//    `sheetsFor` puts a second copy of the token sheet in the document at all.
//  - the box a host page holds before upgrade, which is a used box and needs a layout.
//  - the closed choices operated by pointer and keyboard, and where the open list stands over a
//    host box that clips.
//  - where the caret goes: whether a pointer press focuses the control, whether a hidden control
//    gives the caret up, what a closed root lets a read see, and which card on a page holds it.
//    happy-dom focuses nothing on `click()`, keeps the caret on a hidden node, and throws reading a
//    second shadow root's `activeElement`.
//
// like every spec in this pool it runs from `pnpm test:browser` and not from `pnpm test`, so it does
// not gate `deploy`; see vitest.browser.config.ts.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card'],
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
const planted: HTMLElement[] = [];

/** lets the configuration read settle before the card is inspected. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

type Mounting = {
	readonly ports?: Partial<CheckoutPorts>;
	/** the payment token a redirect came back with, which boots the flow into a resume. */
	readonly resume?: { readonly paymentToken: string };
	/** where the element is put; the document's body where unsaid. */
	readonly parent?: ParentNode;
	/** handed the payment provider's rail report once the card has asked for a checkout. */
	readonly railed?: (report: (method: PaymentMethod | null) => void) => void;
	/** handed the node the payment provider paints its own fields into. */
	readonly painted?: (node: HTMLElement) => void;
};

/** one element on the page, upgraded, carrying the sheets its own code adopted. */
async function mount(config: FormConfig = CONFIG, options: Mounting = {}): Promise<HTMLElement> {
	const tag = `${DONATE_FORM_TAG}-${(tags += 1)}`;
	defineDonateForm(
		{
			loadConfig: async () => config,
			checkout: (config, node, onRail) => {
				options.railed?.(onRail);
				options.painted?.(node);
				return {
					input: {
						config,
						ports: { ...PORTS, ...options.ports },
						...(options.resume === undefined ? {} : { resume: options.resume })
					},
					cadence: () => {},
					offerFund: () => {},
					offerCrypto: () => {},
					offerVenmo: () => {},
					rows: () => {},
					stop: () => {}
				};
			},
			challenge: () => ({ reset: () => {}, stop: () => {} })
		},
		tag
	);
	const host = document.createElement(tag);
	host.setAttribute('form', CONFIG.formId);
	(options.parent ?? document.body).appendChild(host);
	planted.push(host);
	await settle();
	return host;
}

/** a second document on the page, which is the only kind an element can actually move into. */
function otherDocument(): Document {
	const frame = document.createElement('iframe');
	document.body.appendChild(frame);
	planted.push(frame);
	const doc = frame.contentDocument;
	if (doc === null) throw new Error('the frame has no document');
	return doc;
}

/** what the card paints as, which is the whole question a missing registration answers. */
function background(host: HTMLElement): string {
	const card = host.shadowRoot?.querySelector("[part~='card']");
	if (card === undefined || card === null) throw new Error('the element rendered no card');
	return getComputedStyle(card).backgroundColor;
}

function shadow(host: HTMLElement): ShadowRoot {
	const root = host.shadowRoot;
	if (root === null) throw new Error('the element has no shadow root');
	return root;
}

/** the donor walked from the amount step to the review, typing what the details step asks. */
function review(root: ShadowRoot): void {
	const forward = () =>
		root
			.querySelector<HTMLElement>('.step:not([hidden]) [part~="action"]:not([part~="submit"])')
			?.click();
	const type = (selector: string, value: string) => {
		const field = root.querySelector<HTMLInputElement>(selector);
		if (field === null) throw new Error(`no ${selector}`);
		field.value = value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
	};
	root.querySelector<HTMLElement>('[part~="frequency-option"] input')?.click();
	root.querySelector<HTMLElement>('[part~="amount-option"] input')?.click();
	forward();
	type('#email', 'donor@example.org');
	type('#first-name', 'Ada');
	type('#last-name', 'Lovelace');
	forward();
}

afterEach(() => {
	for (const node of planted.splice(0)) node.remove();
	// the root a case below moved, back where every other case in this file assumes it.
	document.documentElement.style.fontSize = '';
});

describe('the element in a second document', () => {
	// the premise behind rebuilding all four sheets rather than re-assigning the ones the shadow root
	// is already holding: they belong to the document they were constructed in and no other will take
	// them (https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets).
	it('cannot hand a document a sheet constructed in another one', () => {
		const other = otherDocument();
		const sheet = new CSSStyleSheet();
		sheet.replaceSync('div { color: red }');

		expect(() => {
			other.adoptedStyleSheets = [sheet];
		}).toThrow(/not allowed/i);
	});

	// so the callback rebuilds, and what it is rebuilding for is the second adoption: `@property`
	// registrations are collected from the document tree, and a card whose seeds have no initial
	// value paints as nothing at all on a page whose host set none.
	it('paints in the document it was adopted into', async () => {
		const host = await mount();
		const painted = background(host);
		const other = otherDocument();
		other.body.appendChild(host);
		await settle();

		expect(host.ownerDocument).toBe(other);
		expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(4);
		expect(background(host)).toBe(painted);
	});
});

// the reflow every host page took, measured. the snippet loads the runtime `async`, so the parser
// builds `<bg-donate-form>` as an unknown inline element with no intrinsic size, lays the page out
// around it, and moves everything below the card down by the card's whole height when the
// definition lands. the reservation is the host page's own rule because nothing this script does can
// come early enough — it has to run to inject anything, and running is the upgrade.
//
// this is the browser pool's question and no other pool's: what is compared is a used box against a
// declared minimum, in the one state the element does not exist in yet.
describe('the box a host page holds before the element upgrades', () => {
	// the real tag rather than a per-case one: `:not(:defined)` is a claim about this document's
	// registry, and every case above registers under a suffixed tag precisely so this one is never
	// defined here. the assertion below states that outright rather than trusting it.
	function waiting(children: readonly HTMLElement[] = []): HTMLElement {
		const style = document.createElement('style');
		style.textContent = PRE_UPGRADE_RESERVATION_CSS;
		document.head.appendChild(style);
		planted.push(style);

		const host = document.createElement(DONATE_FORM_TAG);
		host.setAttribute('form', CONFIG.formId);
		for (const child of children) host.appendChild(child);
		document.body.appendChild(host);
		planted.push(host);
		return host;
	}

	/** the number both ends of the reservation are written from, as the engine resolves a length. */
	const RESERVE = parseFloat(RESERVED_MIN_HEIGHT);

	/**
	 * an element mid-boot: upgraded, with the configuration read still in flight.
	 *
	 * the one state the element's own floor is spent in, and it cannot be reached through `mount`
	 * above — that helper waits for the card.
	 */
	async function loading(children: readonly HTMLElement[] = []): Promise<HTMLElement> {
		const tag = `${DONATE_FORM_TAG}-${(tags += 1)}`;
		defineDonateForm(
			{
				loadConfig: () => new Promise(() => {}),
				checkout: (config) => ({
					input: { config, ports: PORTS },
					cadence: () => {},
					offerFund: () => {},
					offerCrypto: () => {},
					offerVenmo: () => {},
					rows: () => {},
					stop: () => {}
				}),
				challenge: () => ({ reset: () => {}, stop: () => {} })
			},
			tag
		);
		const host = document.createElement(tag);
		host.setAttribute('form', CONFIG.formId);
		for (const child of children) host.appendChild(child);
		document.body.appendChild(host);
		planted.push(host);
		await settle();
		return host;
	}

	// the common case, and the one the README calls optional for a reason: nearly every host pastes
	// the snippet and fills no slot, so the reservation has to hold a box with nothing in it.
	//
	// the box is measured against the element mid-boot rather than against the finished card. the
	// two rules are one continuous floor — the host's stops applying the moment the element is
	// defined and the element's own loading card takes over the same number — and it is the join
	// that has to be seamless, not the card that lands after it.
	it('holds the same box with no loading content in it at all', async () => {
		const empty = waiting();
		const upgraded = await loading();

		expect(customElements.get(DONATE_FORM_TAG)).toBeUndefined();
		expect(getComputedStyle(empty).display).toBe(getComputedStyle(upgraded).display);
		expect(empty.getBoundingClientRect().height).toBe(RESERVE);
		expect(upgraded.getBoundingClientRect().height).toBe(RESERVE);
	});

	// and the documented `loading` slot, which renders before the upgrade as ordinary light DOM: a
	// placeholder shorter than the card must not shrink the box back below the reserve.
	it('holds it against loading content shorter than the card', async () => {
		const line = document.createElement('p');
		line.textContent = 'Loading the donation form…';
		line.setAttribute('slot', 'loading');
		const filled = waiting([line]);
		const short = document.createElement('p');
		short.textContent = 'Loading the donation form…';
		short.setAttribute('slot', 'loading');
		const upgraded = await loading([short]);

		expect(filled.getBoundingClientRect().height).toBe(RESERVE);
		expect(upgraded.getBoundingClientRect().height).toBe(RESERVE);
	});

	// and the release, which is the other half of the same rule. the reserve is a guess at the
	// tallest common card and it is the host page's to keep until the element has something real to
	// draw; held past that it is a floor under every short step, and the amount step is the first
	// thing a donor sees.
	it('lets the card size to its own content once there is a card', async () => {
		const upgraded = await mount();

		expect(getComputedStyle(upgraded).minHeight).toBe('0px');
		expect(upgraded.getBoundingClientRect().height).toBeLessThan(RESERVE);
	});

	// the two cases above compare the reservation against the element's own declared floor, and they
	// hold whatever unit both are written in — which is the whole reason this one exists: what a host
	// page is owed is the reservation against the card that actually renders in it. a host running
	// `html { font-size: 62.5% }` is where the two part company, because the card's scale is clamped
	// (./styles/tokens.css) and stops following the root long before a font-relative reserve does.
	for (const root of ['10px', '16px', '20px']) {
		it(`holds the card that renders on a host whose root is ${root}`, async () => {
			document.documentElement.style.fontSize = root;
			const empty = waiting();
			const upgraded = await mount();

			expect(empty.getBoundingClientRect().height).toBeGreaterThanOrEqual(
				upgraded.getBoundingClientRect().height
			);
		});
	}
});

// the two closed choices on the amount step — the cause and the tribute's kind — are zag's select
// machine (@zag-js/select through @zag-js/vanilla) rather than the platform's `<select>`, so what the
// platform used to guarantee is asserted here: a pick reaches the flow, the keyboard is the listbox
// pattern's, and the list escapes whatever box the card is standing in.
describe('the closed choices on the amount step', () => {
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

	/** the words the closed box is showing, as a sighted donor reads them. */
	function showing(box: HTMLElement): string {
		return box.innerText.trim();
	}

	/** the open list's row carrying `words`, once it is on screen. */
	function row(root: ShadowRoot, words: string): Promise<HTMLElement> {
		return vi.waitFor(() => {
			const found = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')).find(
				(option) => option.innerText.trim() === words
			);
			if (found === undefined || !found.checkVisibility()) throw new Error(`no row reads ${words}`);
			return found;
		});
	}

	it('credits the gift to the cause a donor picks from the open list', async () => {
		const host = await mount(CHOICE);
		const root = shadow(host);
		const box = root.querySelector<HTMLElement>('#program');
		if (box === null) throw new Error('no program box');

		await userEvent.click(box);
		await userEvent.click(await row(root, 'Schools'));

		await vi.waitFor(() => expect(showing(box)).toBe('Schools'));
		review(root);
		expect(root.querySelector('.row.program .program-name')?.textContent).toBe('Schools');
	});

	it('takes the listbox keyboard: typeahead, Enter to choose, the caret back on the box', async () => {
		const host = await mount(CHOICE);
		const root = shadow(host);
		const box = root.querySelector<HTMLElement>('#program');
		if (box === null) throw new Error('no program box');

		box.focus();
		await userEvent.keyboard('{ArrowDown}');
		await vi.waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'));
		await userEvent.keyboard('s');
		await vi.waitFor(() =>
			expect(
				(root.activeElement as HTMLElement | null)?.getAttribute('aria-activedescendant')
			).toBe('program-option-prg_school')
		);
		await userEvent.keyboard('{Enter}');

		await vi.waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('false'));
		expect(showing(box)).toBe('Schools');
		expect(root.activeElement).toBe(box);
	});

	it('closes on Escape without choosing, and hands the caret back to the box', async () => {
		const host = await mount(CHOICE);
		const root = shadow(host);
		root.querySelector<HTMLElement>('.tribute [part~="checkbox"]')?.click();
		const box = root.querySelector<HTMLElement>('#tribute-kind');
		if (box === null) throw new Error('no tribute kind box');

		box.focus();
		await userEvent.keyboard('{ArrowDown}');
		await vi.waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'));
		await userEvent.keyboard('{ArrowDown}');
		await vi.waitFor(async () => {
			await userEvent.keyboard('{Escape}');
			expect(box.getAttribute('aria-expanded')).toBe('false');
		});

		expect(showing(box)).toBe('In honor of');
		expect(root.activeElement).toBe(box);
	});

	it('names each box for what it asks rather than for the option it rests on', async () => {
		const host = await mount(CHOICE);
		const root = shadow(host);
		const named = (id: string) =>
			root.getElementById(root.getElementById(id)?.getAttribute('aria-labelledby') ?? '')
				?.textContent ?? '';

		expect(named('program')).toBe('Program');
		expect(named('tribute-kind')).toBe('How this gift is dedicated');
		expect(root.getElementById('tribute-kind')?.getAttribute('role')).toBe('combobox');
	});

	it('keeps a kind the donor chose through a trip to the next step and back', async () => {
		const host = await mount(CHOICE);
		const root = shadow(host);
		root.querySelector<HTMLElement>('.tribute [part~="checkbox"]')?.click();
		const box = root.querySelector<HTMLElement>('#tribute-kind');
		if (box === null) throw new Error('no tribute kind box');
		const honoree = root.querySelector<HTMLInputElement>('#tribute-honoree');
		if (honoree === null) throw new Error('no honoree box');
		honoree.value = 'Margaret Chen';
		honoree.dispatchEvent(new Event('input', { bubbles: true }));

		await userEvent.click(box);
		await userEvent.click(await row(root, 'In memory of'));
		await vi.waitFor(() => expect(showing(box)).toBe('In memory of'));
		root.querySelector<HTMLElement>('[part~="amount-option"] input')?.click();
		root
			.querySelector<HTMLElement>('.step:not([hidden]) [part~="action"]:not([part~="submit"])')
			?.click();
		expect(box.checkVisibility()).toBe(false);
		root.querySelector<HTMLElement>('.step:not([hidden]) .step-dot')?.click();

		expect(root.querySelector<HTMLElement>('.step:not([hidden]) #tribute-kind')).toBe(box);
		expect(showing(box)).toBe('In memory of');
	});

	/**
	 * the element standing in a host's box that clips and stacks: `overflow: hidden` a little taller
	 * than the box's own row, a `transform` (which makes it the containing block of anything fixed
	 * inside it), and a sibling on a stacking context of its own laid over the space under it.
	 */
	async function clipped(
		offsetTop: string
	): Promise<{ root: ShadowRoot; box: HTMLElement; frame: HTMLElement; cover: HTMLElement }> {
		const frame = document.createElement('div');
		frame.style.cssText = `position: relative; margin-block-start: ${offsetTop}; overflow: hidden; transform: translateZ(0); block-size: 360px; inline-size: 400px;`;
		document.body.appendChild(frame);
		planted.push(frame);
		const host = await mount(CHOICE);
		frame.appendChild(host);
		await settle();
		const cover = document.createElement('div');
		cover.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647;';
		const root = shadow(host);
		const box = root.querySelector<HTMLElement>('#program');
		if (box === null) throw new Error('no program box');
		// the frame is scrolled so the program box stands at its bottom edge, which is where a list
		// opening in flow or inside the frame would be cut.
		frame.scrollTop = box.offsetTop - 300;
		document.body.appendChild(cover);
		planted.push(cover);
		return { root, box, frame, cover };
	}

	/** the open list's surface, once zag has placed it. */
	function placedList(root: ShadowRoot): Promise<HTMLElement> {
		return vi.waitFor(() => {
			const list = root.querySelector<HTMLElement>('[part~="select-list"]');
			if (list === null || !list.checkVisibility()) throw new Error('the list is not open');
			const positioner = list.parentElement;
			if (positioner?.style.getPropertyValue('--y') === '')
				throw new Error('the list is not placed');
			return list;
		});
	}

	it('floats the open list over a host box that clips, transforms and stacks above it', async () => {
		const { root, box, frame } = await clipped('0px');
		box.focus();
		await userEvent.keyboard('{ArrowDown}');
		const list = await placedList(root);
		const last = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).at(-1);
		if (last === undefined) throw new Error('no rows');
		const at = last.getBoundingClientRect();
		const x = at.left + at.width / 2;
		const y = at.top + at.height / 2;

		expect(at.bottom).toBeGreaterThan(frame.getBoundingClientRect().bottom);
		expect(root.elementFromPoint(x, y)?.closest('[role="option"]')).toBe(last);
		expect(list.parentElement?.matches(':popover-open')).toBe(true);
	});

	it('opens the list under the box where there is room, and over it where there is not', async () => {
		const room = await clipped('0px');
		const under = room.box.getBoundingClientRect();
		// the box scrolled to the top of the frame, far from the viewport's bottom edge.
		room.frame.scrollTop = room.box.offsetTop;
		room.box.focus();
		await userEvent.keyboard('{ArrowDown}');
		const below = (await placedList(room.root)).getBoundingClientRect();
		expect(below.top).toBeGreaterThanOrEqual(room.box.getBoundingClientRect().bottom);
		await vi.waitFor(async () => {
			await userEvent.keyboard('{Escape}');
			expect(room.box.getAttribute('aria-expanded')).toBe('false');
		});
		expect(under.height).toBeGreaterThan(0);

		for (const node of planted.splice(0)) node.remove();
		// the frame pushed down until the box sits a list's height off the viewport's bottom edge.
		const tight = await clipped(`${window.innerHeight - 380}px`);
		tight.box.focus();
		await userEvent.keyboard('{ArrowDown}');
		const above = (await placedList(tight.root)).getBoundingClientRect();
		expect(tight.box.getBoundingClientRect().bottom).toBeGreaterThan(window.innerHeight - 100);
		expect(above.bottom).toBeLessThanOrEqual(tight.box.getBoundingClientRect().top);
	});

	// a move is a disconnect and a connect, and the removal hides an open popover under the machine.
	// the box must not go on saying its list is open when no list is on screen.
	it('closes the list a move took off the screen', async () => {
		const host = await mount(CHOICE);
		const root = shadow(host);
		const box = root.querySelector<HTMLElement>('#program');
		if (box === null) throw new Error('no program box');
		box.focus();
		await userEvent.keyboard('{ArrowDown}');
		await vi.waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'));

		document.body.appendChild(host);

		await vi.waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('false'));
		expect(root.querySelector('#program-positioner')?.matches(':popover-open')).toBe(false);
	});
});

// two embeds on one page share its one caret. a card whose heading is replaced while the caret is
// off it says the new heading, because nothing moves the caret there — but a caret in another card
// is a donor busy with that card, and this one speaking into it is noise over what they are doing.
describe('two cards on one page', () => {
	/** a card booted onto a resume, holding its outcome until the case delivers it. */
	async function resuming(parent?: ParentNode): Promise<{ root: ShadowRoot; settles(): void }> {
		let answer: () => void = () => {};
		const host = await mount(CONFIG, {
			...(parent === undefined ? {} : { parent }),
			resume: { paymentToken: 'pi_1_secret_x' },
			ports: {
				resume: () =>
					new Promise((resolve) => {
						answer = () => resolve({ kind: 'processing' });
					})
			}
		});
		return { root: shadow(host), settles: () => answer() };
	}

	/** what the card's live region is saying, once a first sentence has had its task to wait. */
	async function said(root: ShadowRoot): Promise<string> {
		await settle();
		await settle();
		return root.querySelector('[role="status"]')?.textContent ?? '';
	}

	/** the control a donor on the amount step presses next, which is always on screen there. */
	function onward(root: ShadowRoot): HTMLElement {
		const node = root.querySelector<HTMLElement>(
			'.step:not([hidden]) [part~="action"]:not([part~="submit"])'
		);
		if (node === null) throw new Error('no Continue on screen');
		return node;
	}

	it('says the heading replaced under a caret on the host page', async () => {
		const other = await mount();
		const card = await resuming();
		const outside = document.createElement('button');
		document.body.append(outside);
		planted.push(outside);
		outside.focus();
		card.settles();

		expect(await said(card.root)).toBe('Your gift is on its way.');
		expect(shadow(other).activeElement).toBeNull();
		expect(document.activeElement).toBe(outside);
	});

	it('says nothing of it while the caret is on another card', async () => {
		const other = await mount();
		const card = await resuming();
		onward(shadow(other)).focus();
		card.settles();

		expect(await said(card.root)).toBe('');
		expect(card.root.querySelector('.takeover [part~="heading"]')?.textContent).toBe(
			'Your gift is on its way'
		);
		expect(shadow(other).activeElement).toBe(onward(shadow(other)));
	});

	// the payment provider's fields are the host's own light dom, slotted into the card, so a caret
	// in them sits under the other card's host rather than in its shadow root.
	it('says nothing of it while the caret is in another card’s payment fields', async () => {
		const fields: HTMLElement[] = [];
		let report: (method: PaymentMethod | null) => void = () => {};
		const other = await mount(CONFIG, {
			railed: (onRail) => {
				report = onRail;
			},
			painted: (node) => fields.push(node)
		});
		review(shadow(other));
		report('card');
		const field = document.createElement('input');
		field.setAttribute('aria-label', 'Card number');
		fields[0]?.append(field);
		const card = await resuming();
		field.focus();
		card.settles();

		expect(document.activeElement).toBe(field);
		expect(await said(card.root)).toBe('');
	});

	// a host page built from components of its own can hold an embed inside one, where the page's
	// caret reads as that component rather than as the card.
	it('says nothing of it while the caret is on a card inside the host page’s own component', async () => {
		const wrapper = document.createElement('div');
		document.body.append(wrapper);
		planted.push(wrapper);
		const other = await mount(CONFIG, { parent: wrapper.attachShadow({ mode: 'open' }) });
		const card = await resuming();
		onward(shadow(other)).focus();
		card.settles();

		expect(document.activeElement).toBe(wrapper);
		expect(await said(card.root)).toBe('');
	});

	it('says nothing of it from inside a closed root while the caret is on a card outside', async () => {
		const other = await mount();
		const wrapper = document.createElement('div');
		document.body.append(wrapper);
		planted.push(wrapper);
		const card = await resuming(wrapper.attachShadow({ mode: 'closed' }));
		onward(shadow(other)).focus();
		card.settles();

		expect(await said(card.root)).toBe('');
		expect(shadow(other).activeElement).toBe(onward(shadow(other)));
	});
});

// one takeover replacing another is no screen change, and the wait after Give paints no primary, so
// the press hides the control holding the caret. a real click is what decides where the caret is
// when the patch reads it — happy-dom's `click()` focuses nothing, and there the dom pool has to put
// the caret on the control by hand first.
describe('the caret when one takeover replaces another', () => {
	/** the correction screen, with the charge after Give held so the wait stays on screen. */
	async function atCorrection(parent?: ParentNode): Promise<ShadowRoot> {
		let report: (method: PaymentMethod | null) => void = () => {};
		const host = await mount(CONFIG, {
			...(parent === undefined ? {} : { parent }),
			railed: (onRail) => {
				report = onRail;
			},
			ports: {
				quote: async () => ({ paymentToken: 'pi_1', feeMinor: 150, totalMinor: 2650 }),
				confirm: () => new Promise<never>(() => {})
			}
		});
		const root = shadow(host);
		review(root);
		report('card');
		root.querySelector<HTMLElement>('[part~="submit"]')?.click();
		await settle();
		return root;
	}

	function heading(root: ShadowRoot): HTMLElement {
		const node = root.querySelector<HTMLElement>('.takeover [part~="heading"]');
		if (node === null) throw new Error('no takeover heading');
		return node;
	}

	function give(root: ShadowRoot): HTMLElement {
		const node = root.querySelector<HTMLElement>('.takeover > [part~="action"]');
		if (node === null) throw new Error('no takeover primary');
		return node;
	}

	/** every node the caret lands on inside `root` from here on, in order. */
	function caretMoves(root: ShadowRoot): EventTarget[] {
		const landed: EventTarget[] = [];
		root.addEventListener('focusin', (event) => {
			if (event.target !== null) landed.push(event.target);
		});
		return landed;
	}

	// the premise under the order `update` in ./views.ts reads the caret in: the engine takes the
	// caret off a control the moment it is hidden, so a read after the patch finds it gone.
	it('takes the caret off a control the moment it is hidden', async () => {
		const outer = document.createElement('div');
		document.body.append(outer);
		planted.push(outer);
		const root = outer.attachShadow({ mode: 'open' });
		const control = document.createElement('button');
		control.textContent = 'Give';
		root.append(control);
		await userEvent.click(control);
		expect(root.activeElement).toBe(control);

		control.hidden = true;

		expect(root.activeElement).toBeNull();
	});

	it('lands on the heading after a pointer press on Give, with no focus asked for first', async () => {
		const root = await atCorrection();
		expect(heading(root).textContent).toBe('The total changed');
		const focused = caretMoves(root);
		const press = give(root);

		await userEvent.click(press);

		expect(heading(root).textContent).toBe('Confirming your gift…');
		expect(press.hidden).toBe(true);
		expect(focused).toEqual([press, heading(root)]);
		expect(root.activeElement).toBe(heading(root));
	});

	it('lands on the heading after a pointer press on Give inside a closed shadow root', async () => {
		const outer = document.createElement('div');
		document.body.append(outer);
		planted.push(outer);
		const root = await atCorrection(outer.attachShadow({ mode: 'closed' }));
		const focused = caretMoves(root);
		const press = give(root);
		// no locator reaches into a closed root, so the pointer goes where Give is drawn instead.
		const drawn = press.getBoundingClientRect();
		const around = outer.getBoundingClientRect();

		await userEvent.click(outer, {
			position: {
				x: drawn.left - around.left + drawn.width / 2,
				y: drawn.top - around.top + drawn.height / 2
			}
		});

		expect(heading(root).textContent).toBe('Confirming your gift…');
		expect(focused).toEqual([press, heading(root)]);
		expect(root.activeElement).toBe(heading(root));
		expect(document.activeElement).toBe(outer);
	});
});

// arrow keys check a radio as they move onto it, so the other tile is chosen by a keyboard donor
// passing through the group as much as by one deciding on it. the box opens either way, but only a
// pointer press on the tile is a donor reaching for the box: a caret pulled out of the group by an
// arrow is a change of context on input (https://www.w3.org/WAI/WCAG22/Understanding/on-input).
describe('the other tile by keyboard and by pointer', () => {
	function tiles(root: ShadowRoot): HTMLInputElement[] {
		return [...root.querySelectorAll<HTMLInputElement>('[part~="amount-option"] input')];
	}

	function entry(root: ShadowRoot): HTMLInputElement {
		const node = root.querySelector<HTMLInputElement>('#amount-entry');
		if (node === null) throw new Error('no free entry');
		return node;
	}

	/** Continue pressed: a withdrawn amount keeps the donor on the step with the refusal shown. */
	function refusesTheAmount(root: ShadowRoot): void {
		root
			.querySelector<HTMLElement>('.step:not([hidden]) [part~="action"]:not([part~="submit"])')
			?.click();
		expect(root.querySelector<HTMLElement>('#amount-problem')?.hidden).toBe(false);
	}

	it('leaves the caret on the other tile when an arrow moves onto it from the last preset', async () => {
		const root = shadow(await mount());
		const [, last, other] = tiles(root);
		await userEvent.click(last as HTMLInputElement);
		await userEvent.keyboard('{ArrowRight}');
		await settle();

		expect(other?.checked).toBe(true);
		expect(root.activeElement).toBe(other);
		expect(root.querySelector<HTMLElement>('[part~="amount-input"]')?.hidden).toBe(false);
		expect(entry(root).value).toBe('');
		refusesTheAmount(root);
	});

	it('leaves the caret on the other tile when an arrow wraps onto it from the first preset', async () => {
		const root = shadow(await mount());
		const [first, , other] = tiles(root);
		await userEvent.click(first as HTMLInputElement);
		await userEvent.keyboard('{ArrowLeft}');
		await settle();

		expect(other?.checked).toBe(true);
		expect(root.activeElement).toBe(other);
		expect(root.querySelector<HTMLElement>('[part~="amount-input"]')?.hidden).toBe(false);
		expect(entry(root).value).toBe('');
		refusesTheAmount(root);
	});

	it('puts the caret in the free entry on a pointer press on the other tile', async () => {
		const root = shadow(await mount());
		const [, , other] = tiles(root);
		await userEvent.click(other as HTMLInputElement);
		await settle();

		expect(other?.checked).toBe(true);
		expect(root.activeElement).toBe(entry(root));
		expect(entry(root).value).toBe('');
		refusesTheAmount(root);
	});

	// a press on the tile while it is already chosen chooses nothing, so it fires no `change` to
	// spend the pointer on — and the arrow that later comes back onto the tile is still a keyboard.
	it('leaves the caret on the other tile when arrowed back onto after a press that chose nothing', async () => {
		const root = shadow(await mount());
		const [, , other] = tiles(root);
		await userEvent.click(other as HTMLInputElement);
		await userEvent.click(other as HTMLInputElement);
		(other as HTMLInputElement).focus();
		await userEvent.keyboard('{ArrowLeft}');
		await userEvent.keyboard('{ArrowRight}');
		await settle();

		expect(other?.checked).toBe(true);
		expect(root.activeElement).toBe(other);
	});
});
