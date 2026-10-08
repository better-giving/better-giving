import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { checkoutMachine, type Failure } from '../checkout.machine';
import type { CheckoutPorts } from '../ports';
import type { FormConfig, Frequency, PaymentMethod, Quote, QuoteRequest } from '../v1';
import {
	createPaymentSurface,
	loadPaypalScript,
	outcomeOfTermination,
	PAYPAL_CORE_URL,
	PAYPAL_NAMESPACE,
	readNamespace,
	type EligibilityLike,
	type PaypalNamespaceLike,
	type PaypalPaymentSurface,
	type PaypalSdkLike,
	type PaypalSeam,
	type PaypalSessionLike,
	type PaypalWindowLike,
	type SessionOptionsLike
} from './paypal';
import { quoteThrough } from './surface';

// the dom pool, and a processor that is a plain object. what is worth asserting here is what this
// adapter asks PayPal's SDK for and what it makes of the answer — neither needs a network, an
// account or a real approval window, and both are exactly what a spec against the live SDK could
// not see.
//
// **no spec in this package dials paypal.com and none may start.** nothing else in this repository's
// suite reaches an outside service, and a gate that fails without a connection is a gate that gets
// ignored. what such a spec would catch — PayPal changing the shape of what it serves — is caught
// at runtime by `MOUNT_DEADLINE_MS` instead.

describe('how an attempt at PayPal’s window ends', () => {
	it('reads an approval as money in flight rather than as a gift that landed', () => {
		expect(outcomeOfTermination({ kind: 'approved' })).toEqual({ kind: 'processing' });
	});

	// the one signal PayPal itself names as nothing having happened, and it carries no sentence: the
	// donor closed the window and knows it.
	it('reads PayPal’s own cancel as an unfinished form, with nothing to say about it', () => {
		expect(outcomeOfTermination({ kind: 'cancelled' })).toEqual({ kind: 'unfinished' });
	});

	it('reads a refused funding source as a decline the donor can act on', () => {
		expect(
			outcomeOfTermination({ kind: 'error', code: 'INSTRUMENT_DECLINED', message: 'no' })
		).toMatchObject({ kind: 'declined', message: expect.stringContaining('not accepted') });
	});

	it('tells a donor what to do about a window that would not open', () => {
		const outcome = outcomeOfTermination({
			kind: 'error',
			code: 'ERR_DEV_UNABLE_TO_OPEN_POPUP',
			message: 'blocked'
		});
		expect(outcome).toMatchObject({ kind: 'declined' });
		expect(outcome).toMatchObject({ message: expect.stringContaining('pop-ups') });
	});

	// nothing was authorized in front of PayPal's own surface, so a Retry here mints an order
	// against nothing rather than against a live one.
	it('reads a fault raised before the window opened as a refusal', () => {
		for (const code of [
			'ERR_INIT_SDK_COMPONENT_NOT_RECOGNIZED',
			'ERR_DOMAIN_MISMATCH',
			'ERR_FLOW_FUNDING_SOURCE_NOT_ELIGIBLE'
		]) {
			expect(outcomeOfTermination({ kind: 'error', code, message: 'x' })).toMatchObject({
				kind: 'declined'
			});
		}
	});

	// the whole rule, stated as the case that costs a second order: an unrecognised code is an
	// answer nobody has, never a refusal.
	it('refuses to read a code it does not know as a decline', () => {
		expect(outcomeOfTermination({ kind: 'error', code: 'NETWORK_ERROR', message: 'x' })).toEqual({
			kind: 'indeterminate'
		});
		expect(
			outcomeOfTermination({ kind: 'error', code: 'ERR_SOMETHING_NEW', message: 'x' })
		).toEqual({ kind: 'indeterminate' });
	});

	it('reads a start that answered with no callback at all as an answer nobody has', () => {
		expect(outcomeOfTermination({ kind: 'silent' })).toEqual({ kind: 'indeterminate' });
	});
});

// the half a page this project does not own decides: neither the loader nor the served core
// replaces an existing `window.paypal`, and the package's own loader reads a bare
// `window[namespace]` knowing nothing of the nesting.
describe('which PayPal namespace this page already holds', () => {
	const host = (fields: Record<string, unknown>): PaypalWindowLike =>
		({ customElements: { get: () => undefined }, ...fields }) as PaypalWindowLike;

	const v6 = (): Record<string, unknown> => ({
		createInstance: () => Promise.resolve({}),
		version: '6.63.0'
	});

	it('takes the core this module already loaded under its own key', () => {
		const namespace = v6();
		expect(readNamespace(host({ [PAYPAL_NAMESPACE]: namespace }))).toEqual({
			kind: 'found',
			namespace
		});
	});

	// the hazard page: a host running their own version-five SDK. the served core nests under it
	// rather than replacing it, and the package's loader would resolve with the v5 object — whose
	// `createInstance` is `undefined` one line later.
	it('reaches past a host’s older SDK to the core nested under it', () => {
		const nested = v6();
		const reading = readNamespace(
			host({ paypal: { version: '5.0.0', Buttons: () => {}, v6: nested } })
		);
		expect(reading).toEqual({ kind: 'found', namespace: nested });
	});

	it('adopts a host’s own version-six core rather than planting a second one', () => {
		const theirs = v6();
		expect(readNamespace(host({ paypal: theirs }))).toEqual({ kind: 'found', namespace: theirs });
	});

	// the loader optional-chains the reference and not `.version`, so this exact page makes it throw
	// synchronously out of a call that looks asynchronous. nothing here reads `.version` off an
	// object that may not carry one.
	it('is unmoved by an unrelated global of the same name carrying no version', () => {
		expect(() => readNamespace(host({ paypal: { checkout: {} } }))).not.toThrow();
		expect(readNamespace(host({ paypal: { checkout: {} } }))).toEqual({ kind: 'absent' });
	});

	// a core is on the page under a namespace nothing here can name. planting a second one throws
	// inside `customElements.define` during its top-level evaluation, which leaves the loader
	// waiting on a namespace that will never be written.
	it('refuses to plant beside a core it cannot reach', () => {
		const registry = { get: (name: string) => (name === 'paypal-button' ? class {} : undefined) };
		expect(readNamespace({ customElements: registry } as PaypalWindowLike)).toEqual({
			kind: 'unreachable'
		});
	});

	it('says so when the page carries no PayPal at all', () => {
		expect(readNamespace(host({}))).toEqual({ kind: 'absent' });
	});
});

// the core is planted by this module wherever none is waiting yet, so the tag carries the host's
// nonce where it serves one and the address the served config names. the tag is on the page as
// soon as the call is made, which is what these read before any load event is fired.
describe('the core script this module plants', () => {
	const ELSEWHERE = 'https://www.paypal.example.test/web-sdk/v6/core';
	const planted = (): HTMLScriptElement | null => document.querySelector('script');

	afterEach(() => {
		for (const script of document.querySelectorAll('script')) script.remove();
	});

	it('carries the address it is given, the nonce, and the namespace it defines', () => {
		void loadPaypalScript(document, ELSEWHERE, 'n0nce');
		expect(planted()?.getAttribute('src')).toBe(ELSEWHERE);
		expect(planted()?.getAttribute('data-loading-state')).toBe('pending');
		expect(planted()?.getAttribute('data-namespace')).toBe(PAYPAL_NAMESPACE);
		expect(planted()?.nonce).toBe('n0nce');
	});

	it('plants the script without a nonce where the page carries none', () => {
		void loadPaypalScript(document, PAYPAL_CORE_URL, '');
		expect(planted()?.getAttribute('src')).toBe(PAYPAL_CORE_URL);
		expect(planted()?.hasAttribute('nonce')).toBe(false);
	});
});

// the tag a load hangs on stays in the document, and a dead tag left marked pending is one a
// second boot waits on for a load event that has already fired.
describe('that core script, run', () => {
	const carried = (): HTMLScriptElement | null =>
		document.querySelector(`script[src="${PAYPAL_CORE_URL}"]`);

	afterEach(() => {
		for (const script of document.querySelectorAll('script')) script.remove();
		delete (window as unknown as Record<string, unknown>)[PAYPAL_NAMESPACE];
	});

	it('marks its own tag answered once the namespace is there', async () => {
		const settling = loadPaypalScript(document, PAYPAL_CORE_URL, 'n0nce');
		(window as unknown as Record<string, unknown>)[PAYPAL_NAMESPACE] = {
			createInstance: () => Promise.resolve({})
		};
		carried()?.dispatchEvent(new Event('load'));
		await settling;
		expect(carried()?.getAttribute('data-loading-state')).toBe('resolved');
	});

	it('takes a tag that answered without defining the namespace back off the page', async () => {
		const settling = loadPaypalScript(document, PAYPAL_CORE_URL, 'n0nce');
		carried()?.dispatchEvent(new Event('error'));
		await settling;
		expect(carried()).toBeNull();
	});

	// a host's own core, planted by PayPal's loader and not yet run, is the one core this page may
	// hold: a second throws inside `customElements.define` during its own top-level evaluation, so
	// this one is waited on, and left as its owner marked it.
	it('waits on a core the host planted rather than planting its own', async () => {
		const theirs = document.createElement('script');
		theirs.setAttribute('src', PAYPAL_CORE_URL);
		theirs.setAttribute('data-loading-state', 'pending');
		document.head.appendChild(theirs);

		let settled = false;
		const settling = loadPaypalScript(document, PAYPAL_CORE_URL, '').then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		theirs.dispatchEvent(new Event('load'));
		await settling;

		expect(document.querySelectorAll('script')).toHaveLength(1);
		expect(theirs.getAttribute('data-loading-state')).toBe('pending');
	});
});

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'paypal', publishableKey: 'live_client_id' }],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['paypal', 'venmo'],
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

/** the same form, offering a monthly gift beside the one-time one. */
const MONTHLY: FormConfig = { ...CONFIG, frequencies: ['one_time', 'monthly'] };

/** which creator a session came off: a rail's one-time session, or PayPal's subscription session. */
type SessionKind = 'paypal' | 'venmo' | 'subscription';

type SessionRecorder = {
	readonly rail: SessionKind;
	readonly session: PaypalSessionLike;
	readonly options: SessionOptionsLike;
	readonly starts: { presentation: unknown; order: Promise<unknown> }[];
	destroyed: number;
	cancelled: number;
	resumed: number;
	returns: boolean;
};

type Kit = {
	readonly namespace: PaypalNamespaceLike;
	/** the script the kit's own loader was asked to start the core from, each time. */
	readonly loads: string[];
	readonly created: Record<string, unknown>[];
	readonly eligibilityAsks: Record<string, unknown>[];
	readonly sessions: SessionRecorder[];
	/** every deadline this surface armed and has not disarmed, fired by hand. */
	expire(): void;
	readonly seam: PaypalSeam;
	readonly rails: (PaymentMethod | null)[];
	readonly unavailable: Failure[];
	readonly mount: HTMLElement;
};

type Answers = {
	readonly eligible?: readonly string[];
	/** what the read asked for a repeating gift answers, where it differs from the one-time read. */
	readonly eligibleToRepeat?: readonly string[];
	readonly findEligibleMethods?: (options: Record<string, unknown>) => Promise<EligibilityLike>;
	readonly createInstance?: () => Promise<PaypalSdkLike>;
	/** a component whose script will not load, which `createInstance` refuses whole when asked for it. */
	readonly unloadable?: string;
	readonly load?: ((sdkUrl: string) => Promise<PaypalNamespaceLike | null>) | undefined;
	readonly start?: () => Promise<unknown>;
	readonly hasReturned?: boolean;
};

function kit(answers: Answers = {}): Kit {
	const created: Record<string, unknown>[] = [];
	const loads: string[] = [];
	const eligibilityAsks: Record<string, unknown>[] = [];
	const sessions: SessionRecorder[] = [];
	const rails: (PaymentMethod | null)[] = [];
	const unavailable: Failure[] = [];
	const eligible = answers.eligible ?? ['paypal', 'venmo'];
	const eligibleToRepeat = answers.eligibleToRepeat ?? eligible;

	const makeSession = (rail: SessionKind) => (options: SessionOptionsLike) => {
		const record: SessionRecorder = {
			rail,
			options,
			starts: [],
			destroyed: 0,
			cancelled: 0,
			resumed: 0,
			returns: answers.hasReturned ?? false,
			session: {
				start: (presentation, order) => {
					record.starts.push({ presentation, order });
					return (answers.start ?? (() => new Promise<unknown>(() => {})))();
				},
				destroy: () => void (record.destroyed += 1),
				cancel: () => void (record.cancelled += 1),
				hasReturned: () => record.returns,
				resume: () => {
					record.resumed += 1;
					return Promise.resolve();
				}
			}
		};
		sessions.push(record);
		return record.session;
	};

	const sdk: PaypalSdkLike = {
		findEligibleMethods: (options) => {
			eligibilityAsks.push(options);
			return (
				answers.findEligibleMethods ??
				((options) => {
					const answer = options.paymentFlow === 'RECURRING_PAYMENT' ? eligibleToRepeat : eligible;
					return Promise.resolve({ isEligible: (method: string) => answer.includes(method) });
				})
			)(options);
		},
		createPayPalOneTimePaymentSession: makeSession('paypal'),
		createVenmoOneTimePaymentSession: makeSession('venmo'),
		createPayPalSubscriptionPaymentSession: makeSession('subscription')
	};

	const namespace: PaypalNamespaceLike = {
		createInstance: (options) => {
			created.push(options);
			const components = options.components as readonly string[];
			if (answers.unloadable !== undefined && components.includes(answers.unloadable)) {
				return Promise.reject(new Error(`${answers.unloadable} failed to load`));
			}
			return (answers.createInstance ?? (() => Promise.resolve(sdk)))();
		}
	};

	const timers = new Set<() => void>();
	const mount = document.createElement('div');
	document.body.appendChild(mount);

	return {
		namespace,
		loads,
		created,
		eligibilityAsks,
		sessions,
		rails,
		unavailable,
		mount,
		expire: () => {
			for (const run of [...timers]) {
				timers.delete(run);
				run();
			}
		},
		seam: {
			// a loader handed in is passed through as itself, because a page's memory of a dead one is
			// keyed on its identity.
			load:
				answers.load ??
				((sdkUrl) => {
					loads.push(sdkUrl);
					return Promise.resolve(namespace);
				}),
			delay: (run) => {
				const timer = () => run();
				timers.add(timer);
				return () => {
					timers.delete(timer);
				};
			}
		}
	};
}

/** the session most recently created for a rail, which is the one the last window was opened on. */
function latest(k: Kit, rail: SessionKind): SessionRecorder | undefined {
	return k.sessions.filter((session) => session.rail === rail).at(-1);
}

/** a turn of the event loop, past every microtask the quote's own task runs. */
function nextTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** the surface, and the microtasks its mount chain spends before anything is on screen. */
async function mounted(kit: Kit, config: FormConfig = CONFIG): Promise<PaypalPaymentSurface> {
	const surface = createPaymentSurface(
		config,
		kit.mount,
		(rail) => kit.rails.push(rail),
		(failure) => kit.unavailable.push(failure),
		kit.seam
	);
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	return surface;
}

/**
 * a Donate press on the PayPal rail, and the confirmation the flow makes once its quote has landed.
 *
 * the two halves the flow drives in that order — the window opened on the press, the order handed
 * to it at the confirmation — run back to back, as they do wherever the total is the one shown.
 */
function pressed(
	surface: PaypalPaymentSurface,
	paymentToken: string,
	frequency: Frequency = 'one_time'
) {
	const request: QuoteRequest = {
		formId: CONFIG.formId,
		amountMinor: 2500,
		frequency,
		method: 'paypal',
		coversFee: false,
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace',
		consentedToContact: null
	};
	surface.quoting(request, Promise.resolve({ paymentToken, feeMinor: 0, totalMinor: 2500 }));
	return surface.confirm({ paymentToken, method: 'paypal', mandateAccepted: false });
}

describe('the buttons this adapter draws', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	// only the rails the served config offers, so a deployment selling PayPal alone never downloads
	// the Venmo bundle into a stranger's page.
	it('asks for the components its own offered rails need, and the client id off the config', async () => {
		const k = kit();
		await mounted(k);
		expect(k.created[0]).toMatchObject({
			clientId: 'live_client_id',
			components: ['paypal-payments', 'venmo-payments'],
			pageType: 'checkout',
			locale: 'en-US'
		});
	});

	// the served config names the script because the deployment is what knows which address its
	// keys were issued at, and the core's own origin is what decides which one it talks to.
	it('starts the core from the script the served config names', async () => {
		const k = kit();
		const sdkUrl = 'https://www.paypal.example.test/web-sdk/v6/core';
		await mounted(k, {
			...CONFIG,
			providers: [{ name: 'paypal', publishableKey: 'live_client_id', sdkUrl }]
		});
		expect(k.loads).toEqual([sdkUrl]);
	});

	it('starts PayPal’s own core where the served config names none', async () => {
		const k = kit();
		await mounted(k);
		expect(k.loads).toEqual([PAYPAL_CORE_URL]);
	});

	// a repeating gift on PayPal is a subscription, approved in a session only `paypal-subscriptions`
	// carries, and it has to be on the instance before the press: a press may await nothing.
	it('asks for the subscription component beside PayPal’s own where the form offers a repeat', async () => {
		const k = kit();
		await mounted(k, MONTHLY);
		expect(k.created[0]).toMatchObject({
			components: ['paypal-payments', 'paypal-subscriptions', 'venmo-payments']
		});
	});

	it('leaves a rail the config does not offer out of the components it asks for', async () => {
		const k = kit();
		const surface = createPaymentSurface(
			{ ...CONFIG, paymentMethods: ['card', 'paypal'] },
			k.mount,
			(rail) => k.rails.push(rail),
			(failure) => k.unavailable.push(failure),
			k.seam
		);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(k.created[0]).toMatchObject({ components: ['paypal-payments'] });
		surface.stop();
	});

	// the eligibility read is a property of the buyer, the account and the currency, and it is asked
	// with the currency alone: an amount would make two elements on one page contend over the core's
	// own module-global eligibility cache.
	it('reads eligibility against the form’s currency and nothing else', async () => {
		const k = kit();
		await mounted(k);
		expect(k.eligibilityAsks[0]).toEqual({ currencyCode: 'USD' });
	});

	it('draws a row for each eligible rail, holding that rail’s button', async () => {
		const k = kit();
		const surface = await mounted(k);
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal', 'Venmo']);
		expect(
			[...k.mount.children].map((child) => child.firstElementChild?.tagName.toLowerCase())
		).toEqual(['paypal-button', 'venmo-button']);
	});

	// not a disabled control and not an error: a donor who cannot pay with Venmo should not learn
	// that Venmo exists.
	it('draws nothing at all for a rail this donor is not eligible for', async () => {
		const k = kit({ eligible: ['paypal'] });
		const surface = await mounted(k);
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);
		expect(k.mount.querySelector('venmo-button')).toBeNull();
	});

	// eligibility is a property of the payment flow too: a buyer PayPal will take a one-time gift from
	// may not be one it will start a subscription for, and a window that cannot approve is no button.
	// asked behind the one-time read rather than ahead of it, so an answer the core holds per instance
	// is the one-time one wherever the one-time row reads it.
	it('reads eligibility for a repeating gift too, behind the one-time read', async () => {
		const k = kit();
		await mounted(k, MONTHLY);
		expect(k.eligibilityAsks).toEqual([
			{ currencyCode: 'USD' },
			{ currencyCode: 'USD', paymentFlow: 'RECURRING_PAYMENT' }
		]);
	});

	it('draws PayPal’s row on a repeating gift only where PayPal can start one', async () => {
		const k = kit({ eligibleToRepeat: [] });
		const surface = await mounted(k, MONTHLY);
		k.mount.querySelector('paypal-button')?.dispatchEvent(new Event('click'));

		surface.cadence('monthly');
		expect(surface.rows.current().map((row) => row.name)).toEqual(['Venmo']);
		expect(k.rails).toEqual(['paypal', null]);

		surface.cadence('one_time');
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal', 'Venmo']);
	});

	// a window that cannot approve is the dead end at the last step this row exists to avoid, and the
	// one-time gift's row is no less drawable for the repeat's read having failed.
	it('keeps PayPal’s row off a repeating gift when that read fails, and says so', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const k = kit({
			findEligibleMethods: (options) =>
				options.paymentFlow === 'RECURRING_PAYMENT'
					? Promise.reject(new Error('gateway'))
					: Promise.resolve({ isEligible: () => true })
		});
		const surface = await mounted(k, MONTHLY);
		await nextTask();
		surface.offerVenmo(false);
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);

		surface.cadence('monthly');
		expect(surface.rows.current()).toEqual([]);
		expect(k.unavailable).toEqual([]);
		expect(reported).toHaveBeenCalledWith(expect.stringContaining('gateway'));
	});

	// the read is never awaited by the mount, so a donor can commit to Monthly before it answers.
	it('draws PayPal’s row on a repeating gift once a read still out answers that it can', async () => {
		let answer: (eligibility: EligibilityLike) => void = () => {};
		const k = kit({
			findEligibleMethods: (options) =>
				options.paymentFlow === 'RECURRING_PAYMENT'
					? new Promise<EligibilityLike>((resolve) => {
							answer = resolve;
						})
					: Promise.resolve({ isEligible: () => true })
		});
		const surface = await mounted(k, MONTHLY);
		surface.offerVenmo(false);
		surface.cadence('monthly');
		expect(surface.rows.current()).toEqual([]);

		answer({ isEligible: (method) => method === 'paypal' });
		await nextTask();
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);
	});

	// the mount's own deadline is over once the buttons are up, and a read that never settles would
	// otherwise keep PayPal off every repeat with nothing said anywhere.
	it('says at the deadline that the repeat read never answered, keeping PayPal off a repeat', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const k = kit({
			findEligibleMethods: (options) =>
				options.paymentFlow === 'RECURRING_PAYMENT'
					? new Promise<EligibilityLike>(() => {})
					: Promise.resolve({ isEligible: () => true })
		});
		const surface = await mounted(k, MONTHLY);
		await nextTask();
		expect(reported).not.toHaveBeenCalled();

		k.expire();
		expect(reported).toHaveBeenCalledWith(expect.stringContaining('never answered'));
		surface.offerVenmo(false);
		surface.cadence('monthly');
		expect(surface.rows.current()).toEqual([]);
		surface.cadence('one_time');
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);
		expect(k.unavailable).toEqual([]);
	});

	// the core loads every component it is asked for together and refuses the instance whole, so a
	// subscription bundle that would not load must not take the one-time gift's buttons with it.
	it('draws the one-time buttons when the subscription component will not load', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
		const k = kit({ unloadable: 'paypal-subscriptions' });
		const surface = await mounted(k, MONTHLY);
		await nextTask();
		expect(k.created.at(-1)).toMatchObject({ components: ['paypal-payments', 'venmo-payments'] });
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal', 'Venmo']);
		expect(k.unavailable).toEqual([]);
		expect(reported).toHaveBeenCalledWith(expect.stringContaining('paypal-subscriptions failed'));

		surface.offerVenmo(false);
		surface.cadence('monthly');
		expect(surface.rows.current()).toEqual([]);
	});

	it('leaves PayPal’s row standing on a repeating gift where PayPal can start one', async () => {
		const k = kit();
		const surface = await mounted(k, MONTHLY);
		await nextTask();
		surface.offerVenmo(false);
		surface.cadence('monthly');
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);
	});

	it('draws every row closed, its button behind a press on the row’s name', async () => {
		const k = kit();
		await mounted(k);
		const head = k.mount.children[0]?.shadowRoot?.querySelector('button');
		const panel = k.mount.children[0]?.shadowRoot?.querySelector('#panel');
		expect(head?.getAttribute('aria-expanded')).toBe('false');
		expect(head?.textContent).toBe('PayPal');
		expect(panel?.hasAttribute('hidden')).toBe(true);
		expect(head?.getAttribute('aria-controls')).toBe(panel?.id);

		head?.click();
		expect(head?.getAttribute('aria-expanded')).toBe('true');
		expect(panel?.hasAttribute('hidden')).toBe(false);
		// opening a row is looking, not choosing: the rail is still the button's to report.
		expect(k.rails).toEqual([]);
	});

	// the whole reason ineligible and unreadable must not collapse into each other: treating a
	// rejection as "everything is ineligible" silently takes a working button off a form because one
	// API call timed out.
	it('reports an unavailable surface when eligibility could not be read at all', async () => {
		const k = kit({ findEligibleMethods: () => Promise.reject(new Error('gateway')) });
		await mounted(k);
		expect(k.mount.children).toHaveLength(0);
		expect(k.unavailable[0]?.message).toContain('nothing was charged');
		expect(k.unavailable[0]?.fix).toContain('gateway');
	});

	it('reports an unavailable surface when no offered rail is eligible', async () => {
		const k = kit({ eligible: [] });
		await mounted(k);
		expect(k.unavailable[0]?.message).toContain('nothing was charged');
	});

	it('names the missing processor when the served config holds no client id for it', async () => {
		const k = kit();
		createPaymentSurface(
			{ ...CONFIG, providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }] },
			k.mount,
			(rail) => k.rails.push(rail),
			(failure) => k.unavailable.push(failure),
			k.seam
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(k.created).toHaveLength(0);
		expect(k.unavailable[0]?.fix).toContain('names no paypal processor');
	});

	// the press on a hosted-window button is how this form finds out which rail a donor picked; the
	// approval itself is opened by the confirmation, one press later.
	it('reports the rail a donor pressed', async () => {
		const k = kit();
		await mounted(k);
		k.mount.querySelector('venmo-button')?.dispatchEvent(new Event('click'));
		expect(k.rails).toEqual(['venmo']);
	});

	// told off `venmoIsOffered` in ../checkout.machine.ts: a repeating cadence takes the Venmo row off
	// the box and one-time puts it back, with PayPal's row standing through both.
	it('draws the Venmo row only while the flow offers Venmo, leaving PayPal’s standing', async () => {
		const k = kit();
		const surface = await mounted(k);

		surface.offerVenmo(false);
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);
		expect(k.mount.querySelector('venmo-button')).toBeNull();
		expect(k.mount.querySelector('paypal-button')).not.toBeNull();

		surface.offerVenmo(true);
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal', 'Venmo']);
		k.mount.querySelector('venmo-button')?.dispatchEvent(new Event('click'));
		expect(k.rails).toEqual(['venmo']);
	});

	it('holds the Venmo row back when the flow withdrew it before the buttons came up', async () => {
		const k = kit();
		const surface = createPaymentSurface(
			CONFIG,
			k.mount,
			(rail) => k.rails.push(rail),
			(failure) => k.unavailable.push(failure),
			k.seam
		);
		surface.offerVenmo(false);
		await nextTask();
		expect(surface.rows.current().map((row) => row.name)).toEqual(['PayPal']);
		expect(k.unavailable).toEqual([]);
	});

	// a donor who pressed Venmo and then went back and picked Monthly is holding a rail nothing can
	// approve, so it is taken back with the row; a PayPal press is not.
	it('takes back a Venmo press when the row leaves, and leaves a PayPal press chosen', async () => {
		const k = kit();
		const surface = await mounted(k);

		k.mount.querySelector('venmo-button')?.dispatchEvent(new Event('click'));
		surface.offerVenmo(false);
		expect(k.rails).toEqual(['venmo', null]);

		surface.offerVenmo(true);
		k.mount.querySelector('paypal-button')?.dispatchEvent(new Event('click'));
		surface.offerVenmo(false);
		expect(k.rails).toEqual(['venmo', null, 'paypal']);
	});
});

describe('a donor’s gift through PayPal’s window', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	const paypalSession = (k: Kit): SessionRecorder => {
		const found = latest(k, 'paypal');
		if (found === undefined) throw new Error('no PayPal session was created');
		return found;
	};

	it('opens the window for the rail the order was minted on, carrying that order', async () => {
		const k = kit();
		const surface = await mounted(k);
		void pressed(surface, '5O190127TN364715T');
		await Promise.resolve();
		const started = paypalSession(k).starts[0];
		expect(started?.presentation).toEqual({ presentationMode: 'auto' });
		await expect(started?.order).resolves.toEqual({ orderId: '5O190127TN364715T' });
		expect(k.sessions.find((session) => session.rail === 'venmo')?.starts).toHaveLength(0);
	});

	// the server mints a subscription for a repeating gift and its id is no order: handed to the
	// one-time session as `{ orderId }` the window errors, and the donor lands on "we don't know".
	it('opens a repeating gift’s window on a subscription session, carrying the subscription', async () => {
		const k = kit();
		const surface = await mounted(k, MONTHLY);
		surface.cadence('monthly');
		void pressed(surface, 'I-BW452GLLEP1G', 'monthly');
		await Promise.resolve();
		const started = latest(k, 'subscription')?.starts;
		expect(started).toHaveLength(1);
		expect(started?.[0]?.presentation).toEqual({ presentationMode: 'auto' });
		await expect(started?.[0]?.order).resolves.toEqual({ subscriptionId: 'I-BW452GLLEP1G' });
		expect(
			k.sessions.filter((session) => session.rail === 'paypal').flatMap((s) => s.starts)
		).toEqual([]);
	});

	// the correction screen's Confirm opens a window with no press behind it and the port carries no
	// cadence, so the one the card last committed to says the token is a subscription.
	it('opens a subscription session on a confirmation no press opened a window for', async () => {
		const k = kit();
		const surface = await mounted(k, MONTHLY);
		surface.cadence('monthly');
		void surface.confirm({
			paymentToken: 'I-BW452GLLEP1G',
			method: 'paypal',
			mandateAccepted: false
		});
		await expect(latest(k, 'subscription')?.starts[0]?.order).resolves.toEqual({
			subscriptionId: 'I-BW452GLLEP1G'
		});
	});

	// the same form, the same press, the gift made once: an order, on PayPal's one-time session.
	it('keeps a one-time gift on the one-time session where the form also offers a repeat', async () => {
		const k = kit();
		const surface = await mounted(k, MONTHLY);
		surface.cadence('one_time');
		void pressed(surface, '5O190127TN364715T');
		await Promise.resolve();
		await expect(paypalSession(k).starts[0]?.order).resolves.toEqual({
			orderId: '5O190127TN364715T'
		});
		expect(k.sessions.filter((session) => session.rail === 'subscription')).toEqual([]);
	});

	it('reads an approval as money in flight', async () => {
		const k = kit();
		const surface = await mounted(k);
		const confirming = pressed(surface, 'o1');
		await Promise.resolve();
		await paypalSession(k).options.onApprove({ orderId: 'o1' });
		await expect(confirming).resolves.toEqual({ kind: 'processing' });
	});

	// the donor is returned to the payment step with the button still on it, rather than to a screen
	// saying the gift was not completed.
	it('reads a closed window as an unfinished form', async () => {
		const k = kit();
		const surface = await mounted(k);
		const confirming = pressed(surface, 'o1');
		await Promise.resolve();
		paypalSession(k).options.onCancel({ orderId: 'o1' });
		await expect(confirming).resolves.toEqual({ kind: 'unfinished' });
		expect(k.mount.querySelector('paypal-button')).not.toBeNull();
	});

	// the rule the whole mapping rests on: the order is approved on PayPal's side and the server is
	// about to capture it, so nothing that arrives afterwards may put a Retry in front of the donor.
	it('lets an approval dominate whatever PayPal says after it', async () => {
		const k = kit();
		const surface = await mounted(k);
		const confirming = pressed(surface, 'o1');
		await Promise.resolve();
		const session = paypalSession(k);
		await session.options.onApprove({ orderId: 'o1' });
		session.options.onError({ code: 'INSTRUMENT_DECLINED', message: 'refused' });
		await expect(confirming).resolves.toEqual({ kind: 'processing' });
	});

	it('tells a donor about a window that would not open', async () => {
		const k = kit({
			start: () => Promise.reject({ code: 'ERR_DEV_UNABLE_TO_OPEN_POPUP', message: 'blocked' })
		});
		const surface = await mounted(k);
		const outcome = await pressed(surface, 'o1');
		expect(outcome).toMatchObject({
			kind: 'declined',
			message: expect.stringContaining('pop-ups')
		});
	});

	// the browser holds no read of a PayPal order, so a re-read on this page load can only answer
	// with what PayPal's own callbacks already said — and with nothing where they said nothing.
	it('answers a re-read with what PayPal last said, and with nothing where it said nothing', async () => {
		const k = kit();
		const surface = await mounted(k);
		await expect(surface.resume({ paymentToken: 'o1' })).resolves.toEqual({
			kind: 'indeterminate'
		});
		const confirming = pressed(surface, 'o1');
		await Promise.resolve();
		await paypalSession(k).options.onApprove({ orderId: 'o1' });
		await confirming;
		await expect(surface.resume({ paymentToken: 'o1' })).resolves.toEqual({ kind: 'processing' });
	});

	// the documented shape for a page reached by a redirect return: ask the session, and resume it
	// where it says the donor has come back.
	it('picks a return from PayPal’s own window back up', async () => {
		const k = kit({ hasReturned: true });
		const surface = await mounted(k);
		await Promise.resolve();
		expect(paypalSession(k).resumed).toBe(1);
		await expect(surface.claimsReturn()).resolves.toBe(true);
	});

	it('claims no return on an ordinary page load', async () => {
		const k = kit();
		const surface = await mounted(k);
		await expect(surface.claimsReturn()).resolves.toBe(false);
	});
});

describe('letting go of the surface', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it('ends every session it created and takes its buttons off the page', async () => {
		const k = kit();
		const surface = await mounted(k);
		surface.stop();
		for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
		expect(k.sessions.map((session) => session.destroyed)).toEqual([1, 1]);
		expect(k.mount.children).toHaveLength(0);
	});

	it('raises nothing when it is reached twice, or before anything was drawn', async () => {
		const k = kit({ load: () => new Promise(() => {}) });
		const surface = createPaymentSurface(
			CONFIG,
			k.mount,
			(rail) => k.rails.push(rail),
			(failure) => k.unavailable.push(failure),
			k.seam
		);
		expect(() => {
			surface.stop();
			surface.stop();
		}).not.toThrow();
	});

	// a stop mid-attempt must settle the promise the flow is holding, rather than leave a
	// confirmation nothing will ever answer.
	it('answers a confirmation the card walked away from', async () => {
		const k = kit();
		const surface = await mounted(k);
		const confirming = pressed(surface, 'o1');
		await Promise.resolve();
		surface.stop();
		await expect(confirming).resolves.toEqual({ kind: 'indeterminate' });
	});
});

describe('a start that never finishes', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	// the failure that names itself in no other way: the loader's promise stays pending for the life
	// of the page, so no button is ever drawn and every report this file has to make sits behind a
	// promise with nothing to settle it.
	it('tells the donor once the deadline passes', async () => {
		const k = kit({ load: () => new Promise(() => {}) });
		await mounted(k);
		k.expire();
		expect(k.unavailable[0]?.message).toContain('nothing was charged');
		expect(k.unavailable[0]?.fix).toContain('never finished starting');
	});

	// a second card booting into the same dead loader is refused at once rather than made to wait
	// out the same thirty seconds again.
	it('refuses a second surface that would wait on the same dead loader', async () => {
		const first = kit({ load: () => new Promise(() => {}) });
		await mounted(first);
		first.expire();
		const second = kit({ load: first.seam.load });
		await mounted(second);
		expect(second.unavailable[0]?.fix).toContain('already been found dead');
	});
});

// the press a popup is opened on is the Donate press itself, and a window opened a network round
// trip after it is one the browser blocks for want of a transient activation — Safari's lasts about
// a second. so the window opens in the press's own task, on an order that is still being minted.
describe('the Donate press with PayPal chosen', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	/** a quote the spec answers by hand, so the press can be observed before the server has spoken. */
	function deferredQuote() {
		let answer: (quote: Quote) => void = () => {};
		let refuse: (reason: unknown) => void = () => {};
		const asked: QuoteRequest[] = [];
		const post = (request: QuoteRequest): Promise<Quote> => {
			asked.push(request);
			return new Promise<Quote>((resolve, reject) => {
				answer = resolve;
				refuse = reject;
			});
		};
		return {
			post,
			asked,
			answer: (quote: Quote) => answer(quote),
			refuse: (r: unknown) => refuse(r)
		};
	}

	/** the flow on the review step with `method` chosen, running on this adapter's own ports. */
	async function onReview(method: PaymentMethod, config: FormConfig = CONFIG) {
		const k = kit();
		const surface = await mounted(k, config);
		const quote = deferredQuote();
		const ports: CheckoutPorts = {
			quote: quoteThrough(surface, quote.post),
			confirm: surface.confirm,
			resume: surface.resume,
			status: () => Promise.resolve({ state: 'waiting' }),
			now: () => 0
		};
		const actor = createActor(checkoutMachine, { input: { config, ports } });
		actor.start();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'CONTINUE' });
		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'CONTINUE' });
		actor.send({ type: 'SET_METHOD', method });
		return { k, actor, quote };
	}

	const sessionFor = (k: Kit, rail: 'paypal' | 'venmo'): SessionRecorder => {
		const found = latest(k, rail);
		if (found === undefined) throw new Error(`no ${rail} session was created`);
		return found;
	};

	it('opens the window in the press’s own task, before the quote has answered', async () => {
		const { k, actor, quote } = await onReview('paypal');
		actor.send({ type: 'SUBMIT' });
		expect(quote.asked).toHaveLength(1);
		expect(sessionFor(k, 'paypal').starts).toHaveLength(1);
		expect(sessionFor(k, 'paypal').starts[0]?.presentation).toEqual({ presentationMode: 'auto' });
		expect(sessionFor(k, 'venmo').starts).toHaveLength(0);
	});

	it('hands PayPal the order the quote carries once the quote answers', async () => {
		const { k, actor, quote } = await onReview('paypal');
		actor.send({ type: 'SUBMIT' });
		const shown = actor.getSnapshot().context.estimate?.totalMinor ?? 2500;
		quote.answer({ paymentToken: '5O190127TN364715T', feeMinor: shown - 2500, totalMinor: shown });
		await expect(sessionFor(k, 'paypal').starts[0]?.order).resolves.toEqual({
			orderId: '5O190127TN364715T'
		});
		expect(actor.getSnapshot().value).toBe('confirming');
	});

	// the window closes on PayPal's side when the order it was handed is refused, and the flow lands
	// exactly where a failed quote lands on any other rail.
	it('refuses PayPal the order when the quote fails, and lands on the failed quote', async () => {
		const { k, actor, quote } = await onReview('paypal');
		actor.send({ type: 'SUBMIT' });
		const order = sessionFor(k, 'paypal').starts[0]?.order;
		const refusal = { message: 'This gift was not started, and nothing was charged.' };
		quote.refuse(refusal);
		await expect(order).rejects.toBe(refusal);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toBe(refusal.message);
	});

	// the correction screen is a page the donor has to read and press on, so no window may stand
	// over it: the one opened on Donate is closed when the total lands corrected, and the screen's
	// own Confirm — a press with its own activation — opens a fresh one on the order already minted.
	it('closes the window on a corrected total and opens a fresh one on Confirm', async () => {
		const { k, actor, quote } = await onReview('paypal');
		actor.send({ type: 'SUBMIT' });
		const first = sessionFor(k, 'paypal');
		const shown = actor.getSnapshot().context.estimate?.totalMinor ?? 2500;
		quote.answer({ paymentToken: 'o_corrected', feeMinor: shown - 2400, totalMinor: shown + 100 });
		await nextTask();
		expect(actor.getSnapshot().value).toBe('confirm');
		await expect(first.starts[0]?.order).rejects.toBeDefined();

		actor.send({ type: 'CONFIRM' });
		const second = sessionFor(k, 'paypal');
		expect(second).not.toBe(first);
		expect(second.starts).toHaveLength(1);
		await expect(second.starts[0]?.order).resolves.toEqual({ orderId: 'o_corrected' });
	});

	// a 2xx the flow refuses is a quote nothing will ever confirm, so the window opened for it closes.
	it('refuses PayPal the order when the flow refuses the quote', async () => {
		const { k, actor, quote } = await onReview('paypal');
		actor.send({ type: 'SUBMIT' });
		quote.answer({ paymentToken: 'o_unusable', feeMinor: 0, totalMinor: 100 });
		await nextTask();
		expect(actor.getSnapshot().value).toBe('failed');
		await expect(sessionFor(k, 'paypal').starts[0]?.order).rejects.toBeDefined();
	});

	it('opens no PayPal window on a press made on another rail', async () => {
		const config: FormConfig = { ...CONFIG, paymentMethods: ['paypal', 'venmo', 'card'] };
		const { k, actor, quote } = await onReview('card', config);
		actor.send({ type: 'SUBMIT' });
		expect(quote.asked).toHaveLength(1);
		expect(k.sessions.flatMap((session) => session.starts)).toHaveLength(0);
	});
});

// every window this surface opens is answered by its own signals and no other window's, and every
// one the flow walks away from is told so — the order it waits on refused, and the window cancelled.
describe('windows the flow walks away from', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	const request = (method: 'paypal' | 'venmo' = 'paypal'): QuoteRequest => ({
		formId: CONFIG.formId,
		amountMinor: 2500,
		frequency: 'one_time',
		method,
		coversFee: false,
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace',
		consentedToContact: null
	});

	const pending = (): Promise<Quote> => new Promise<Quote>(() => {});

	it('cancels the window a second press supersedes, and refuses its order', async () => {
		const k = kit();
		const surface = await mounted(k);
		surface.quoting(request(), pending());
		const first = latest(k, 'paypal');
		surface.quoting(request(), pending());
		expect(first?.cancelled).toBe(1);
		await expect(first?.starts[0]?.order).rejects.toBeDefined();
	});

	it('lets no signal from a superseded window answer the press after it', async () => {
		const k = kit();
		const surface = await mounted(k);
		surface.quoting(request(), pending());
		const first = latest(k, 'paypal');
		surface.quoting(
			request(),
			Promise.resolve({ paymentToken: 'o2', feeMinor: 0, totalMinor: 2500 })
		);
		const second = latest(k, 'paypal');
		const confirming = surface.confirm({
			paymentToken: 'o2',
			method: 'paypal',
			mandateAccepted: false
		});
		first?.options.onCancel({});
		await second?.options.onApprove({ orderId: 'o2' });
		await expect(confirming).resolves.toEqual({ kind: 'processing' });
	});

	it('refuses the order a window is waiting on when the card lets go', async () => {
		const k = kit();
		const surface = await mounted(k);
		surface.quoting(request(), pending());
		surface.stop();
		await expect(latest(k, 'paypal')?.starts[0]?.order).rejects.toBeDefined();
	});

	// a window that already ended — the donor closed it — is never handed an approvable order.
	it('refuses rather than releases the order to a window that already ended', async () => {
		const k = kit();
		const surface = await mounted(k);
		surface.quoting(
			request(),
			Promise.resolve({ paymentToken: 'o1', feeMinor: 0, totalMinor: 2500 })
		);
		const session = latest(k, 'paypal');
		session?.options.onCancel({});
		const outcome = await surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
		expect(outcome).toEqual({ kind: 'unfinished' });
		await expect(session?.starts[0]?.order).rejects.toBeDefined();
	});
});
