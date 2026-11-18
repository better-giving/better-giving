import { describe, expect, it } from 'vitest';
import { unitRails, unitWords } from './unit';
import type { FormConfig } from './v1';

// node pool: which groups the unit list draws and the words it says are a reading of the served
// config and nothing else, so the deployments the spec names are four configs and no DOM.

const CARD_ONLY: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_x' }],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
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
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

const WITH_COINS: FormConfig = {
	...CARD_ONLY,
	paymentMethods: ['card', 'crypto'],
	coins: [{ coin: 'btc', ticker: 'btc', name: 'Bitcoin', network: 'Bitcoin', memoRequired: false }]
};

describe('which groups the unit list draws', () => {
	it('draws currencies alone, and so no control, on a deployment taking one currency and no coin', () => {
		expect(unitRails(CARD_ONLY)).toEqual({ coins: false, stocks: false, chooses: false });
	});

	it('draws the crypto group where the served config lists a coin', () => {
		expect(unitRails(WITH_COINS)).toEqual({ coins: true, stocks: false, chooses: true });
	});

	// a coin list served beside no crypto rail is one nothing can be quoted on.
	it('draws no crypto group where the deployment offers no crypto rail', () => {
		expect(unitRails({ ...WITH_COINS, paymentMethods: ['card'] }).coins).toBe(false);
	});

	// a coin gift is one-time, and a cadence the deployment cannot charge is never offered.
	it('draws no crypto group where the deployment takes no one-time gift', () => {
		expect(unitRails({ ...WITH_COINS, frequencies: ['monthly'] })).toEqual({
			coins: false,
			stocks: false,
			chooses: false
		});
	});
});

describe('the words the unit list says', () => {
	it.each([
		[
			{ coins: true, stocks: true },
			{
				placeholder: 'Search for currency, crypto token, or stock ticker',
				hint: 'Currencies, crypto and stocks',
				noMatch: 'No currency, coin or stock matches.'
			}
		],
		[
			{ coins: true, stocks: false },
			{
				placeholder: 'Search for currency or crypto token',
				hint: 'Currencies and crypto',
				noMatch: 'No currency or coin matches.'
			}
		],
		[
			{ coins: false, stocks: true },
			{
				placeholder: 'Search for currency or stock ticker',
				hint: 'Currencies and stocks',
				noMatch: 'No currency or stock matches.'
			}
		],
		[
			{ coins: false, stocks: false },
			{ placeholder: 'Search for currency', hint: '', noMatch: 'No currency matches.' }
		]
	])('names only what the deployment takes: %o', (rails, words) => {
		expect(unitWords(rails)).toEqual(words);
	});
});
