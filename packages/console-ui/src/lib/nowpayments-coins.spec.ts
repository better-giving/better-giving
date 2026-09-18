import { describe, expect, it } from 'vitest';
import type { NowpaymentsListing } from '../api/types';
import type { CoinsBox } from './nowpayments-coins';
import {
	COINS_CHOOSE,
	COINS_UNPAYABLE_ACCOUNT,
	COINS_KEY_REFUSED,
	COINS_UNANSWERED,
	COINS_UNKEYED,
	COINS_UNREAD,
	coinsBox,
	coinsLanded,
	coinsTyped
} from './nowpayments-coins';

const listing = (coins: NowpaymentsListing['coins']): NowpaymentsListing => ({
	kind: 'listed',
	detail: '',
	coins
});

const BTC = { code: 'btc', name: 'Bitcoin', network: 'btc' };
const USDC_ETH = { code: 'usdc', name: 'USD Coin', network: 'eth' };
const USDC_MATIC = { code: 'usdcmatic', name: 'USD Coin', network: 'matic' };

/** the coins the box is offering, without the standing choice that cannot be stored. */
const offered = (box: CoinsBox) => box.options.filter((o) => o.value !== '').map((o) => o.value);

/** a key typed, its listing landed. */
const landed = (coins: NowpaymentsListing['coins']) =>
	coinsLanded(coinsTyped(COINS_UNREAD, 'NP1-KEY'), 'NP1-KEY', listing(coins));

describe('a key box holding nothing', () => {
	it('lists nothing and closes the box', () => {
		const read = coinsTyped(COINS_UNREAD, '   ');
		const box = coinsBox(read, '');
		expect(box).toEqual({
			options: [{ value: '', label: COINS_CHOOSE }],
			retired: undefined,
			note: COINS_UNKEYED,
			detail: null,
			disabled: true
		});
	});
});

describe('a landed listing', () => {
	it('offers the coins in the order the binary sent them, and opens the box', () => {
		const box = coinsBox(landed([BTC, USDC_ETH]), 'btc');
		expect(box.options).toEqual([
			{ value: 'btc', label: 'Bitcoin' },
			{ value: 'usdc', label: 'USD Coin' }
		]);
		expect(box.disabled).toBe(false);
		expect(box.note).toBe(null);
	});

	it('names the network only where two coins would read the same', () => {
		const box = coinsBox(landed([BTC, USDC_ETH, USDC_MATIC]), 'btc');
		expect(box.options.map((option) => option.label)).toEqual([
			'Bitcoin',
			'USD Coin (eth)',
			'USD Coin (matic)'
		]);
	});
});

describe('the currency the deployment is holding', () => {
	it('is an offered coin and not also a retired one', () => {
		const box = coinsBox(landed([BTC, USDC_MATIC]), 'usdcmatic');
		expect(box.options.map((option) => option.value)).toContain('usdcmatic');
		expect(box.retired).toBe(undefined);
	});

	it('is kept as the retired option where the list does not offer it', () => {
		const box = coinsBox(landed([BTC]), 'usdcmatic');
		expect(box.retired).toEqual({ value: 'usdcmatic', label: 'usdcmatic' });
	});

	it('is no option at all where the deployment holds none', () => {
		const box = coinsBox(landed([BTC]), '');
		expect(box.retired).toBe(undefined);
	});
});

describe('a listing NOWPayments stopped', () => {
	const stopped = (kind: 'key_refused' | 'unanswered') =>
		coinsBox(
			coinsLanded(coinsTyped(COINS_UNREAD, 'NP1-KEY'), 'NP1-KEY', {
				kind,
				detail: 'API key is invalid',
				coins: []
			}),
			'usdcmatic'
		);

	it('closes the box where the key was turned down', () => {
		const box = stopped('key_refused');
		expect(box.disabled).toBe(true);
		expect(box.note).toBe(COINS_KEY_REFUSED);
		expect(box.detail).toBe('API key is invalid');
	});

	it('says so in its own words where nothing was found out', () => {
		const box = stopped('unanswered');
		expect(box.note).toBe(COINS_UNANSWERED);
		expect(box.detail).toBe('API key is invalid');
	});
});

describe('a key changed under a list already on screen', () => {
	const read = landed([BTC, USDC_ETH]);

	it('leaves the list standing while the next read is in flight', () => {
		const box = coinsBox(coinsTyped(read, 'NP1-OTHER'), '');
		expect(offered(box)).toEqual(['btc', 'usdc']);
		expect(box.disabled).toBe(false);
	});

	it('takes the list down once the key that lists nothing is answered for', () => {
		const next = coinsTyped(read, 'NP1-OTHER');
		const box = coinsBox(
			coinsLanded(next, 'NP1-OTHER', { kind: 'key_refused', detail: 'nope', coins: [] }),
			''
		);
		expect(offered(box)).toEqual([]);
		expect(box.note).toBe(COINS_KEY_REFUSED);
	});

	it('takes the list down the moment the key box is emptied', () => {
		expect(offered(coinsBox(coinsTyped(read, ''), ''))).toEqual([]);
	});

	it('drops an answer to the key it has already moved past', () => {
		const next = coinsTyped(read, 'NP1-OTHER');
		const stale = coinsLanded(next, 'NP1-KEY', listing([USDC_MATIC]));
		expect(stale).toBe(next);
	});
});

describe('a deployment holding no coin yet', () => {
	it('leads the list with a choice that cannot be stored', () => {
		const box = coinsBox(landed([BTC, USDC_ETH]), '');
		expect(box.options).toEqual([
			{ value: '', label: COINS_CHOOSE },
			{ value: 'btc', label: 'Bitcoin' },
			{ value: 'usdc', label: 'USD Coin' }
		]);
	});

	it('offers that choice to no deployment already holding one', () => {
		const box = coinsBox(landed([BTC]), 'btc');
		expect(box.options.map((option) => option.value)).toEqual(['btc']);
	});
});

describe('an account NOWPayments will pay out in nothing', () => {
	it('says so rather than closing the box over silence', () => {
		const box = coinsBox(landed([]), 'usdcmatic');
		expect(offered(box)).toEqual([]);
		expect(box.disabled).toBe(true);
		expect(box.note).toBe(COINS_UNPAYABLE_ACCOUNT);
		expect(box.detail).toBe(null);
	});
});

describe('the stored currency before any list has landed', () => {
	it('stands as an ordinary option rather than one said to be no longer offered', () => {
		const box = coinsBox(coinsTyped(COINS_UNREAD, 'NP1-KEY'), 'usdcmatic');
		expect(box.retired).toBe(undefined);
		expect(box.options).toEqual([{ value: 'usdcmatic', label: 'usdcmatic' }]);
		expect(box.disabled).toBe(true);
	});

	it('stands as an ordinary option where the listing was stopped', () => {
		const read = coinsLanded(coinsTyped(COINS_UNREAD, 'NP1-KEY'), 'NP1-KEY', {
			kind: 'unanswered',
			detail: 'timed out',
			coins: []
		});
		const box = coinsBox(read, 'usdcmatic');
		expect(box.retired).toBe(undefined);
		expect(box.options).toEqual([{ value: 'usdcmatic', label: 'usdcmatic' }]);
	});

	it('is retired only once a listing comes back without it', () => {
		const box = coinsBox(landed([BTC]), 'usdcmatic');
		expect(box.retired).toEqual({ value: 'usdcmatic', label: 'usdcmatic' });
		expect(offered(box)).toEqual(['btc']);
	});
});
