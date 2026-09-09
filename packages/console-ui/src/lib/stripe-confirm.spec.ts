import { describe, expect, it } from 'vitest';
import { confirmLines, remakesSetup } from './stripe-confirm';
import { stripeAsked } from './stripe-keys';

// what the confirm states before a press is made.
//
// the property worth holding is the one nothing else can see: a press writes a credential no box
// asked for, so the lines are not the edits. ./stripe-keys.spec.ts covers the reading of the boxes
// themselves and nothing here re-asserts it — every case below goes through `stripeAsked` so the
// two stay one reading.

/** the one name in the payments group nobody types, as ./payments-fold.tsx hands it in. */
const MINTED = ['STRIPE_WEBHOOK_SECRET'];

const lines = (
	boxes: { secret: string; publishable: string },
	seeds: { secret: string; publishable: string },
	held: readonly string[]
) =>
	confirmLines(
		stripeAsked(
			{ STRIPE_SECRET_KEY: boxes.secret, STRIPE_PUBLISHABLE_KEY: boxes.publishable },
			{ STRIPE_SECRET_KEY: seeds.secret, STRIPE_PUBLISHABLE_KEY: seeds.publishable }
		),
		MINTED,
		(name) => held.includes(name)
	);

/** a deployment already set up, which is every press after the first. */
const SECRET = 'sk_live_51stored';
const HOLDING = { secret: SECRET, publishable: 'pk_live_51abc' };
const BOTH = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

/** a deployment holding neither, which is the first setup. */
const NOTHING = { secret: '', publishable: '' };

describe('confirmLines', () => {
	it('states nothing where the press has no act, so no confirm can be opened over it', () => {
		expect(lines(HOLDING, HOLDING, BOTH)).toEqual([]);
	});

	it('states the first setup as both boxes and the secret the press will mint', () => {
		expect(lines({ secret: 'sk_test_1', publishable: 'pk_test_1' }, NOTHING, [])).toEqual([
			{ name: 'STRIPE_SECRET_KEY', act: 'Set' },
			{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Set' },
			{ name: 'STRIPE_WEBHOOK_SECRET', act: 'Set' }
		]);
	});

	/**
	 * the errand over a deployment already set up. the endpoint is registered afresh against the
	 * pair that was pasted, so the secret held for the old one is replaced whether or not anybody
	 * asked — which is the line the boxes cannot carry.
	 */
	it('states a retyped secret key as replacing the signing secret beside it', () => {
		expect(lines({ secret: 'sk_live_2', publishable: HOLDING.publishable }, HOLDING, BOTH)).toEqual(
			[
				{ name: 'STRIPE_SECRET_KEY', act: 'Replaced' },
				{ name: 'STRIPE_WEBHOOK_SECRET', act: 'Replaced' }
			]
		);
	});

	it('states a publish as the one box it is, and never as a credential', () => {
		// such a press carries no key, so no Stripe call is made and the endpoint and the secret
		// proving its deliveries are untouched — a line for either would be an act nothing performs.
		expect(lines({ secret: SECRET, publishable: 'pk_live_new' }, HOLDING, BOTH)).toEqual([
			{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Replaced' }
		]);
	});

	it('states a removal as both credentials, so nobody agrees to keep one this press deletes', () => {
		expect(lines({ secret: '', publishable: HOLDING.publishable }, HOLDING, BOTH)).toEqual([
			{ name: 'STRIPE_SECRET_KEY', act: 'Removed' },
			{ name: 'STRIPE_WEBHOOK_SECRET', act: 'Removed' }
		]);
	});

	it('states no removal of a signing secret the deployment is not holding', () => {
		expect(
			lines({ secret: '', publishable: HOLDING.publishable }, HOLDING, ['STRIPE_SECRET_KEY'])
		).toEqual([{ name: 'STRIPE_SECRET_KEY', act: 'Removed' }]);
	});
});

describe('remakesSetup', () => {
	/**
	 * the defect this covers: a first setup drew a sentence about deleting an endpoint Stripe was
	 * already sending to, over a deployment that had never registered one.
	 */
	it('reads a press that sets every value for the first time as no remake', () => {
		expect(
			remakesSetup([
				{ name: 'STRIPE_SECRET_KEY', act: 'Set' },
				{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Set' },
				{ name: 'STRIPE_WEBHOOK_SECRET', act: 'Set' }
			])
		).toBe(false);
	});

	it('reads a signing secret being replaced as a setup that already works', () => {
		expect(
			remakesSetup([
				{ name: 'STRIPE_SECRET_KEY', act: 'Replaced' },
				{ name: 'STRIPE_WEBHOOK_SECRET', act: 'Replaced' }
			])
		).toBe(true);
	});

	it('reads a press with no lines at all as no remake', () => {
		expect(remakesSetup([])).toBe(false);
	});
});
