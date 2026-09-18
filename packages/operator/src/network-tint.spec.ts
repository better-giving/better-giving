import { describe, expect, it } from 'vitest';
import { NETWORK_TINTS, networkTint } from './network-tint';

// the palette index a network's pill takes. what is asserted is what the pill rests on: an answer
// for every string, the same answer every time, and an answer inside the palette.
//
// it asserts nothing against packages/form/src/coins.ts's function of the same shape. the two are
// independent — two design systems, two token files, no import in either direction — so a case
// holding them to the same answer would be inventing a contract this repository does not have.

describe('the entry a network is painted in', () => {
	it('is inside the palette for every network a listing could name', () => {
		const networks = ['btc', 'eth', 'matic', 'bsc', 'sol', 'trx', 'arbitrum', 'base', '', 'ξ'];

		for (const network of networks) {
			const tint = networkTint(network);
			expect(Number.isInteger(tint)).toBe(true);
			expect(tint).toBeGreaterThanOrEqual(0);
			expect(tint).toBeLessThan(NETWORK_TINTS);
		}
	});

	it('is the same answer every time it is asked', () => {
		expect(networkTint('matic')).toBe(networkTint('matic'));
	});

	it('reads the same network written in either case, with space around it', () => {
		// the words are the processor's own and arrive as it spells them, so a listing that starts
		// spelling a chain `ETH` must not repaint every row that names it.
		expect(networkTint('  ETH ')).toBe(networkTint('eth'));
	});

	it('spreads a real listing over more than one entry', () => {
		// a hash that answered the same for every network would satisfy every case above and paint a
		// list one colour, which is the whole of what the pill is for.
		const networks = ['btc', 'eth', 'matic', 'bsc', 'sol', 'trx', 'ton', 'avax'];

		expect(new Set(networks.map(networkTint)).size).toBeGreaterThan(2);
	});
});
