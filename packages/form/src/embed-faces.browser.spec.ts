import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineDonateForm, DONATE_FORM_TAG } from './element';
import type { CheckoutPorts } from './ports';
import type { FormConfig } from './v1';

// the embed draws in the design registry's faces, and brings the six core ones with it.
//
// a nonprofit's page is the document, and it links no face of its own here. the real element is
// mounted, whose coin list is the one the card builds and stands in its own shadow. the card's words
// compute Red Hat Round Text and its heading Red Hat Round Display, the faces the element put into
// the document (`documentCss` in ./element.ts) — a `@font-face` in a shadow root's sheet is never
// collected — and the files the page fetched are the core subset's alone
// (./registry/styles/fonts-core.usage.md). the built runtime carries them inline, which
// ./embed/build-output.spec.ts reads; here the dev server serves the copied files, so each one is a
// request a spec can see.

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

/** the six faces fonts-core ships, as the file names the registry gives them. */
const CORE_FILES = [
	'RedHatRoundDisplay-Bold.woff2',
	'RedHatRoundDisplay-SemiBold.woff2',
	'RedHatRoundText-Bold.woff2',
	'RedHatRoundText-Medium.woff2',
	'RedHatRoundText-Regular.woff2',
	'RedHatRoundText-SemiBold.woff2'
];

describe('the embed’s own faces', () => {
	it('draws the card in the registry’s faces and fetches none outside the core six', async () => {
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

		const list = await vi.waitFor(() => coinList(host), { timeout: 5000 });

		const word = host.shadowRoot?.querySelector('label, p');
		const heading = host.shadowRoot?.querySelector("[part~='heading']");
		const ticker = list.querySelector('.coin-ticker');
		if (word == null || heading == null) throw new Error('the card drew no text');
		if (ticker == null) throw new Error('the coin list drew no ticker');

		expect(getComputedStyle(word).fontFamily).toMatch(/^"?Red Hat Round Text"?,/);
		expect(getComputedStyle(heading).fontFamily).toMatch(/^"?Red Hat Round Display"?,/);
		// Mono is not one of the six, so the ticker draws in the platform monospace its stack falls to.
		expect(getComputedStyle(ticker).fontFamily).toContain('ui-monospace');

		await document.fonts.ready;
		const declared = [...document.fonts].map(
			(face) => `${face.family.replaceAll('"', '')} ${face.weight} ${face.style}`
		);
		expect(declared.sort()).toEqual([
			'Red Hat Round Display 600 normal',
			'Red Hat Round Display 700 normal',
			'Red Hat Round Text 400 normal',
			'Red Hat Round Text 500 normal',
			'Red Hat Round Text 600 normal',
			'Red Hat Round Text 700 normal'
		]);
		const fetched = fontFiles().map((url) => url.slice(url.lastIndexOf('/') + 1).split('?')[0]);
		expect(fetched.length).toBeGreaterThan(0);
		expect(fetched.filter((name) => !CORE_FILES.includes(name ?? ''))).toEqual([]);
	});
});
