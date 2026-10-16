import { afterEach, describe, expect, it } from 'vitest';
import { defineDonateForm, DONATE_FORM_TAG } from './element';
import type { CheckoutPorts } from './ports';
import type { FormConfig } from './v1';

// the embed stays on the platform stack when the document also links the hosted faces.
//
// a nonprofit's page is the document. this one links the same face sheet a hosted campaign
// links, then mounts the real element, whose coin list is the one the card builds and stands in
// its own shadow. the computed face is the platform stack, and none of the sheet's files is
// fetched. a probe set in Red Hat Text on the same document does fetch one, so a request the
// element made would have been seen.
//
// `__HOSTED_FACES__` is the sheet's href, set by vitest.browser.config.ts. the form package does
// not import packages/operator.

declare const __HOSTED_FACES__: string;

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
	document.head.querySelector('link[data-hosted-faces]')?.remove();
	document.getElementById('face-probe')?.remove();
});

describe('the embed beside the hosted face sheet', () => {
	it('computes the platform stack and requests no font file', async () => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = __HOSTED_FACES__;
		link.dataset.hostedFaces = '';
		const loaded = new Promise<void>((resolve, reject) => {
			link.onload = () => resolve();
			link.onerror = () => reject(new Error('the hosted face sheet did not load'));
		});
		document.head.appendChild(link);
		await loaded;

		const declared = [...document.fonts].map((face) => face.family).join(' ');
		expect(declared).toContain('Red Hat Text');
		expect(declared).toContain('Red Hat Display');
		expect(declared).toContain('Red Hat Mono');
		for (const face of document.fonts) expect(face.status).toBe('unloaded');

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
		const host = document.createElement(tag);
		host.setAttribute('form', CONFIG.formId);
		document.body.appendChild(host);
		planted.push(host);

		let list: ShadowRoot | null = null;
		for (let frame = 0; frame < 20 && list === null; frame += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			try {
				list = coinList(host);
			} catch {
				list = null;
			}
		}
		if (list === null) throw new Error('the element rendered no coin list');

		const word = host.shadowRoot?.querySelector('p, h1, h2, button, label');
		if (word == null) throw new Error('the card drew no text');
		const ticker = list.querySelector('.coin-ticker');
		if (ticker == null) throw new Error('the coin list drew no ticker');

		const cardFace = getComputedStyle(word).fontFamily;
		const tickerFace = getComputedStyle(ticker).fontFamily;
		expect(cardFace).toContain('system-ui');
		expect(cardFace).not.toContain('Red Hat');
		expect(tickerFace).toContain('ui-monospace');
		expect(tickerFace).not.toContain('Red Hat');
		await document.fonts.ready;
		expect(fontFiles()).toEqual([]);

		const probe = document.createElement('p');
		probe.id = 'face-probe';
		probe.textContent = 'Northside pantry';
		probe.style.fontFamily = "'Red Hat Text', sans-serif";
		document.body.appendChild(probe);
		await document.fonts.load('400 16px "Red Hat Text"');
		await document.fonts.ready;
		expect(fontFiles().length).toBeGreaterThan(0);
		expect(getComputedStyle(word).fontFamily).not.toContain('Red Hat');
	});
});
