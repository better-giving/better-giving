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
import type { TurnstileLike } from '@better-giving/form/embed/turnstile';
import type { FeeRules, FormConfig } from '@better-giving/form/v1';
import { expect, it, onTestFinished, vi } from 'vitest';
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
	venmo: { percent: 0.0349, fixedMinor: 49 }
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
