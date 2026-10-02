import type {
	EligibilityLike,
	PaypalNamespaceLike,
	PaypalSdkLike,
	PaypalSessionLike,
	SessionOptionsLike
} from '@better-giving/form/embed/paypal';
import type {
	PaymentChangeLike,
	PaymentElementLike,
	StripeLike
} from '@better-giving/form/embed/stripe';
import { CHARIOT_TAG } from '@better-giving/form/embed/chariot';
import type { ChallengeSeam, TurnstileLike } from '@better-giving/form/embed/turnstile';
import { PART_NAMES, ROLE_TOKENS, STATE_TOKENS } from '@better-giving/form/parts';
import { DEPOSIT_POLL_MS, MICRODEPOSIT_WINDOW_MS } from '@better-giving/form/machine';
import type { FeeRules, FormConfig, Quote } from '@better-giving/form/v1';
import { act, createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { DonateCard } from './card';
import { Choice } from './choice';
import * as copy from './copy';
import { createReactPropTypes, reactPropTypes } from './normalize';
import { PaymentBox } from './payment';

// the card a donor uses, driven the way a donor drives it.
//
// money-shaped, so the coverage is the decisions rather than the markup: which amounts a press is
// refused for, which fields, what the fee decision does to the figure on the control that spends it,
// and what the card says out loud about each. every provider is reached through its own seam — one
// entry per processor plus the challenge's — so nothing here touches a network or a payment SDK.
//
// in the dom pool because what is asserted is the tree: which element carries a sentence, which
// control an `aria-describedby` names, where the caret landed. it is not the browser spec CLAUDE.md
// keeps for the form package — nothing here reads a computed style, and this page's dress is free to
// change.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no top layer and no popover methods, and the open lists — the closed choices'
// (./choice.tsx) and the coin list's — are shown as popovers; here the methods only have to exist.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

const FEE_RULES: FeeRules = {
	card: { percent: 0.029, fixedMinor: 30 },
	apple_pay: { percent: 0.029, fixedMinor: 30 },
	google_pay: { percent: 0.029, fixedMinor: 30 },
	ach: { percent: 0.008, fixedMinor: 0, capMinor: 500 },
	paypal: { percent: 0.0349, fixedMinor: 49 },
	venmo: { percent: 0.0349, fixedMinor: 49 },
	daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
	crypto: { percent: 0.01, fixedMinor: 0 }
};

const CONFIG: FormConfig = {
	formId: 'ff000000-0000-4000-8000-000000000001',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_spec' }],
	currency: 'usd',
	suggestedAmountsMinor: [1000, 2500, 5000],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time', 'monthly', 'yearly'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: FEE_RULES,
	locale: 'en-US',
	orgLegalName: 'Helping Hands',
	ein: '12-3456789',
	deductibilityStatement: 'Helping Hands is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA',
	program: {
		mode: 'choice',
		options: [
			{ id: 'p1', name: 'Clean water' },
			{ id: 'p2', name: 'Schools' }
		]
	}
};

/** what the provider answers a confirmation and a resume's read with, where a spec says. */
type Answers = {
	readonly confirm?: () => Promise<unknown>;
	readonly retrieve?: () => Promise<unknown>;
};

/** the payment provider, as a plain object, with the one report the flow needs off it. */
function paymentProvider(answers: Answers = {}) {
	const change: ((payload: PaymentChangeLike) => void)[] = [];
	const held: Record<string, unknown[]> = { change, ready: [], loaderror: [] };
	const element = {
		mount: () => {},
		focus: () => {},
		collapse: () => {},
		on: (event: string, handler: unknown) => {
			held[event]?.push(handler);
		},
		off: (event: string, handler: unknown) => {
			const list = held[event];
			const at = list?.indexOf(handler) ?? -1;
			if (list !== undefined && at !== -1) list.splice(at, 1);
		},
		destroy: () => {}
	} as unknown as PaymentElementLike;
	const stripe = {
		elements: () => ({ create: () => element, update: async () => {}, submit: async () => ({}) }),
		// never settles, so a gift that reaches the charge stays on the beat that is announced as one.
		confirmPayment: answers.confirm ?? (() => new Promise(() => {})),
		retrievePaymentIntent: answers.retrieve ?? (async () => ({}))
	} as unknown as StripeLike;
	return {
		load: async () => stripe,
		pick: (type: string) => {
			act(() => {
				for (const handler of [...change]) {
					handler({ collapsed: false, empty: false, value: { type } });
				}
			});
		},
		/** the element group saying its fields will not come up. */
		fail: () => {
			act(() => {
				for (const handler of [...(held.loaderror ?? [])]) {
					(handler as (payload: unknown) => void)({ error: { message: 'spec' } });
				}
			});
		}
	};
}

/** PayPal's hosted window, as a plain object: the buttons are the whole of what this spec presses. */
function paypalProvider() {
	const session = (_options: SessionOptionsLike): PaypalSessionLike => ({
		start: () => new Promise<unknown>(() => {}),
		destroy: () => {},
		cancel: () => {},
		hasReturned: () => false,
		resume: () => Promise.resolve()
	});
	const sdk: PaypalSdkLike = {
		findEligibleMethods: () =>
			Promise.resolve({ isEligible: () => true } satisfies EligibilityLike),
		createPayPalOneTimePaymentSession: session,
		createVenmoOneTimePaymentSession: session
	};
	const namespace: PaypalNamespaceLike = { createInstance: () => Promise.resolve(sdk) };
	return { load: async () => namespace };
}

/** Chariot's element, standing in: it keeps the one callback it is handed and nothing else. */
class StubConnect extends HTMLElement {
	donationRequest: (() => unknown) | null = null;
	onDonationRequest(callback: () => unknown): void {
		this.donationRequest = callback;
	}
}
if (customElements.get(CHARIOT_TAG) === undefined) customElements.define(CHARIOT_TAG, StubConnect);

/** the same deployment, holding Chariot's key beside the card processor's. */
const WITH_FUND: FormConfig = {
	...CONFIG,
	providers: [...CONFIG.providers, { name: 'chariot', publishableKey: 'cid_spec' }],
	paymentMethods: ['card', 'daf']
};

/** the fund's own button on the review step, pressed the way its script asks for the gift. */
function openFund(root: HTMLElement): StubConnect {
	const button = root.querySelector(CHARIOT_TAG);
	if (!(button instanceof StubConnect)) throw new Error('no fund button on the review step');
	act(() => {
		button.donationRequest?.();
	});
	return button;
}

const CHALLENGE: ChallengeSeam = {
	load: async () => {
		const api: TurnstileLike = { render: () => 'widget-1', reset: () => {}, remove: () => {} };
		return api;
	},
	delay: () => () => {}
};

/**
 * a card on a page, with both providers answered from plain objects.
 *
 * awaited, because both providers answer through a promise chain of their own: the element group is
 * built and subscribed a few microtasks after the effect that asked for it, and a spec that reported
 * a rail before then would be reporting into nothing.
 */
async function card(
	config: FormConfig = CONFIG,
	answers: Answers = {},
	{ strict = false }: { readonly strict?: boolean } = {}
) {
	const payment = paymentProvider(answers);
	const paypal = paypalProvider();
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	const drawn = (
		<DonateCard
			config={config}
			seams={{
				payment: {
					stripe: { load: payment.load, delay: () => () => {} },
					paypal: { load: paypal.load, delay: () => () => {} },
					chariot: { load: async () => true, delay: () => () => {} }
				},
				challenge: CHALLENGE
			}}
		/>
	);
	act(() => {
		// react-router's default client entry hydrates under `<StrictMode>`, which runs every effect
		// twice on a development mount.
		mounted.render(strict ? <StrictMode>{drawn}</StrictMode> : drawn);
	});
	onTestFinished(() => {
		act(() => {
			mounted.unmount();
		});
		host.remove();
	});
	await act(async () => {
		for (let at = 0; at < 4; at += 1) await Promise.resolve();
	});
	return { root: host, payment };
}

function one(root: HTMLElement, selector: string): HTMLElement {
	const node = root.querySelector(selector);
	if (!(node instanceof HTMLElement)) throw new Error(`nothing matched ${selector}`);
	return node;
}

function every(root: HTMLElement, selector: string): HTMLElement[] {
	return [...root.querySelectorAll(selector)].filter((node) => node instanceof HTMLElement);
}

function input(root: HTMLElement, selector: string): HTMLInputElement {
	const node = one(root, selector);
	if (!(node instanceof HTMLInputElement)) throw new Error(`${selector} is not an input`);
	return node;
}

/** the visible section, which is the one screen the card is showing. */
function screen(root: HTMLElement): HTMLElement {
	const open = every(root, 'section.step').filter((section) => !section.hidden);
	const only = open[0];
	if (only === undefined || open.length !== 1) throw new Error(`${open.length} screens are shown`);
	return only;
}

function press(node: HTMLElement): void {
	act(() => {
		node.click();
	});
}

/**
 * types into a box the way a keystroke does.
 *
 * through the prototype setter, which is what react's own change tracking reads — assigning
 * `box.value` leaves it believing the box still holds what it rendered.
 */
function type(box: HTMLInputElement, value: string): void {
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
		setter?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

/** what the card is saying out loud. */
function said(root: HTMLElement): string {
	return one(root, '[role="status"]').textContent ?? '';
}

const CONTINUE = 'section.step:not([hidden]) > button[part~="action"]';

/** a gift decided and a payer given, which is what the review step is reached with. */
function walkToGive(root: HTMLElement): void {
	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	type(input(root, '#email'), 'donor@example.org');
	type(input(root, '#first-name'), 'Ada');
	type(input(root, '#last-name'), 'Lovelace');
	press(one(root, CONTINUE));
}

it('draws the amounts, the cadences and the causes the configuration offers', async () => {
	const { root } = await card();

	expect(every(root, '.segment > label')).toHaveLength(3);
	// three suggestions and the way past them, which is drawn as one of them.
	expect(every(root, '.tiles > label')).toHaveLength(4);
	expect(every(root, '#program-list [role="option"]').map((row) => row.textContent)).toEqual([
		'Where it’s needed most',
		'Clean water',
		'Schools'
	]);
	// the entry is closed behind the way past the presets until a donor takes it.
	expect(one(root, '.tile.entry').hidden).toBe(true);
});

/** a closed choice opened from its box and a row pressed, the way a pointer does it. */
async function choose(root: HTMLElement, id: string, words: string): Promise<void> {
	press(one(root, `#${id}`));
	await act(async () => {});
	const row = every(root, `#${id}-list [role="option"]`).find((node) => node.textContent === words);
	if (row === undefined) throw new Error(`no ${words} in #${id}`);
	press(row);
	await act(async () => {});
}

// the box is a `role="combobox"` button rather than a native select, so what names it is the label
// ark points `aria-labelledby` at: the program's is on screen, the dedication's is for the name alone
// because the resting option already says what the box is for.
it('names each closed choice by its own label', async () => {
	const { root } = await card();
	press(input(root, '.disclosure.tribute input[type="checkbox"]'));

	for (const [id, words, hidden] of [
		['program', copy.PROGRAM, false],
		['tribute-kind', copy.TRIBUTE_KIND_LABEL, true]
	] as const) {
		const box = one(root, `#${id}`);
		expect(box.getAttribute('role'), id).toBe('combobox');
		const label = one(root, `#${box.getAttribute('aria-labelledby')}`);
		expect(label.tagName, id).toBe('LABEL');
		expect(label.textContent, id).toBe(words);
		expect(label.classList.contains('vh'), id).toBe(hidden);
	}
});

it('carries the cause a donor chose onto the review step', async () => {
	const { root } = await card();

	await choose(root, 'program', 'Schools');
	expect(one(root, '#program').getAttribute('aria-expanded')).toBe('false');
	expect(one(root, '#program [data-chosen]').textContent).toBe('Schools');

	walkToGive(root);
	expect(one(root, '.row.program .program-name').textContent).toBe('Schools');
});

it('holds the dedication a donor chose, on the box and on its row', async () => {
	const { root } = await card();
	press(input(root, '.disclosure.tribute input[type="checkbox"]'));

	expect(one(root, '#tribute-kind [data-chosen]').textContent).toBe('In honor of');
	await choose(root, 'tribute-kind', 'In memory of');

	expect(one(root, '#tribute-kind [data-chosen]').textContent).toBe('In memory of');
	const chosen = every(root, '#tribute-kind-list [role="option"]').filter((row) =>
		(row.getAttribute('part') ?? '').split(/\s+/).includes('selected')
	);
	expect(chosen.map((row) => row.textContent)).toEqual(['In memory of']);
});

const TRIBUTE_KINDS = (label: string) => ({
	name: 'tributeKind',
	value: 'honor',
	options: [
		{ value: 'honor', label: 'In honor of' },
		{ value: 'memory', label }
	],
	onChange: () => {}
});

// `connect` builds its options afresh on every projection; ark is handed a new collection only when
// what they say changed.
it('hands ark one collection for as long as the options say the same thing', () => {
	const held = createReactPropTypes();
	const project = (label: string) => held.select(TRIBUTE_KINDS(label)).root.collection;

	const first = project('In memory of');
	expect(project('In memory of')).toBe(first);
	expect(project('In remembrance of')).not.toBe(first);
});

// the page is server-rendered in a worker isolate that outlives a request, so a collection held at
// module scope would be handed from one donor's card to the next.
it('shares no collection between two cards, or between two readings taken once', () => {
	const read = () => reactPropTypes.select(TRIBUTE_KINDS('In memory of')).root.collection;
	expect(read()).not.toBe(read());

	const mounted = () =>
		createReactPropTypes().select(TRIBUTE_KINDS('In memory of')).root.collection;
	expect(mounted()).not.toBe(mounted());
});

// the flow is told once per pick, and not at all for a pick of what it already holds.
it('reports a pick to the flow once, with the value picked', async () => {
	const onChange = vi.fn();
	const choice = reactPropTypes.select({
		name: 'programId',
		value: '',
		options: [
			{ value: '', label: 'Where it’s needed most' },
			{ value: 'p1', label: 'Clean water' }
		],
		onChange
	});
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
			<Choice id="program" label={copy.PROGRAM} choice={choice} className="field-row" />
		);
	});
	onTestFinished(() => {
		act(() => {
			mounted.unmount();
		});
		host.remove();
	});

	await choose(host, 'program', 'Where it’s needed most');
	expect(onChange).not.toHaveBeenCalled();
	await choose(host, 'program', 'Clean water');
	expect(onChange.mock.calls).toEqual([['p1']]);
});

it('writes a pressed preset into the entry and lights that tile alone', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));

	const lit = every(root, '.tiles > label').map((tile) =>
		(tile.getAttribute('part') ?? '').includes('selected')
	);
	expect(lit).toEqual([false, true, false, false]);
	expect(input(root, '#amount-entry').value).toBe('25');
});

/**
 * a pointer press on a tile, the way a mouse or a finger makes one: `pointerdown` on the tile, then
 * the click the browser sends. a bare `click()` is what Space on a focused radio sends, so it stands
 * for the keyboard.
 */
function point(node: HTMLElement): void {
	act(() => {
		node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		node.click();
	});
}

/**
 * an arrow key moving the selection in a group of radios, as a browser moves it: the keydown on the
 * radio holding the caret, then the caret and the check on the next radio, which reports the click.
 * happy-dom moves neither, so the spec moves both.
 */
function arrow(from: HTMLInputElement, key: string, onto: HTMLInputElement): void {
	act(() => {
		from.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		onto.focus();
		onto.click();
		onto.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
	});
}

/** the tray's radios in order, Other last. */
function amountRadios(root: HTMLElement): HTMLInputElement[] {
	return every(root, '.tiles > label > input[type="radio"]').filter(
		(node) => node instanceof HTMLInputElement
	);
}

describe('the way past the presets', () => {
	it('opens the entry empty and takes the caret on a pointer press', async () => {
		const { root } = await card();

		point(one(root, '.tiles > label:nth-of-type(2)'));
		point(one(root, '.tiles > label.other'));

		const entry = input(root, '#amount-entry');
		expect(one(root, '.tile.entry').hidden).toBe(false);
		expect(entry.value).toBe('');
		expect(document.activeElement).toBe(entry);
	});

	it.each(['ArrowRight', 'ArrowDown'])(
		'leaves the caret on Other when %s reaches it from the last preset',
		async (key) => {
			const { root } = await card();
			const radios = amountRadios(root);
			const last = radios.at(-2);
			const other = radios.at(-1);
			if (last === undefined || other === undefined) throw new Error('no tray');

			act(() => last.focus());
			press(last);
			arrow(last, key, other);

			expect(document.activeElement).toBe(other);
			expect(other.checked).toBe(true);
			expect(one(root, '.tile.entry').hidden).toBe(false);
			expect(input(root, '#amount-entry').value).toBe('');
		}
	);

	it.each(['ArrowLeft', 'ArrowUp'])(
		'leaves the caret on Other when %s wraps onto it from the first preset',
		async (key) => {
			const { root } = await card();
			const radios = amountRadios(root);
			const first = radios[0];
			const other = radios.at(-1);
			if (first === undefined || other === undefined) throw new Error('no tray');

			act(() => first.focus());
			press(first);
			arrow(first, key, other);

			expect(document.activeElement).toBe(other);
			expect(other.checked).toBe(true);
			expect(one(root, '.tile.entry').hidden).toBe(false);
			expect(input(root, '#amount-entry').value).toBe('');
		}
	);

	it('leaves the caret on Other when Space selects it', async () => {
		const { root } = await card();
		const other = amountRadios(root).at(-1);
		if (other === undefined) throw new Error('no tray');

		act(() => other.focus());
		act(() => {
			other.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
			other.click();
		});

		expect(document.activeElement).toBe(other);
		expect(one(root, '.tile.entry').hidden).toBe(false);
	});

	it('does not carry a pointer press that selected nothing onto a later arrow', async () => {
		const { root } = await card();
		const radios = amountRadios(root);
		const last = radios.at(-2);
		const other = radios.at(-1);
		if (last === undefined || other === undefined) throw new Error('no tray');

		// the press lands on the tile and is dragged off it, so no click and no selection follow.
		act(() => {
			one(root, '.tiles > label.other').dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true })
			);
		});
		act(() => last.focus());
		press(last);
		arrow(last, 'ArrowRight', other);

		expect(document.activeElement).toBe(other);
	});

	it.each([
		['a pointer press', (root: HTMLElement) => point(one(root, '.tiles > label.other'))],
		[
			'an arrow key',
			(root: HTMLElement) => {
				const radios = amountRadios(root);
				const last = radios.at(-2);
				const other = radios.at(-1);
				if (last === undefined || other === undefined) throw new Error('no tray');
				arrow(last, 'ArrowRight', other);
			}
		]
	])('withdraws the preset amount on %s, so Continue is refused for it', async (_way, reach) => {
		const { root } = await card();

		press(one(root, '.tiles > label:nth-of-type(2)'));
		reach(root);
		press(one(root, CONTINUE));

		expect(input(root, '#amount-entry').getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(input(root, '#amount-entry'));
	});
});

it('refuses a figure outside the bounds and states them where the caret cannot land', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label.other'));
	type(input(root, '#amount-entry'), '1.00');
	press(one(root, CONTINUE));

	expect(one(root, '#amount-problem').hidden).toBe(false);
	expect(one(root, '#amount-problem').textContent).toBe('between $5 and $5,000');
	expect(input(root, '#amount-entry').getAttribute('aria-invalid')).toBe('true');
	// the caret lands on a control inside a fieldset, where a group's description is not reliably
	// announced from a descendant — so the sentence is on the region however the press was made, and
	// spoken with its subject, which the visible sentence takes from where it stands.
	expect(said(root)).toBe('Amount: between $5 and $5,000');
	expect(document.activeElement).toBe(input(root, '#amount-entry'));
});

it('describes the entry by the bounds while a missing amount is marked', async () => {
	const { root } = await card();
	const entry = input(root, '#amount-entry');

	// before any press the sentence is not on screen, so nothing describes the box by it.
	expect(entry.hasAttribute('aria-describedby')).toBe(false);

	press(one(root, '.tiles > label.other'));
	press(one(root, CONTINUE));

	expect(entry.getAttribute('aria-invalid')).toBe('true');
	expect(entry.getAttribute('aria-describedby')).toBe('amount-problem');
	expect(one(root, '#amount-problem').hidden).toBe(false);
});

it('names every decision a press was refused for, not the first', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label.other'));
	press(input(root, '.disclosure.note input[type="checkbox"]'));
	press(one(root, CONTINUE));

	expect(one(root, '#amount-problem').hidden).toBe(false);
	expect(one(root, '#note-problem').hidden).toBe(false);
	// the note's sentence is on the control itself, so it is not repeated on the region.
	expect(said(root)).toBe('Amount: between $5 and $5,000');
});

it('marks a dedication the press was refused for and clears it when the block is taken back', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	const tick = input(root, '.disclosure.tribute input[type="checkbox"]');
	press(tick);
	expect(document.activeElement).toBe(input(root, '#tribute-honoree'));

	press(one(root, CONTINUE));
	expect(one(root, '#tribute-honoree-problem').hidden).toBe(false);
	expect(input(root, '#tribute-honoree').getAttribute('aria-invalid')).toBe('true');

	// untaking the dedication takes the decision out of the set altogether.
	press(tick);
	expect(one(root, '#tribute-honoree-problem').hidden).toBe(true);
	expect(screen(root)).toBe(one(root, 'section.step'));
});

it('opens the notify pair on the press and empties both boxes when it is shut', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(input(root, '.disclosure.tribute input[type="checkbox"]'));
	const notify = one(root, 'button[aria-controls="tribute-notify"]');

	press(notify);
	expect(one(root, '#tribute-notify').hidden).toBe(false);
	expect(notify.getAttribute('aria-expanded')).toBe('true');
	expect(document.activeElement).toBe(input(root, '#tribute-notify-name'));

	type(input(root, '#tribute-notify-name'), 'Grace');
	press(notify);

	expect(one(root, '#tribute-notify').hidden).toBe(true);
	expect(input(root, '#tribute-notify-name').value).toBe('');
	expect(notify.textContent).toBe(copy.NOTIFY_SHUT);
});

it('carries the cadence a donor picked onto the receipt', async () => {
	const { root } = await card();

	press(one(root, '.segment > label:nth-of-type(2)'));
	walkToGive(root);

	expect(one(root, '[part~="summary"] .row-label').textContent).toBe('Monthly gift');
	// the repeat sentence states the total rather than the gift: it is what will be charged again.
	expect(one(root, '.receipt-note').textContent).toBe(
		`Then ${one(root, 'output.figure').textContent} monthly until you cancel.`
	);
});

// the label on each of the three boxes is a real `<label for>`, and the words in it are what the box
// is named by: a placeholder or an `aria-label` standing in for a label would be neither announced
// on every reading nor left on screen once the donor starts typing.
//
// a floating label holds the name alone — the refusal the box is carrying stands beside the box
// rather than inside the label — so every box on the step is named by its own label's words, and
// none of them carries a naming attribute of any kind.
it('binds a real label to every box a donor types their details into', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));

	for (const [id, words] of [
		['email', copy.EMAIL],
		['first-name', copy.FIRST_NAME],
		['last-name', copy.LAST_NAME]
	] as const) {
		const label = one(root, `label[for="${id}"]`);
		expect(label.textContent).toBe(words);
		expect(input(root, `#${id}`).hasAttribute('aria-label'), id).toBe(false);
		expect(input(root, `#${id}`).hasAttribute('aria-labelledby'), id).toBe(false);
	}
});

// the pair is one question and says so structurally, so the two boxes are announced under the name
// the group asks for rather than as two unrelated asks between the address and the consent.
it('groups the two name boxes under one legend', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));

	const group = one(root, 'fieldset:has(#first-name)');
	expect(one(group, 'legend').textContent).toBe(copy.YOUR_NAME);
	expect(group.contains(input(root, '#last-name'))).toBe(true);
	// the address is its own ask and stays outside the pair.
	expect(group.contains(input(root, '#email'))).toBe(false);
});

// which of the two constructions a box is drawn with is the row's to say, and this authorship has
// to say the same thing the element's own does: a box inside a named group of boxes carries the
// hook the stylesheet keys on and the blank placeholder those rules tell its two states apart by,
// and a box standing on its own carries neither and keeps its label over it.
it('asks for a label inside the box on the pair and never on the address', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));

	for (const id of ['first-name', 'last-name']) {
		const box = input(root, `#${id}`);
		expect(box.closest('.field-row')?.className, id).toBe('field-row floating');
		expect(box.getAttribute('placeholder'), id).toBe(' ');
	}

	const email = input(root, '#email');
	expect(email.closest('.field-row')?.className).toBe('field-row');
	expect(email.hasAttribute('placeholder')).toBe(false);
});

it('marks only the payer fields the press was refused for and puts the caret on the first', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	type(input(root, '#email'), 'donor@example.org');
	press(one(root, CONTINUE));

	expect(one(root, '#email-problem').hidden).toBe(true);
	expect(one(root, '#first-name-problem').hidden).toBe(false);
	expect(one(root, '#first-name-problem').textContent).toBe(copy.NAME_PROBLEM);
	expect(input(root, '#first-name').getAttribute('aria-describedby')).toBe('first-name-problem');
	expect(document.activeElement).toBe(input(root, '#first-name'));
	// and it is said under the box, in the row's own column, on this row as on every other: one
	// construction, so nothing about the sentence follows where the box's label stands.
	expect(one(root, '#first-name-problem').parentElement).toBe(
		input(root, '#first-name').parentElement
	);
	expect(one(root, '#first-name-problem').tagName).toBe('P');
	expect(one(root, '#email-problem').tagName).toBe('P');
	expect(one(root, '#email-problem').parentElement?.className).toBe('field-row');
});

// the press that moved no caret: it is on the first refused box already, so the region is the only
// channel, and a list of bare problems would say which rules broke without saying which boxes.
it('names each refused field when a press leaves the caret where it was', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	type(input(root, '#last-name'), 'Lovelace');
	act(() => {
		input(root, '#email').focus();
	});
	press(one(root, CONTINUE));

	expect(document.activeElement).toBe(input(root, '#email'));
	expect(said(root)).toBe('Email: required for your receipt; First name: required');
	// the sentences under the boxes are unchanged: their label is the one standing over them.
	expect(one(root, '#email-problem').textContent).toBe(copy.EMAIL_MISSING);
	expect(one(root, '#first-name-problem').textContent).toBe(copy.NAME_PROBLEM);
});

it('says which of the two rules an address broke', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, CONTINUE));
	type(input(root, '#email'), 'not-an-address');
	type(input(root, '#first-name'), 'Ada');
	type(input(root, '#last-name'), 'Lovelace');
	press(one(root, CONTINUE));

	expect(one(root, '#email-problem').textContent).toBe(copy.EMAIL_MALFORMED);
});

it('moves the total and the control that spends it when the fee decision changes', async () => {
	const { root } = await card();
	walkToGive(root);

	const total = one(root, 'output.figure');
	const submit = one(root, 'button[part~="submit"] .action-label');
	const covered = total.textContent;
	expect(submit.textContent).toBe(`Donate ${covered}`);

	press(input(root, '.fee-decision input[type="checkbox"]'));

	expect(total.textContent).not.toBe(covered);
	expect(submit.textContent).toBe(`Donate ${total.textContent}`);
	// the box reports its own new setting; the figure that moved is the half nobody is told.
	expect(said(root)).toBe(`Total today is ${total.textContent}.`);
});

// the figure is an `<output>`, a polite region by its tag alone, so a selector reading `role` off the
// attribute never finds it: what is asserted is the attribute that overrides the tag. it is off on
// every commit, and the card's one region is where a total that moved is said.
it('says a fee decision once, on the card’s region and never on the figure’s own', async () => {
	const { root } = await card();
	walkToGive(root);
	const total = one(root, 'output.figure');
	expect(total.getAttribute('aria-live')).toBe('off');

	press(input(root, '.fee-decision input[type="checkbox"]'));

	expect(said(root)).toBe(`Total today is ${total.textContent}.`);
	expect(total.getAttribute('aria-live')).toBe('off');
});

/** the same deployment offering a bank debit beside the card, which the fee rules price apart. */
const WITH_BANK: FormConfig = { ...CONFIG, paymentMethods: ['card', 'ach'] };

it('says a total a rail pick moved once, on the card’s region', async () => {
	const { root, payment } = await card(WITH_BANK);
	walkToGive(root);
	payment.pick('card');
	const total = one(root, 'output.figure');
	const onCard = total.textContent;

	payment.pick('us_bank_account');

	expect(total.textContent).not.toBe(onCard);
	expect(said(root)).toBe(`Total today is ${total.textContent}.`);
	expect(total.getAttribute('aria-live')).toBe('off');
});

it('says nothing about the total when a rail pick leaves it where it was', async () => {
	const { root, payment } = await card(WITH_BANK);
	walkToGive(root);
	payment.pick('card');
	const total = one(root, 'output.figure').textContent;

	payment.pick('card');

	expect(one(root, 'output.figure').textContent).toBe(total);
	expect(said(root)).toBe('');
});

// a refused press has been heard, and the box keeps the refusal as its description; a total that
// moved after it is news the region would otherwise never carry, because the figure is silent.
it('says a total moved under a standing refusal on the card’s region', async () => {
	const { root } = await card();
	walkToGive(root);
	press(one(root, 'button[part~="submit"]'));
	expect(said(root)).toBe(copy.PAYMENT_PROBLEM);
	const total = one(root, 'output.figure');

	press(input(root, '.fee-decision input[type="checkbox"]'));

	expect(said(root)).toBe(`Total today is ${total.textContent}.`);
	expect(total.getAttribute('aria-live')).toBe('off');
	expect(one(root, '#payment-problem').hidden).toBe(false);
});

it('refuses a press with no rail, and says so on the box and on the region', async () => {
	const { root } = await card();
	walkToGive(root);

	press(one(root, 'button[part~="submit"]'));

	const box = one(root, '[part~="payment"]');
	expect(one(root, '#payment-problem').hidden).toBe(false);
	expect(one(root, '#payment-problem').textContent).toBe(copy.PAYMENT_PROBLEM);
	expect(box.getAttribute('aria-describedby')).toBe('payment-problem');
	expect(said(root)).toBe(copy.PAYMENT_PROBLEM);
	expect(document.activeElement).toBe(box);
});

it('takes the press once a rail is reported, and stays on the review screen while it works', async () => {
	const { root, payment } = await card();
	// a quote nothing settles, which is what a press in flight is.
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>(() => {}))
	);
	walkToGive(root);
	payment.pick('card');

	press(one(root, 'button[part~="submit"]'));

	// a busy flow stays where it happened rather than dropping the donor onto a blank frame.
	expect(screen(root).className).toContain('step-give');
	expect(one(root, 'form.card-body').getAttribute('aria-busy')).toBe('true');
	expect(said(root)).toBe(copy.WORKING);
	expect(one(root, '#payment-problem').hidden).toBe(true);
});

it('emits only part names the element publishes, and no control anywhere is disabled', async () => {
	const { root, payment } = await card();
	const known = new Set<string>([...PART_NAMES, ...STATE_TOKENS, ...ROLE_TOKENS]);
	const names = new Set<string>();
	const collect = (): void => {
		for (const node of every(root, '[part]')) {
			const tokens = (node.getAttribute('part') ?? '').split(/\s+/).filter((one) => one !== '');
			const [name, ...rest] = tokens;
			if (name !== undefined) names.add(name);
			for (const token of tokens) expect(known.has(token)).toBe(true);
			// a state never spawns a name: the tokens past the first are the published state and role
			// vocabulary, never a thirteenth part.
			for (const token of rest) {
				expect([...STATE_TOKENS, ...ROLE_TOKENS] as readonly string[]).toContain(token);
			}
		}
		expect(every(root, '[disabled]')).toEqual([]);
	};

	collect();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new Error('no network in this pool');
		})
	);
	walkToGive(root);
	collect();
	payment.pick('card');
	await act(async () => {
		one(root, 'button[part~="submit"]').click();
	});
	// the failure takeover, which is the fourth screen and the one no numbered step draws.
	expect(one(root, 'section.takeover').hidden).toBe(false);
	collect();

	expect([...names].sort()).toEqual(
		[...names].filter((name) => (PART_NAMES as readonly string[]).includes(name)).sort()
	);
	expect(names.size).toBeGreaterThan(6);
});

// the hole this page had while its payment seam composed one processor: a deployment holding
// PayPal's keys and no card processor's served its own donation page with no way to pay on it.
it('draws a way to pay on a config that offers only PayPal’s rails', async () => {
	const { root } = await card({
		...CONFIG,
		providers: [{ name: 'paypal', publishableKey: 'live_client_id' }],
		paymentMethods: ['paypal']
	});
	walkToGive(root);

	const box = one(root, '[part~="payment"]');
	expect(box.hidden).toBe(false);
	expect(box.querySelector('paypal-button')).not.toBeNull();
});

it('draws both processors’ boxes where a deployment holds both', async () => {
	const { root } = await card({
		...CONFIG,
		providers: [
			{ name: 'stripe', publishableKey: 'pk_test_spec' },
			{ name: 'paypal', publishableKey: 'live_client_id' }
		],
		paymentMethods: ['card', 'paypal']
	});
	walkToGive(root);

	// one box on the card and a node inside it per processor, placed and ordered by the composer.
	const box = one(root, '[part~="payment"]');
	expect(box.children).toHaveLength(2);
	expect(box.querySelector('paypal-button')).not.toBeNull();
});

it('draws no header over a box listing one option, and names the box itself', async () => {
	const { root } = await card();
	walkToGive(root);

	const box = one(root, '[part~="payment"]');
	expect(one(root, '#payment-heading').hidden).toBe(true);
	expect(box.getAttribute('aria-label')).toBe(copy.PAYMENT_DETAILS);
	expect(box.hasAttribute('aria-labelledby')).toBe(false);
});

// the sheet both surfaces share closes the gap on this pair by adjacency
// (`.aside:has(+ [part~='submit'])` in packages/form/src/styles/layout.css), so anything standing
// between the two leaves the line at the step's own rhythm between two blocks, reading as a third.
it('stands the line saying where the receipt goes directly over the press', async () => {
	const { root } = await card();
	walkToGive(root);

	const line = one(root, 'section.step-give > p.aside');
	expect(line.hidden).toBe(false);
	expect(line.textContent).toBe(copy.receiptTo('donor@example.org'));
	expect(line.nextElementSibling).toBe(one(root, 'button[part~="submit"]'));
});

it('heads a box listing a choice, and names the box by the header', async () => {
	const { root } = await card({ ...CONFIG, paymentMethods: ['card', 'ach'] });
	walkToGive(root);

	const heading = one(root, '#payment-heading');
	const box = one(root, '[part~="payment"]');
	expect(heading.hidden).toBe(false);
	expect(heading.tagName).toBe('H3');
	expect(heading.getAttribute('part')).toBe('label');
	expect(heading.textContent).toBe(copy.PAYMENT_HEADING);
	expect(box.getAttribute('aria-labelledby')).toBe('payment-heading');
	expect(box.hasAttribute('aria-label')).toBe(false);
});

// the card starts its checkout in an effect, so an unprepared box is the server-rendered one: drawn
// here through the box alone rather than through a card that prepares itself on mount.
it('draws no header over a box that is not prepared, however many options it lists', () => {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
			<PaymentBox mount={createRef()} prepared={false} rows={2} words="" aside={false} />
		);
	});
	onTestFinished(() => {
		act(() => {
			mounted.unmount();
		});
		host.remove();
	});

	const box = one(host, '[part~="payment"]');
	expect(box.hidden).toBe(true);
	expect(one(host, '#payment-heading').hidden).toBe(true);
	expect(box.getAttribute('aria-label')).toBe(copy.PAYMENT_DETAILS);
	expect(box.hasAttribute('aria-labelledby')).toBe(false);
});

// the charge is different news from the mint for a donor who cannot see the spinner, and on which
// rail is different news again: the sentence is the one place this page says who is holding it.
it('names the rail in what it says out loud while the charge is in flight', async () => {
	const { root, payment } = await card();
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(
					// the figure the card is showing, answered back: a quote that moved lands on the
					// correction screen instead, which is a different sentence and a different test.
					JSON.stringify({ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		)
	);
	walkToGive(root);
	payment.pick('card');

	await act(async () => {
		one(root, 'button[part~="submit"]').click();
		for (let at = 0; at < 6; at += 1) await Promise.resolve();
	});

	expect(said(root)).toBe('Confirming your gift with your card issuer.');
	expect(said(root)).toBe(copy.confirming('card'));
	// and not the bank's, which a card donor is never waiting on.
	expect(said(root)).not.toBe(copy.confirming('ach'));
});

// the donor is in their fund's window, which is the fund's own page rather than a request this card
// is waiting on: the card stays on the review step, is not busy, and keeps the fund's button standing
// — its window's endings are heard on that element, and a button taken down drops the approval.
it('stays on the review step, unbusied, with the fund’s button standing while its window is open', async () => {
	const { root } = await card(WITH_FUND);
	walkToGive(root);

	const button = openFund(root);

	expect(screen(root).className).toContain('step-give');
	expect(one(root, 'form.card-body').hasAttribute('aria-busy')).toBe(false);
	expect(said(root)).toBe('');
	expect(root.querySelector(CHARIOT_TAG)).toBe(button);
});

// with the card's fields down and only a fund up, a repeating gift has no rail left but can still be
// made one-time: the review step offers that in place of a box with nothing in it, in the element's
// words (`oneTimeOfferWords` in packages/form/src/views.ts).
describe('a repeating gift no processor still up can take', () => {
	const OFFER =
		'This gift cannot be made monthly right now. You can make it a one-time gift instead.';

	/** the review step of a gift on `cadence`, on a form whose card fields then fail. */
	async function atReview(cadence: 1 | 2 | 3 = 2) {
		const reached = await card(WITH_FUND);
		press(one(reached.root, `.segment > label:nth-of-type(${cadence})`));
		walkToGive(reached.root);
		reached.payment.fail();
		return reached;
	}

	const offer = (root: HTMLElement) => one(root, '.step-give .attention');
	const makeOneTime = (root: HTMLElement) => one(root, '.step-give .attention + [part~="action"]');
	const paymentGroup = (root: HTMLElement) =>
		one(root, '[part~="payment"]').closest('.group') as HTMLElement;

	it('offers the gift as one-time in place of the payment box, and draws no Donate', async () => {
		const { root } = await atReview();

		expect(screen(root).className).toContain('step-give');
		expect(offer(root).closest('[hidden]')).toBeNull();
		expect(offer(root).textContent).toBe(OFFER);
		expect(makeOneTime(root).textContent).toBe('Make it one-time');
		expect(makeOneTime(root).getAttribute('type')).toBe('button');
		expect(paymentGroup(root).hidden).toBe(true);
		expect(one(root, 'button[part~="submit"]').hidden).toBe(true);
		expect(said(root)).toBe(OFFER);
	});

	it('names a yearly gift’s cadence in the offer', async () => {
		const { root } = await atReview(3);

		expect(offer(root).textContent).toBe(
			'This gift cannot be made yearly right now. You can make it a one-time gift instead.'
		);
	});

	it('makes the gift one-time on the press, says so, and puts the caret on the payment box', async () => {
		const { root } = await atReview();
		expect(root.querySelector(CHARIOT_TAG)).toBeNull();

		press(makeOneTime(root));

		expect(screen(root).className).toContain('step-give');
		expect(one(root, '[part~="summary"] .row-label').textContent).toBe('One-time gift');
		expect(offer(root).closest('[hidden]')).not.toBeNull();
		expect(paymentGroup(root).hidden).toBe(false);
		expect(one(root, 'button[part~="submit"]').hidden).toBe(false);
		expect(said(root)).toBe('This is now a one-time gift.');
		expect(document.activeElement).toBe(one(root, '[part~="payment"]'));
		// the fund's rail, which takes a one-time gift only, is offered from this reading on.
		expect(root.querySelector(CHARIOT_TAG)).not.toBeNull();
	});

	it('offers nothing on a one-time gift', async () => {
		const { root } = await atReview(1);

		expect(offer(root).closest('[hidden]')).not.toBeNull();
		expect(paymentGroup(root).hidden).toBe(false);
		expect(one(root, 'button[part~="submit"]').hidden).toBe(false);
		expect(said(root)).not.toBe(OFFER);
	});
});

// the donor may change the amount inside the fund's window, and the grant is recorded from what the
// fund approved — so the ending states the server's figures, not the ones the review step showed.
it('states the granted figures on the ending, not the ones the form showed', async () => {
	const { root } = await card(WITH_FUND);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify({ paymentToken: 'grant_1', feeMinor: 200, totalMinor: 5200 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		)
	);
	walkToGive(root);
	expect(one(root, '.row.total .figure').textContent).not.toBe('$52.00');

	const button = openFund(root);
	await act(async () => {
		button.dispatchEvent(
			new CustomEvent('CHARIOT_SUCCESS', {
				detail: { workflowSessionId: 'wfs_1', grantIntent: { amount: 5200 } }
			})
		);
		for (let at = 0; at < 20; at += 1) await Promise.resolve();
	});

	const ending = screen(root);
	expect(ending.className).toContain('takeover');
	expect(one(ending, 'h2').textContent).toBe(copy.PROCESSING_HEADING);
	expect(one(ending, '.row:not(.fee):not(.total) .figure').textContent).toBe('$50.00');
	expect(one(ending, '.row.fee .figure').textContent).toBe('+ $2.00');
	expect(one(ending, '.row.total .figure').textContent).toBe('$52.00');
	expect(one(ending, '.row.total .row-label').textContent).toBe('Grant requested');
	expect(one(ending, '.prose').textContent).toContain('Your fund has your grant request');
	expect(one(ending, '.prose').textContent).not.toContain('charge');
});

// one takeover giving way to another is no screen change, and it can take the control holding the
// caret with it: Give and Authorize go to a wait that paints no primary.
describe('where the caret goes when one takeover replaces another', () => {
	// through the screen the card shows rather than the takeover's class, so a renamed class leaves
	// these specs reading the same elements and only the card's section ref decides the outcome.
	function takeoverHeading(root: HTMLElement): HTMLElement {
		return one(screen(root), ':scope > h2');
	}

	function takeoverPrimary(root: HTMLElement): HTMLElement {
		return one(screen(root), ':scope > button[part~="action"]');
	}

	/** the deployment's quote endpoint, answering every request with `body`. */
	function quoting(body: unknown): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify(body), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
			)
		);
	}

	/** a control pressed from the keyboard, so the caret starts on it. */
	async function pressHeld(node: HTMLElement): Promise<void> {
		await act(async () => {
			node.focus();
			node.click();
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});
	}

	/** the review step of a card gift, with Donate pressed from the keyboard. */
	async function donated(quote: unknown, answers: Answers = {}) {
		quoting(quote);
		const { root, payment } = await card(CONFIG, answers);
		walkToGive(root);
		payment.pick('card');
		await pressHeld(one(root, 'button[part~="submit"]'));
		return root;
	}

	// a figure other than the one the review step shows, which is what lands on the correction.
	const MOVED = { paymentToken: 'pi_1_secret_x', feeMinor: 200, totalMinor: 2700 };
	const MANDATE = {
		paymentToken: 'pi_1_secret_x',
		feeMinor: 106,
		totalMinor: 2606,
		mandate: { text: 'By clicking, you authorize the debit of your account.' }
	};

	it('lands on the heading when Give on the correction screen hands the card to the wait', async () => {
		const root = await donated(MOVED);
		expect(takeoverHeading(root).textContent).toBe(copy.CORRECTION_HEADING);

		await pressHeld(takeoverPrimary(root));

		expect(takeoverHeading(root).textContent).toBe(copy.CONFIRMING_HEADING);
		expect(one(screen(root), '.prose').textContent).toBe(copy.CONFIRMING_BODY);
		expect(takeoverPrimary(root).hidden).toBe(true);
		expect(document.activeElement).toBe(takeoverHeading(root));
	});

	it('lands on the heading when Authorize on the mandate hands the card to the wait', async () => {
		const root = await donated(MANDATE);
		expect(takeoverHeading(root).textContent).toBe(copy.MANDATE_HEADING);

		await pressHeld(takeoverPrimary(root));

		expect(takeoverHeading(root).textContent).toBe(copy.CONFIRMING_HEADING);
		expect(one(screen(root), '.prose').textContent).toBe(copy.CONFIRMING_BODY);
		expect(takeoverPrimary(root).hidden).toBe(true);
		expect(document.activeElement).toBe(takeoverHeading(root));
	});

	// after Give the wait has put the caret on the heading, and a heading's words replaced under a
	// caret already on it are read by nobody unless the region reads them.
	it('says a heading replaced under the caret once, in its own words', async () => {
		let settle: (result: unknown) => void = () => {};
		const root = await donated(MOVED, {
			confirm: () =>
				new Promise((resolve) => {
					settle = resolve;
				})
		});
		await pressHeld(takeoverPrimary(root));
		const heading = takeoverHeading(root);
		expect(document.activeElement).toBe(heading);
		expect(said(root)).toBe(copy.confirming('card'));

		await act(async () => {
			settle({ paymentIntent: { status: 'processing' } });
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});

		expect(heading.textContent).toBe(copy.PROCESSING_HEADING);
		expect(document.activeElement).toBe(heading);
		expect(said(root)).toBe(`${copy.PROCESSING_HEADING}.`);
	});

	// straight from the review step the caret arrives on the heading, and arriving reads it: the
	// region saying the same words again is the heading twice.
	it('leaves the heading to the caret that arrives on it', async () => {
		const root = await donated(
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 },
			{ confirm: async () => ({ paymentIntent: { status: 'processing' } }) }
		);

		expect(takeoverHeading(root).textContent).toBe(copy.PROCESSING_HEADING);
		expect(document.activeElement).toBe(takeoverHeading(root));
		expect(said(root)).toBe('');
	});

	// the flow closes the verification window on its own clock, under the caret the arrival put on
	// the heading: focusing the node that holds focus says nothing, so the region says the new words.
	it('says the window closing to a donor whose caret is on the heading', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const root = await donated(
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 },
			{
				confirm: async () => ({
					paymentIntent: {
						status: 'requires_action',
						next_action: { type: 'verify_with_microdeposits' }
					}
				})
			}
		);
		const heading = takeoverHeading(root);
		expect(heading.textContent).toBe(copy.VERIFY_HEADING);
		expect(document.activeElement).toBe(heading);
		expect(said(root)).toBe('');

		await act(async () => {
			await vi.advanceTimersByTimeAsync(MICRODEPOSIT_WINDOW_MS);
		});

		expect(heading.textContent).toBe(copy.EXPIRED_HEADING);
		expect(document.activeElement).toBe(heading);
		expect(said(root)).toBe(`${copy.EXPIRED_HEADING}.`);
	});

	// back to start remounts the card, which takes the pressed control with it; the new card's first
	// step is where the caret was, so it lands on that step's heading rather than on the page body.
	it('lands on the first step’s heading when Back to start rebuilds the card under the caret', async () => {
		const root = await donated(
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 },
			{ confirm: async () => ({ paymentIntent: { status: 'succeeded' } }) }
		);
		expect(takeoverHeading(root).textContent).toBe(copy.SUCCESS_HEADING);
		const back = every(screen(root), 'button').find(
			(button) => button.textContent === copy.BACK_TO_START
		);
		if (back === undefined) throw new Error('the ending drew no way back to the start');

		await pressHeld(back);

		const heading = one(screen(root), 'h2');
		expect(heading.textContent).toBe(copy.STEP_HEADINGS[0]);
		expect(document.activeElement).toBe(heading);
	});

	// a click that leaves the caret on the host page — Safari on macOS focuses no button on a click —
	// is a restart the caret was never in, so the rebuilt card leaves it where it is.
	it('leaves the caret on the host page when Back to start is pressed from outside the card', async () => {
		const root = await donated(
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 },
			{ confirm: async () => ({ paymentIntent: { status: 'succeeded' } }) }
		);
		const back = every(screen(root), 'button').find(
			(button) => button.textContent === copy.BACK_TO_START
		);
		if (back === undefined) throw new Error('the ending drew no way back to the start');
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		onTestFinished(() => {
			elsewhere.remove();
		});
		elsewhere.focus();

		press(back);

		expect(one(screen(root), 'h2').textContent).toBe(copy.STEP_HEADINGS[0]);
		expect(document.activeElement).toBe(elsewhere);
	});

	// the card's own first paint is no screen change: a donor tabbing through the host page keeps
	// their place while the card loads.
	it('takes no focus on a first load with the caret elsewhere on the page', async () => {
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		onTestFinished(() => {
			elsewhere.remove();
		});
		elsewhere.focus();

		await card();

		expect(document.activeElement).toBe(elsewhere);
	});

	// a resume boots onto a takeover and is replaced by its outcome a moment later, with the caret
	// wherever the page left it.
	it('takes no focus when a resume’s outcome replaces the takeover it booted onto', async () => {
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		onTestFinished(() => {
			elsewhere.remove();
		});
		elsewhere.focus();
		window.history.replaceState(
			null,
			'',
			`?bg_donate_form=${CONFIG.formId}&payment_intent_client_secret=pi_1_secret_x`
		);
		let answer: () => void = () => {};
		const { root } = await card(CONFIG, {
			retrieve: () =>
				new Promise((resolve) => {
					answer = () => resolve({ paymentIntent: { status: 'succeeded' } });
				})
		});
		expect(takeoverHeading(root).textContent).toBe(copy.RESUMING_HEADING);
		expect(document.activeElement).toBe(elsewhere);

		await act(async () => {
			answer();
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});

		expect(takeoverHeading(root).textContent).toBe(copy.SUCCESS_HEADING);
		expect(document.activeElement).toBe(elsewhere);
	});

	// nothing moves the caret onto a heading it is not near, so the region is what tells a donor
	// elsewhere on the page that the screen changed.
	it('says the heading a resume’s outcome replaces the takeover with, to a caret outside it', async () => {
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		onTestFinished(() => {
			elsewhere.remove();
		});
		elsewhere.focus();
		window.history.replaceState(
			null,
			'',
			`?bg_donate_form=${CONFIG.formId}&payment_intent_client_secret=pi_1_secret_x`
		);
		let answer: () => void = () => {};
		const { root } = await card(CONFIG, {
			retrieve: () =>
				new Promise((resolve) => {
					answer = () => resolve({ paymentIntent: { status: 'processing' } });
				})
		});
		expect(takeoverHeading(root).textContent).toBe(copy.RESUMING_HEADING);

		await act(async () => {
			answer();
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});

		expect(takeoverHeading(root).textContent).toBe(copy.PROCESSING_HEADING);
		expect(document.activeElement).toBe(elsewhere);
		expect(said(root)).toBe(`${copy.PROCESSING_HEADING}.`);
	});

	// the claim scrubs the url, so a second run of the effect that claimed it again would find nothing
	// and boot the donor back from their bank onto an empty amount step.
	it('resumes the gift a donor came back to under strict mode', async () => {
		window.history.replaceState(
			null,
			'',
			`?bg_donate_form=${CONFIG.formId}&payment_intent_client_secret=pi_1_secret_x`
		);
		const { root } = await card(
			CONFIG,
			{ retrieve: () => new Promise(() => {}) },
			{ strict: true }
		);
		expect(takeoverHeading(root).textContent).toBe(copy.RESUMING_HEADING);
	});
});

describe('a crypto gift', () => {
	const CRYPTO: FormConfig = {
		...CONFIG,
		paymentMethods: ['card', 'crypto'],
		coins: [
			{ coin: 'xrp', ticker: 'xrp', name: 'Ripple', network: 'Ripple', memoRequired: true },
			{
				coin: 'usdttrc20',
				ticker: 'usdt',
				name: 'Tether USD (Tron)',
				network: 'Tron',
				memoRequired: false,
				logo: 'https://nowpayments.io/images/coins/usdttrc20.svg'
			},
			{ coin: 'btc', ticker: 'btc', name: 'Bitcoin', network: 'Bitcoin', memoRequired: false }
		]
	};
	/** far enough out that no spec's clock reaches it, unless the spec puts its clock there. */
	const VALID_UNTIL = '2099-11-21T12:00:00.000Z';
	const USDT: Quote = {
		paymentToken: 'don_1',
		feeMinor: 25,
		totalMinor: 2525,
		deposit: {
			address: 'TbdBAaeHZo9WeEtpitUFqfEuUXDRfLpjeV',
			memo: null,
			coin: 'usdttrc20',
			network: 'Tron',
			coinAmount: '25.004187',
			validUntil: VALID_UNTIL,
			qr: { rows: ['110', '011', '101'] }
		}
	};

	afterEach(() => {
		vi.useRealTimers();
	});

	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});

	/**
	 * the deployment's two endpoints a crypto gift reaches: the quote answers `quote`, and the read
	 * answers whatever `state` holds when it is asked.
	 */
	function deployment(quote: () => Response) {
		const server = { state: 'waiting' as string, reads: 0 };
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.method === 'POST') return quote();
				server.reads += 1;
				return json({ state: server.state });
			})
		);
		return server;
	}

	/** the row a payment option stands in, found by the name on its head. */
	function row(root: HTMLElement, name: string): HTMLElement | null {
		for (const node of every(root, '[part~="payment"] *')) {
			const head = node.shadowRoot?.querySelector<HTMLElement>('.head');
			if (head?.querySelector('.name')?.textContent === name) return head;
		}
		return null;
	}

	/** the coin list's own shadow root, standing in the crypto option. */
	function coins(root: HTMLElement): ShadowRoot {
		const host = every(root, '[part~="payment"] *').find((node) =>
			node.shadowRoot?.querySelector('[role="combobox"]')
		);
		if (host?.shadowRoot == null) throw new Error('no coin list in the payment box');
		return host.shadowRoot;
	}
	const combobox = (root: HTMLElement) =>
		coins(root).querySelector('[role="combobox"]') as HTMLInputElement;

	async function pick(root: HTMLElement, ticker: string): Promise<void> {
		press(coins(root).querySelector('.picker') as HTMLElement);
		await act(async () => {});
		const option = [...coins(root).querySelectorAll<HTMLElement>('[role="option"]')].find(
			(node) => node.querySelector('.coin-ticker')?.textContent === ticker
		);
		if (option === undefined) throw new Error(`no ${ticker} in the coin list`);
		press(option);
		// a pick hands the caret back to the box a frame later (`setFinalFocus` in @zag-js/combobox),
		// and a donor's next press never lands inside that frame. waited out here, since under a
		// faked clock that frame runs only when the clock is next moved: after Donate, it takes the
		// caret off the heading.
		await act(() => new Promise<void>((settle) => requestAnimationFrame(() => settle())));
	}

	/** the review step of a one-time gift with the crypto option open. */
	async function onCrypto(quote: () => Response = () => json(USDT)) {
		const server = deployment(quote);
		const { root } = await card(CRYPTO);
		walkToGive(root);
		const head = row(root, 'Crypto');
		if (head === null) throw new Error('no crypto option on the review step');
		press(head);
		return { root, server };
	}

	/** Donate pressed from the keyboard, so the caret starts on the control rather than in the list. */
	async function donate(root: HTMLElement): Promise<void> {
		await act(async () => {
			one(root, 'button[part~="submit"]').focus();
			one(root, 'button[part~="submit"]').click();
			for (let at = 0; at < 20; at += 1) await Promise.resolve();
		});
	}

	/** the address screen, for a USDT gift. */
	async function atAddress() {
		const reached = await onCrypto();
		await pick(reached.root, 'USDT');
		await donate(reached.root);
		return reached;
	}

	async function tick(ms: number): Promise<void> {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ms);
		});
	}

	// the picker draws more of a coin than a gift is built from, and the card hands the served option
	// over whole rather than a subset of its own (`CoinOption` in @better-giving/form/coin-picker).
	it('draws the network and the logo the served list carries', async () => {
		const { root } = await onCrypto();

		press(coins(root).querySelector('.picker') as HTMLElement);
		const listed = [...coins(root).querySelectorAll<HTMLElement>('[role="option"]')].find(
			(node) => node.querySelector('.coin-ticker')?.textContent === 'USDT'
		);

		expect(listed?.querySelector('.net')?.textContent).toBe('Tron');
		expect(listed?.querySelector('img')?.getAttribute('src')).toBe(
			'https://nowpayments.io/images/coins/usdttrc20.svg'
		);
	});

	it('offers crypto on a one-time gift and hides it on a repeating one', async () => {
		deployment(() => json(USDT));
		const { root } = await card(CRYPTO);
		walkToGive(root);
		expect(row(root, 'Crypto')).not.toBeNull();

		press(every(root, '.step-give .step-dot')[0] as HTMLElement);
		press(one(root, '.segment > label:nth-of-type(2)'));
		press(one(root, CONTINUE));
		press(one(root, CONTINUE));

		expect(screen(root).className).toContain('step-give');
		expect(row(root, 'Crypto')).toBeNull();
	});

	it('says what the fee does to a gift valued on arrival', async () => {
		const { root } = await onCrypto();
		expect(one(root, '.fee-note').textContent).toMatch(
			/^You add about \$\d+\.\d\d toward the processing fee\.$/
		);

		press(input(root, '.row.fee [part~="checkbox"]'));
		expect(one(root, '.fee-note').textContent).toBe(
			'Helping Hands pays the processing fee out of your gift.'
		);
	});

	it('asks for a coin on a press with none picked, in the coin list and not on the box', async () => {
		const { root, server } = await onCrypto();

		await donate(root);

		expect(screen(root).className).toContain('step-give');
		expect(coins(root).getElementById('coin-problem')?.textContent).toBe(copy.COIN_REQUIRED);
		expect(coins(root).activeElement).toBe(combobox(root));
		expect(one(root, '#payment-problem').hidden).toBe(true);
		expect(server.reads).toBe(0);
	});

	it('shows where and how much to send, with the caret on the heading', async () => {
		const { root } = await atAddress();

		const ending = screen(root);
		expect(ending.className).toContain('takeover');
		const heading = one(ending, 'h2');
		expect(heading.textContent).toBe('Send your gift');
		expect(document.activeElement).toBe(heading);
		// a child of the takeover itself, where the element stands it.
		const block = one(ending, ':scope > .deposit');
		expect(block.hidden).toBe(false);
		expect(one(block, '.entry.total .value.amount').textContent).toBe('25.004187 USDT');
		expect(one(block, '.attention').textContent).toContain('Send on this network only,');
		expect(one(ending, '.receipt-slot').hidden).toBe(true);
		// the way out and the line that makes taking it safe, as the one group at the foot.
		expect(one(ending, ':scope > .foot > .aside').textContent).toBe(
			'Also sent to donor@example.org.'
		);
		expect(
			every(ending, ':scope > button, :scope > .foot > button')
				.filter((node) => !node.hidden)
				.map((node) => node.textContent)
		).toEqual(['Use a different coin']);
	});

	it('says a Copy on the card’s region', async () => {
		vi.stubGlobal('navigator', {
			...navigator,
			clipboard: { writeText: async () => {} }
		});
		const { root } = await atAddress();

		await act(async () => {
			one(root, '.deposit [aria-label="Copy address"]').click();
			for (let at = 0; at < 4; at += 1) await Promise.resolve();
		});

		expect(one(root, '.deposit [aria-label="Copy address"]').dataset.outcome).toBe('copied');
		expect(said(root)).toBe('Address copied.');
	});

	it('goes back to the coin list for a different coin', async () => {
		const { root } = await atAddress();

		press(one(root, '.takeover > .foot > button[part~="action-quiet"]'));

		expect(screen(root).className).toContain('step-give');
		expect(coins(root).activeElement).toBe(combobox(root));
	});

	it('turns to the thank-you once the gift arrives, with no receipt figures', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { root, server } = await atAddress();

		await tick(DEPOSIT_POLL_MS);
		expect(server.reads).toBe(1);
		expect(one(screen(root), 'h2').textContent).toBe('Send your gift');
		// the caret on a Copy control, which leaves the card with the address block.
		one(root, '.deposit [aria-label="Copy address"]').focus();

		server.state = 'received';
		await tick(DEPOSIT_POLL_MS);

		const ending = screen(root);
		expect(one(ending, 'h2').textContent).toBe(copy.SUCCESS_HEADING);
		expect(one(ending, '.prose').textContent).toBe(copy.arrivedBody('Helping Hands'));
		expect(one(ending, '.receipt-slot').hidden).toBe(true);
		expect(one(ending, '.deposit').hidden).toBe(true);
		expect(document.activeElement).toBe(one(ending, 'h2'));
		expect(said(root)).toBe(copy.ARRIVED_ANNOUNCE);
	});

	it('offers a new address once the server says this one expired, and keeps the coin', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { root, server } = await atAddress();
		server.state = 'expired';

		await tick(DEPOSIT_POLL_MS);

		expect(one(screen(root), 'h2').textContent).toBe(copy.EXPIRED_HEADING);
		expect(one(screen(root), '.prose').textContent).toBe(copy.DEPOSIT_EXPIRED_BODY);
		press(one(root, '.takeover > button[part~="action"]'));

		expect(screen(root).className).toContain('step-give');
		expect(coins(root).activeElement).toBe(combobox(root));
		// the ticker and the network, which is the whole of what the closed box reads (`words` in
		// @better-giving/form's coin-picker.ts): the coin's full name is drawn nowhere on it.
		expect(coins(root).querySelector('.chosen')?.textContent).toBe('USDTTron');
	});

	it('withdraws the address and every Copy once its send-by passes, and keeps reading', async () => {
		vi.useFakeTimers({
			shouldAdvanceTime: true,
			now: new Date(VALID_UNTIL).getTime() - DEPOSIT_POLL_MS * 2
		});
		const { root, server } = await atAddress();
		expect(one(screen(root), 'h2').textContent).toBe('Send your gift');

		await tick(DEPOSIT_POLL_MS * 2);

		const checking = screen(root);
		expect(one(checking, 'h2').textContent).toBe(copy.CHECKING_HEADING);
		expect(one(checking, '.deposit').hidden).toBe(true);
		expect(every(checking, 'button').filter((node) => node.closest('[hidden]') === null)).toEqual(
			[]
		);

		const before = server.reads;
		await tick(DEPOSIT_POLL_MS);
		expect(server.reads).toBeGreaterThan(before);
	});

	// the flow replaces the heading on its own clock, under a caret the address screen put on it:
	// focusing the node that holds focus says nothing, so the region says the new words.
	it('says the address closing, and then expiring, to a caret on the heading', async () => {
		// a second short of the send-by, so the address closes between two readings: a reading
		// landing in the same task is a snapshot with nothing to say, and it would clear the region.
		vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(VALID_UNTIL).getTime() - 1000 });
		const { root, server } = await atAddress();
		const heading = one(screen(root), 'h2');
		expect(document.activeElement).toBe(heading);

		await tick(1000);

		expect(heading.textContent).toBe(copy.CHECKING_HEADING);
		expect(document.activeElement).toBe(heading);
		expect(said(root)).toBe(`${copy.CHECKING_HEADING}.`);

		server.state = 'expired';
		await tick(DEPOSIT_POLL_MS);

		expect(heading.textContent).toBe(copy.EXPIRED_HEADING);
		expect(document.activeElement).toBe(heading);
		expect(said(root)).toBe(`${copy.EXPIRED_HEADING}.`);
	});

	// a donor who stepped off the card while waiting on the chain is told each change, and the caret
	// stays where they put it.
	it('says the address closing, and then expiring, to a caret outside the card', async () => {
		// a second short of the send-by, so the address closes between two readings: a reading
		// landing in the same task is a snapshot with nothing to say, and it would clear the region.
		vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(VALID_UNTIL).getTime() - 1000 });
		const { root, server } = await atAddress();
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		onTestFinished(() => {
			elsewhere.remove();
		});
		act(() => {
			elsewhere.focus();
		});

		await tick(1000);

		expect(one(screen(root), 'h2').textContent).toBe(copy.CHECKING_HEADING);
		expect(document.activeElement).toBe(elsewhere);
		expect(said(root)).toBe(`${copy.CHECKING_HEADING}.`);

		server.state = 'expired';
		await tick(DEPOSIT_POLL_MS);

		expect(one(screen(root), 'h2').textContent).toBe(copy.EXPIRED_HEADING);
		expect(document.activeElement).toBe(elsewhere);
		expect(said(root)).toBe(`${copy.EXPIRED_HEADING}.`);
	});

	it('lands a gift below the coin’s minimum on the amount step, naming the minimum', async () => {
		const { root } = await onCrypto(() =>
			json({ error: 'below_minimum', message: 'too small', minAmountMinor: 1200 }, 422)
		);
		await pick(root, 'USDT');

		await donate(root);

		expect(screen(root).className).not.toContain('step-give');
		expect(one(root, '#amount-problem').hidden).toBe(false);
		expect(one(root, '#amount-problem').textContent).toBe(
			'at least $12 in Tether USD (Tron), or pick another coin'
		);
		const focused = document.activeElement as HTMLElement;
		expect(focused.getAttribute('aria-describedby')).toBe('amount-problem');

		press(one(root, '.tiles > label.other'));
		type(input(root, '#amount-entry'), '50');
		expect(one(root, '#amount-problem').hidden).toBe(true);
	});

	it.each([
		['above_maximum', 'too large for Tether USD (Tron), lower it or pick another coin'],
		['below_minimum', 'too small for Tether USD (Tron), raise it or pick another coin']
	])('words a %s refusal with no figure', async (code, words) => {
		const { root } = await onCrypto(() => json({ error: code, message: 'refused' }, 422));
		await pick(root, 'USDT');

		await donate(root);

		expect(one(root, '#amount-problem').textContent).toBe(words);
	});

	it('lands a coin the account no longer takes back in the list, marked', async () => {
		const { root } = await onCrypto(() =>
			json({ error: 'coin_not_accepted', message: 'refused' }, 422)
		);
		await pick(root, 'USDT');

		await donate(root);

		expect(screen(root).className).toContain('step-give');
		expect(coins(root).getElementById('coin-problem')?.textContent).toBe(copy.COIN_REFUSED);
		expect(coins(root).activeElement).toBe(combobox(root));
		expect(coins(root).querySelector('[aria-disabled="true"] .coin-ticker')?.textContent).toBe(
			'USDT'
		);
	});
});
