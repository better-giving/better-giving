import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineDonateForm, DONATE_FORM_TAG } from './element';
import type { CheckoutPorts } from './ports';
import type { FormConfig } from './v1';

// the embed loads no web font: the card is set in the face the host page gives the element.
//
// a nonprofit's page is the document, and it sets its own face on the element's parent. the real
// element is mounted, whose coin list is the one the card builds and stands in its own shadow. the
// card's words, heading, a text box and a button compute the page's face, the coin's ticker the
// platform's monospace, and the page fetches no font file and holds no face in the document's own
// sheets — the one the element adopts there included.
//
// `document.fonts` holds the document's faces only: an `@font-face` in a shadow root's sheet is not
// in it, so this file cannot see a face the card's own sheets declare. the guard on those is "carries
// no face and emits no file beside the runtime", and its case for the loader, in
// ./embed/build-output.spec.ts, which reads the shipped bytes.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['crypto'],
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
	coins: [
		{ coin: 'btc', ticker: 'btc', name: 'Bitcoin', network: 'Bitcoin', memoRequired: false },
		{ coin: 'sol', ticker: 'sol', name: 'Solana', network: 'Solana', memoRequired: false }
	]
};

const PORTS: CheckoutPorts = {
	quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 }),
	confirm: async () => ({ kind: 'succeeded' }),
	resume: async () => ({ kind: 'succeeded' }),
	status: async () => ({ state: 'waiting' }),
	now: () => 1_700_000_000_000
};

const planted: HTMLElement[] = [];

function fontFiles(): string[] {
	return performance
		.getEntriesByType('resource')
		.map((entry) => entry.name)
		.filter((name) => /\.woff2?(?:$|\?)/i.test(name));
}

/** the coin list the element built, which is a shadow root of its own inside the card. */
function coinList(host: HTMLElement): ShadowRoot {
	for (const node of [host, ...host.querySelectorAll('*')]) {
		const root = node.shadowRoot;
		if (root?.querySelector('.coin-ticker') != null) return root;
	}
	throw new Error('the element rendered no coin list');
}

afterEach(() => {
	for (const node of planted.splice(0)) node.remove();
});

/** the face the host page sets, which no font file stands behind. */
const HOST_FACE = "Georgia, 'Times New Roman', serif";

describe('the embed’s face', () => {
	it('draws the card in the face the host page gives it and fetches no font', async () => {
		const tag = `${DONATE_FORM_TAG}-faces`;
		defineDonateForm(
			{
				loadConfig: async () => CONFIG,
				checkout: (config, mount, _onRail, _onUnavailable, _boot, _fund, coins) => {
					mount.appendChild(coins);
					return {
						input: { config, ports: PORTS },
						cadence: () => {},
						offerFund: () => {},
						offerCrypto: () => {},
						offerVenmo: () => {},
						rows: () => {},
						repeatingUnavailable: () => {},
						stop: () => {}
					};
				},
				challenge: () => ({ reset: () => {}, stop: () => {} })
			},
			tag
		);
		const page = document.createElement('div');
		page.style.fontFamily = HOST_FACE;
		const host = document.createElement(tag);
		host.setAttribute('form', CONFIG.formId);
		page.appendChild(host);
		document.body.appendChild(page);
		planted.push(page);

		const list = await vi.waitFor(() => coinList(host), { timeout: 5000 });

		const word = host.shadowRoot?.querySelector('label, p');
		const heading = host.shadowRoot?.querySelector("[part~='heading']");
		const ticker = list.querySelector('.coin-ticker');
		// a control inherits only through layout.css's `font: inherit`, never by default
		const field = host.shadowRoot?.querySelector('input:not([type=checkbox], [type=radio])');
		const button = host.shadowRoot?.querySelector('button');
		if (word == null || heading == null) throw new Error('the card drew no text');
		if (field == null || button == null) throw new Error('the card drew no control');
		if (ticker == null) throw new Error('the coin list drew no ticker');

		const pageFace = getComputedStyle(page).fontFamily;
		expect(pageFace).toContain('Georgia');
		expect(getComputedStyle(word).fontFamily).toBe(pageFace);
		expect(getComputedStyle(heading).fontFamily).toBe(pageFace);
		expect(getComputedStyle(field).fontFamily).toBe(pageFace);
		expect(getComputedStyle(button).fontFamily).toBe(pageFace);
		expect(getComputedStyle(ticker).fontFamily.startsWith('ui-monospace')).toBe(true);

		await document.fonts.ready;
		expect([...document.fonts]).toEqual([]);
		expect(fontFiles()).toEqual([]);
	});
});
