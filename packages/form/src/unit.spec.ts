import { describe, expect, it } from 'vitest';
import {
	coinRefusalSentence,
	continueCase,
	currencyOf,
	noStockMatch,
	unitKey,
	unitOfKey,
	unitPill,
	STOCK_SEARCH_FAILED
} from './unit';
import type { FormConfig, PaymentMethod } from './v1';

// node pool: the first step's words and the readings drawn from them, with no DOM. the element and
// the deployment's own donation page draw from these and from `connect` alone.

const BTC = {
	coin: 'btc',
	ticker: 'btc',
	name: 'Bitcoin',
	network: 'Bitcoin',
	memoRequired: false,
	logo: 'https://example.test/coins/btc.svg'
};
const ETH = {
	coin: 'eth',
	ticker: 'eth',
	name: 'Ethereum',
	network: 'Ethereum',
	memoRequired: false
};

const CONFIG = {
	currency: 'usd',
	locale: 'en-US',
	paymentMethods: ['card', 'ach', 'crypto', 'stock'],
	coins: [ETH, BTC]
} as unknown as FormConfig;

const BOTH = { coin: true, stock: true };

describe('the unit pill', () => {
	it('is plain text where the deployment offers its currency alone', () => {
		expect(unitPill(CONFIG, { coin: false, stock: false }, undefined)).toEqual({
			state: 'text',
			code: 'USD',
			name: 'USD',
			marks: []
		});
	});

	it('names the kinds the deployment takes besides its currency until the donor picks', () => {
		const name = (offered: { coin: boolean; stock: boolean }) =>
			unitPill(CONFIG, offered, undefined).name;

		expect(name(BOTH)).toBe('Currency: USD. Also crypto and stocks');
		expect(name({ coin: true, stock: false })).toBe('Currency: USD. Also crypto');
		expect(name({ coin: false, stock: true })).toBe('Currency: USD. Also stocks');
		expect(unitPill(CONFIG, BOTH, undefined).state).toBe('initial');
	});

	it('stacks the flag, then a BTC coin and the Apple mark for the kinds offered', () => {
		expect(unitPill(CONFIG, BOTH, undefined).marks).toEqual([
			{ mark: 'flag', country: 'us' },
			{ mark: 'logo', src: BTC.logo },
			{ mark: 'apple' }
		]);
		expect(unitPill(CONFIG, { coin: false, stock: true }, undefined).marks).toEqual([
			{ mark: 'flag', country: 'us' },
			{ mark: 'apple' }
		]);
	});

	it('stacks no flag for a currency the table has none for', () => {
		const yen = { ...CONFIG, currency: 'jpy' } as FormConfig;
		expect(unitPill(yen, { coin: false, stock: true }, undefined).marks).toEqual([
			{ mark: 'apple' }
		]);
	});

	it('names and marks the picked unit alone, the currency included', () => {
		expect(unitPill(CONFIG, BOTH, { kind: 'currency' })).toEqual({
			state: 'picked',
			code: 'USD',
			name: 'Currency: USD',
			marks: [{ mark: 'flag', country: 'us' }]
		});
		expect(unitPill(CONFIG, BOTH, { kind: 'coin', coin: 'btc' })).toEqual({
			state: 'picked',
			code: 'BTC',
			name: 'Crypto: BTC',
			marks: [{ mark: 'logo', src: BTC.logo }]
		});
		expect(unitPill(CONFIG, BOTH, { kind: 'stock', ticker: 'AAPL' })).toEqual({
			state: 'picked',
			code: 'AAPL',
			name: 'Stock: AAPL',
			marks: [{ mark: 'apple' }]
		});
	});

	// held for a decision: a 14px disc with no flag or logo draws no letter, so the pill carries no mark.
	it('carries no mark for a coin with no logo or a ticker other than AAPL', () => {
		expect(unitPill(CONFIG, BOTH, { kind: 'coin', coin: 'eth' }).marks).toEqual([]);
		expect(unitPill(CONFIG, BOTH, { kind: 'stock', ticker: 'AAL' }).marks).toEqual([]);
	});
});

describe('the currency table', () => {
	it('names the US dollar and maps the three flagged currencies to their country', () => {
		expect(currencyOf('usd', 'en-US')).toEqual({ code: 'USD', name: 'US dollar', country: 'us' });
		expect(currencyOf('EUR', 'en-US')).toMatchObject({ code: 'EUR', country: 'eu' });
		expect(currencyOf('gbp', 'en-US')).toMatchObject({ code: 'GBP', country: 'gb' });
	});

	it('has neither flag nor name of its own for any other code, and reads the name from Intl', () => {
		const yen = currencyOf('jpy', 'en-US');
		expect(yen).toEqual({
			code: 'JPY',
			name: new Intl.DisplayNames('en-US', { type: 'currency' }).of('JPY')
		});
		expect(yen.name).not.toBe('JPY');
	});
});

describe('the unit keys a list option carries', () => {
	it('reads back each kind of unit it writes, and nothing else', () => {
		for (const unit of [
			{ kind: 'currency' },
			{ kind: 'coin', coin: 'usdttrc20' },
			{ kind: 'stock', ticker: 'BRK.B' }
		] as const) {
			expect(unitOfKey(unitKey(unit))).toEqual(unit);
		}
		expect(unitOfKey('')).toBeNull();
		expect(unitOfKey('coin:')).toBeNull();
		expect(unitOfKey('bond:x')).toBeNull();
	});
});

describe('the in-group sentences', () => {
	it('quotes what the donor typed when no stock matches it', () => {
		expect(noStockMatch('zzq')).toBe('No match for “zzq”. Try a name or a ticker.');
		expect(STOCK_SEARCH_FAILED).toBe('Couldn’t search stocks. Try again in a moment.');
	});
});

describe('a coin refusal beside the entry', () => {
	it('keeps the amount refusals’ words, naming the coin by its listed name or its code', () => {
		const say = (refusal: Parameters<typeof coinRefusalSentence>[0]) =>
			coinRefusalSentence(refusal, CONFIG);

		expect(say({ code: 'above_maximum', coin: 'btc' })).toBe(
			'Enter a smaller amount for Bitcoin, or choose another coin'
		);
		expect(say({ code: 'below_minimum', coin: 'btc' })).toBe(
			'Enter a larger amount for Bitcoin, or choose another coin'
		);
		expect(say({ code: 'below_minimum', coin: 'doge', minAmountMinor: 1200 })).toBe(
			'Enter at least $12 in DOGE, or choose another coin'
		);
		expect(say({ code: 'coin_not_accepted', coin: 'btc' })).toBe('no longer accepted');
	});
});

describe('the Continue on the first step', () => {
	const withRails = (paymentMethods: readonly PaymentMethod[]) =>
		({ ...CONFIG, paymentMethods }) as FormConfig;

	it('names the payment step and lists its methods in order, crypto and stock never among them', () => {
		const config = withRails(['venmo', 'stock', 'ira_qcd', 'card', 'crypto', 'ach']);
		expect(continueCase(config, false)).toEqual({
			case: 'methods',
			label: 'Continue',
			eyebrow: 'Next: payment',
			name: 'Continue to payment',
			description: 'Payment methods on the next step: Card, Bank account, Venmo, IRA (QCD)',
			methods: [
				{ method: 'card', label: 'Card' },
				{ method: 'ach', label: 'Bank account' },
				{ method: 'venmo', label: 'Venmo' },
				{ method: 'ira_qcd', label: 'IRA (QCD)' }
			]
		});
	});

	it('keeps the eyebrow where one method is configured', () => {
		expect(continueCase(withRails(['card']), false)).toMatchObject({
			case: 'one-method',
			eyebrow: 'Next: payment',
			description: 'Payment methods on the next step: Card',
			methods: [{ method: 'card', label: 'Card' }]
		});
	});

	it('is a plain Continue for a coin or stock gift, which skips the payment step', () => {
		expect(continueCase(CONFIG, true)).toEqual({ case: 'in-kind', label: 'Continue' });
	});
});
