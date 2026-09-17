import { connect, toState } from '@better-giving/form/connect';
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
	PaymentLoadErrorLike,
	StripeLike
} from '@better-giving/form/embed/stripe';
import { CHARIOT_TAG } from '@better-giving/form/embed/chariot';
import { DEPOSIT_POLL_MS } from '@better-giving/form/machine';
import type { TurnstileLike } from '@better-giving/form/embed/turnstile';
import type { FeeRules, FormConfig, Quote } from '@better-giving/form/v1';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { initialSnapshot, startCheckout } from './machine';
import { reactPropTypes } from './normalize';

// the actor's life, and the surfaces that live exactly as long as it does.
//
// in the dom pool because both surfaces are handed a node: each processor's own script mounts into
// the payment box and the challenge widget renders into the other. no processor's script is reached
// — every one of them takes an injectable seam for exactly this, so what is asserted here is what
// this module asks of them and when.
//
// the payment seam is one entry per processor because the surface this module composes is the one
// in @better-giving/form/embed/surface, which is between the two adapters rather than in front of
// them. what that composition does is covered in the form package's own `surface.dom.spec.ts`; what
// is covered here is that this page holds one surface whichever processors a served config names.
//
// what it is really for is the leak. a card that stops without letting go leaves one element group
// and one challenge widget per gift, each registered inside a script this project did not write,
// under a handle nothing here ever sees — removing the nodes they painted in collects the DOM and
// tells neither script anything.

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
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: FEE_RULES,
	locale: 'en-US',
	orgLegalName: 'Helping Hands',
	ein: '12-3456789',
	deductibilityStatement: 'Helping Hands is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

/** the same deployment, holding PayPal's keys and no card processor's. */
const PAYPAL_ONLY: FormConfig = {
	...CONFIG,
	providers: [{ name: 'paypal', publishableKey: 'live_client_id' }],
	paymentMethods: ['paypal']
};

/** the same deployment, holding Chariot's key beside the card processor's. */
const WITH_FUND: FormConfig = {
	...CONFIG,
	providers: [...CONFIG.providers, { name: 'chariot', publishableKey: 'cid_spec' }],
	paymentMethods: ['card', 'daf']
};

/** Chariot's element, standing in: it keeps the one callback it is handed and nothing else. */
class StubConnect extends HTMLElement {
	donationRequest: (() => unknown) | null = null;
	onDonationRequest(callback: () => unknown): void {
		this.donationRequest = callback;
	}
}
if (customElements.get(CHARIOT_TAG) === undefined) customElements.define(CHARIOT_TAG, StubConnect);

/** every deadline either provider armed, and whether it is still standing. */
type Armed = { readonly run: () => void; readonly ms: number; live: boolean };

function clock() {
	const armed: Armed[] = [];
	const delay = (run: () => void, ms: number): (() => void) => {
		const timer: Armed = { run, ms, live: true };
		armed.push(timer);
		return () => {
			timer.live = false;
		};
	};
	return { armed, delay };
}

/** the payment provider, as a plain object, and every subscription it is holding. */
function paymentProvider() {
	const change: ((payload: PaymentChangeLike) => void)[] = [];
	const ready: (() => void)[] = [];
	const loaderror: ((payload: PaymentLoadErrorLike) => void)[] = [];
	const held: Record<string, unknown[]> = { change, ready, loaderror };
	let mountedInto: HTMLElement | null = null;
	let destroyed = 0;

	const element = {
		mount: (node: HTMLElement) => {
			mountedInto = node;
		},
		focus: () => {},
		on: (event: string, handler: unknown) => {
			held[event]?.push(handler);
		},
		off: (event: string, handler: unknown) => {
			const list = held[event];
			const at = list?.indexOf(handler) ?? -1;
			if (list !== undefined && at !== -1) list.splice(at, 1);
		},
		destroy: () => {
			destroyed += 1;
		}
	} as unknown as PaymentElementLike;

	const stripe = {
		elements: () => ({
			create: () => element,
			update: async () => {},
			submit: async () => ({})
		}),
		confirmPayment: async () => ({}),
		retrievePaymentIntent: async () => ({})
	} as unknown as StripeLike;

	return {
		load: async () => stripe,
		pick: (type: string) => {
			for (const handler of [...change])
				handler({ collapsed: false, empty: false, value: { type } });
		},
		mountedInto: () => mountedInto,
		subscriptions: () => change.length + ready.length + loaderror.length,
		destroyed: () => destroyed
	};
}

/** PayPal's hosted window, as a plain object, and the sessions this adapter opened on it. */
function paypalProvider() {
	const sessions: SessionOptionsLike[] = [];
	const orders: Promise<{ orderId: string }>[] = [];
	const session = (options: SessionOptionsLike): PaypalSessionLike => {
		sessions.push(options);
		return {
			start: (_presentation, order) => {
				orders.push(order);
				return new Promise<unknown>(() => {});
			},
			destroy: () => {},
			cancel: () => {},
			hasReturned: () => false,
			resume: () => Promise.resolve()
		};
	};
	const sdk: PaypalSdkLike = {
		findEligibleMethods: () =>
			Promise.resolve({ isEligible: () => true } satisfies EligibilityLike),
		createPayPalOneTimePaymentSession: session,
		createVenmoOneTimePaymentSession: session
	};
	const namespace: PaypalNamespaceLike = { createInstance: () => Promise.resolve(sdk) };
	return { load: async () => namespace, sessions, orders };
}

/** the challenge provider, and the two calls this adapter makes on it by id. */
function challengeProvider() {
	const rendered: HTMLElement[] = [];
	const resets: string[] = [];
	const removals: string[] = [];
	const api: TurnstileLike = {
		render: (node) => {
			rendered.push(node);
			return `widget-${rendered.length}`;
		},
		reset: (id) => {
			resets.push(id);
		},
		remove: (id) => {
			removals.push(id);
		}
	};
	return { load: async () => api, rendered, resets, removals };
}

/** the two boxes a card hands over, on a document a provider can measure. */
function boxes() {
	const host = document.createElement('div');
	const paymentMount = document.createElement('div');
	const challengeMount = document.createElement('div');
	// `appendChild` rather than `append`: `wrangler types` writes a global `interface Element` for
	// HTMLRewriter that typescript merges with the DOM's, and its own `append` shadows
	// `ParentNode.append` for every element in this project.
	host.appendChild(paymentMount);
	host.appendChild(challengeMount);
	document.body.appendChild(host);
	onTestFinished(() => {
		host.remove();
	});
	return { paymentMount, challengeMount };
}

/** a tick long enough for both providers' own promise chains to settle. */
async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

it('reads a snapshot off the configuration alone, so the served html holds the amounts', () => {
	const snapshot = initialSnapshot(CONFIG);
	const api = connect(snapshot, () => {}, reactPropTypes);

	expect(api.state.step).toBe('amount');
	expect(api.amountGroup.options.map((option) => option.value)).toEqual([2500]);
	expect(api.frequencyGroup.options.map((option) => option.value)).toEqual(['one_time']);
	// twice over the same configuration is the same reading, which is what hydration needs of it.
	expect(toState(initialSnapshot(CONFIG))).toEqual(api.state);
});

it('mounts the payment provider into the box it was handed and draws no challenge yet', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const challenge = challengeProvider();
	const timer = clock();

	const checkout = startCheckout(CONFIG, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: { stripe: { load: payment.load, delay: timer.delay } },
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	onTestFinished(() => checkout.stop());
	await settle();

	// into a node of its own inside the box, which is the composer's placement rather than this
	// module's: one processor per node, so two of them never race for one.
	expect(payment.mountedInto()).toBe(paymentMount.children[0]);
	// the challenge is drawn at the last moment it can be drawn without a donor waiting on it, which
	// is the details step — not the one before it.
	expect(challenge.rendered).toEqual([]);
});

it('draws the challenge on arrival at the details step and resets it on the way out of a busy flow', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const challenge = challengeProvider();
	const timer = clock();
	// the one press that spends a token never reaches the network here: what the quote does is leave
	// the busy flow, which is the transition the reset hangs off.
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new Error('no network in this pool');
		})
	);

	const checkout = startCheckout(CONFIG, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: { stripe: { load: payment.load, delay: timer.delay } },
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	onTestFinished(() => checkout.stop());
	await settle();

	const { actor } = checkout;
	actor.send({ type: 'CONTINUE' });
	await settle();
	expect(challenge.rendered).toEqual([challengeMount]);

	actor.send({ type: 'SET_CONTACT', email: 'donor@example.org' });
	actor.send({ type: 'SET_CONTACT', firstName: 'Ada' });
	actor.send({ type: 'SET_CONTACT', lastName: 'Lovelace' });
	actor.send({ type: 'CONTINUE' });
	payment.pick('card');
	expect(toState(actor.getSnapshot()).step).toBe('give');

	actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'token-1' });
	actor.send({ type: 'SUBMIT' });
	await settle();

	expect(toState(actor.getSnapshot()).step).toBe('failed');
	expect(challenge.resets).toEqual(['widget-1']);
});

it('stops without leaving a subscription, a widget or a deadline behind', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const challenge = challengeProvider();
	const timer = clock();

	const checkout = startCheckout(CONFIG, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: { stripe: { load: payment.load, delay: timer.delay } },
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	await settle();
	checkout.actor.send({ type: 'CONTINUE' });
	await settle();

	expect(payment.subscriptions()).toBeGreaterThan(0);
	expect(challenge.rendered).toHaveLength(1);

	checkout.stop();

	expect(payment.subscriptions()).toBe(0);
	expect(payment.destroyed()).toBe(1);
	expect(challenge.removals).toEqual(['widget-1']);
	expect(timer.armed.filter((armed) => armed.live)).toEqual([]);
	// twice is safe, which is what lets a card let go in whatever order a caller reaches it in.
	expect(() => checkout.stop()).not.toThrow();
});

it('tells a listener how many options the payment box lists', async () => {
	const payment = paymentProvider();
	const timer = clock();
	const start = (config: FormConfig) => {
		const { paymentMount, challengeMount } = boxes();
		const checkout = startCheckout(config, {
			paymentMount,
			challengeMount,
			resumeToken: null,
			seams: { payment: { stripe: { load: payment.load, delay: timer.delay } } }
		});
		onTestFinished(() => checkout.stop());
		return checkout;
	};

	const single: number[] = [];
	start(CONFIG).rows((count) => single.push(count));
	const pair: number[] = [];
	start({ ...CONFIG, paymentMethods: ['card', 'ach'] }).rows((count) => pair.push(count));
	await settle();

	// told on the call, because the provider's rails are counted off the config before anything loads.
	expect(single).toEqual([1]);
	expect(pair).toEqual([2]);
});

// the hole this page had until the surface it composes stopped being one processor's: a deployment
// holding PayPal's keys and no card processor's drew a box nothing could be paid in.
it('draws a payment surface for a config offering only PayPal’s rails, and confirms on one', async () => {
	const { paymentMount, challengeMount } = boxes();
	const paypal = paypalProvider();
	const challenge = challengeProvider();
	const timer = clock();

	const checkout = startCheckout(PAYPAL_ONLY, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: { paypal: { load: paypal.load, delay: timer.delay } },
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	onTestFinished(() => checkout.stop());
	await settle();

	const button = paymentMount.querySelector('paypal-button');
	expect(button).not.toBeNull();

	const { actor } = checkout;
	actor.send({ type: 'CONTINUE' });
	await settle();
	actor.send({ type: 'SET_CONTACT', email: 'donor@example.org' });
	actor.send({ type: 'SET_CONTACT', firstName: 'Ada' });
	actor.send({ type: 'SET_CONTACT', lastName: 'Lovelace' });
	actor.send({ type: 'CONTINUE' });

	// the button is the rail picker on this processor, so the press is what makes the gift payable.
	button?.dispatchEvent(new Event('click'));
	expect(toState(actor.getSnapshot()).step).toBe('give');

	// the figure the donor was shown, answered back as the server's own: a quote that moved would
	// put the flow on the correction screen, which is a different thing than this test is about.
	const shown = connect(actor.getSnapshot(), () => {}, reactPropTypes).submitButton.totalMinor;
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify({ paymentToken: 'order-1', feeMinor: 0, totalMinor: shown }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		)
	);

	actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'token-1' });
	actor.send({ type: 'SUBMIT' });
	for (let turn = 0; turn < 20; turn += 1) await settle();
	expect(toState(actor.getSnapshot()).step).toBe('working');

	// the order the server minted, handed to PayPal's own session: the confirmation reached the one
	// processor this deployment holds.
	expect(paypal.orders).toHaveLength(1);
	await expect(paypal.orders[0]).resolves.toEqual({ orderId: 'order-1' });
});

it('tells the flow the rail a donor pressed, on whichever processor’s box they pressed it in', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const paypal = paypalProvider();
	const challenge = challengeProvider();
	const timer = clock();

	const checkout = startCheckout(
		{
			...CONFIG,
			providers: [...CONFIG.providers, { name: 'paypal', publishableKey: 'cid' }],
			paymentMethods: ['card', 'paypal']
		},
		{
			paymentMount,
			challengeMount,
			resumeToken: null,
			seams: {
				payment: {
					stripe: { load: payment.load, delay: timer.delay },
					paypal: { load: paypal.load, delay: timer.delay }
				},
				challenge: { load: challenge.load, delay: timer.delay }
			}
		}
	);
	onTestFinished(() => checkout.stop());
	await settle();

	// both processors drew, each into a node of its own inside the one box this page renders.
	expect(paymentMount.children).toHaveLength(2);
	expect(paymentMount.querySelector('paypal-button')).not.toBeNull();

	// the flow is the only place either report lands: the takeovers word themselves off the committed
	// rail `State` carries (@better-giving/form/connect), and nothing on this page keeps a second
	// reading of what a processor last said.
	payment.pick('card');
	expect(checkout.actor.getSnapshot().context.payerDraft.method).toBe('card');

	paymentMount.querySelector('paypal-button')?.dispatchEvent(new Event('click'));
	expect(checkout.actor.getSnapshot().context.payerDraft.method).toBe('paypal');
});

// the fund's own button is the rail picker and the window's opener in one press, and its window's
// endings are reports rather than a confirmation — so this page hands the surface a third kind of
// report, and tells it on every reading whether the button stands.
it('stands a fund’s button on the review step alone, and carries its window’s reports into the flow', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const challenge = challengeProvider();
	const timer = clock();
	const posted: unknown[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			posted.push(JSON.parse(String(init.body)));
			// the donor raised the grant inside the window, so the server's figures are not the form's.
			return new Response(
				JSON.stringify({ paymentToken: 'grant_1', feeMinor: 200, totalMinor: 5200 }),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		})
	);

	const checkout = startCheckout(WITH_FUND, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: {
				stripe: { load: payment.load, delay: timer.delay },
				chariot: { load: async () => true, delay: timer.delay }
			},
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	onTestFinished(() => checkout.stop());
	await settle();

	const fund = () => paymentMount.querySelector(CHARIOT_TAG);
	expect(fund()).toBeNull();

	const { actor } = checkout;
	actor.send({ type: 'CONTINUE' });
	await settle();
	actor.send({ type: 'SET_CONTACT', email: 'donor@example.org' });
	actor.send({ type: 'SET_CONTACT', firstName: 'Ada' });
	actor.send({ type: 'SET_CONTACT', lastName: 'Lovelace' });
	actor.send({ type: 'CONTINUE' });
	expect(toState(actor.getSnapshot()).step).toBe('give');

	const button = fund();
	if (!(button instanceof StubConnect)) throw new Error('no fund button on the review step');
	expect(button.donationRequest?.()).toMatchObject({
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace',
		frequency: 'ONE_TIME'
	});
	expect(toState(actor.getSnapshot())).toMatchObject({ step: 'working', phase: 'authorizing' });
	// the window is open, and a second press is not one the flow takes.
	expect(button.donationRequest?.()).toBe(false);

	actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'token-1' });
	button.dispatchEvent(
		new CustomEvent('CHARIOT_SUCCESS', {
			detail: { workflowSessionId: 'wfs_1', grantIntent: { amount: 5200 } }
		})
	);
	for (let turn = 0; turn < 20; turn += 1) await settle();

	expect(posted).toHaveLength(1);
	expect(posted[0]).toMatchObject({ method: 'daf', authorizationId: 'wfs_1' });
	expect(toState(actor.getSnapshot())).toMatchObject({
		step: 'processing',
		granted: { giftMinor: 5000, feeMinor: 200, totalMinor: 5200 }
	});
	// off the review step the button is taken down, which is `fundIsOffered` read on this reading.
	expect(fund()).toBeNull();
});

it('puts a donor who closed the fund’s window back on the review step with nothing sent', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const challenge = challengeProvider();
	const timer = clock();
	const fetched = vi.fn();
	vi.stubGlobal('fetch', fetched);

	const checkout = startCheckout(WITH_FUND, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: {
				stripe: { load: payment.load, delay: timer.delay },
				chariot: { load: async () => true, delay: timer.delay }
			},
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	onTestFinished(() => checkout.stop());
	await settle();

	const { actor } = checkout;
	actor.send({ type: 'CONTINUE' });
	await settle();
	actor.send({ type: 'SET_CONTACT', email: 'donor@example.org' });
	actor.send({ type: 'SET_CONTACT', firstName: 'Ada' });
	actor.send({ type: 'SET_CONTACT', lastName: 'Lovelace' });
	actor.send({ type: 'CONTINUE' });

	const button = paymentMount.querySelector(CHARIOT_TAG);
	if (!(button instanceof StubConnect)) throw new Error('no fund button on the review step');
	button.donationRequest?.();
	button.dispatchEvent(new CustomEvent('CHARIOT_EXIT'));
	await settle();

	expect(toState(actor.getSnapshot()).step).toBe('give');
	expect(fetched).not.toHaveBeenCalled();
	expect(paymentMount.querySelector(CHARIOT_TAG)).toBe(button);
});

/** the same deployment, taking crypto beside cards on a form that offers a repeating cadence. */
const WITH_CRYPTO: FormConfig = {
	...CONFIG,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'crypto'],
	coins: [
		{
			coin: 'usdttrc20',
			ticker: 'usdt',
			name: 'Tether USD (Tron)',
			network: 'trx',
			memoRequired: false
		}
	]
};

const USDT: Quote = {
	paymentToken: 'don_1',
	feeMinor: 25,
	totalMinor: 2525,
	deposit: {
		address: 'TbdBAaeHZo9WeEtpitUFqfEuUXDRfLpjeV',
		memo: null,
		coin: 'usdttrc20',
		network: 'trx',
		coinAmount: '25.004187',
		validUntil: '2099-01-01T00:00:00.000Z',
		qr: { rows: ['1'] }
	}
};

afterEach(() => {
	vi.useRealTimers();
});

it('stands the coin list in the crypto option on a one-time gift, and takes it away on a repeating one', async () => {
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const timer = clock();

	const checkout = startCheckout(WITH_CRYPTO, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: { payment: { stripe: { load: payment.load, delay: timer.delay } } }
	});
	onTestFinished(() => checkout.stop());
	await settle();

	expect(paymentMount.contains(checkout.coins.host)).toBe(true);

	checkout.actor.send({ type: 'SET_FREQUENCY', frequency: 'monthly' });
	expect(paymentMount.contains(checkout.coins.host)).toBe(false);

	checkout.actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
	expect(paymentMount.contains(checkout.coins.host)).toBe(true);
});

it('reads a crypto gift at this deployment until it arrives', async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	const { paymentMount, challengeMount } = boxes();
	const payment = paymentProvider();
	const timer = clock();
	const reads: string[] = [];
	let arrived = false;
	const challenge = challengeProvider();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return new Response(JSON.stringify(USDT), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			reads.push(url);
			return new Response(JSON.stringify({ state: arrived ? 'received' : 'waiting' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);

	const checkout = startCheckout(WITH_CRYPTO, {
		paymentMount,
		challengeMount,
		resumeToken: null,
		seams: {
			payment: { stripe: { load: payment.load, delay: timer.delay } },
			challenge: { load: challenge.load, delay: timer.delay }
		}
	});
	onTestFinished(() => checkout.stop());
	await settle();

	const { actor } = checkout;
	actor.send({ type: 'CONTINUE' });
	actor.send({ type: 'SET_CONTACT', email: 'donor@example.org' });
	actor.send({ type: 'SET_CONTACT', firstName: 'Ada' });
	actor.send({ type: 'SET_CONTACT', lastName: 'Lovelace' });
	actor.send({ type: 'CONTINUE' });
	actor.send({ type: 'SET_METHOD', method: 'crypto' });
	actor.send({ type: 'SET_COIN', coin: 'usdttrc20' });
	actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'token-1' });
	actor.send({ type: 'SUBMIT' });
	for (let turn = 0; turn < 20; turn += 1) await settle();
	expect(toState(actor.getSnapshot()).step).toBe('awaitingDeposit');

	await vi.advanceTimersByTimeAsync(DEPOSIT_POLL_MS);
	// same-origin, as the quote is: this page and `/api/v1` are one deployment.
	expect(reads).toEqual([`/api/v1/forms/${WITH_CRYPTO.formId}/donations/don_1`]);
	expect(toState(actor.getSnapshot()).step).toBe('awaitingDeposit');

	arrived = true;
	await vi.advanceTimersByTimeAsync(DEPOSIT_POLL_MS);
	expect(toState(actor.getSnapshot())).toEqual({ step: 'success', method: 'crypto' });
});
