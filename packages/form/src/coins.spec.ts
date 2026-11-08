import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NETWORK_BADGES, networkTint, searchCoins } from './coins';

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

describe('the network tint', () => {
	it('is one of the registry’s five badge variants', () => {
		const badgeCss = readFileSync(
			new URL('./registry/styles/badge-css.css', import.meta.url),
			'utf8'
		);
		const variants = [...badgeCss.matchAll(/^\.ds-badge-([\w-]+) \{/gm)].map(([, name]) => name);
		expect([...NETWORK_BADGES].sort()).toEqual(variants.sort());
	});

	it('answers one of the badges for any string at all', () => {
		for (const network of ['Tron', 'Ethereum', '', '  ', '💠', 'a network minted tomorrow']) {
			expect(NETWORK_BADGES).toContain(networkTint(network));
		}
	});

	it('answers the same badge for the same network every time, whatever its case or padding', () => {
		expect(networkTint('Tron')).toBe(networkTint('Tron'));
		expect(networkTint('  tron ')).toBe(networkTint('Tron'));
	});

	it('spreads the networks a deployment actually lists across the badges', () => {
		// a rule that answered one badge for everything would pass the two claims above and paint
		// every pill one colour.
		const networks = ['Tron', 'Ethereum', 'Bitcoin', 'Solana', 'Ripple', 'BNB Smart Chain'];
		expect(new Set(networks.map(networkTint)).size).toBeGreaterThan(1);
	});
});
