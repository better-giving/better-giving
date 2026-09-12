import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Failure } from '../checkout.machine';
import type { FormConfig, PaymentMethod, Quote, QuoteRequest } from '../v1';
import {
	createPaymentSurface,
	ensureStripeScript,
	loadStripeScript,
	MOUNT_DEADLINE_MS,
	STRIPE_JS_URL,
	STRIPE_JS_URL_SHAPES,
	type ElementsLike,
	type PaymentChangeLike,
	type PaymentElementLike,
	type PaymentLoadErrorLike,
	type StripeLike
} from './stripe';
import { UNCONFIRMABLE, type ConfirmResult } from './outcome';

// the dom pool, and a provider that is a plain object. what is worth asserting here is what this
// adapter asks the SDK for and what it makes of the answer — neither needs a network, an account
// or a real frame, and both are exactly what a spec against the real SDK could not see.
//
// ./outcome.spec.ts owns the answer-to-outcome mapping. this file owns the asking.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['card', 'ach'],
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

type Recorder = {
	readonly stripe: StripeLike;
	readonly elementsOptions: Record<string, unknown>[];
	readonly createOptions: Record<string, unknown>[];
	readonly updates: Record<string, unknown>[];
	readonly confirmations: Record<string, unknown>[];
	readonly mounted: HTMLElement[];
	readonly retrieved: string[];
	/** every event the adapter unsubscribed from, in the order it let each one go. */
	readonly offs: string[];
	/** one entry per element group the adapter destroyed. */
	readonly destroyed: number[];
	/** how many times the adapter moved the caret into the provider's own fields. */
	readonly focused: number;
	/** the provider reporting what the donor picked in its own fields. */
	changed(event: PaymentChangeLike): void;
	/** the provider reporting that its own fields are on screen. */
	ready(): void;
	/** the provider reporting that its own fields will not be. */
	loadError(event: PaymentLoadErrorLike): void;
};

type Answers = {
	readonly submit?: ElementsLike['submit'];
	readonly confirm?: () => Promise<ConfirmResult>;
	readonly retrieve?: () => Promise<ConfirmResult>;
	/** what the element group makes of a change asked of it, recorded either way. */
	readonly update?: (options: Record<string, unknown>) => Promise<void>;
	/** what the element group makes of being destroyed, recorded either way. */
	readonly destroy?: () => void;
};

function recorder(answers: Answers = {}): Recorder {
	const elementsOptions: Record<string, unknown>[] = [];
	const createOptions: Record<string, unknown>[] = [];
	const updates: Record<string, unknown>[] = [];
	const confirmations: Record<string, unknown>[] = [];
	const mounted: HTMLElement[] = [];
	const retrieved: string[] = [];
	const listeners: ((event: PaymentChangeLike) => void)[] = [];
	const readies: (() => void)[] = [];
	const loadErrors: ((event: PaymentLoadErrorLike) => void)[] = [];
	const offs: string[] = [];
	const destroyed: number[] = [];

	// declared with the same three overloads the adapter is written against, so the fake reports
	// each of the provider's events with the payload that event actually carries rather than one
	// widened union nothing has to get right.
	function on(event: 'change', handler: (payload: PaymentChangeLike) => void): void;
	function on(event: 'ready', handler: () => void): void;
	function on(event: 'loaderror', handler: (payload: PaymentLoadErrorLike) => void): void;
	function on(event: string, handler: (payload: never) => void): void {
		if (event === 'change') listeners.push(handler as (payload: PaymentChangeLike) => void);
		if (event === 'ready') readies.push(handler as () => void);
		if (event === 'loaderror') loadErrors.push(handler as (payload: PaymentLoadErrorLike) => void);
	}

	/** the same three overloads from the other end, dropping the handler it is given. */
	function off(event: 'change', handler: (payload: PaymentChangeLike) => void): void;
	function off(event: 'ready', handler: () => void): void;
	function off(event: 'loaderror', handler: (payload: PaymentLoadErrorLike) => void): void;
	function off(event: string, handler: (payload: never) => void): void {
		offs.push(event);
		const held =
			event === 'change'
				? listeners
				: event === 'ready'
					? readies
					: event === 'loaderror'
						? loadErrors
						: [];
		const at = (held as unknown[]).indexOf(handler);
		if (at !== -1) (held as unknown[]).splice(at, 1);
	}

	// the real one throws on a second call, which is what `asks the provider for nothing on a second
	// stop` below is about. every ask is recorded before the answer, so a case can say the group was
	// never asked rather than only that it never went.
	const destroy =
		answers.destroy ??
		((): void => {
			if (destroyed.length > 1) throw new Error('the element group was already destroyed');
		});

	const focuses: number[] = [];

	const element: PaymentElementLike = {
		mount: (node) => void mounted.push(node),
		on,
		off,
		focus: () => void focuses.push(focuses.length + 1),
		destroy: () => {
			destroyed.push(destroyed.length + 1);
			destroy();
		}
	};

	const elements: ElementsLike = {
		create: (_type, options) => {
			createOptions.push(options);
			return element;
		},
		update: async (options) => {
			updates.push(options);
			if (answers.update !== undefined) await answers.update(options);
		},
		submit: answers.submit ?? (async () => ({}))
	};

	return {
		stripe: {
			elements: (options) => {
				elementsOptions.push(options);
				return elements;
			},
			confirmPayment: async (options) => {
				confirmations.push(options);
				return answers.confirm === undefined
					? { paymentIntent: { status: 'succeeded' } }
					: answers.confirm();
			},
			retrievePaymentIntent: async (secret) => {
				retrieved.push(secret);
				return answers.retrieve === undefined
					? { paymentIntent: { status: 'succeeded' } }
					: answers.retrieve();
			}
		},
		elementsOptions,
		createOptions,
		updates,
		confirmations,
		mounted,
		retrieved,
		offs,
		destroyed,
		// a getter, because every other field here is an array a case reads after the fact and a
		// number read off the object at return time would be the count before anything happened.
		get focused() {
			return focuses.length;
		},
		changed: (event) => {
			for (const listener of listeners) listener(event);
		},
		ready: () => {
			for (const listener of readies) listener();
		},
		loadError: (event) => {
			for (const listener of loadErrors) listener(event);
		}
	};
}

/**
 * the mount deadline's timer, fired by hand.
 *
 * a timer rather than fake timers, for the reason `now` is a port in ../ports.ts: the deadline is
 * thirty seconds and a test that waited for it would not be a test, while a test that patched the
 * ambient `setTimeout` would be asserting against the patch. It records every arming so a case can
 * say the deadline was dropped rather than only that it never fired.
 */
function manualDeadline() {
	const armed: { readonly run: () => void; readonly ms: number; cancelled: boolean }[] = [];
	return {
		armed,
		delay: (run: () => void, ms: number) => {
			const timer = { run, ms, cancelled: false };
			armed.push(timer);
			return () => void (timer.cancelled = true);
		},
		/** fires everything still armed, which is what letting the deadline pass amounts to. */
		expire: () => {
			for (const timer of armed) if (!timer.cancelled) timer.run();
		}
	};
}

/** the box the card hands over, in a document. */
function box(): HTMLElement {
	const node = document.createElement('div');
	document.body.appendChild(node);
	return node;
}

/** every rail the surface reported, in the order it reported them. */
function surfaceOn(
	node: HTMLElement,
	kit: Recorder,
	reported: (PaymentMethod | null)[] = [],
	config: FormConfig = CONFIG,
	extra: {
		readonly unavailable?: Failure[];
		readonly delay?: (run: () => void, ms: number) => () => void;
		readonly load?: () => Promise<StripeLike | null>;
	} = {}
): ReturnType<typeof createPaymentSurface> {
	return createPaymentSurface(
		config,
		node,
		(rail) => void reported.push(rail),
		(failure) => void extra.unavailable?.push(failure),
		{
			load: extra.load ?? (async () => kit.stripe),
			...(extra.delay === undefined ? {} : { delay: extra.delay })
		}
	);
}

/** one turn of the loop, which is what the provider's script arriving amounts to here. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * the rails the group has last been told it takes, which is the list a confirmation is sent with.
 *
 * the creation and every ask since, read as one state rather than as a call to assert on: the
 * group carries the newest list it was given, so a case that read only the last update would pass
 * against a group that was never narrowed at all.
 */
function railsOffered(kit: Recorder): unknown {
	return [kit.elementsOptions[0], ...kit.updates].reduce<unknown>(
		(last, ask) => ask?.paymentMethodTypes ?? last,
		undefined
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the element group this adapter asks for', () => {
	// the intent that names the amount is not minted until the donor presses, so the fields have
	// to exist before there is a client secret to create them against.
	it('is created for a payment with no intent behind it yet', async () => {
		const kit = recorder();
		surfaceOn(box(), kit);
		await settle();

		expect(kit.elementsOptions[0]).toMatchObject({ mode: 'payment', currency: 'usd' });
		expect(kit.elementsOptions[0]).not.toHaveProperty('clientSecret');
	});

	// every rail this deployment offers, because the provider's own picker is what a donor
	// chooses on now. the amount and currency the group carries are what decide which of them
	// can be presented, which is a per-rail eligibility this repository does not know.
	it('offers every rail this deployment takes, rather than one', async () => {
		const kit = recorder();
		surfaceOn(box(), kit);
		await settle();

		expect(kit.elementsOptions[0]?.paymentMethodTypes).toEqual(['card', 'us_bank_account']);
	});

	/**
	 * a wire type is named once however many rails settle as it.
	 *
	 * three of the four rails this processor settles are delivered as `card` (`RAILS` in ./rails.ts),
	 * so a deployment offering a card and a wallet has the group refuse the whole list — and it
	 * refuses at mount, on a donor's screen, where this adapter can say nothing but that the fields
	 * are not coming up. the wallets add no type of their own: they are drawn by the `wallets` hash
	 * off this same `card`.
	 */
	it('names a wire type once however many rails settle as it', async () => {
		const kit = recorder();
		surfaceOn(box(), kit, [], {
			...CONFIG,
			paymentMethods: ['card', 'ach', 'apple_pay', 'google_pay']
		});
		await settle();

		expect(kit.elementsOptions[0]?.paymentMethodTypes).toEqual(['card', 'us_bank_account']);
	});

	/**
	 * a rail another processor settles is left out of the group entirely.
	 *
	 * the group is created from `paymentMethodTypes`, and one name this processor has no method for
	 * refuses the whole creation — so a deployment offering the hosted window's rails beside the
	 * inline fields would lose the card box as well, on a form whose card rail was never in doubt.
	 * `STRIPE_RAILS` in ./rails.ts is the list this adapter draws from.
	 */
	it('names no rail another processor settles', async () => {
		const kit = recorder();
		surfaceOn(box(), kit, [], { ...CONFIG, paymentMethods: ['card', 'paypal', 'venmo'] });
		await settle();

		expect(kit.elementsOptions[0]?.paymentMethodTypes).toEqual(['card']);
	});

	// a form offering nothing but wallets still names the type they settle as, or the group is
	// created with no rail at all and the provider refuses it.
	it('names the card for a form that offers only wallets', async () => {
		const kit = recorder();
		surfaceOn(box(), kit, [], { ...CONFIG, paymentMethods: ['apple_pay', 'google_pay'] });
		await settle();

		expect(kit.elementsOptions[0]?.paymentMethodTypes).toEqual(['card']);
	});

	// the fee is priced per rail, so the flow has to learn which one the donor is on. the
	// provider's own name for it is what arrives, and this is where it becomes ours.
	it('reports the rail the donor picked in the provider’s own fields', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		surfaceOn(box(), kit, reported);
		await settle();

		kit.changed({ collapsed: false, empty: true, value: { type: 'us_bank_account' } });

		expect(reported).toEqual(['ach']);
	});

	it('mounts into the box the card handed it', async () => {
		const kit = recorder();
		const node = box();
		surfaceOn(node, kit);
		await settle();

		expect(kit.mounted).toEqual([node]);
	});

	// the card collects the donor's name and email in its own fields. asking for them twice is
	// two places for one answer to differ.
	it('tells the provider never to ask for a name or an email again', async () => {
		const kit = recorder();
		surfaceOn(box(), kit);
		await settle();

		expect(kit.createOptions[0]).toMatchObject({
			fields: { billingDetails: { name: 'never', email: 'never' } }
		});
	});

	// a wallet is not a payment method type, so naming the rails neither draws one nor excludes one:
	// this hash is the whole of what decides, and each key is answered from the rails the deployment
	// was actually approved for. Link has no rail of its own and rides whatever settles as a card.
	it('draws the wallets the deployment offers, and Link beside them', async () => {
		const kit = recorder();
		surfaceOn(box(), kit, [], {
			...CONFIG,
			paymentMethods: ['card', 'ach', 'apple_pay', 'google_pay']
		});
		await settle();

		expect(kit.createOptions[0]?.wallets).toEqual({
			applePay: 'auto',
			googlePay: 'auto',
			link: 'auto'
		});
	});

	// the provider draws a wallet off the `card` in the group whatever this deployment quotes on, so
	// a key left at `auto` for a rail the account was not approved for is an option a donor may pick
	// and `chosenRail` then reports as no rail at all — a Donate press refused with nothing on the
	// card to explain it.
	it('draws no wallet the deployment was not approved for', async () => {
		const kit = recorder();
		surfaceOn(box(), kit, [], { ...CONFIG, paymentMethods: ['card', 'google_pay'] });
		await settle();

		expect(kit.createOptions[0]?.wallets).toEqual({
			applePay: 'never',
			googlePay: 'auto',
			link: 'auto'
		});
	});

	// Link is switched on off the card rather than off a rail of its own, so a form that settles
	// nothing as a card draws none of the three — there is no `card` in the group for one to ride.
	it('draws no wallet at all on a form that settles nothing as a card', async () => {
		const kit = recorder();
		surfaceOn(box(), kit, [], { ...CONFIG, paymentMethods: ['ach'] });
		await settle();

		expect(kit.createOptions[0]?.wallets).toEqual({
			applePay: 'never',
			googlePay: 'never',
			link: 'never'
		});
	});

	// the rails are a list of options to pick from, so each one is drawn as its own container
	// rather than sharing a box with a seam in it, and no radio: the open rail is the picked one.
	it('draws every rail as its own option in a stack', async () => {
		const kit = recorder();
		surfaceOn(box(), kit);
		await settle();

		expect(kit.createOptions[0]?.layout).toEqual({
			type: 'accordion',
			spacedAccordionItems: true,
			radios: 'never'
		});
	});

	// `null` rather than the first rail this form offers. a rail reported from here is one the donor
	// is taken to have chosen, and it is what a submit is allowed on, so a default invented at this
	// seam is a gift charged on a rail nobody picked. the fee row does state a default before any
	// rail is reported and it belongs to the flow (`displayRail` in ../checkout.machine.ts), which is
	// where it can be a figure on screen and nothing else.
	it('reports no rail while the provider’s picker has nothing chosen in it', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		surfaceOn(box(), kit, reported);
		await settle();

		kit.changed({ collapsed: true, empty: true, value: {} });

		expect(reported).toEqual([null]);
	});

	// the intent is minted for one rail this repository names, so a selection it has no name for
	// is no selection at all rather than something to pass on.
	it('reports no rail for a selection this form does not take', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		surfaceOn(box(), kit, reported);
		await settle();

		kit.changed({ collapsed: false, empty: false, value: { type: 'cashapp' } });

		expect(reported).toEqual([null]);
	});

	/**
	 * a wallet arrives under its own name, not under the type it settles as.
	 *
	 * the bug this pins reads as working code: `RAILS` maps three rails onto `card`, so a lookup
	 * written only over that table answers `apple_pay` with nothing at all — the rail is unreported,
	 * `methodIsChargeable` in ../value.ts refuses the press, and every wallet gift on the deployment
	 * is refused at the last step with nothing on the card to explain it.
	 */
	it('reports a wallet under this repository’s own name for it', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		surfaceOn(box(), kit, reported, {
			...CONFIG,
			paymentMethods: ['card', 'ach', 'apple_pay', 'google_pay']
		});
		await settle();

		kit.changed({ collapsed: false, empty: false, value: { type: 'apple_pay' } });
		kit.changed({ collapsed: false, empty: false, value: { type: 'google_pay' } });
		kit.changed({ collapsed: false, empty: false, value: { type: 'card' } });

		expect(reported).toEqual(['apple_pay', 'google_pay', 'card']);
	});

	/**
	 * Link has no rail of its own and is quoted on the card, which is what it pays from.
	 *
	 * it is drawn by the same hash the wallets are and has no name in `PAYMENT_METHODS` (../v1.ts),
	 * so this seam is the only place that can answer for it — reported as nothing, a donor who picks
	 * Link is refused on a form that drew the option for them.
	 */
	it('reports a donor who picked Link as being on the card rail', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		surfaceOn(box(), kit, reported);
		await settle();

		kit.changed({ collapsed: false, empty: false, value: { type: 'link' } });

		expect(reported).toEqual(['card']);
	});

	// a form that settles nothing as a card draws no Link to pick, so a payload naming one is a
	// report from nowhere — answered with the card rail it would quote a gift on a rail the form
	// does not offer.
	it('reports no rail for Link on a form that settles nothing as a card', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		surfaceOn(box(), kit, reported, { ...CONFIG, paymentMethods: ['ach'] });
		await settle();

		kit.changed({ collapsed: false, empty: false, value: { type: 'link' } });

		expect(reported).toEqual([null]);
	});
});

// a repeat is confirmed against the first collection of a commitment, and the element group has to
// be drawn for that: the mandate a donor authorizes a schedule under is rendered by the provider's
// own fields, and only a group told it is collecting for a repeat renders one. the loud failure is
// a rail that refuses without displayed terms; the quiet one is a card, which confirms anyway and
// leaves a donor subscribed to something they were never shown.
describe('the cadence the donor committed to', () => {
	it('draws a gift collected once until a repeat is committed', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('one_time');
		await settle();

		expect(kit.elementsOptions[0]).toMatchObject({ mode: 'payment' });
		expect(kit.updates).toEqual([]);
	});

	it('asks the group to collect for a repeat once the donor commits to one', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		await settle();

		expect(kit.updates).toEqual([
			{ mode: 'subscription', paymentMethodTypes: ['card', 'us_bank_account'] }
		]);
	});

	// monthly and yearly are one shape as far as the provider's fields are concerned, and an ask is
	// a re-render of fields a donor may already be typing into.
	it('asks nothing more when a repeat changes cadence but not shape', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		surface.cadence('yearly');
		await settle();

		expect(kit.updates).toHaveLength(1);
	});

	// a donor reaches the screens after a confirmation with no cadence carried onto them, and the
	// gift they made is over. reading that as a gift collected once would put the group back and
	// re-render the provider's fields for every donation that ended.
	it('says nothing about a gift the donor has not committed to', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		surface.cadence(undefined);
		await settle();

		expect(kit.updates).toHaveLength(1);
	});

	// the donor may go back and drop the repeat, and the fields have to follow them: a group left
	// collecting for a schedule states terms for a gift that is now collected once.
	it('puts the group back to a single collection when the repeat is dropped', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		surface.cadence('one_time');
		await settle();

		expect(kit.updates[1]).toEqual({
			mode: 'payment',
			paymentMethodTypes: ['card', 'us_bank_account']
		});
	});

	// the rails offered stay honest for the cadence: a rail that cannot be collected from a second
	// time is not one a repeating gift may be confirmed on. both rails this deployment quotes carry
	// a repeat, so what this pins is that the list is decided per cadence rather than assumed.
	it('offers only the rails a repeat can be collected on', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		await settle();

		expect(kit.updates[0]?.paymentMethodTypes).toEqual(['card', 'us_bank_account']);
	});

	// `settling` is what holds this: the shape a cadence asked for and the total a quote named are
	// two asks, and a press landing after both must wait for both. the slow one here is the cadence
	// and the fast one is the total, which is the interleaving that matters — a field holding only
	// the newest ask would let the confirmation go the moment the total landed, on fields still
	// drawn for the gift the donor no longer chose.
	it('never confirms before everything asked of the group has been applied', async () => {
		const order: string[] = [];
		const kit = recorder({
			update: async (options) => {
				if (options.mode !== undefined) await settle();
				order.push(`update:${Object.keys(options)[0]}`);
			},
			submit: async () => {
				order.push('submit');
				return {};
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		surface.quoted(REQUEST, QUOTE);
		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(order).toEqual(['update:mode', 'update:amount', 'update:paymentMethodTypes', 'submit']);
	});

	// nothing has been authorized at the point this is discovered, so a refusal costs the donor a
	// second press. confirming anyway would be the silent case this whole block exists for.
	it('refuses to confirm on a group that would not take the shape', async () => {
		const kit = recorder({
			update: async () => {
				throw new Error('the frame went away');
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.cadence('monthly');
		const outcome = await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(outcome).toMatchObject({ kind: 'declined' });
		expect(kit.confirmations).toEqual([]);
	});
});

describe('what a quote tells the provider', () => {
	it('echoes the server’s own total into the surfaces that state one', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.quoted(REQUEST, QUOTE);
		await settle();

		expect(kit.updates).toContainEqual({ amount: 2603 });
	});

	// the response is untrusted json reaching code on a stranger's page, and the machine is what
	// refuses an unusable quote. a total that is not a whole minor unit is not passed on as one.
	it('passes on no total that is not a whole minor unit', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.quoted(REQUEST, { ...QUOTE, totalMinor: 26.03 });
		await settle();

		expect(kit.updates).toEqual([]);
	});

	it('hands the donor’s own details over at confirmation rather than collecting them twice', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		surface.quoted(REQUEST, QUOTE);
		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		expect(params.payment_method_data).toEqual({
			billing_details: { name: 'Ada Lovelace', email: 'ada@example.org' }
		});
	});
});

describe('confirming', () => {
	/**
	 * the defect this exists for.
	 *
	 * the group offers every rail the form takes so that the donor picks theirs in the provider's
	 * own box, and the intent is minted for exactly one — the fee that produced its amount was
	 * priced for that rail. a confirmation carries the group's own list for the API to check
	 * against the intent's, so a group still offering both is refused before any rail is touched:
	 * no charge, no decline, an intent left at `requires_payment_method` with nothing attached and
	 * no `last_payment_error`, and a donor reading a thank-you.
	 *
	 * measured where the confirmation reads it rather than afterwards, so that a list put back for
	 * a donor who may try again cannot stand in for one that was never narrowed.
	 */
	it.each([
		['card', 'card'],
		['ach', 'us_bank_account']
	])('confirms a %s gift on the one rail the intent names', async (method, named) => {
		let offered: unknown;
		const kit: Recorder = recorder({
			submit: async () => {
				offered = railsOffered(kit);
				return {};
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: method as PaymentMethod,
			mandateAccepted: false
		});

		expect(offered).toEqual([named]);
	});

	// the narrowing above is for the length of one attempt. `declined` is the outcome ../ports.ts
	// describes as another try on this page load, and the picker that try is made in is the
	// provider's own — a group left holding the rail that just refused offers a donor who wants to
	// pay another way a single option.
	it('offers every rail again once a refusal hands the donor back the form', async () => {
		const kit = recorder({
			confirm: async () => ({
				error: { type: 'card_error', message: 'Your card was declined.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		const outcome = await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'ach',
			mandateAccepted: false
		});
		await settle();

		expect(outcome).toMatchObject({ kind: 'declined' });
		expect(railsOffered(kit)).toEqual(['card', 'us_bank_account']);
	});

	// an ask re-renders the provider's fields, and this is the one made after the donor has finished
	// typing into them. a form that offers the rail alone is already confirming on it.
	it('asks for no narrowing on a form that offers the one rail', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit, [], { ...CONFIG, paymentMethods: ['card'] });
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(kit.updates).toEqual([]);
	});

	it('confirms the intent the flow named and nothing it worked out itself', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(kit.confirmations[0]).toMatchObject({ clientSecret: 'pi_1_secret_x' });
	});

	// the donor comes back to the page they left, whichever page that is: this package is handed
	// an address rather than holding one.
	it('sends the donor back to the page the form is embedded in', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		const back = new URL(String(params.return_url));
		// the page itself, down to the path. what the url carries beyond it is the stamp below, which
		// is this adapter's own addition rather than anything the host asked for.
		expect(back.origin).toBe(window.location.origin);
		expect(back.pathname).toBe(window.location.pathname);
	});

	// the page a donor comes back to may carry a second form, or the org's own separate integration
	// with this provider. the stamp is the only thing that tells whose token the provider appended:
	// `takeResumeToken` in ./resume.ts claims a return for the form named here and for no other.
	it('stamps the return url with the form the donor is leaving from', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		expect(new URL(String(params.return_url)).searchParams.get('bg_donate_form')).toBe(
			'frm_a8x2k9'
		);
	});

	// the page the donor was on when the form was built, and never whatever the host's own router
	// last wrote. a single-page host rewrites its url without reloading anything, so a return read at
	// confirm time is a route chosen by their router in the middle of a gift — and a donor coming
	// back from their bank lands on a view that may hold no form at all, with the token on the url
	// and nobody to claim it.
	it('sends the donor back to the page the form was mounted on', async () => {
		window.history.replaceState(null, '', '/give?campaign=spring');
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();
		// the host's router, mid-gift.
		window.history.replaceState(null, '', '/thanks');

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		const back = new URL(String(params.return_url));
		expect(back.pathname).toBe('/give');
		expect(back.searchParams.get('campaign')).toBe('spring');
		expect(back.searchParams.get('bg_donate_form')).toBe('frm_a8x2k9');
	});

	// a document that is not a page a donor can be sent back to: an `about:` or `blob:` frame, which
	// is what a preview pane and some cms embeds render into. no return url is handed over at all,
	// and the provider's own parameter checking refuses the confirmation — which this adapter already
	// reads as a refusal rather than as an answer nobody has, so nothing is authorized and the donor
	// is told. inventing a page to send them to would be a donor returning to a form that was never
	// there.
	it('hands over no return url from a document that is not an http page', async () => {
		const frame = document.createElement('iframe');
		document.body.appendChild(frame);
		const doc = frame.contentDocument;
		if (doc === null) throw new Error('the iframe has no document');
		const node = doc.createElement('div');
		doc.body.appendChild(node);
		const kit = recorder();
		const surface = surfaceOn(node, kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		expect(doc.defaultView?.location.protocol).not.toBe('https:');
		expect(params.return_url).toBe('');
	});

	// the href is read where the form is built, so on a second gift it is a page this adapter has
	// already stamped once. appended rather than replaced, the url carries two stamps and the reader
	// takes the first — a donor sent away from a form that would then never claim its own return.
	it('replaces a stamp the page already carries rather than adding a second', async () => {
		window.history.replaceState(null, '', '/give?bg_donate_form=frm_earlier&campaign=spring');
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		const back = new URL(String(params.return_url));
		expect(back.searchParams.getAll('bg_donate_form')).toEqual(['frm_a8x2k9']);
		// the host's own parameters are none of this adapter's business and come back untouched.
		expect(back.searchParams.get('campaign')).toBe('spring');
	});

	// untouched down to the character, which a query read into `URLSearchParams` and written back out
	// is not: that serializer is form-urlencoded, so `;` becomes `%3B`, a valueless parameter grows an
	// `=` and `%20` becomes `+`. the url is the host's page and this adapter is the one handing it to
	// a payment provider — a donor comes back to whatever it says, and a parameter their own site
	// reads by hand comes back meaning something else. `campaign=spring` above happens to survive
	// that round trip, so the case beside this one cannot catch a serializer that moves characters.
	it('leaves a query the host wrote in characters that serializer would move', async () => {
		window.history.replaceState(null, '', '/give?opts=a;b&debug&nudge=one%20two');
		const before = window.location.href;
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		const params = kit.confirmations[0]?.confirmParams as Record<string, unknown>;
		expect(String(params.return_url)).toBe(`${before}&bg_donate_form=frm_a8x2k9`);
	});

	// the host's page must not be navigated away from underneath the donor for a card that needed
	// no challenge, so a redirect happens only where the rail cannot be authenticated in place.
	it('leaves the page only where the rail requires it', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(kit.confirmations[0]?.redirect).toBe('if_required');
	});

	it('validates the provider’s own fields before confirming anything', async () => {
		const order: string[] = [];
		const kit = recorder({
			submit: async () => {
				order.push('submit');
				return {};
			},
			confirm: async () => {
				order.push('confirm');
				return { paymentIntent: { status: 'succeeded' } };
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(order).toEqual(['submit', 'confirm']);
	});

	/**
	 * the press made over a card the donor has not filled in, which is the ordinary way a form gets
	 * filled in rather than a gift that failed.
	 *
	 * the provider's own validation stops it before anything leaves the page, and the sentence it
	 * carries is one it is already showing on the field it is about. so what comes back says nothing
	 * — the flow stays where it is, and ../checkout.machine.ts is where that lands.
	 */
	it('never confirms when the fields the provider owns are not filled in', async () => {
		const kit = recorder({
			submit: async () => ({
				error: { type: 'validation_error', message: 'Your card number is incomplete.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		const outcome = await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(kit.confirmations).toEqual([]);
		expect(outcome).toEqual({ kind: 'unfinished' });
	});

	/**
	 * the donor is put in front of what stopped them, rather than left on a button that did nothing.
	 *
	 * the fields are the provider's, painted in a frame on its own origin, so nothing this end can
	 * move the caret into them except the group's own `focus` — and without it a donor pressing
	 * Donate on an empty card gets no visible answer at all, which is worst for the two who cannot
	 * see the marks appear: someone on a keyboard and someone on a screen reader.
	 */
	it('puts the donor back in the provider’s fields rather than on the press that refused', async () => {
		const kit = recorder({
			submit: async () => ({
				error: { type: 'validation_error', message: 'Your card number is incomplete.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});
		// the caret waits for the picker to be put back, because that ask redraws the fields it is
		// moving into.
		await settle();

		expect(kit.focused).toBe(1);
	});

	// the narrowing lasts one attempt, and this attempt is over — the donor is back in the picker
	// with the form. a group left holding the one rail the intent named would offer someone who has
	// not chosen yet a single option, on a step they never left.
	it('offers every rail again when the donor is handed back an unfinished form', async () => {
		const kit = recorder({
			submit: async () => ({
				error: { type: 'validation_error', message: 'Your card number is incomplete.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'ach',
			mandateAccepted: false
		});
		await settle();

		expect(railsOffered(kit)).toEqual(['card', 'us_bank_account']);
	});

	// an unfinished form is the ordinary way a donor fills one in, and the loudest thing there is to
	// log: reported on every host page it would bury the faults this console reporting exists for.
	it('says nothing in the console about a form that is simply not finished', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const kit = recorder({
			submit: async () => ({
				error: { type: 'validation_error', message: 'Your card number is incomplete.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(reported).not.toHaveBeenCalled();
	});

	/**
	 * the second half of the defect, and the half that leaves the first unreported.
	 *
	 * the provider's sentence names the parameter it refused, and `ConfirmOutcome` in ../ports.ts
	 * has nowhere to carry that: it is the donor's vocabulary, and rightly says nothing an
	 * integrator could act on. so the sentence goes to the console of the page the form is embedded
	 * in — the same place ./loader.ts puts a runtime that would not load — because a refusal
	 * nothing states anywhere is a form that silently does nothing.
	 */
	it('names the provider’s own words in the console when a confirmation is refused', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const kit = recorder({
			confirm: async () => ({
				error: {
					type: 'invalid_request_error',
					message: 'The provided payment_method_types do not match the expected value.'
				}
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(reported.mock.calls[0]?.[0]).toContain('do not match the expected value');
	});

	// a refusal by the issuer is the donor's to read and the one path that works reaching the
	// console on every host page it is embedded in would bury the faults this reporting exists for.
	it('says nothing in the console about a rail that simply refused', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const kit = recorder({
			confirm: async () => ({
				error: { type: 'card_error', message: 'Your card has insufficient funds.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(reported).not.toHaveBeenCalled();
	});

	// the port's own contract: an adapter that cannot get an answer says so rather than throwing.
	// a throw out of a confirmation is not a refusal, and reported as one it puts a Retry in front
	// of a donor whose card may already have been charged.
	it('reports a confirmation that threw as an answer nobody has', async () => {
		const kit = recorder({
			confirm: async () => {
				throw new Error('the frame went away');
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		const outcome = await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(outcome).toEqual({ kind: 'indeterminate' });
	});

	/**
	 * the one throw out of a confirmation that is knowable, and it is the one this defect raised.
	 *
	 * an integration error is the provider's own parameter checking, raised before anything leaves
	 * the page — nothing was authorized, so `indeterminate` would be a confident answer dressed as
	 * an unknown one, and ../views.ts greets that state with a thank-you. every other throw stays
	 * unknown, because the request may well have been received.
	 */
	it('reads an integration error as a refusal rather than an answer nobody has', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const kit = recorder({
			confirm: async () => {
				const raised = new Error('Invalid value for stripe.confirmPayment(): the ‘elements’ …');
				raised.name = 'IntegrationError';
				throw raised;
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		const outcome = await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(outcome).toEqual({ kind: 'declined', message: UNCONFIRMABLE });
	});

	// whatever it turns out to be, it is diagnosable: a throw nothing writes down is a form that
	// silently does nothing.
	it('names a throw of any kind in the console', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const kit = recorder({
			confirm: async () => {
				throw new Error('the frame went away');
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(reported.mock.calls[0]?.[0]).toContain('the frame went away');
	});

	// nothing reached the provider at all, so this is the one thing an unanswered confirmation is
	// definitely not — and saying so is what lets the donor pay another way.
	it('reports a provider that never loaded as a refusal, never as an unanswered confirmation', async () => {
		const surface = createPaymentSurface(
			CONFIG,
			box(),
			() => {},
			() => {},
			{
				load: async () => null
			}
		);

		const outcome = await surface.confirm({
			paymentToken: 'pi_1_secret_x',
			method: 'card',
			mandateAccepted: false
		});

		expect(outcome).toMatchObject({ kind: 'declined' });
	});
});

describe('resuming', () => {
	it('reads the intent the URL came back with rather than confirming anything', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();

		const outcome = await surface.resume({ paymentToken: 'pi_1_secret_x' });

		expect(kit.retrieved).toEqual(['pi_1_secret_x']);
		expect(kit.confirmations).toEqual([]);
		expect(outcome).toEqual({ kind: 'succeeded' });
	});

	// the refusal a confirmation may be certain about, on the one port that may not: this read tells
	// nobody whether the gift it could not fetch was charged, and a donor who came back from their
	// bank is exactly the donor whose card may already have been.
	it('reads a refused read as an answer nobody has, never as a refusal', async () => {
		const kit = recorder({
			retrieve: async () => ({
				error: { type: 'invalid_request_error', message: 'No such payment_intent.' }
			})
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		expect(await surface.resume({ paymentToken: 'pi_1_secret_x' })).toEqual({
			kind: 'indeterminate'
		});
	});

	// the same swallow one port over, and the same cost: a donor coming back from their bank onto a
	// page that can say nothing about why it cannot read their gift.
	it('names a read that threw in the console', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const kit = recorder({
			retrieve: async () => {
				throw new Error('offline');
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		await surface.resume({ paymentToken: 'pi_1_secret_x' });

		expect(reported.mock.calls[0]?.[0]).toContain('offline');
	});

	it('reports a read that threw as an answer nobody has', async () => {
		const kit = recorder({
			retrieve: async () => {
				throw new Error('offline');
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		expect(await surface.resume({ paymentToken: 'pi_1_secret_x' })).toEqual({
			kind: 'indeterminate'
		});
	});
});

describe('fields that never came up', () => {
	// the defect this exists for. subscribed to `change` alone, the element group reports a mount
	// that starts and never finishes in no way at all — no console line, no state change and no
	// sentence on the card — so the donor sits in front of a form with no card fields on it, and the
	// operator has nothing to work from.
	it('reports the failure the provider named when its own fields refuse to load', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		surfaceOn(box(), kit, [], CONFIG, { unavailable });
		await settle();
		kit.loadError({ error: { message: 'No such publishable key.' } });

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.fix).toContain('No such publishable key.');
	});

	/**
	 * a config naming no entry for this processor is one this adapter cannot start at all.
	 *
	 * `FormConfig.providers` is a set (../v1.ts) and this file takes its own entry by name, so a
	 * deployment that holds only the other processor hands this surface no key. reported rather
	 * than loaded with nothing: the SDK would answer badly on its own clock, and a donor would sit
	 * in front of an empty box while it did.
	 */
	it('reports a config that names no entry for this processor', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		surfaceOn(
			box(),
			kit,
			[],
			{
				...CONFIG,
				providers: [{ name: 'paypal', publishableKey: 'AZ_client_id' }]
			},
			{ unavailable }
		);
		await settle();

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.fix).toContain('names no stripe processor');
	});

	// the stall this was found on named nothing: `loaderstart` and then silence, with no
	// `loaderror` ever arriving. So the absence of `ready` is what has to be the signal, and a
	// subscription to `loaderror` alone would have watched this defect ship.
	it('reports a stall the provider never named, once the deadline passes', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const deadline = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: deadline.delay });
		await settle();
		deadline.expire();

		expect(deadline.armed[0]?.ms).toBe(MOUNT_DEADLINE_MS);
		expect(unavailable).toHaveLength(1);
	});

	// the ordinary case, and the one a deadline must not spoil: fields that came up are fields that
	// came up, however long a donor then sits in front of them.
	it('says nothing at all once the fields are on screen', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const deadline = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: deadline.delay });
		await settle();
		kit.ready();
		deadline.expire();

		expect(unavailable).toEqual([]);
	});

	// one report is a failure screen; two is a failure screen replacing a failure screen, and the
	// provider fires `loaderror` per retry of its own.
	it('reports once however many ways the same mount goes wrong', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const deadline = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: deadline.delay });
		await settle();
		kit.loadError({ error: { message: 'No such publishable key.' } });
		kit.loadError({ error: { message: 'No such publishable key.' } });
		deadline.expire();

		expect(unavailable).toHaveLength(1);
	});

	// the same failure one layer earlier: the provider's script never arrived, so there is no
	// element group to have loaded. It is answerable at confirmation too — `UNLOADABLE` — but only
	// to a donor who has filled the whole form in first and then pressed.
	it('reports when the provider’s script never arrived at all', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		surfaceOn(box(), kit, [], CONFIG, { unavailable, load: async () => null });
		await settle();

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.message).toContain('nothing was charged');
	});

	// a deadline left armed against a script that never arrived would fire thirty seconds after the
	// sentence the donor is already reading, and replace it with a second one. the load is bounded,
	// so there is a deadline to drop rather than none to arm — dropped on the answer, whichever
	// answer it was.
	it('leaves no deadline armed once the script has answered', async () => {
		const kit = recorder();
		const deadline = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { delay: deadline.delay, load: async () => null });
		await settle();

		// the count first, and it is not decoration: `every` holds on an empty array, so a load that
		// armed no deadline at all would pass the line below — which is the regression the deadline
		// over the load exists to prevent.
		expect(deadline.armed).toHaveLength(1);
		expect(deadline.armed.every((timer) => timer.cancelled)).toBe(true);
	});

	// the tag that fires neither `load` nor `error`. the script's promise settles on one of those two
	// events and on nothing else, so it stays pending for the life of the page: no element group is
	// ever built, nothing arms the mount deadline, and the report that the fields are not coming up
	// sits behind a promise with nothing to settle it. the donor is left in front of a box that says
	// nothing at all, forever — which is the one outcome every other path here exists to prevent.
	it('reports a script that never answers either way, once the deadline passes', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const deadline = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, {
			unavailable,
			delay: deadline.delay,
			load: () => new Promise<StripeLike | null>(() => {})
		});
		await settle();
		deadline.expire();
		await settle();

		expect(deadline.armed[0]?.ms).toBe(MOUNT_DEADLINE_MS);
		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.message).toContain('nothing was charged');
	});

	// the re-boot behind it, which is the second half of the same defect: the dead tag is still in
	// the document, so the SDK's loader adopts it and joins the same promise nothing settles. a boot
	// that waited again would spend a second deadline discovering what the first one already found,
	// with a donor in front of a silent box for thirty more seconds.
	it('waits on nothing when an earlier boot already found the script dead', async () => {
		const kit = recorder();
		const dead = () => new Promise<StripeLike | null>(() => {});
		const first = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { delay: first.delay, load: dead });
		await settle();
		first.expire();

		const unavailable: Failure[] = [];
		const again = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: again.delay, load: dead });
		await settle();

		expect(again.armed).toEqual([]);
		expect(unavailable).toHaveLength(1);
	});

	// and the other side of that record, which is a donor's only way back without a reload: a script
	// that answers late is a script that answers. the deadline has already put the failure screen up,
	// the donor presses Try again at forty seconds, and by then `window.Stripe` is loaded and
	// working — a boot that still refused on the strength of the first attempt would be a form that
	// can never take this donor's gift, on a page that is now perfectly able to.
	it('boots again on a loader that answered after its deadline had passed', async () => {
		const kit = recorder();
		let answer: (stripe: StripeLike) => void = () => {};
		const slow = () =>
			new Promise<StripeLike | null>((resolve) => {
				answer = resolve;
			});
		const first = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { delay: first.delay, load: slow });
		await settle();
		first.expire();
		answer(kit.stripe);
		await settle();

		const unavailable: Failure[] = [];
		const again = manualDeadline();
		surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: again.delay, load: slow });
		answer(kit.stripe);
		await settle();

		expect(kit.mounted).toHaveLength(1);
		expect(unavailable).toEqual([]);
	});
});

// the defect this exists for. the card that built this surface can go away — a second gift re-boots
// the element, and a host page can take it off the document — and nothing here is told unless it is
// told here. the element group, its three subscriptions and an armed deadline otherwise outlive the
// card that asked for them: one orphan per gift, each still reporting into a flow that has been
// stopped.
describe('letting go of the provider’s fields', () => {
	it('unsubscribes every report it took out on the element group', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();
		surface.stop();

		expect(kit.offs).toEqual(['change', 'ready', 'loaderror']);
	});

	// `change` is the one with somewhere to arrive: the callback it was subscribed with reports the
	// rail into a flow this surface no longer belongs to.
	it('reports no rail the donor picks in fields nobody is looking at', async () => {
		const kit = recorder();
		const reported: (PaymentMethod | null)[] = [];
		const surface = surfaceOn(box(), kit, reported);
		await settle();
		surface.stop();
		kit.changed({ collapsed: false, empty: true, value: { type: 'card' } });

		expect(reported).toEqual([]);
	});

	// the frame the provider painted is inside the mount node, and the card removes that node from
	// the host's page — which collects the DOM and leaves the group registered in the provider's own
	// script. the SDK's element group carries no teardown of its own; the element created from it is
	// what has `destroy`.
	it('destroys the element group it built', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();
		surface.stop();

		expect(kit.destroyed).toHaveLength(1);
	});

	// the SPA host that routes away inside thirty seconds. the deadline fires at a flow that has
	// been stopped, which is an xstate warning in a stranger's console and a screen nobody sees.
	it('says nothing once the deadline it left armed passes', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const deadline = manualDeadline();
		const surface = surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: deadline.delay });
		await settle();
		surface.stop();
		deadline.expire();

		// both of them, counted as well as read: the load's, dropped when the script answered, and
		// the mount's, dropped here. `every` holds on an empty array, so the count is what says a
		// deadline was armed at all.
		expect(deadline.armed).toHaveLength(2);
		expect(deadline.armed.every((timer) => timer.cancelled)).toBe(true);
		expect(unavailable).toEqual([]);
	});

	// the same window from the other side: the card is gone before the provider's script arrives, so
	// there is nothing yet to unsubscribe from and the group must not be built at all. built anyway
	// it would mount into a node already off the page and arm a fresh deadline behind it. the one
	// deadline standing at that moment is the load's, and it goes with the stop.
	it('builds no element group at all when it is stopped before the script arrives', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const deadline = manualDeadline();
		const surface = surfaceOn(box(), kit, [], CONFIG, { unavailable, delay: deadline.delay });
		surface.stop();
		await settle();
		deadline.expire();

		expect(kit.elementsOptions).toEqual([]);
		expect(kit.mounted).toEqual([]);
		// one deadline stood at the stop — the load's — and it is cancelled rather than merely
		// absent, which an `every` on its own could not tell apart.
		expect(deadline.armed).toHaveLength(1);
		expect(deadline.armed.every((timer) => timer.cancelled)).toBe(true);
		expect(unavailable).toEqual([]);
	});

	// the box a caller hands over is the caller's to remove, and it may already have. this surface
	// holds its own end either way rather than depending on the order it is reached in.
	it('stops a surface whose box has already left the page', async () => {
		const kit = recorder();
		const node = box();
		const surface = surfaceOn(node, kit);
		await settle();
		node.remove();
		surface.stop();

		expect(kit.destroyed).toHaveLength(1);
	});

	// the one call in a teardown the provider can refuse, and refusing it must end here. the caller
	// is a re-boot — `#stop` in ../element.ts runs before the mount and the boot that follow it — so
	// a refusal allowed out of this surface is a fresh boot that never starts and an uncaught error
	// on the host's page: the donor presses Try again and the card sits there.
	it('lets go without raising when the provider refuses to destroy the group', async () => {
		const kit = recorder({
			destroy: () => {
				throw new Error('the element group is already gone');
			}
		});
		const surface = surfaceOn(box(), kit);
		await settle();

		expect(() => surface.stop()).not.toThrow();
		// and everything that had to happen happened: the refusal is the last thing asked for.
		expect(kit.offs).toEqual(['change', 'ready', 'loaderror']);
	});

	// a second gift stops the surface and the element then leaves the document, or the other way
	// round. the provider refuses a second `destroy`, so the second stop has to ask it for nothing.
	it('asks the provider for nothing on a second stop', async () => {
		const kit = recorder();
		const surface = surfaceOn(box(), kit);
		await settle();
		surface.stop();
		surface.stop();

		expect(kit.destroyed).toHaveLength(1);
		expect(kit.offs).toEqual(['change', 'ready', 'loaderror']);
	});
});

// the provider's script, planted here rather than left to the SDK.
//
// the SDK builds its own tag inside `injectScript` and sets no nonce on it, and takes no option
// for one — so on a host serving `script-src 'nonce-…'` without `'strict-dynamic'` the payment
// fields never arrive and a donor is stopped at the one step of a donation that cannot be skipped.
describe('the provider’s script on a page with a policy', () => {
	/** a document of its own, so one case's tag is not the next case's host page. */
	function page(): Document {
		return document.implementation.createHTMLDocument('');
	}

	function scripts(doc: Document): HTMLScriptElement[] {
		return Array.from(doc.querySelectorAll('script'));
	}

	/**
	 * the installed SDK's own source, which is the only place its two url rules are written.
	 *
	 * resolved from this module rather than from the process's working directory: `@stripe/stripe-js`
	 * is a dependency of this package and pnpm gives it a node_modules entry here, not necessarily one
	 * at whatever directory the test happened to be run from.
	 */
	function sdkSource(): string {
		return readFileSync(
			fileURLToPath(import.meta.resolve('@stripe/stripe-js/dist/pure.js')),
			'utf8'
		);
	}

	it('plants the provider’s script carrying the nonce', () => {
		const doc = page();
		const planted = ensureStripeScript(doc, 'n0nce');

		expect(planted?.getAttribute('src')).toBe(STRIPE_JS_URL);
		expect(scripts(doc)).toHaveLength(1);
		expect(planted?.nonce).toBe('n0nce');
	});

	// every page without such a policy, which is nearly all of them. the SDK injects its own tag
	// there, and this adapter is not in the business of owning that url.
	it('plants nothing where the runtime carried no nonce', () => {
		const doc = page();

		expect(ensureStripeScript(doc, '')).toBeNull();
		expect(scripts(doc)).toEqual([]);
	});

	// the host page may run the provider's script for its own checkout, under their own nonce. a
	// second copy is what the SDK's own loader exists to avoid, and planting one would be this
	// adapter causing the thing it is here to prevent.
	it('leaves a provider script the SDK would adopt', () => {
		const doc = page();
		const theirs = doc.createElement('script');
		theirs.setAttribute('src', 'https://js.stripe.com/v3');
		doc.head.appendChild(theirs);

		expect(ensureStripeScript(doc, 'n0nce')).toBeNull();
		expect(scripts(doc)).toEqual([theirs]);
	});

	// a merchant page carrying one of the provider's other scripts — a buy button, a pricing table,
	// a terminal or a legacy tag — is one the SDK will not adopt, so it injects its own un-nonced
	// tag a moment later. bailing on the origin alone would leave exactly those pages unfixed.
	it.each([
		['a buy button', 'https://js.stripe.com/v3/buy-button.js'],
		['a pricing table', 'https://js.stripe.com/v3/pricing-table.js'],
		['a terminal script', 'https://js.stripe.com/terminal/v1/index.js'],
		['a legacy tag', 'https://js.stripe.com/v2/']
	])('plants beside %s, which the SDK would not adopt', (_label, src) => {
		const doc = page();
		const theirs = doc.createElement('script');
		theirs.setAttribute('src', src);
		doc.head.appendChild(theirs);

		expect(ensureStripeScript(doc, 'n0nce')?.getAttribute('src')).toBe(STRIPE_JS_URL);
	});

	// the whole plant rests on the SDK finding this tag rather than injecting one of its own, and it
	// looks by url: `findScript` in @stripe/stripe-js takes a `js.stripe.com` script whose src is one
	// of two shapes it holds privately, and `injectScript` runs when there is none. the url it builds
	// is a release train in that same file. both are copied into ./stripe.ts because the package
	// exports neither, and both are read back out of the installed package here — a bump that moves
	// either is a red test rather than a page that loads two copies, or the wrong one, or an
	// un-nonced one.
	it('names the url the installed SDK builds for itself', () => {
		const train = /var RELEASE_TRAIN = '([a-z]+)'/.exec(sdkSource())?.[1];

		expect(train).toBeDefined();
		expect(STRIPE_JS_URL).toBe(`https://js.stripe.com/${train}/stripe.js`);
	});

	it('matches the url shapes the installed SDK recognises', () => {
		const source = sdkSource();
		const shapes = [
			/var V3_URL_REGEX = (\/.*\/);/.exec(source)?.[1],
			/var STRIPE_JS_URL_REGEX = (\/.*\/);/.exec(source)?.[1]
		];

		expect(shapes).toEqual(STRIPE_JS_URL_SHAPES.map(String));
	});
});

// the second attempt, which is where the nonce would be lost.
//
// the SDK loads at most once and clears that memory when the attempt fails, so a second form
// mounting after a transient failure re-enters its loader — where it removes the tag from the first
// attempt and injects a replacement with no nonce on it. what keeps that branch out of reach is
// `window.Stripe`: the SDK resolves off it before it looks at the document at all.
describe('the provider’s script through a second attempt', () => {
	function page(): Document {
		const frame = document.createElement('iframe');
		document.body.appendChild(frame);
		const doc = frame.contentDocument;
		if (doc === null) throw new Error('the iframe has no document');
		return doc;
	}

	function provider(doc: Document, present: boolean): void {
		(doc.defaultView as unknown as { Stripe?: unknown }).Stripe = present ? () => {} : undefined;
	}

	it('leaves the script it planted where the provider arrived on it', async () => {
		const doc = page();
		const waiting = loadStripeScript(doc, 'n0nce');
		provider(doc, true);
		doc.querySelector('script')?.dispatchEvent(new Event('load'));
		await waiting;

		expect(doc.querySelectorAll('script')).toHaveLength(1);
	});

	// left on the page it is what the SDK finds next time, and it would be adopted for a load event
	// that has already fired — a promise nothing settles, in front of a donor.
	it('takes it back off where the script loaded and defined nothing', async () => {
		const doc = page();
		const waiting = loadStripeScript(doc, 'n0nce');
		provider(doc, false);
		doc.querySelector('script')?.dispatchEvent(new Event('load'));
		await waiting;

		expect(doc.querySelectorAll('script')).toHaveLength(0);
	});

	// the failure this whole path is for: the first attempt did not complete, and the second must be
	// able to plant a nonced tag of its own rather than find the dead one and stand down.
	it('takes it back off on error, so a later attempt plants a nonced one again', async () => {
		const doc = page();
		const waiting = loadStripeScript(doc, 'n0nce');
		doc.querySelector('script')?.dispatchEvent(new Event('error'));
		await waiting;

		expect(ensureStripeScript(doc, 'n0nce')?.nonce).toBe('n0nce');
	});

	// every page with no policy of its own: nothing is planted and nothing is waited for, so the SDK
	// loads its own script itself.
	it('waits for nothing where there is no nonce', async () => {
		const doc = page();
		await loadStripeScript(doc, '');

		expect(doc.querySelectorAll('script')).toHaveLength(0);
	});
});
