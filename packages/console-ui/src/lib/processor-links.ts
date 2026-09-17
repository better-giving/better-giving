import type { DeployVarName, PaymentProcessor } from '../api/types';

// the processors the rail lists under its donation processor heading, each a way to that
// processor's own page (./console-pages.ts).
//
// **it is a module and not an expression in the rail**, for ./processor-payments.ts's reason: this
// package has no DOM pool (../../vite.config.ts), so a reading written inside a component is one
// nothing here can hold.
//
// **whether a processor is set up is read off the held values and nothing else.** the deployment
// takes a gift on a processor whose pair it holds (`CHARGE_PAIRS` in
// packages/app/src/lib/server/config/readiness.ts), and the rail is drawn before any reading of the
// account has landed — so a cell waiting on a promise would be a rail that says nothing while the
// deployment is asked.
//
// nothing here reaches a network.

/** one processor's cell on the rail. */
export type ProcessorLink = {
	readonly processor: PaymentProcessor;
	readonly name: string;
	readonly href: string;
	readonly notSetUp: boolean;
};

/**
 * the pair each processor charges on, which is the deployment's own reading of whether it can take
 * a gift there. ./home-sections.ts reads the fold's word off the same pairs.
 *
 * Chariot's pair is the key and the Connect id the key fetched, rather than the key and the address:
 * a blank address is live, so the address is no half of anything.
 */
export const CHARGE_PAIRS: Record<PaymentProcessor, readonly DeployVarName[]> = {
	stripe: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
	paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
	chariot: ['CHARIOT_API_KEY', 'CHARIOT_CONNECT_ID'],
	nowpayments: ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_OUTCOME_CURRENCY']
};

/** what each processor is called and where its page is. */
export const PROCESSORS: Record<PaymentProcessor, { name: string; href: string }> = {
	stripe: { name: 'Stripe', href: '/payments/stripe' },
	paypal: { name: 'PayPal', href: '/payments/paypal' },
	chariot: { name: 'Chariot', href: '/payments/chariot' },
	nowpayments: { name: 'NOWPayments', href: '/payments/nowpayments' }
};

/** the order the cells stand in, which is the order the deployment reports processors in. */
const ORDER = [
	'stripe',
	'paypal',
	'chariot',
	'nowpayments'
] as const satisfies readonly PaymentProcessor[];

/**
 * one cell per processor.
 *
 * `held` is every name the deployment holds a value under, a withheld one included: its value
 * cannot be drawn in a box, and it is set all the same (./held-values.ts).
 */
export function processorLinks(held: ReadonlySet<string>): ProcessorLink[] {
	return ORDER.map((processor) => {
		const { name, href } = PROCESSORS[processor];
		return {
			processor,
			name,
			href,
			notSetUp: !CHARGE_PAIRS[processor].every((value) => held.has(value))
		};
	});
}
