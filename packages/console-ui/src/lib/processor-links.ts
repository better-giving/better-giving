import type { DeployVarName, PaymentProcessor } from '../api/types';
import { WALLET_NAMES } from './wallet-rows';

// the rows the donation processor fold draws, one per processor, each a way to that processor's
// own screen.
//
// **it is a module and not an expression in the list**, for ./processor-payments.ts's reason: this
// package has no DOM pool (../../vite.config.ts), so a reading written inside a component is one
// nothing here can hold.
//
// **whether a row says `Not set up` is read off the held values and nothing else.** the deployment
// takes a gift on a processor whose pair it holds (`CHARGE_PAIRS` in
// packages/app/src/lib/server/config/readiness.ts), and the list is drawn before any reading of the
// account has landed — so a row waiting on a promise would be a list that says nothing while the
// deployment is asked.
//
// nothing here reaches a network.

/** one processor's row on the list. */
export type ProcessorLink = {
	readonly name: string;
	readonly href: string;
	readonly notSetUp: boolean;
	/** the ways of paying this processor can take gifts on, joined for one line. */
	readonly takes: string;
};

/**
 * the pair each processor charges on, which is the deployment's own reading of whether it can take
 * a gift there. ./home-sections.ts reads the fold's word off the same pairs.
 */
export const CHARGE_PAIRS: Record<PaymentProcessor, readonly DeployVarName[]> = {
	stripe: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
	paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']
};

/**
 * what each processor is called, where its screen is, and what it takes.
 *
 * `takes` is fixed per processor rather than read off the rails report: the list is drawn with no
 * reading of the account, and what a processor can take is the product's rather than the account's.
 * Card and Bank account are the donation form's own words for the two (`PAYMENT_METHOD_LABELS` in
 * packages/form/src/v1.ts), and the three wallets are the Stripe screen's own row labels.
 */
const PROCESSORS: Record<
	PaymentProcessor,
	{ name: string; href: string; takes: readonly string[] }
> = {
	stripe: {
		name: 'Stripe',
		href: '/payments/stripe',
		takes: [
			'Card',
			'Bank account',
			WALLET_NAMES.apple_pay,
			WALLET_NAMES.google_pay,
			WALLET_NAMES.link
		]
	},
	paypal: { name: 'PayPal', href: '/payments/paypal', takes: ['PayPal', 'Venmo'] }
};

/** the order the rows stand in, which is the order the deployment reports processors in. */
const ORDER: readonly PaymentProcessor[] = ['stripe', 'paypal'];

/**
 * one row per processor.
 *
 * `held` is every name the deployment holds a value under, a withheld one included: its value
 * cannot be drawn in a box, and it is set all the same (./held-values.ts).
 */
export function processorLinks(held: ReadonlySet<string>): ProcessorLink[] {
	return ORDER.map((processor) => {
		const { name, href, takes } = PROCESSORS[processor];
		return {
			name,
			href,
			notSetUp: !CHARGE_PAIRS[processor].every((value) => held.has(value)),
			takes: takes.join(', ')
		};
	});
}
