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
import { DEPOSIT_POLL_MS } from '@better-giving/form/machine';
import type { FeeRules, FormConfig, Quote } from '@better-giving/form/v1';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { DonateCard } from './card';
import * as copy from './copy';
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

/** the payment provider, as a plain object, with the one report the flow needs off it. */
function paymentProvider() {
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
		confirmPayment: () => new Promise(() => {}),
		retrievePaymentIntent: async () => ({})
	} as unknown as StripeLike;
	return {
		load: async () => stripe,
		pick: (type: string) => {
			act(() => {
				for (const handler of [...change]) {
					handler({ collapsed: false, empty: false, value: { type } });
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
async function card(config: FormConfig = CONFIG) {
	const payment = paymentProvider();
	const paypal = paypalProvider();
	const host = document.createElement('div');
	document.body.appendChild(host);
	const mounted = createRoot(host);
	act(() => {
		mounted.render(
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
	expect(every(root, '#program > option').map((option) => option.textContent)).toEqual([
		'Where it’s needed most',
		'Clean water',
		'Schools'
	]);
	// the entry is closed behind the way past the presets until a donor takes it.
	expect(one(root, '.tile.entry').hidden).toBe(true);
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

it('opens the entry empty on the way past the presets and takes the caret', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label:nth-of-type(2)'));
	press(one(root, '.tiles > label.other'));

	const entry = input(root, '#amount-entry');
	expect(one(root, '.tile.entry').hidden).toBe(false);
	expect(entry.value).toBe('');
	expect(document.activeElement).toBe(entry);
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
	// announced from a descendant — so the sentence is on the region however the press was made.
	expect(said(root)).toBe('between $5 and $5,000');
	expect(document.activeElement).toBe(input(root, '#amount-entry'));
});

it('names every decision a press was refused for, not the first', async () => {
	const { root } = await card();

	press(one(root, '.tiles > label.other'));
	press(input(root, '.disclosure.note input[type="checkbox"]'));
	press(one(root, CONTINUE));

	expect(one(root, '#amount-problem').hidden).toBe(false);
	expect(one(root, '#note-problem').hidden).toBe(false);
	// the note's sentence is on the control itself, so it is not repeated on the region.
	expect(said(root)).toBe('between $5 and $5,000');
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
		mounted.render(<PaymentBox mount={createRef()} prepared={false} rows={2} words="" />);
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

describe('a crypto gift', () => {
	const CRYPTO: FormConfig = {
		...CONFIG,
		paymentMethods: ['card', 'crypto'],
		coins: [
			{ coin: 'xrp', ticker: 'xrp', name: 'Ripple', network: 'xrp', memoRequired: true },
			{
				coin: 'usdttrc20',
				ticker: 'usdt',
				name: 'Tether USD (Tron)',
				network: 'trx',
				memoRequired: false
			},
			{ coin: 'btc', ticker: 'btc', name: 'Bitcoin', network: 'btc', memoRequired: false }
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

	function pick(root: HTMLElement, ticker: string): void {
		press(coins(root).querySelector('.picker') as HTMLElement);
		const option = [...coins(root).querySelectorAll<HTMLElement>('[role="option"]')].find(
			(node) => node.querySelector('.coin-ticker')?.textContent === ticker
		);
		if (option === undefined) throw new Error(`no ${ticker} in the coin list`);
		press(option);
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
		pick(reached.root, 'USDT');
		await donate(reached.root);
		return reached;
	}

	async function tick(ms: number): Promise<void> {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ms);
		});
	}

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
		expect(one(block, '.value.amount').textContent).toBe('25.004187 USDT');
		expect(one(block, '.attention').textContent).toContain('Send on this network only,');
		expect(one(ending, '.receipt-slot').hidden).toBe(true);
		expect(
			every(ending, ':scope > button')
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

		press(one(root, '.takeover > button[part~="action-quiet"]'));

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
		expect(coins(root).querySelector('.chosen')?.textContent).toBe('USDT Tether USD (Tron)');
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

	it('lands a gift below the coin’s minimum on the amount step, naming the minimum', async () => {
		const { root } = await onCrypto(() =>
			json({ error: 'below_minimum', message: 'too small', minAmountMinor: 1200 }, 422)
		);
		pick(root, 'USDT');

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
		pick(root, 'USDT');

		await donate(root);

		expect(one(root, '#amount-problem').textContent).toBe(words);
	});

	it('lands a coin the account no longer takes back in the list, marked', async () => {
		const { root } = await onCrypto(() =>
			json({ error: 'coin_not_accepted', message: 'refused' }, 422)
		);
		pick(root, 'USDT');

		await donate(root);

		expect(screen(root).className).toContain('step-give');
		expect(coins(root).getElementById('coin-problem')?.textContent).toBe(copy.COIN_REFUSED);
		expect(coins(root).activeElement).toBe(combobox(root));
		expect(coins(root).querySelector('[aria-disabled="true"] .coin-ticker')?.textContent).toBe(
			'USDT'
		);
	});
});
