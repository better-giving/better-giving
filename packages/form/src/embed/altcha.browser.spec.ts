import { createChallenge as issueChallenge, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';
import type { Payload } from 'altcha-lib/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineDonateForm, DONATE_FORM_TAG } from '../element';
import type { CheckoutPorts } from '../ports';
import type { FormConfig, PaymentMethod, QuoteRequest } from '../v1';
import { createChallenge } from './challenge';

// the ALTCHA solve in a real Chromium, through the element, to the request the press sends.
//
// what node cannot say about it: that the solver runs on this engine's WebCrypto at the cost the
// deployment really sets, that it needs no worker — which is the whole of why README's
// Content-Security-Policy section asks a host page for nothing new — and that the element draws
// nothing in front of the donor while it runs. every challenge is minted here by altcha-lib's own
// issuer at the app's parameters (`createAltcha` in packages/app/src/lib/server/api/altcha.ts) and
// every payload checked by its own verifier, so the request is one the endpoint would accept.
//
// like every spec in this pool it runs from `pnpm test:browser` and not from `pnpm test`; see
// vitest.browser.config.ts.

const SECRET = 'browser-spec-signature-secret';
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
	altchaChallengeUrl: '/api/v1/forms/frm_a8x2k9/challenge'
};

/**
 * the deployment's challenge endpoint, issuing at the app's own cost, each answer after `held`
 * settles.
 */
function endpoint(held: Promise<void> = Promise.resolve()) {
	const asked: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		asked.push(String(input));
		await held;
		const challenge = await issueChallenge({
			algorithm: 'PBKDF2/SHA-256',
			cost: 5_000,
			keyPrefix: '00',
			deriveKey,
			expiresAt: Math.floor(Date.now() / 1000) + 20 * 60,
			hmacSignatureSecret: SECRET
		});
		return Response.json(challenge);
	}) as typeof globalThis.fetch;
	return { asked, fetch };
}

async function verifies(payload: string | undefined): Promise<boolean> {
	if (payload === undefined) return false;
	const { challenge, solution } = JSON.parse(atob(payload)) as Payload;
	const result = await verifySolution({
		challenge,
		solution,
		deriveKey,
		hmacSignatureSecret: SECRET
	});
	return result.verified;
}

let tags = 0;
const planted: HTMLElement[] = [];

afterEach(() => {
	for (const node of planted.splice(0)) node.remove();
	vi.unstubAllGlobals();
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

/** the element on the page, running the shipped challenge against `fetch`, with its quotes logged. */
async function mount(fetch: typeof globalThis.fetch) {
	const quotes: QuoteRequest[] = [];
	const tokens: string[] = [];
	let report: (method: PaymentMethod | null) => void = () => {};
	const ports: CheckoutPorts = {
		quote: async (request) => {
			quotes.push(request);
			return { paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 };
		},
		confirm: () => new Promise<never>(() => {}),
		resume: async () => ({ kind: 'succeeded' }),
		status: async () => ({ state: 'waiting' }),
		now: () => Date.now()
	};
	const tag = `${DONATE_FORM_TAG}-altcha-${(tags += 1)}`;
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
			challenge: (config, node, onToken, onUnavailable) =>
				createChallenge(
					config,
					node,
					(token) => {
						tokens.push(token);
						onToken(token);
					},
					onUnavailable,
					{ configUrl: CONFIG_URL, seam: { altcha: { fetch } } }
				)
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
	return { root, quotes, tokens, rail: (method: PaymentMethod) => report(method) };
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

describe('a gift on a deployment whose spam check is ALTCHA', () => {
	it('solves in the background with no worker and sends a payload the endpoint accepts', async () => {
		// a page whose policy grants no `worker-src` is a page where constructing one throws.
		vi.stubGlobal(
			'Worker',
			class {
				constructor() {
					throw new Error('no worker may be started');
				}
			}
		);
		const { asked, fetch } = endpoint();
		const { root, quotes, tokens, rail } = await mount(fetch);

		review(root);
		rail('card');
		await until(() => tokens.length === 1);
		root.querySelector<HTMLElement>('[part~="submit"]')?.click();
		await until(() => quotes.length === 1);

		expect(asked).toEqual(['https://give.example.org/api/v1/forms/frm_a8x2k9/challenge']);
		expect(quotes[0]).not.toHaveProperty('turnstileToken');
		expect(await verifies(quotes[0]?.altchaPayload)).toBe(true);
	});

	// a donor quicker than the solve is held on the review step rather than sent without a payload
	// and refused for it: the press they made reports busy, keeps the caret, and is sent once the
	// solve lands.
	it('holds a press made before the solve has finished, then sends it with the payload', async () => {
		let release: () => void = () => {};
		const { fetch } = endpoint(new Promise((resolve) => (release = resolve)));
		const { root, quotes, tokens, rail } = await mount(fetch);
		review(root);
		rail('card');
		const press = root.querySelector<HTMLElement>('[part~="submit"]');
		if (press === null) throw new Error('no submit');

		await userEvent.click(press);

		expect(tokens).toEqual([]);
		expect(quotes).toEqual([]);
		expect(press.getAttribute('aria-busy')).toBe('true');
		expect(root.activeElement).toBe(press);
		// the review step's box for a widget asking for the donor stays empty: ALTCHA asks nothing.
		const held = root.querySelector<HTMLElement>('.step-give .challenge');
		expect(held?.childElementCount).toBe(0);
		expect(held?.getBoundingClientRect().height).toBe(0);

		release();
		await until(() => quotes.length === 1);
		expect(await verifies(quotes[0]?.altchaPayload)).toBe(true);
	});

	// the donor is shown no puzzle: the box a Turnstile widget would draw in stays empty and takes
	// no room on the details step.
	it('draws nothing on the details step while it solves', async () => {
		const { fetch } = endpoint();
		const { root, tokens } = await mount(fetch);
		const forward = root.querySelector<HTMLElement>(
			'.step:not([hidden]) [part~="action"]:not([part~="submit"])'
		);
		root.querySelector<HTMLElement>('[part~="amount-option"] input')?.click();
		forward?.click();

		const box = root.querySelector<HTMLElement>('.challenge');
		expect(box).not.toBeNull();
		await until(() => tokens.length === 1);
		expect(box?.childElementCount).toBe(0);
		expect(box?.getBoundingClientRect().height).toBe(0);
	});
});
