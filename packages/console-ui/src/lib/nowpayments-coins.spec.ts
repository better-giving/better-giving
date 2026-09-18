import { describe, expect, it } from 'vitest';
import type { NowpaymentsCoin, NowpaymentsListing } from '../api/types';
import type { CoinsBox } from './nowpayments-coins';
import {
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

/** one coin in every member the binary sends it in. */
const coin = (code: string, ticker: string, name: string, network: string): NowpaymentsCoin => ({
	code,
	ticker,
	name,
	network,
	logo: `https://nowpayments.io/images/coins/${code}.svg`,
	popular: false,
	stablecoin: false
});

const BTC = coin('btc', 'btc', 'Bitcoin', 'btc');
const USDC_ETH = coin('usdc', 'usdc', 'USD Coin', 'eth');
// one ticker over two networks, which is the pair the code and the ticker are two strings on.
const USDC_MATIC = coin('usdcmatic', 'usdc', 'USD Coin', 'matic');

/** the coins the box is offering, by the code each row is stored under. */
const offered = (box: CoinsBox) => box.options.map((option) => option.code);

/** a key typed, its listing landed. */
const landed = (coins: NowpaymentsListing['coins']) =>
	coinsLanded(coinsTyped(COINS_UNREAD, 'NP1-KEY'), 'NP1-KEY', listing(coins));

describe('a key box holding nothing', () => {
	it('lists nothing and closes the box', () => {
		const read = coinsTyped(COINS_UNREAD, '   ');
		const box = coinsBox(read, '');
		expect(box).toEqual({
			options: [],
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
		expect(offered(box)).toEqual(['btc', 'usdc']);
		expect(box.disabled).toBe(false);
		expect(box.note).toBe(null);
	});

	it('hands a row everything it draws, whole', () => {
		// the ticker, the network under it and the picture in front of both are the row; the code is
		// the value and is drawn nowhere, and the name rides along for the search and for the letter a
		// missing picture falls back to.
		const box = coinsBox(landed([USDC_MATIC]), '');
		expect(box.options[0]).toEqual(
			expect.objectContaining({
				code: 'usdcmatic',
				ticker: 'usdc',
				name: 'USD Coin',
				network: 'matic',
				logo: 'https://nowpayments.io/images/coins/usdcmatic.svg'
			})
		);
	});

	it('leaves two coins of one ticker two rows, with nothing composed to tell them apart', () => {
		// the select this box replaced had to append the network to a repeated name to keep the two
		// readable. the row draws the ticker and the network itself, so there is nothing to compose.
		const box = coinsBox(landed([BTC, USDC_ETH, USDC_MATIC]), 'btc');
		expect(box.options.map((option) => [option.ticker, option.network])).toEqual([
			['btc', 'btc'],
			['usdc', 'eth'],
			['usdc', 'matic']
		]);
	});
});

describe('the currency the deployment is holding', () => {
	it('is an offered coin and not also a retired one', () => {
		const box = coinsBox(landed([BTC, USDC_MATIC]), 'usdcmatic');
		expect(offered(box)).toContain('usdcmatic');
		expect(box.retired).toBe(undefined);
	});

	it('is kept as the retired option where the list does not offer it', () => {
		const box = coinsBox(landed([BTC]), 'usdcmatic');
		// no ticker, because no listing named one: the row falls back to the code, which is the only
		// name this coin has here.
		expect(box.retired).toEqual({
			code: 'usdcmatic',
			ticker: '',
			name: 'usdcmatic',
			network: '',
			logo: ''
		});
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
	it('offers coins and nothing else', () => {
		// choosing nothing is the closed box's own placeholder and not a line of the list: a row
		// standing for no coin is a row that can be landed on, and a press over it would store the
		// empty string on purpose rather than by not having chosen.
		const box = coinsBox(landed([BTC, USDC_ETH]), '');
		expect(offered(box)).toEqual(['btc', 'usdc']);
		expect(box.options.every((option) => option.code !== '')).toBe(true);
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
		expect(offered(box)).toEqual(['usdcmatic']);
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
		expect(offered(box)).toEqual(['usdcmatic']);
	});

	it('is retired only once a listing comes back without it', () => {
		const box = coinsBox(landed([BTC]), 'usdcmatic');
		// and leaves the list itself, because the control appends the retired coin after it.
		expect(box.retired?.code).toBe('usdcmatic');
		expect(offered(box)).toEqual(['btc']);
	});
});
