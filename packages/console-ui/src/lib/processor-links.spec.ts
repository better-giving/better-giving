import { describe, expect, it } from 'vitest';
import { processorLinks } from './processor-links';

// the rail's processor cells, away from the rail that draws them: this package has no DOM
// pool (../../vite.config.ts), so the reading is held here or nowhere.

const STRIPE_PAIR = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'];
const PAYPAL_PAIR = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'];
const CHARIOT_PAIR = ['CHARIOT_API_KEY', 'CHARIOT_CONNECT_ID'];
const NOWPAYMENTS_PAIR = ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_OUTCOME_CURRENCY'];

describe('processorLinks', () => {
	it('draws every processor set up where the deployment holds every pair', () => {
		const held = new Set([...STRIPE_PAIR, ...PAYPAL_PAIR, ...CHARIOT_PAIR, ...NOWPAYMENTS_PAIR]);
		expect(processorLinks(held)).toEqual([
			{ processor: 'stripe', name: 'Stripe', href: '/payments/stripe', notSetUp: false },
			{ processor: 'paypal', name: 'PayPal', href: '/payments/paypal', notSetUp: false },
			{ processor: 'chariot', name: 'Chariot', href: '/payments/chariot', notSetUp: false },
			{
				processor: 'nowpayments',
				name: 'NOWPayments',
				href: '/payments/nowpayments',
				notSetUp: false
			}
		]);
	});

	it('marks the one processor whose pair the deployment does not hold', () => {
		const rows = processorLinks(new Set(PAYPAL_PAIR));
		expect(rows.map((row) => [row.name, row.notSetUp])).toEqual([
			['Stripe', true],
			['PayPal', false],
			['Chariot', true],
			['NOWPayments', true]
		]);
	});

	/** half a pair takes no gift, so it is not set up. */
	it('marks a processor holding half its pair as not set up', () => {
		const rows = processorLinks(new Set(['STRIPE_SECRET_KEY', ...PAYPAL_PAIR]));
		expect(rows[0]?.notSetUp).toBe(true);
	});

	/** the connect id is what the key fetched, so a key alone takes no gift either. */
	it('marks Chariot holding its key without its connect id as not set up', () => {
		const rows = processorLinks(new Set(['CHARIOT_API_KEY', 'CHARIOT_API_URL']));
		expect(rows[2]?.notSetUp).toBe(true);
	});

	it('marks every processor where the deployment holds no pair', () => {
		expect(processorLinks(new Set()).map((row) => row.notSetUp)).toEqual([true, true, true, true]);
	});
});
