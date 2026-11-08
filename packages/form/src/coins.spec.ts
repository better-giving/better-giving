import { describe, expect, it } from 'vitest';
import { searchCoins } from './coins';

// node pool: which coins a typed search lists, and in what order, is a pure reading of the list
// ./connect.ts projects and the text in the box.

const COINS = [
	{ value: 'btc', label: 'BTC', name: 'Bitcoin' },
	{ value: 'luna', label: 'LUNA', name: 'Terra' },
	{ value: 'sol', label: 'SOL', name: 'Solana' },
	{ value: 'usdttrc20', label: 'USDT', name: 'Tether USD (Tron)' },
	{ value: 'xrp', label: 'XRP', name: 'Ripple' }
];

const tickers = (query: string) => searchCoins(COINS, query).map((coin) => coin.label);

describe('the coin search', () => {
	it('lists every coin in the order given while nothing is typed', () => {
		expect(tickers('')).toEqual(['BTC', 'LUNA', 'SOL', 'USDT', 'XRP']);
		expect(tickers('  ')).toEqual(['BTC', 'LUNA', 'SOL', 'USDT', 'XRP']);
	});

	it('ignores case and finds text anywhere in the ticker, the name or the code', () => {
		expect(tickers('TETH')).toEqual(['USDT']);
		expect(tickers('tron')).toEqual(['USDT']);
		expect(tickers('trc20')).toEqual(['USDT']);
	});

	it('ranks an exact ticker, then a ticker prefix, then a name prefix, then any match', () => {
		const coins = [
			{ value: 'aaa', label: 'ABS', name: 'Something' },
			{ value: 'bbb', label: 'XAB', name: 'Other' },
			{ value: 'ccc', label: 'ZZZ', name: 'Absolute' },
			{ value: 'ddd', label: 'AB', name: 'Exact' }
		];
		expect(searchCoins(coins, 'ab').map((coin) => coin.label)).toEqual(['AB', 'ABS', 'ZZZ', 'XAB']);
		expect(tickers('s')).toEqual(['SOL', 'USDT']);
	});

	it('lists nothing where nothing matches', () => {
		expect(tickers('doge')).toEqual([]);
	});
});
