import { describe, expect, it } from 'vitest';
import { processorLinks } from './processor-links';

// the rail's processor cells, away from the rail that draws them: this package has no DOM
// pool (../../vite.config.ts), so the reading is held here or nowhere.

const STRIPE_PAIR = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'];
const PAYPAL_PAIR = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'];

describe('processorLinks', () => {
	it('draws both processors set up where the deployment holds both pairs', () => {
		expect(processorLinks(new Set([...STRIPE_PAIR, ...PAYPAL_PAIR]))).toEqual([
			{ processor: 'stripe', name: 'Stripe', href: '/payments/stripe', notSetUp: false },
			{ processor: 'paypal', name: 'PayPal', href: '/payments/paypal', notSetUp: false }
		]);
	});

	it('marks the one processor whose pair the deployment does not hold', () => {
		const rows = processorLinks(new Set(PAYPAL_PAIR));
		expect(rows.map((row) => [row.name, row.notSetUp])).toEqual([
			['Stripe', true],
			['PayPal', false]
		]);
	});

	/** half a pair takes no gift, so it is not set up. */
	it('marks a processor holding half its pair as not set up', () => {
		const rows = processorLinks(new Set(['STRIPE_SECRET_KEY', ...PAYPAL_PAIR]));
		expect(rows[0]?.notSetUp).toBe(true);
	});

	it('marks both where the deployment holds neither pair', () => {
		expect(processorLinks(new Set()).map((row) => row.notSetUp)).toEqual([true, true]);
	});
});
