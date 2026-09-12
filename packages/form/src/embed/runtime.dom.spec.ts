import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DONATE_FORM_TAG, type FormBoot } from '../element';
import { RUNTIME_MARK } from './loader';
import { configUrl, createFormRuntime, runtimeOrigin, startRuntime } from './runtime';

// the runtime half of the embed: what the loader installs, and the only thing on a donor's page
// that knows how to talk to this deployment.
//
// this file registers the real tag rather than one of its own, which ../element.dom.spec.ts cannot
// do — a custom element name may be defined once per document, and that file needs a different
// runtime per case. here there is one runtime and it is the shipped one, and a spec file gets its
// own document, so the real name is the honest thing to assert against.

const DEPLOYMENT = 'https://donate.example';
const HOST_PAGE = 'https://acme.org';
const RUNTIME_PATH = '/embed/9f2a1c4e.js';

function plantScript(src: string, mark?: string): HTMLScriptElement {
	const script = document.createElement('script');
	if (mark !== undefined) script.setAttribute(RUNTIME_MARK, mark);
	script.setAttribute('src', src);
	document.head.appendChild(script);
	return script;
}

/** the runtime's own script tag, as the loader would have left it. */
function plantRuntimeScript(): HTMLScriptElement {
	return plantScript(`${DEPLOYMENT}${RUNTIME_PATH}`, DEPLOYMENT);
}

/**
 * `document.currentScript` while a classic script is being processed. no DOM implementation lets a
 * test set it, so it is defined as an own property for the length of one case.
 */
function whileExecuting(script: HTMLScriptElement | null, body: () => void): void {
	Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
	try {
		body();
	} finally {
		Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
	}
}

/** one turn of the loop, which is what the element's boot needs to reach its read. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
	const fetched = vi.fn(async () => response);
	vi.stubGlobal('fetch', fetched);
	return fetched;
}

type Refusal = { readonly message: string; readonly fix?: string; readonly name?: string };

/**
 * how a call refused, as the flow reads a refusal: a sentence and a fix.
 *
 * a call that resolves is the failure this asserts against, so it is turned into one rather than
 * left to a later expectation that would read as a missing property.
 */
async function refusal(work: Promise<unknown>): Promise<Refusal> {
	try {
		await work;
	} catch (error) {
		return error as Refusal;
	}
	throw new Error('the call answered instead of refusing');
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	document.head.replaceChildren();
	document.body.replaceChildren();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('reading a form configuration', () => {
	it('asks the deployment, not the page the form is embedded in', async () => {
		const fetched = stubFetch(json({ formId: 'frm_a8x2k9' }));
		const runtime = createFormRuntime(DEPLOYMENT, document);
		await runtime.loadConfig('frm_a8x2k9', new AbortController().signal);
		expect(fetched.mock.calls[0]?.[0]).toBe(`${DEPLOYMENT}/api/v1/forms/frm_a8x2k9/config`);
	});

	// the element aborts the read when it leaves the document or its `form` attribute changes, and
	// that only drops anything if the signal reaches the request.
	it('passes the abort signal the element handed it through to the request', async () => {
		const fetched = stubFetch(json({}));
		const reading = new AbortController();
		await createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', reading.signal);
		const init = fetched.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init?.signal).toBe(reading.signal);
	});

	// ../config.ts is what decides whether a body can be solicited on, and it treats the value as
	// untrusted. checking anything here would be a second, weaker copy of that.
	it('hands back what came off the wire, unread', async () => {
		stubFetch(json({ formId: 'frm_a8x2k9', nothingElse: true }));
		const body = await createFormRuntime(DEPLOYMENT, document).loadConfig(
			'frm_a8x2k9',
			new AbortController().signal
		);
		expect(body).toEqual({ formId: 'frm_a8x2k9', nothingElse: true });
	});

	// a 404 is one of the ways this read fails, not the only one, and every one of them ends the
	// same way: the read fails and the element paints its unavailable card. the sentence it paints
	// has to name the request that failed.
	it('fails with a sentence naming the request when the endpoint answers 404', async () => {
		stubFetch(new Response('Not Found', { status: 404 }));
		const failure = await refusal(
			createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', new AbortController().signal)
		);
		expect(failure.message.length).toBeGreaterThan(0);
		expect(failure.fix).toContain('/api/v1/forms/frm_a8x2k9/config');
		expect(failure.fix).toContain('404');
	});

	// a 4xx from this API carries its own sentence and its own fix, and flattening those to a
	// status code would spend the whole reason they are written that way.
	it('keeps the words the api answered with', async () => {
		stubFetch(
			json(
				{
					error: 'form_not_published',
					message: 'That form is not live yet.',
					fix: 'Publish it first.'
				},
				409
			)
		);
		const failure = await refusal(
			createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', new AbortController().signal)
		);
		expect(failure.message).toBe('That form is not live yet.');
		expect(failure.fix).toBe('Publish it first.');
	});

	// with no origin there is nowhere to ask. guessing the page's own origin would ask the org's
	// site for this deployment's api, so it says so instead and the card carries the reason.
	it('refuses to invent a deployment when the loader could not name one', async () => {
		const fetched = stubFetch(json({}));
		const failure = await refusal(
			createFormRuntime(null, document).loadConfig('frm_a8x2k9', new AbortController().signal)
		);
		expect(fetched).not.toHaveBeenCalled();
		expect(failure.fix).toContain('/embed.js');
	});

	// the case the `!response.ok` branch above does not cover. a cross-origin GET the served
	// headers do not admit — a page whose origin the form does not name — is refused by the
	// browser before any status is readable, so `fetch` rejects outright. left unwrapped that
	// reaches the card as "Failed to fetch" with no fix at all.
	it('turns a request that never completed into a sentence naming CORS', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		const failure = await refusal(
			createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', new AbortController().signal)
		);
		expect(failure.message).not.toBe('Failed to fetch');
		expect(failure.fix).toContain('Access-Control-Allow-Origin');
		expect(failure.fix).toContain(`${DEPLOYMENT}/api/v1/forms/frm_a8x2k9/config`);
	});

	// an abort is not a failure to report. the element aborts this read when it leaves the document
	// or its `form` attribute changes, and answers an aborted read by rendering nothing — dressing
	// it up as an `EmbedFailure` would paint a failure card for a form nobody is looking at.
	it('re-throws an abort untouched', async () => {
		const reading = new AbortController();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				reading.abort();
				const aborted = new Error('the read was aborted');
				aborted.name = 'AbortError';
				throw aborted;
			})
		);
		const thrown = await refusal(
			createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', reading.signal)
		);
		expect(thrown.name).toBe('AbortError');
		expect(thrown.fix).toBeUndefined();
	});

	// `null` is a valid json document, so a body of `null` is the deployment answering, not the
	// deployment answering with html. ../config.ts is what turns it into the unreadable-config card.
	it('hands back a null body as a body', async () => {
		stubFetch(json(null));
		const body = await createFormRuntime(DEPLOYMENT, document).loadConfig(
			'frm_a8x2k9',
			new AbortController().signal
		);
		expect(body).toBeNull();
	});

	it('distinguishes a body that is not json from one that is', async () => {
		stubFetch(new Response('<!doctype html><title>hello</title>', { status: 200 }));
		const failure = await refusal(
			createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', new AbortController().signal)
		);
		expect(failure.fix).toContain('not JSON');
	});

	// the api is this deployment and its words are put on screen with `createTextNode`, so there is
	// no markup path — but a misconfigured deployment can still answer with a body of any length,
	// and there is a donor in front of the card.
	it('caps how much of a sentence the api supplied reaches the card', async () => {
		const long = 'x'.repeat(5000);
		stubFetch(json({ error: 'nope', message: long, fix: long }, 400));
		const failure = await refusal(
			createFormRuntime(DEPLOYMENT, document).loadConfig('frm_a8x2k9', new AbortController().signal)
		);
		expect(failure.message.length).toBeLessThan(long.length);
		expect(failure.message.length).toBeLessThanOrEqual(400);
		expect((failure.fix ?? '').length).toBeLessThanOrEqual(400);
	});

	it('builds the same url the request is asserted against', () => {
		expect(configUrl(DEPLOYMENT, 'frm_a8x2k9')).toBe(
			`${DEPLOYMENT}/api/v1/forms/frm_a8x2k9/config`
		);
	});
});

describe('the clock the shipped ports read', () => {
	// the clock is a port so a ten-day window can be asserted in a millisecond, but the shipped
	// one has to be the real clock or every deadline the flow reads is wrong.
	it('is the real one', () => {
		const before = Date.now();
		const read = createFormRuntime(DEPLOYMENT, document)
			.checkout(
				{
					formId: 'frm_a8x2k9',
					providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
					currency: 'USD',
					minAmountMinor: 500,
					paymentMethods: ['card']
				} as never,
				document.createElement('div'),
				() => {},
				() => {},
				'first'
			)
			.input.ports.now();

		expect(read).toBeGreaterThanOrEqual(before);
		expect(read).toBeLessThanOrEqual(Date.now());
	});
});

// where this deployment is, per the runtime's own script tag — the same question ./loader.ts
// answers for the loader, against a different tag and with one more reading available.
//
// this is not decoration. every other case in this file hands `createFormRuntime` an origin
// directly, and `startRuntime` is watched only through the tag it defines and the card it paints —
// both of which happen whatever origin resolved, because a stubbed fetch answers every url the
// same. replace this function's body with `doc.location.origin` and all of that stays green. what
// catches it is the identity asserted here and the end-to-end read below.
describe('finding the deployment from the runtime', () => {
	it('reads the origin off the tag the loader marked', () => {
		plantRuntimeScript();
		whileExecuting(null, () => {
			expect(document.location.origin).not.toBe(DEPLOYMENT);
			expect(runtimeOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// a tag copied by hand, or written by a tag manager that strips unknown attributes, carries no
	// marker. the directory it is served from is what is left to go on.
	it('reads the origin off an unmarked tag under the runtime directory', () => {
		plantScript(`${DEPLOYMENT}${RUNTIME_PATH}`);
		whileExecuting(null, () => {
			expect(runtimeOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// the marker is written by this project's own loader and a path is not, so a script the org
	// happens to serve from a directory of that name — later in the document, which is where the
	// last-match fallback would otherwise find it — must not outrank the marked one.
	it('prefers the marked tag over a later one that merely shares the path', () => {
		plantRuntimeScript();
		plantScript(`${HOST_PAGE}${RUNTIME_PATH}`);
		whileExecuting(null, () => {
			expect(runtimeOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	it('reads its own element first, where the browser still has it', () => {
		const mine = plantScript(`${DEPLOYMENT}${RUNTIME_PATH}`);
		plantScript(`${HOST_PAGE}${RUNTIME_PATH}`, HOST_PAGE);
		whileExecuting(mine, () => {
			expect(runtimeOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// a foreign currentScript is not an answer, for the reason it is not one in ./loader.ts: taking
	// it hands back the org's own domain and every read then goes to a site that serves no api.
	it('refuses a currentScript that is not a runtime of ours', () => {
		const theirs = plantScript(`${HOST_PAGE}/bundle.js`);
		whileExecuting(theirs, () => {
			expect(runtimeOrigin(document)).toBeNull();
		});
	});

	it('answers with nothing for a src that names no origin', () => {
		const inline = plantScript('data:text/javascript,void 0');
		whileExecuting(inline, () => {
			expect(runtimeOrigin(document)).toBeNull();
		});
	});

	it('answers with nothing when no script on the page is one of ours', () => {
		plantScript(`${HOST_PAGE}/vendor/analytics.js`);
		whileExecuting(null, () => {
			expect(runtimeOrigin(document)).toBeNull();
		});
	});
});

describe('registering the element', () => {
	// the whole embed, end to end and in the shipped order: a marked runtime tag on the page, the
	// registration, an element, and the one request that comes out of it. this is what holds
	// `runtimeOrigin` to an answer — the url asserted here is the org's page origin if it resolves
	// anything else.
	//
	// it runs first because the runtime a registration closes over is the one that answers for every
	// later element: a name may be defined once per document, so a `startRuntime` ahead of this one
	// would leave its own origin in place and make this assertion about that call instead.
	it('reads the form configuration from the deployment it was served from', async () => {
		expect(customElements.get(DONATE_FORM_TAG)).toBeUndefined();
		plantRuntimeScript();
		const fetched = stubFetch(new Response('Not Found', { status: 404 }));
		startRuntime(document);

		const host = document.createElement(DONATE_FORM_TAG);
		host.setAttribute('form', 'frm_a8x2k9');
		document.body.appendChild(host);
		await settle();

		expect(fetched.mock.calls[0]?.[0]).toBe(`${DEPLOYMENT}/api/v1/forms/frm_a8x2k9/config`);
	});

	it('defines the permanent tag', () => {
		plantRuntimeScript();
		stubFetch(new Response('Not Found', { status: 404 }));
		startRuntime(document);
		expect(customElements.get(DONATE_FORM_TAG)).toBeDefined();
	});

	// the tag renders once it is defined, which is the half of the lifecycle a lightweight DOM can
	// show. the other half — an element already parsed into the page being upgraded by the
	// registration that arrives after it, which is what the snippet actually does — is in
	// ./runtime.browser.spec.ts: happy-dom's `customElements.define` performs no upgrade of
	// existing elements and its `customElements.upgrade` is a no-op, so an assertion about it here
	// would be an assertion about the fixture.
	it('renders a card for an element placed on the page after it', () => {
		plantRuntimeScript();
		stubFetch(new Response('Not Found', { status: 404 }));
		startRuntime(document);

		const host = document.createElement(DONATE_FORM_TAG);
		host.setAttribute('form', 'frm_a8x2k9');
		document.body.appendChild(host);

		// by name rather than by position: the element's live region is in front of every card it
		// shows (`#show` in ../element.ts), and it is the card that is being asserted here.
		expect(host.shadowRoot?.querySelector('[part~="card"]')).not.toBeNull();
	});

	// the loader installs the runtime once, but a page can hold a hand-written script tag beside a
	// pasted snippet. a second registration of a defined name throws.
	it('survives being started twice', () => {
		plantRuntimeScript();
		stubFetch(new Response('Not Found', { status: 404 }));
		startRuntime(document);
		expect(() => startRuntime(document)).not.toThrow();
	});
});

describe('the quote port the element is handed', () => {
	// the port itself is ./api.ts's and is asserted in ./api.spec.ts. what is this file's is the
	// composition around it: the answer is handed to ./stripe.ts's surface on the way back, and a
	// wrap that swallowed or rewrote it would be a total the provider's fields never learned.
	/** what one press sends, as `QuoteRequest` in ../v1.ts shapes it. */
	const SUBMISSION = {
		formId: 'frm_a8x2k9',
		amountMinor: 2500,
		frequency: 'one_time',
		method: 'card',
		coversFee: false,
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace',
		consentedToContact: false,
		turnstileToken: 'tok'
	} as const;

	/** the port as the element gets it: built per configuration, off one deployment's origin. */
	function quotePort() {
		return createFormRuntime(DEPLOYMENT, document).checkout(
			{
				formId: SUBMISSION.formId,
				currency: 'USD',
				paymentMethods: ['card'],
				providers: [{ name: 'stripe', publishableKey: 'pk_test_x' }]
			} as never,
			document.createElement('div'),
			() => {},
			() => {},
			'first'
		).input.ports.quote;
	}

	it('reaches the deployment and answers with what the deployment minted', async () => {
		const fetched = stubFetch(json({ paymentToken: 'pi_secret', feeMinor: 41, totalMinor: 2541 }));

		await expect(quotePort()(SUBMISSION)).resolves.toEqual({
			paymentToken: 'pi_secret',
			feeMinor: 41,
			totalMinor: 2541
		});
		expect(fetched.mock.calls[0]?.[0]).toBe(`${DEPLOYMENT}/api/v1/forms/frm_a8x2k9/donations`);
	});
});

describe('the rails a runtime offers', () => {
	/** as much of a configuration as building the ports reads. */
	const config = (paymentMethods: readonly string[]) =>
		({
			formId: 'frm_a8x2k9',
			providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
			currency: 'USD',
			minAmountMinor: 500,
			paymentMethods
		}) as never;

	const checkoutFor = (paymentMethods: readonly string[]) =>
		createFormRuntime(DEPLOYMENT, document).checkout(
			config(paymentMethods),
			document.createElement('div'),
			() => {},
			() => {},
			'first'
		);

	const inputFor = (paymentMethods: readonly string[]) => checkoutFor(paymentMethods).input;

	// every rail a config may name is one ./stripe.ts can carry to a confirmation, so nothing is
	// dropped on the way in. `paymentMethods` is what the fee row prices against and what a reported
	// rail is tested against, and a rail narrowed away here would be this runtime overruling the
	// account that was actually asked — a donor shown fewer ways to pay than the deployment approved.
	it('runs the flow on the rails the config was served with', () => {
		expect(inputFor(['card', 'ach', 'apple_pay']).config.paymentMethods).toEqual([
			'card',
			'ach',
			'apple_pay'
		]);
	});

	it('leaves a form that offers nothing but wallets exactly as it was served', () => {
		expect(inputFor(['apple_pay', 'google_pay']).config.paymentMethods).toEqual([
			'apple_pay',
			'google_pay'
		]);
	});

	// a surface is built per configuration, and a second gift is a second call here — so the door
	// onto each one has to be that surface's own. one shared door would stop the live surface on
	// behalf of the orphan, which is the defect inverted rather than fixed. calling it is what
	// proves the door is wired to a surface at all: an unwired one throws on the way through.
	it('hands back a teardown of its own for every surface it builds', () => {
		const first = checkoutFor(['card']);
		const second = checkoutFor(['card']);

		expect(first.stop).not.toBe(second.stop);
		expect(() => {
			first.stop();
			second.stop();
		}).not.toThrow();
	});
});

describe('a donor coming back from their bank', () => {
	const config = {
		formId: 'frm_a8x2k9',
		providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
		currency: 'USD',
		minAmountMinor: 500,
		paymentMethods: ['card']
	} as never;

	/** the same form under another id, which is what a second element on one page is. */
	const OTHER = { ...(config as object), formId: 'frm_b3n7p1' } as never;

	/**
	 * the page the donor came back to, before anything on it has booted.
	 *
	 * bound once, ahead of any case that makes `replaceState` refuse: putting a url in front of the
	 * runtime is the harness arriving at the page, not the runtime rewriting it, and a host that
	 * refuses the one still lets the donor land on the other.
	 */
	const arriveAt = window.history.replaceState.bind(window.history);
	const returnedTo = (search: string) => arriveAt(null, '', `/give${search}`);

	/** a document that will not let its own url be rewritten — sandboxed, or opaque-origin. */
	const refusesRewrite = () =>
		vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		});

	/** the same document's storage, which an opaque origin refuses on the property access itself. */
	function refusesStorage(): void {
		const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
		Object.defineProperty(window, 'sessionStorage', {
			configurable: true,
			get() {
				throw new DOMException('The operation is insecure.', 'SecurityError');
			}
		});
		restoreStorage = () => {
			if (original === undefined) Reflect.deleteProperty(window, 'sessionStorage');
			else Object.defineProperty(window, 'sessionStorage', original);
		};
	}

	let restoreStorage: (() => void) | null = null;

	beforeEach(() => {
		window.sessionStorage.clear();
	});

	afterEach(() => {
		restoreStorage?.();
		restoreStorage = null;
	});

	/**
	 * one element booting on that page, which is where a return is claimed or is not.
	 *
	 * the boot says which kind it is, because a runtime cannot tell a second element apart from an
	 * element booting a second time: both are a second `checkout` for the same form id.
	 */
	const bootOn = (
		runtime: ReturnType<typeof createFormRuntime>,
		on: never = config,
		boot: FormBoot = 'first'
	) =>
		runtime.checkout(
			on,
			document.createElement('div'),
			() => {},
			() => {},
			boot
		).input;

	const bootedWith = (search: string) => {
		returnedTo(search);
		return bootOn(createFormRuntime(DEPLOYMENT, document));
	};

	/** the stamp `returnUrl` in ./stripe.ts puts on the url it sends a donor away to. */
	const stamped = (formId: string) => `bg_donate_form=${formId}`;
	const RETURN = 'payment_intent_client_secret=pi_1_secret_x&payment_intent=pi_1';

	// the donor left for their bank and came back cross-origin into a context that remembers
	// nothing. the token in the URL is the only thing carried across, and it is what boots the
	// flow into a resume rather than onto an empty form for someone who has already paid.
	it('boots into a resume on the token the URL carried', () => {
		const input = bootedWith(`?${stamped('frm_a8x2k9')}&${RETURN}`);

		expect(input.resume).toEqual({ paymentToken: 'pi_1_secret_x' });
	});

	// left in place they outlive the gift they name: a reload weeks later would paint a thank-you
	// for a donation long since receipted, and the form on that page could never be used again. the
	// stamp goes with them, because it is this project's own parameter and its work is done the
	// moment the return is claimed.
	it('takes those parameters and its own stamp back off the host’s URL', () => {
		bootedWith(`?campaign=spring&${stamped('frm_a8x2k9')}&${RETURN}&redirect_status=succeeded`);

		expect(window.location.search).toBe('?campaign=spring');
	});

	// a resume belongs to one gift rather than to one page load. "Give again" is `#reboot` in
	// ../element.ts, which is a second checkout on the same runtime — carrying the old token into it
	// paints the thank-you for the gift that already settled, and the form on that page can never be
	// used a second time.
	it('hands no return to an element that says it is booting again', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		const runtime = createFormRuntime(DEPLOYMENT, document);

		expect(bootOn(runtime).resume).toEqual({ paymentToken: 'pi_1_secret_x' });
		expect(bootOn(runtime, config, 'again').resume).toBeUndefined();
	});

	// a page may hold the same form twice — the hero and the footer of a donation page is the
	// ordinary reason — and the donor gave to that form, so both should say so. the url can only be
	// read once, so the claim is held and served to every element booting on that id for the first
	// time; whichever of them read it first is not the one that gets to keep it.
	it('serves the return it claimed to a second element booting on the same form', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		const runtime = createFormRuntime(DEPLOYMENT, document);

		expect(bootOn(runtime).resume).toEqual({ paymentToken: 'pi_1_secret_x' });
		expect(bootOn(runtime).resume).toEqual({ paymentToken: 'pi_1_secret_x' });
		// and the url was emptied once, by the read that claimed it.
		expect(window.location.search).toBe('');
	});

	// two elements on one page share the runtime the loader installed, and the return belongs to
	// exactly one of them. the other is a form the donor never gave to, painting a thank-you.
	it('leaves the form the return does not name to boot fresh beside it', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		const runtime = createFormRuntime(DEPLOYMENT, document);

		expect(bootOn(runtime, OTHER).resume).toBeUndefined();
		expect(bootOn(runtime).resume).toEqual({ paymentToken: 'pi_1_secret_x' });
	});

	// the page carrying the footer snippet may also carry the org's own separate integration with
	// the same provider, and its return has no stamp of ours on it. reading that token would be
	// this widget resuming somebody else's gift; deleting it would be this widget taking their
	// return away from them.
	it('claims nothing from a return no form of ours stamped', () => {
		const input = bootedWith(`?${RETURN}`);

		expect(input.resume).toBeUndefined();
		expect(window.location.search).toBe(`?${RETURN}`);
	});

	// two forms on one page and the return names the other one. this form has nothing to resume, so
	// it boots onto an empty amount step — and the url stays whole, because the form that owns it
	// may not have booted yet.
	it('boots fresh on a return stamped for another form', () => {
		const search = `?${stamped('frm_b3n7p1')}&${RETURN}`;
		const input = bootedWith(search);

		expect(input.resume).toBeUndefined();
		expect(window.location.search).toBe(search);
	});

	it('starts at the amount step when the URL carried none', () => {
		expect(bootedWith('?campaign=spring').resume).toBeUndefined();
	});

	// a host router or a parameter-stripping script may take the token and leave the rest. there is
	// no gift to resume, but the stamp is still this project's own and the return parameters beside
	// it are still nobody's — left behind they sit on the donor's address bar for good.
	it('takes its stamp off a return whose token something else stripped', () => {
		const input = bootedWith(`?campaign=spring&${stamped('frm_a8x2k9')}&payment_intent=pi_1`);

		expect(input.resume).toBeUndefined();
		expect(window.location.search).toBe('?campaign=spring');
	});

	// what is left behind is the host's own query and it is written back onto their address bar, so
	// it comes back character for character: read into `URLSearchParams` and written out again, `;`
	// becomes `%3B` and a valueless parameter grows an `=` — a parameter their own page reads by
	// hand, changed under them by a widget in their footer.
	it('leaves the parameters it is not taking exactly as the host wrote them', () => {
		bootedWith(`?opts=a;b&debug&${stamped('frm_a8x2k9')}&${RETURN}`);

		expect(window.location.search).toBe('?opts=a;b&debug');
	});

	// the ordinary paste puts the snippet in a site-wide footer, so the runtime boots on pages
	// carrying no form at all — and a provider returns to whichever page the donor left from, which
	// may be one of them. a scrub at boot rewrites that url with nobody to consume what it held,
	// and neither a reload nor Back can get it back.
	// the scrub is what makes the claim one-shot, and a sandboxed or opaque-origin host refuses it
	// every time — the stamp and the token stay in the address bar. the runtime holds one claim per
	// page load, but that memory dies with the JavaScript context, and a reload or a Back is a new
	// one: without a bound that outlives it, the donor lands back on a thank-you for a gift that
	// settled once, on a form they can never use again.
	it('serves a return it could not scrub once, rather than once per reload', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		refusesRewrite();

		expect(bootOn(createFormRuntime(DEPLOYMENT, document)).resume).toEqual({
			paymentToken: 'pi_1_secret_x'
		});
		// the same url, in a runtime that remembers nothing, which is what a reload is.
		expect(bootOn(createFormRuntime(DEPLOYMENT, document)).resume).toBeUndefined();
	});

	// an opaque origin refuses the rewrite and the storage alike, and there is nothing left there to
	// tell a return coming back around from one arriving for the first time. the donor is holding a
	// gift their bank has already taken money for, so it is resumed — degraded, and stated as such
	// where the claim is written (./resume.ts) rather than quietly.
	it('still resumes a gift on a document that refuses the url and the storage alike', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		refusesRewrite();
		refusesStorage();

		expect(bootOn(createFormRuntime(DEPLOYMENT, document)).resume).toEqual({
			paymentToken: 'pi_1_secret_x'
		});
		expect(bootOn(createFormRuntime(DEPLOYMENT, document)).resume).toEqual({
			paymentToken: 'pi_1_secret_x'
		});
	});

	// the note only has to answer whether this return has already been served. the token answers it
	// too, and it is the secret the gift is confirmed with — written whole it is a second copy of
	// it, on a page this project does not own, outliving the url that carried it for as long as the
	// tab stays open.
	it('notes a claim it could not scrub without keeping the donor’s payment secret', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		refusesRewrite();

		bootOn(createFormRuntime(DEPLOYMENT, document));

		const wrote: string[] = [];
		for (let at = 0; at < window.sessionStorage.length; at += 1) {
			const key = window.sessionStorage.key(at);
			if (key !== null) wrote.push(`${key}=${window.sessionStorage.getItem(key)}`);
		}
		expect(wrote).toHaveLength(1);
		expect(wrote[0]).not.toContain('pi_1_secret_x');
	});

	// "Give again" on a host that refuses the scrub: the donor gives a second time from the tab
	// they came back into, and their second return is a different gift. a note that recorded only
	// that this form had claimed something would strand it on the thank-you for the first one.
	it('serves a second gift from that tab the return it came back with', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		refusesRewrite();
		bootOn(createFormRuntime(DEPLOYMENT, document));

		returnedTo(`?${stamped('frm_a8x2k9')}&payment_intent_client_secret=pi_2_secret_y`);

		expect(bootOn(createFormRuntime(DEPLOYMENT, document)).resume).toEqual({
			paymentToken: 'pi_2_secret_y'
		});
	});

	// the note is the scrub's understudy and nothing more. where the url itself could be emptied,
	// no later load can claim anything twice, and a key left in a stranger's storage would be this
	// widget writing on a page that only asked it to draw a form.
	it('writes nothing into the host’s storage where the url itself could be scrubbed', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);

		bootOn(createFormRuntime(DEPLOYMENT, document));

		expect(window.sessionStorage.length).toBe(0);
	});

	it('leaves a return url alone on a page that carries no form at all', () => {
		returnedTo(`?${stamped('frm_a8x2k9')}&${RETURN}`);
		plantRuntimeScript();
		stubFetch(new Response('Not Found', { status: 404 }));

		startRuntime(document);

		expect(window.location.search).toContain('payment_intent_client_secret=pi_1_secret_x');
	});
});
