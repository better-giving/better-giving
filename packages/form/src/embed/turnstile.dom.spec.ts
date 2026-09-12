import { describe, expect, it } from 'vitest';
import type { Failure } from '../checkout.machine';
import type { FormConfig } from '../v1';
import {
	createChallenge,
	installTurnstile,
	RETRYABLE_FAILURE_LIMIT,
	SCRIPT_DEADLINE_MS,
	TURNSTILE_SCRIPT_SRC,
	type RenderOptions,
	type TurnstileLike
} from './turnstile';

// the dom pool, and a challenge provider that is a plain object. what is worth asserting here is
// what this adapter asks the widget for and what it makes of the answer — neither needs a network
// nor a sitekey, and both are exactly what a spec against the real widget could not see.
//
// what a lightweight DOM cannot see at all is whether the widget completes a mount inside a shadow
// root. that was measured in a real browser against three mounts of identical options — inside a
// shadow root, in the light DOM, and in a light-DOM node that is hidden — and all three completed,
// which is why nothing here leaves the shadow tree the way the payment surface has to
// (`#start` in ../element.ts).

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
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
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.',
	turnstileSiteKey: '0x4AAAAAAABBBB'
};

type Recorder = {
	readonly turnstile: TurnstileLike;
	readonly rendered: { node: HTMLElement; options: RenderOptions }[];
	readonly resets: string[];
	readonly removed: string[];
	/** the widget handing over a token, the way its own script does. */
	solve(token: string): void;
	/** the widget naming a failure of its own. */
	fail(code: string): void;
	/** the interactive challenge timing out under the donor. */
	timeout(): void;
};

function recorder(id = 'cf-chl-widget-1'): Recorder {
	const rendered: { node: HTMLElement; options: RenderOptions }[] = [];
	const resets: string[] = [];
	const removed: string[] = [];
	const last = (): RenderOptions => {
		const options = rendered.at(-1)?.options;
		if (options === undefined) throw new Error('nothing has been rendered');
		return options;
	};
	return {
		turnstile: {
			render: (node, options) => {
				rendered.push({ node, options });
				return id;
			},
			reset: (widget) => void resets.push(widget),
			remove: (widget) => void removed.push(widget)
		},
		rendered,
		resets,
		removed,
		solve: (token) => last().callback?.(token),
		fail: (code) => last()['error-callback']?.(code),
		timeout: () => last()['timeout-callback']?.()
	};
}

/**
 * a document of its own, with a window behind it.
 *
 * an iframe rather than `createHTMLDocument`, which has no `defaultView` — and a document nothing
 * is being rendered in is one this adapter installs nothing into on purpose. a fresh document per
 * case is also what keeps the one-install-per-document cache from being shared across them.
 */
function page(): Document {
	const frame = document.createElement('iframe');
	document.body.appendChild(frame);
	const doc = frame.contentDocument;
	if (doc === null) throw new Error('the iframe has no document');
	return doc;
}

/** the box the card hands over, in a document. */
function box(): HTMLElement {
	const node = document.createElement('div');
	document.body.appendChild(node);
	return node;
}

type Extra = {
	readonly tokens?: string[];
	readonly unavailable?: Failure[];
	readonly load?: () => Promise<TurnstileLike | null>;
	readonly config?: FormConfig;
};

function challengeOn(kit: Recorder, extra: Extra = {}) {
	return createChallenge(
		extra.config ?? CONFIG,
		box(),
		(token) => void extra.tokens?.push(token),
		(failure) => void extra.unavailable?.push(failure),
		{ load: extra.load ?? (async () => kit.turnstile) }
	);
}

/** one turn of the loop, which is what the provider's script arriving amounts to here. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the widget this adapter asks for', () => {
	// the mode is the decision, not a preference. `interaction-only` draws nothing at all for a
	// visitor who is not being asked to solve anything, which is what lets the card reserve no
	// space for it (`.challenge` in ../styles/layout.css).
	it('renders into the node it was handed, drawing nothing unless a visitor must interact', async () => {
		const kit = recorder();
		challengeOn(kit);
		await settle();

		expect(kit.rendered).toHaveLength(1);
		expect(kit.rendered[0]?.options.sitekey).toBe('0x4AAAAAAABBBB');
		expect(kit.rendered[0]?.options.appearance).toBe('interaction-only');
	});

	// the form is light only — the card's greys are fixed near-white literals and no seed reaches
	// them — so a widget that followed the visitor's system theme would paint a dark box on a white
	// card.
	it('asks for the light theme rather than the visitor’s system one', async () => {
		const kit = recorder();
		challengeOn(kit);
		await settle();

		expect(kit.rendered[0]?.options.theme).toBe('light');
	});

	// a token is valid for five minutes and a donor may take longer than that over a card number.
	// stated here rather than left to the provider's default, so the behaviour is this file's.
	it('lets the widget replace a token that expires under the donor', async () => {
		const kit = recorder();
		const tokens: string[] = [];
		challengeOn(kit, { tokens });
		await settle();
		kit.solve('tok_first');
		kit.solve('tok_second');

		expect(kit.rendered[0]?.options['refresh-expired']).toBe('auto');
		// every token, not just the first: the flow spends the last one to arrive, and the widget
		// mints another on its own once the first has aged out.
		expect(tokens).toEqual(['tok_first', 'tok_second']);
	});

	// the provider's own troubleshooting answers an interaction that timed out with this exact
	// call, and the alternative is a donor looking at a widget that will never answer.
	it('resets the widget when the interactive challenge times out under the donor', async () => {
		const kit = recorder('cf-chl-widget-abc');
		challengeOn(kit);
		await settle();
		kit.timeout();

		expect(kit.resets).toEqual(['cf-chl-widget-abc']);
	});
});

describe('a challenge that cannot mint a token', () => {
	// the whole point of subscribing. the sitekey is wrong, the domain is not on the widget's
	// allowlist, or the key was disabled — all of them are an operator's to fix, none of them is
	// fixed by trying again, and without this the donor fills the entire form in and is refused by
	// the endpoint with a sentence written for a developer.
	it.each([
		['an invalid sitekey', '110100'],
		['a sitekey that is not found', '110110'],
		['a domain the widget does not serve', '110200'],
		['a clock or cache problem', '200100'],
		['a sitekey the dashboard disabled', '400070']
	])('reports %s, which Cloudflare documents as not retryable', async (_label, code) => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		kit.fail(code);

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.fix).toContain(code);
	});

	// the one code of the six with a single cause, and the one an operator actually hits: adding a
	// site in this app's /admin does not add it to the widget's own hostname list at Cloudflare, and
	// nothing in this repository can see that list to say so any other way.
	it('names the widget’s hostname list, and the two lists, for a domain that is not authorized', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		kit.fail('110200');

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.fix).toContain('110200');
		expect(unavailable[0]?.fix).toContain('Hostname Management');
		expect(unavailable[0]?.fix).toContain('/admin');
		// the sitekey is not what is wrong here, and the shared sentence asks the reader to check it.
		expect(unavailable[0]?.fix).not.toContain('sitekey');
	});

	// the other five keep the shared sentence, which is the whole of what is known about them.
	it('keeps the shared sentence for an unrecoverable code that is not the domain', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		kit.fail('110100');

		expect(unavailable[0]?.fix).toContain('110100');
		expect(unavailable[0]?.fix).toContain('not retryable');
		expect(unavailable[0]?.fix).not.toContain('Hostname Management');
	});

	// the other half, and the half that keeps this from being worse than saying nothing: Cloudflare
	// publishes which codes are worth retrying and the widget retries them itself. reporting one
	// would take down a form over a blip that had already fixed itself.
	it.each([
		['a challenge that timed out', '110600'],
		['an interaction that timed out', '110620'],
		['an iframe that would not load', '200500'],
		['a generic challenge failure', '300010'],
		['another generic challenge failure', '600123']
	])('says nothing about %s, which the widget retries on its own', async (_label, code) => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		kit.fail(code);

		expect(unavailable).toEqual([]);
	});

	// the other half of that, and what tells a widget retrying apart from one that has retried and
	// gone on failing. Cloudflare's own troubleshooting says the callback is invoked again for each
	// failure a retry produces
	// (https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/), so a
	// visitor who cannot clear the challenge reaches this count and is told, rather than filling the
	// whole form in and being refused at the press.
	it('reports a retryable code that has gone on failing', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		for (let attempt = 0; attempt < RETRYABLE_FAILURE_LIMIT; attempt += 1) kit.fail('300010');

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.fix).toContain('300010');
	});

	// the half of the seam that keeps the report from being worse than saying nothing, pinned at the
	// boundary rather than at one failure: a retryable code is retried by the widget itself, and a
	// form that goes down on the second of them goes down on a connection that dropped and came
	// back. it is here so that moving the report onto the second failure is a red test rather than a
	// decision nobody sees.
	it('says nothing while a retryable code is still short of that', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		for (let attempt = 0; attempt < RETRYABLE_FAILURE_LIMIT - 1; attempt += 1) kit.fail('300010');

		expect(unavailable).toEqual([]);
	});

	// counted since the last token rather than for the life of the widget. a token is spent and the
	// element resets for the next one, and a challenge lives on a page for as long as a donor takes
	// over a card number — so a blip an hour is a form that takes itself down over three gifts that
	// all went through.
	it('counts from the last token the widget minted', async () => {
		const kit = recorder();
		const tokens: string[] = [];
		const unavailable: Failure[] = [];
		challengeOn(kit, { tokens, unavailable });
		await settle();
		for (let attempt = 0; attempt < RETRYABLE_FAILURE_LIMIT - 1; attempt += 1) kit.fail('300010');
		kit.solve('tok_after_the_blips');
		for (let attempt = 0; attempt < RETRYABLE_FAILURE_LIMIT - 1; attempt += 1) kit.fail('300010');

		expect(tokens).toEqual(['tok_after_the_blips']);
		expect(unavailable).toEqual([]);
	});

	// every way it goes wrong is reported, and a report is never the last one this adapter will
	// make. the flow is where a report is answered or held for later (`heldChallenge` in
	// ../checkout.machine.ts), and a widget that reported once and went quiet would leave that
	// decision to be made by whichever failure happened to be first. the donor is not shown a
	// screen per report either: a report the flow has already answered leaves it standing where it
	// is.
	it('reports every way the same widget goes wrong', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable });
		await settle();
		kit.fail('110100');
		kit.fail('110200');

		expect(unavailable).toHaveLength(2);
		expect(unavailable[1]?.fix).toContain('Hostname Management');
	});

	// the script never arrived — blocked by an extension, a proxy, or a Content-Security-Policy on
	// the host's own page. the donor is told before they fill anything in.
	it('reports a script that never arrived', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		challengeOn(kit, { unavailable, load: async () => null });
		await settle();

		expect(unavailable).toHaveLength(1);
		expect(kit.rendered).toEqual([]);
		expect(unavailable[0]?.fix).toContain('challenges.cloudflare.com');
	});

	// a deployment that never set `TURNSTILE_SITE_KEY` serves a config with no sitekey in it, so
	// there is no widget to draw and every donation it takes is refused by its own endpoint. the
	// form says so rather than looking like a form.
	it('reports a deployment that served no sitekey, without loading anything', async () => {
		const kit = recorder();
		const unavailable: Failure[] = [];
		const { turnstileSiteKey: _dropped, ...withoutKey } = CONFIG;
		challengeOn(kit, { unavailable, config: withoutKey });
		await settle();

		expect(unavailable).toHaveLength(1);
		expect(unavailable[0]?.fix).toContain('TURNSTILE_SITE_KEY');
		expect(kit.rendered).toEqual([]);
	});
});

describe('the widget’s life after the first token', () => {
	// a token is single-use. the element asks for this the moment one has been spent, which is what
	// keeps a donor's second press from failing for a different reason than their first.
	it('resets through the widget id the provider handed back', async () => {
		const kit = recorder('cf-chl-widget-abc');
		const challenge = challengeOn(kit);
		await settle();
		challenge.reset();

		expect(kit.resets).toEqual(['cf-chl-widget-abc']);
	});

	// the widget is registered inside the provider's script under an id nothing else holds, so
	// dropping the nodes it drew in leaves the registration behind.
	it('removes through that same id when the element takes it off the page', async () => {
		const kit = recorder('cf-chl-widget-abc');
		const challenge = challengeOn(kit);
		await settle();
		challenge.stop();

		expect(kit.removed).toEqual(['cf-chl-widget-abc']);
	});

	// the element stops a card whose configuration read is still in flight, and a reset or a remove
	// against a widget that was never rendered is a throw inside a state transition.
	it('answers a reset and a stop that arrive before the script does', async () => {
		const kit = recorder();
		let arrive: (api: TurnstileLike) => void = () => {};
		const challenge = challengeOn(kit, {
			load: () => new Promise((resolve) => (arrive = resolve))
		});
		challenge.reset();
		challenge.stop();
		arrive(kit.turnstile);
		await settle();

		// stopped before the script landed, so nothing is drawn on the page it landed on.
		expect(kit.rendered).toEqual([]);
		expect(kit.resets).toEqual([]);
	});
});

describe('installing the provider’s script', () => {
	// one script per document however many forms are on the page. the provider keeps one registry
	// of widgets keyed by id, and a second copy of the script is a second registry.
	it('installs one script, in explicit rendering mode', async () => {
		const doc = page();
		const first = installTurnstile(doc, () => () => {});
		installTurnstile(doc, () => () => {});
		const scripts = doc.querySelectorAll('script');

		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.getAttribute('src')).toBe(TURNSTILE_SCRIPT_SRC);
		// explicit rendering: this adapter decides where and when, and the container carries no
		// `cf-turnstile` class for the implicit scan to find.
		expect(TURNSTILE_SCRIPT_SRC).toContain('render=explicit');
		expect(first).toBe(installTurnstile(doc, () => () => {}));
	});

	// the host page may already run Turnstile of its own. the provider's script is documented as
	// having to be fetched from its exact URL and not proxied, so the one already there is the one
	// to wait on rather than a reason for a second.
	it('adopts a script the host page already installed', async () => {
		const doc = page();
		const existing = doc.createElement('script');
		existing.setAttribute('src', 'https://challenges.cloudflare.com/turnstile/v0/api.js');
		doc.head.appendChild(existing);
		installTurnstile(doc, () => () => {});

		expect(doc.querySelectorAll('script')).toHaveLength(1);
	});

	// a host page whose Content-Security-Policy is `script-src 'nonce-…'` without `'strict-dynamic'`
	// refuses this tag unless it carries that page's nonce. refused, the widget never renders, no
	// token is ever minted, and every donation the deployment takes is refused by its own endpoint
	// for arriving without one.
	it('carries the nonce it was handed', () => {
		const doc = page();
		installTurnstile(doc, () => () => {}, 'n0nce');

		expect(doc.querySelector('script')?.nonce).toBe('n0nce');
	});

	// a page with no policy of its own is the ordinary one, and a nonce invented for it is a value
	// no policy matches.
	//
	// what this pins is where the nonce is read from: the tag that served the runtime, and never
	// whichever script on the page happens to have one — taking a stranger's would put their nonce
	// on our tag on every page that has both, which is what the host's own nonced script here would
	// catch.
	it('sets no nonce where the script that injected the runtime had none', () => {
		const doc = page();
		const theirs = doc.createElement('script');
		theirs.setAttribute('src', 'https://acme.org/vendor/analytics.js');
		Object.defineProperty(theirs, 'nonce', { value: 'theirs', configurable: true });
		doc.head.appendChild(theirs);

		installTurnstile(doc, () => () => {}, '');

		expect(
			doc.querySelector<HTMLScriptElement>('script[src^="https://challenges"]')?.nonce ?? ''
		).toBe('');
	});

	// a script that loads and defines nothing is the same outcome as one that never loaded, and it
	// is `null` rather than a throw for the reason the payment adapter's loader is: a rejection
	// here is a donation form that renders nothing at all.
	it('answers null when the script loads without defining the provider', async () => {
		const doc = page();
		const installing = installTurnstile(doc, () => () => {});
		doc.querySelector('script')?.dispatchEvent(new Event('load'));

		await expect(installing).resolves.toBeNull();
	});

	// the failure is a moment rather than a property of the page. a request that did not complete
	// once says nothing about the next one, and the cache is per document: holding the `null` is
	// every later challenge on that page — a second gift, an attribute change, a second element —
	// refused for a network event that has since passed, with a sentence about configuration.
	it('lets a document whose first install failed install again', async () => {
		const doc = page();
		const armed: (() => void)[] = [];
		const first = installTurnstile(doc, (run) => {
			armed.push(run);
			return () => {};
		});
		armed[0]?.();

		await expect(first).resolves.toBeNull();

		// the script the first install gave up on ran after all, which is the ordinary shape of a
		// slow one: the API is on the window and a fresh read of it would succeed.
		const kit = recorder();
		(doc.defaultView as unknown as { turnstile: TurnstileLike }).turnstile = kit.turnstile;

		await expect(installTurnstile(doc, () => () => {})).resolves.toBe(kit.turnstile);
	});

	// a tag that fires neither event — a proxy holding the connection open — is the stall this
	// deadline exists for, and it is the one failure the script itself never names.
	it('answers null once the deadline passes with the script still silent', async () => {
		const doc = page();
		const armed: { run: () => void; ms: number }[] = [];
		const installing = installTurnstile(doc, (run, ms) => {
			armed.push({ run, ms });
			return () => {};
		});
		armed[0]?.run();

		expect(armed[0]?.ms).toBe(SCRIPT_DEADLINE_MS);
		await expect(installing).resolves.toBeNull();
	});
});
