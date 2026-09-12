import { afterEach, describe, expect, it } from 'vitest';
import type { Failure } from '../checkout.machine';
import type { FormConfig, PaymentMethod, Quote, QuoteRequest } from '../v1';
import type {
	EligibilityLike,
	PaypalNamespaceLike,
	PaypalSdkLike,
	SessionOptionsLike
} from './paypal';
import type { ElementsLike, PaymentElementLike, StripeLike } from './stripe';
import { createPaymentSurface } from './surface';

// the composer, driven through both real adapters with a plain object standing in for each
// processor's SDK. what is worth asserting here is the composition itself — which adapter a reading
// belongs to, and what one processor's failure does to the other — and none of it needs a network,
// an account or a real approval window.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [
		{ name: 'stripe', publishableKey: 'pk_live_x' },
		{ name: 'paypal', publishableKey: 'live_client_id' }
	],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['card', 'paypal'],
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

const REQUEST: QuoteRequest = {
	formId: 'frm_a8x2k9',
	amountMinor: 2500,
	frequency: 'one_time',
	method: 'card',
	coversFee: true,
	email: 'ada@example.org',
	firstName: 'Ada',
	lastName: 'Lovelace',
	consentedToContact: false
};

const QUOTE: Quote = { paymentToken: 'pi_1_secret_x', feeMinor: 103, totalMinor: 2603 };

type Kit = {
	readonly mount: HTMLElement;
	readonly rails: (PaymentMethod | null)[];
	readonly unavailable: Failure[];
	/** the provider reporting what the donor picked in the inline fields. */
	pickCard(type: string | undefined): void;
	readonly confirmations: Record<string, unknown>[];
	readonly retrieved: string[];
	readonly elementUpdates: Record<string, unknown>[];
	readonly paypalSessions: SessionOptionsLike[];
	readonly paypalStarts: Promise<{ orderId: string }>[];
	readonly seams: Parameters<typeof createPaymentSurface>[4];
};

type Answers = {
	readonly stripe?: (() => Promise<StripeLike | null>) | undefined;
	readonly paypal?: (() => Promise<PaypalNamespaceLike | null>) | undefined;
	readonly eligible?: readonly string[];
	readonly hasReturned?: boolean;
};

function kit(answers: Answers = {}): Kit {
	const rails: (PaymentMethod | null)[] = [];
	const unavailable: Failure[] = [];
	const confirmations: Record<string, unknown>[] = [];
	const retrieved: string[] = [];
	const elementUpdates: Record<string, unknown>[] = [];
	const paypalSessions: SessionOptionsLike[] = [];
	const paypalStarts: Promise<{ orderId: string }>[] = [];
	const changed: ((payload: { value?: { type?: string } }) => void)[] = [];

	function on(event: string, handler: (payload: never) => void): void {
		if (event === 'change')
			changed.push(handler as (payload: { value?: { type?: string } }) => void);
	}
	const element = {
		mount: () => {},
		focus: () => {},
		on,
		off: () => {},
		destroy: () => {}
	} as unknown as PaymentElementLike;
	const elements: ElementsLike = {
		create: () => element,
		update: (options) => {
			elementUpdates.push(options);
			return Promise.resolve();
		},
		submit: () => Promise.resolve({})
	};
	const stripe: StripeLike = {
		elements: () => elements,
		confirmPayment: (options) => {
			confirmations.push(options);
			return Promise.resolve({ paymentIntent: { status: 'succeeded' } });
		},
		retrievePaymentIntent: (secret) => {
			retrieved.push(secret);
			return Promise.resolve({ paymentIntent: { status: 'succeeded' } });
		}
	};

	const eligible = answers.eligible ?? ['paypal', 'venmo'];
	const session = (options: SessionOptionsLike) => {
		paypalSessions.push(options);
		return {
			start: (_presentation: unknown, order: Promise<{ orderId: string }>) => {
				paypalStarts.push(order);
				return new Promise<unknown>(() => {});
			},
			destroy: () => {},
			cancel: () => {},
			hasReturned: () => answers.hasReturned ?? false,
			resume: () => Promise.resolve()
		};
	};
	const sdk: PaypalSdkLike = {
		findEligibleMethods: () =>
			Promise.resolve({
				isEligible: (method: string) => eligible.includes(method)
			} satisfies EligibilityLike),
		createPayPalOneTimePaymentSession: session,
		createVenmoOneTimePaymentSession: session
	};
	const namespace: PaypalNamespaceLike = { createInstance: () => Promise.resolve(sdk) };

	const mount = document.createElement('div');
	document.body.appendChild(mount);

	return {
		mount,
		rails,
		unavailable,
		confirmations,
		retrieved,
		elementUpdates,
		paypalSessions,
		paypalStarts,
		pickCard: (type) => {
			for (const handler of changed) handler({ value: type === undefined ? {} : { type } });
		},
		seams: {
			stripe: { load: answers.stripe ?? (() => Promise.resolve(stripe)), delay: () => () => {} },
			paypal: { load: answers.paypal ?? (() => Promise.resolve(namespace)), delay: () => () => {} }
		}
	};
}

async function composed(k: Kit, config: FormConfig = CONFIG) {
	const surface = createPaymentSurface(
		config,
		k.mount,
		(rail) => k.rails.push(rail),
		(failure) => k.unavailable.push(failure),
		k.seams
	);
	for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
	return surface;
}

describe('one payment surface over however many processors a config names', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	// the node each adapter is handed is created here and in this order, synchronously, because both
	// adapters reach their own node long after this call returns — left to mount into one shared
	// node they would land in whichever order the network answered in.
	it('gives each processor a node of its own, in reading order', async () => {
		const k = kit();
		await composed(k);
		expect(k.mount.children).toHaveLength(2);
		expect(k.mount.children[1]?.querySelector('paypal-button')).not.toBeNull();
	});

	it('builds nothing for a processor whose rails this form does not offer', async () => {
		const k = kit();
		await composed(k, { ...CONFIG, paymentMethods: ['paypal', 'venmo'] });
		expect(k.mount.children).toHaveLength(1);
		expect(k.mount.children[0]?.querySelector('paypal-button')).not.toBeNull();
	});

	it('sends a confirmation to the processor that settles the rail it was quoted on', async () => {
		const k = kit();
		const surface = await composed(k);
		void surface.confirm({ paymentToken: 'o1', method: 'paypal', mandateAccepted: false });
		await Promise.resolve();
		expect(k.paypalStarts).toHaveLength(1);
		expect(k.confirmations).toHaveLength(0);

		void surface.confirm({ paymentToken: 'pi_1_secret_x', method: 'card', mandateAccepted: false });
		for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
		expect(k.confirmations).toHaveLength(1);
	});

	it('tells every processor what the server quoted and what the donor committed to', async () => {
		const k = kit();
		const surface = await composed(k);
		surface.quoted(REQUEST, QUOTE);
		surface.cadence('monthly');
		for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
		expect(k.elementUpdates.some((update) => update.amount === 2603)).toBe(true);
		expect(k.elementUpdates.some((update) => update.mode === 'subscription')).toBe(true);
	});

	// one processor failing is not a form with no way to pay: the other one is still up, and a
	// donor told the payment details did not load would be looking at a card box that works.
	it('says nothing to the donor while any processor is still up', async () => {
		const k = kit({ paypal: () => Promise.resolve(null) });
		await composed(k);
		expect(k.unavailable).toHaveLength(0);
	});

	it('tells the donor once no processor at all can be paid through', async () => {
		const k = kit({ stripe: () => Promise.resolve(null), paypal: () => Promise.resolve(null) });
		await composed(k);
		expect(k.unavailable).toHaveLength(1);
		expect(k.unavailable[0]?.message).toContain('nothing was charged');
	});

	// a picker collapsing in one processor's box must not un-pick the rail a donor chose in the
	// other's — the press that chose it happened somewhere this reading knows nothing about.
	it('keeps a rail chosen in one processor’s box when the other reports nothing', async () => {
		const k = kit();
		await composed(k);
		k.mount.querySelector('paypal-button')?.dispatchEvent(new Event('click'));
		k.pickCard(undefined);
		expect(k.rails).toEqual(['paypal']);
	});

	it('still clears the rail when the processor that holds it says so', async () => {
		const k = kit();
		await composed(k);
		k.pickCard('card');
		k.pickCard(undefined);
		expect(k.rails).toEqual(['card', null]);
	});

	// a cold page load carrying a payment token has no rail behind it, and the two processors'
	// tokens are not told apart by reading them: PayPal's own session is the authority on whether
	// this page came back from PayPal's window, and a card gift's 3DS return must not be handed to
	// the adapter that cannot read it.
	it('hands a return with no rail behind it to the processor that claims it', async () => {
		const k = kit({ hasReturned: true });
		const surface = await composed(k);
		await surface.resume({ paymentToken: 'o1' });
		expect(k.retrieved).toHaveLength(0);
	});

	it('hands a return nobody claims to the processor that can read one', async () => {
		const k = kit();
		const surface = await composed(k);
		await surface.resume({ paymentToken: 'pi_1_secret_x' });
		expect(k.retrieved).toEqual(['pi_1_secret_x']);
	});

	it('re-reads through the processor that took the confirmation', async () => {
		const k = kit({ hasReturned: true });
		const surface = await composed(k);
		void surface.confirm({ paymentToken: 'pi_1_secret_x', method: 'card', mandateAccepted: false });
		for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
		await surface.resume({ paymentToken: 'pi_1_secret_x' });
		expect(k.retrieved).toEqual(['pi_1_secret_x']);
	});

	it('lets go of every processor at once, and raises nothing on a second stop', async () => {
		const k = kit();
		const surface = await composed(k);
		expect(() => {
			surface.stop();
			surface.stop();
		}).not.toThrow();
		for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
		expect(k.mount.querySelector('paypal-button')).toBeNull();
	});
});
