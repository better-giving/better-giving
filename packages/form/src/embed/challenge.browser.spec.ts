import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineDonateForm, DONATE_FORM_TAG } from '../element';
import type { CheckoutPorts } from '../ports';
import type { FormConfig, PaymentMethod, QuoteRequest } from '../v1';
import { createChallenge } from './challenge';
import type { RenderOptions, TurnstileLike } from './turnstile';

// a Turnstile widget asking the donor to solve something, in a real Chromium, through the element
// and the shipped adapter. the widget is a stand-in that draws a box of the size Cloudflare's own
// does and answers when the spec says the donor solved it: what is under test is where the element
// puts it and when the press is sent, which a lightweight DOM cannot measure.
//
// like every spec in this pool it runs from `pnpm test:browser` and not from `pnpm test`; see
// vitest.browser.config.ts.

const CONFIG_URL = 'https://give.example.org/api/v1/forms/frm_a8x2k9/config';

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card'],
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
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.',
	turnstileSiteKey: '1x00000000000000000000AA'
};

/** a widget that draws a challenge-sized box in each node it is rendered into. */
function interactiveWidget() {
	const rendered: { node: HTMLElement; options: RenderOptions; id: string }[] = [];
	const removed: string[] = [];
	const turnstile: TurnstileLike = {
		render: (node, options) => {
			const id = `cf-chl-widget-${rendered.length + 1}`;
			const frame = document.createElement('div');
			frame.dataset.widget = id;
			// the managed widget's own box, in CSS pixels.
			frame.style.cssText = 'inline-size: 300px; block-size: 65px;'; // raw-length-ok: a stand-in for the vendor's frame
			node.appendChild(frame);
			rendered.push({ node, options, id });
			return id;
		},
		reset: () => {},
		remove: (id) => {
			removed.push(id);
			for (const entry of rendered) entry.node.querySelector(`[data-widget="${id}"]`)?.remove();
		}
	};
	const last = () => {
		const entry = rendered.at(-1);
		if (entry === undefined) throw new Error('nothing has been rendered');
		return entry;
	};
	return { turnstile, rendered, removed, last };
}

const planted: HTMLElement[] = [];
let tags = 0;

afterEach(() => {
	for (const node of planted.splice(0)) node.remove();
});

function until(check: () => boolean, ms = 10_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = performance.now();
		const poll = () => {
			if (check()) resolve();
			else if (performance.now() - started > ms) reject(new Error('timed out'));
			else setTimeout(poll, 10);
		};
		poll();
	});
}

async function mount(turnstile: TurnstileLike) {
	const quotes: QuoteRequest[] = [];
	let report: (method: PaymentMethod | null) => void = () => {};
	const ports: CheckoutPorts = {
		quote: async (request) => {
			quotes.push(request);
			return new Promise<never>(() => {});
		},
		confirm: () => new Promise<never>(() => {}),
		resume: async () => ({ kind: 'succeeded' }),
		status: async () => ({ state: 'waiting' }),
		now: () => Date.now()
	};
	const tag = `${DONATE_FORM_TAG}-interactive-${(tags += 1)}`;
	defineDonateForm(
		{
			loadConfig: async () => CONFIG,
			checkout: (config, _node, onRail) => {
				report = onRail;
				return {
					input: { config, ports },
					cadence: () => {},
					offerFund: () => {},
					offerCrypto: () => {},
					offerVenmo: () => {},
					rows: () => {},
					repeatingUnavailable: () => {},
					stop: () => {}
				};
			},
			challenge: (config, node, onToken, onUnavailable, onInteractive) =>
				createChallenge(config, node, onToken, onUnavailable, {
					configUrl: CONFIG_URL,
					onInteractive,
					seam: { turnstile: { load: async () => turnstile, delay: () => () => {} } }
				})
		},
		tag
	);
	const host = document.createElement(tag);
	host.setAttribute('form', CONFIG.formId);
	document.body.appendChild(host);
	planted.push(host);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const root = host.shadowRoot;
	if (root === null) throw new Error('the element has no shadow root');
	return { root, quotes, rail: (method: PaymentMethod) => report(method) };
}

/** the donor walked from the amount step to the review, typing what the details step asks. */
function review(root: ShadowRoot): void {
	const forward = () =>
		root
			.querySelector<HTMLElement>('.step:not([hidden]) [part~="action"]:not([part~="submit"])')
			?.click();
	const type = (selector: string, value: string) => {
		const field = root.querySelector<HTMLInputElement>(selector);
		if (field === null) throw new Error(`no ${selector}`);
		field.value = value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
	};
	root.querySelector<HTMLElement>('[part~="frequency-option"] input')?.click();
	root.querySelector<HTMLElement>('[part~="amount-option"] input')?.click();
	forward();
	type('#email', 'donor@example.org');
	type('#first-name', 'Ada');
	type('#last-name', 'Lovelace');
	forward();
}

describe('a held press on a Turnstile widget that asks the donor to solve something', () => {
	it('draws the widget on screen beside the press, and sends the gift once it is solved', async () => {
		const widget = interactiveWidget();
		const { root, quotes, rail } = await mount(widget.turnstile);
		review(root);
		rail('card');
		await until(() => widget.rendered.length === 1);
		// the widget decides it needs the donor after they have left the step it is drawn on.
		widget.last().options['before-interactive-callback']?.();
		const press = root.querySelector<HTMLElement>('[part~="submit"]');
		if (press === null) throw new Error('no submit');

		await userEvent.click(press);
		await until(() => widget.rendered.length === 2);

		const drawn = widget.last().node;
		expect(widget.removed).toEqual(['cf-chl-widget-1']);
		expect(drawn.previousElementSibling).toBe(press);
		expect(drawn.getBoundingClientRect().height).toBeGreaterThan(0);
		expect(drawn.checkVisibility()).toBe(true);
		expect(quotes).toEqual([]);

		widget.last().options['before-interactive-callback']?.();
		widget.last().options.callback?.('tk_solved');
		await until(() => quotes.length === 1);

		expect(quotes[0]?.turnstileToken).toBe('tk_solved');
	});

	it('leaves the widget where it is for a press that already holds a token', async () => {
		const widget = interactiveWidget();
		const { root, quotes, rail } = await mount(widget.turnstile);
		review(root);
		rail('card');
		await until(() => widget.rendered.length === 1);
		widget.last().options.callback?.('tk_early');
		widget.last().options['before-interactive-callback']?.();

		root.querySelector<HTMLElement>('[part~="submit"]')?.click();
		await until(() => quotes.length === 1);

		expect(widget.rendered).toHaveLength(1);
		expect(widget.removed).toEqual([]);
	});
});
