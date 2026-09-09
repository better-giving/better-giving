import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS, WALLET_METHODS } from '@better-giving/form/v1';
import { OFFERED_PAYMENT_METHODS } from './offered-rails';

describe('OFFERED_PAYMENT_METHODS', () => {
	it('offers the card, the bank rail and both wallets', () => {
		expect(OFFERED_PAYMENT_METHODS).toEqual(['card', 'ach', 'apple_pay', 'google_pay']);
	});

	it('offers only members of the `v1` vocabulary', () => {
		for (const method of OFFERED_PAYMENT_METHODS) {
			expect(PAYMENT_METHODS).toContain(method);
		}
	});

	/**
	 * a wallet is offered only where the rail it is delivered as is, asserted rather than left to
	 * the comment.
	 *
	 * the provider draws a wallet inside its own box off the `card` the element group already
	 * carries (`RAILS` in packages/form/src/embed/rails.ts), so a list naming a wallet with nothing
	 * that settles as a card would offer a rail no group can draw and no intent can be minted for.
	 */
	it('offers no wallet without the rail it settles as', () => {
		const offersWallet = WALLET_METHODS.some((wallet) => OFFERED_PAYMENT_METHODS.includes(wallet));
		if (!offersWallet) return;
		expect(OFFERED_PAYMENT_METHODS).toContain('card');
	});

	/**
	 * one order in the repository, and it is the vocabulary's.
	 *
	 * `parseConfig` in packages/form/src/config.ts re-orders every list it is served into
	 * `PAYMENT_METHODS`' order, so a list written in any other order is one the donation form
	 * discards and the operator console keeps — two screens naming the same rails differently, with
	 * nothing on either saying which is the real one. it also fixes what the fee row is priced
	 * against for a donor who has picked nothing yet: `displayRail` in
	 * packages/form/src/checkout.machine.ts reads the first rail on offer, and that is the card.
	 */
	it('is in the vocabulary’s own order, opening with the card', () => {
		const offered = [...OFFERED_PAYMENT_METHODS];
		expect(offered).toEqual(PAYMENT_METHODS.filter((method) => offered.includes(method)));
		expect(offered[0]).toBe('card');
	});
});
