import { afterEach, describe, expect, it } from 'vitest';
import type { Failure } from '../checkout.machine';
import type { FormConfig, PaymentMethod } from '../v1';
import {
	createPaymentSurface,
	ensurePaypalScript,
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

// the loader sets no nonce of its own, and the seam through which this repository's nonce
// discipline reaches PayPal is the loader's own adoption selector — it takes over any script
// already on the page whose src carries the core path and which is marked pending.
describe('the core script this module plants ahead of the loader', () => {
	const fresh = (): Document => document.implementation.createHTMLDocument('t');

	it('carries everything the loader needs to adopt it and to name the namespace', () => {
		const doc = fresh();
		const script = ensurePaypalScript(doc, 'n0nce');
		expect(script?.getAttribute('src')).toBe(PAYPAL_CORE_URL);
		expect(script?.getAttribute('data-loading-state')).toBe('pending');
		expect(script?.getAttribute('data-namespace')).toBe(PAYPAL_NAMESPACE);
		expect(script?.nonce).toBe('n0nce');
	});

	// with no nonce there is nothing to fix, and the loader owns its own tag on every page that
	// does not serve a nonce policy — which is nearly all of them.
	it('plants nothing where there is no nonce to carry', () => {
		const doc = fresh();
		expect(ensurePaypalScript(doc, '')).toBeNull();
		expect(doc.querySelectorAll('script')).toHaveLength(0);
	});

	// a second core script on one page throws inside `customElements.define` during its own
	// top-level evaluation, so the tag already waiting is the tag the loader will adopt.
	it('plants nothing beside a core already waiting on this page', () => {
		const doc = fresh();
		ensurePaypalScript(doc, 'n0nce');
		expect(ensurePaypalScript(doc, 'n0nce')).toBeNull();
		expect(doc.querySelectorAll('script')).toHaveLength(1);
	});
});

// the tag a load hangs on stays in the document, and the loader's adoption selector is what makes
// that other surfaces' problem: a dead tag left marked pending is one a second boot joins for a
// load event that has already fired.
describe('that core script, run', () => {
	const carried = (): HTMLScriptElement | null =>
		document.querySelector(`script[src="${PAYPAL_CORE_URL}"]`);

	afterEach(() => {
		for (const script of document.querySelectorAll('script')) script.remove();
		delete (window as unknown as Record<string, unknown>)[PAYPAL_NAMESPACE];
	});

	it('marks its own tag answered once the namespace is there', async () => {
		const settling = loadPaypalScript(document, 'n0nce');
		(window as unknown as Record<string, unknown>)[PAYPAL_NAMESPACE] = {
			createInstance: () => Promise.resolve({})
		};
		carried()?.dispatchEvent(new Event('load'));
		await settling;
		expect(carried()?.getAttribute('data-loading-state')).toBe('resolved');
	});

	// left on the page marked pending it is what the loader adopts on the next attempt, and the
	// promise it joins has already had the only event it was waiting for.
	it('takes a tag that answered without defining the namespace back off the page', async () => {
		const settling = loadPaypalScript(document, 'n0nce');
		carried()?.dispatchEvent(new Event('error'));
		await settling;
		expect(carried()).toBeNull();
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
		venmo: { percent: 0.0349, fixedMinor: 49 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

type SessionRecorder = {
	readonly rail: 'paypal' | 'venmo';
	readonly session: PaypalSessionLike;
	readonly options: SessionOptionsLike;
	readonly starts: { presentation: unknown; order: Promise<{ orderId: string }> }[];
	destroyed: number;
	resumed: number;
	returns: boolean;
};

type Kit = {
	readonly namespace: PaypalNamespaceLike;
	readonly created: Record<string, unknown>[];
	readonly eligibilityAsks: Record<string, unknown>[];
	readonly sessions: SessionRecorder[];
	/** the deadline this surface armed, fired by hand. */
	expire(): void;
	readonly seam: PaypalSeam;
	readonly rails: (PaymentMethod | null)[];
	readonly unavailable: Failure[];
	readonly mount: HTMLElement;
};

type Answers = {
	readonly eligible?: readonly string[];
	readonly findEligibleMethods?: () => Promise<EligibilityLike>;
	readonly createInstance?: () => Promise<PaypalSdkLike>;
	readonly load?: (() => Promise<PaypalNamespaceLike | null>) | undefined;
	readonly start?: () => Promise<unknown>;
	readonly hasReturned?: boolean;
};

function kit(answers: Answers = {}): Kit {
	const created: Record<string, unknown>[] = [];
	const eligibilityAsks: Record<string, unknown>[] = [];
	const sessions: SessionRecorder[] = [];
	const rails: (PaymentMethod | null)[] = [];
	const unavailable: Failure[] = [];
	const eligible = answers.eligible ?? ['paypal', 'venmo'];

	const makeSession = (rail: 'paypal' | 'venmo') => (options: SessionOptionsLike) => {
		const record: SessionRecorder = {
			rail,
			options,
			starts: [],
			destroyed: 0,
			resumed: 0,
			returns: answers.hasReturned ?? false,
			session: {
				start: (presentation, order) => {
					record.starts.push({ presentation, order });
					return (answers.start ?? (() => new Promise<unknown>(() => {})))();
				},
				destroy: () => void (record.destroyed += 1),
				cancel: () => {},
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
				(() => Promise.resolve({ isEligible: (method: string) => eligible.includes(method) }))
			)();
		},
		createPayPalOneTimePaymentSession: makeSession('paypal'),
		createVenmoOneTimePaymentSession: makeSession('venmo')
	};

	const namespace: PaypalNamespaceLike = {
		createInstance: (options) => {
			created.push(options);
			return (answers.createInstance ?? (() => Promise.resolve(sdk)))();
		}
	};

	let fire: (() => void) | null = null;
	const mount = document.createElement('div');
	document.body.appendChild(mount);

	return {
		namespace,
		created,
		eligibilityAsks,
		sessions,
		rails,
		unavailable,
		mount,
		expire: () => fire?.(),
		seam: {
			load: answers.load ?? (() => Promise.resolve(namespace)),
			delay: (run) => {
				fire = run;
				return () => {
					fire = null;
				};
			}
		}
	};
}

/** the surface, and the microtasks its mount chain spends before anything is on screen. */
async function mounted(kit: Kit): Promise<PaypalPaymentSurface> {
	const surface = createPaymentSurface(
		CONFIG,
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

	it('puts a button for each eligible rail in the node it was handed', async () => {
		const k = kit();
		await mounted(k);
		expect([...k.mount.children].map((child) => child.tagName.toLowerCase())).toEqual([
			'paypal-button',
			'venmo-button'
		]);
	});

	// not a disabled control and not an error: a donor who cannot pay with Venmo should not learn
	// that Venmo exists.
	it('draws nothing at all for a rail this donor is not eligible for', async () => {
		const k = kit({ eligible: ['paypal'] });
		await mounted(k);
		expect([...k.mount.children].map((child) => child.tagName.toLowerCase())).toEqual([
			'paypal-button'
		]);
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
});

describe('a donor’s gift through PayPal’s window', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	const paypalSession = (k: Kit): SessionRecorder => {
		const found = k.sessions.find((session) => session.rail === 'paypal');
		if (found === undefined) throw new Error('no PayPal session was created');
		return found;
	};

	it('opens the window for the rail the order was minted on, carrying that order', async () => {
		const k = kit();
		const surface = await mounted(k);
		void surface.confirm({
			paymentToken: '5O190127TN364715T',
			method: 'paypal',
			mandateAccepted: false
		});
		await Promise.resolve();
		const started = paypalSession(k).starts[0];
		expect(started?.presentation).toEqual({ presentationMode: 'auto' });
		await expect(started?.order).resolves.toEqual({ orderId: '5O190127TN364715T' });
		expect(k.sessions.find((session) => session.rail === 'venmo')?.starts).toHaveLength(0);
	});

	it('reads an approval as money in flight', async () => {
		const k = kit();
		const surface = await mounted(k);
		const confirming = surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
		await Promise.resolve();
		await paypalSession(k).options.onApprove({ orderId: 'o1' });
		await expect(confirming).resolves.toEqual({ kind: 'processing' });
	});

	// the donor is returned to the payment step with the button still on it, rather than to a screen
	// saying the gift was not completed.
	it('reads a closed window as an unfinished form', async () => {
		const k = kit();
		const surface = await mounted(k);
		const confirming = surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
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
		const confirming = surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
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
		const outcome = await surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
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
		const confirming = surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
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
		const confirming = surface.confirm({
			paymentToken: 'o1',
			method: 'paypal',
			mandateAccepted: false
		});
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
