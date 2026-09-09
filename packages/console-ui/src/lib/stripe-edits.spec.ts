import { describe, expect, it } from 'vitest';
import { KEY_FIELD } from './stripe-keys';
import { STRIPE_REMOVAL, stripeKeyEdits } from './stripe-edits';

// the two boxes read as an act, which happens before anything leaves this machine.
//
// **what is covered is which act the boxes make, and never whether a key is a key.** the seed
// decides the act — the stored key coming back, a box emptied, a value typed — and that is the
// whole of what this module knows. which slot a value belongs in is read in front of this one and
// covered beside it (`stripeRefusals` in ./stripe-keys.spec.ts), so there is no shape, prefix or
// mode case here and none belongs here.

/**
 * a press over a deployment holding neither key, which is the first setup.
 *
 * what is held is the deployment's own answer and never the form's, so it is handed in here the way
 * the press reads it (../routes/_index.tsx).
 */
const typed = (secret: string, publishable: string, heldSecret = '') => {
	const posted = new FormData();
	posted.set(KEY_FIELD('STRIPE_SECRET_KEY'), secret);
	posted.set(KEY_FIELD('STRIPE_PUBLISHABLE_KEY'), publishable);
	return stripeKeyEdits(posted, { secretKey: heldSecret });
};

/** the secret key such a deployment is holding, which is what its box was drawn with. */
const STORED = 'sk_live_51stored';

/** the same press over a deployment already holding a secret key, which is every one after it. */
const overStored = (secret: string, publishable: string) => typed(secret, publishable, STORED);

describe('stripeKeyEdits', () => {
	it('takes a typed pair as the whole errand, whatever the two strings are', () => {
		expect(typed('sk_live_51abc', 'pk_live_51abc')).toEqual({
			ok: true,
			act: 'errand',
			keys: { secretKey: 'sk_live_51abc', publishableKey: 'pk_live_51abc' }
		});
	});

	/**
	 * the pair goes over as it was typed and Stripe says whether it is one. no shape is read
	 * anywhere on this surface, and none at the binary's door either.
	 */
	it('reads no shape off either box', () => {
		expect(typed('sk', 'pk')).toMatchObject({ ok: true, act: 'errand' });
		expect(typed('pk_live_51abc', 'sk_live_51abc')).toMatchObject({ ok: true, act: 'errand' });
		expect(typed('whsec_51abc', 'whsec_51abc')).toMatchObject({ ok: true, act: 'errand' });
		expect(typed('sk_test_51abc', 'pk_live_51abc')).toMatchObject({ ok: true, act: 'errand' });
	});

	/**
	 * a padded paste is carried rather than repaired: trimming it would store a value that differs
	 * from what the operator pasted, and a space at either end is a character of it. what a padded
	 * key costs is a refusal from Stripe, which is where it is reported.
	 */
	it('carries a key with whitespace around it rather than trimming it', () => {
		expect(typed('sk_test_51abc\n', 'pk_test_51abc')).toEqual({
			ok: true,
			act: 'errand',
			keys: { secretKey: 'sk_test_51abc\n', publishableKey: 'pk_test_51abc' }
		});
	});

	/** an empty box over nothing stored is the first setup, and one press sets up the whole of it. */
	it('refuses an empty box at that box where the deployment holds neither key', () => {
		const read = typed('', 'pk_test_51abc');
		expect(read).toMatchObject({ ok: false });
		if (read.ok) return;
		expect(read.errors.STRIPE_SECRET_KEY).toBe('required');
		expect(read.errors.STRIPE_PUBLISHABLE_KEY).toBeUndefined();
	});

	/**
	 * a box holding nothing but whitespace is an empty box: the deployment reads such a string as
	 * nothing at all (`readConfigEnv` in packages/app/src/lib/server/config/env.ts), so a press
	 * carrying one has nothing to store.
	 */
	it('reads a box holding only whitespace as empty', () => {
		const read = typed('sk_test_51abc', '  ');
		expect(read).toMatchObject({ ok: false });
		if (read.ok) return;
		expect(read.errors.STRIPE_PUBLISHABLE_KEY).toBe('required');
	});

	/**
	 * the box a stored key is drawn in arrives holding that key, and the key coming back unchanged
	 * is the box nobody went near — so the press carries no key to reach Stripe with and is the
	 * publish and nothing else.
	 */
	it('reads the stored key coming back as the box being left alone', () => {
		expect(overStored(STORED, 'pk_test_99xyz')).toEqual({
			ok: true,
			act: 'publish',
			publishableKey: 'pk_test_99xyz'
		});
	});

	/**
	 * what is held is the account's answer and never the form's, so the same string over a
	 * deployment holding nothing is a value somebody typed and runs the whole errand.
	 */
	it('reads that key over a deployment holding none as a value', () => {
		expect(typed(STORED, 'pk_test_51abc')).toMatchObject({ ok: true, act: 'errand' });
	});

	/**
	 * an emptied box over a stored key is a value taken away — the operator had one in front
	 * of them and removed it. the signing secret goes with it: it names an account this deployment
	 * can no longer charge on.
	 */
	it('reads an emptied secret box over a stored key as the removal', () => {
		expect(overStored('', 'pk_test_51abc')).toEqual({ ok: true, act: 'remove' });
	});

	/** the publishable box is not read on a removal: the press publishes nothing either way. */
	it('takes the removal whatever the publishable box holds', () => {
		expect(overStored('', 'not a key at all')).toEqual({ ok: true, act: 'remove' });
		expect(overStored('', '')).toEqual({ ok: true, act: 'remove' });
	});

	/**
	 * the publishable box has no removal: a deployment serving a donation form without that key
	 * takes no money, so an emptied one is refused rather than read as a value taken away.
	 */
	it('refuses an emptied publishable box', () => {
		const read = overStored(STORED, '');
		expect(read).toMatchObject({ ok: false });
		if (read.ok) return;
		expect(read.errors.STRIPE_PUBLISHABLE_KEY).toBe('required');
	});
});

/**
 * the removal's payload, which is the two credentials a Stripe account is reached with and both of
 * them together.
 *
 * a deployment left holding the signing secret alone would go on verifying deliveries for an
 * account nothing can charge on.
 */
describe('STRIPE_REMOVAL', () => {
	it('deletes the secret key and the signing secret and nothing else', () => {
		expect(STRIPE_REMOVAL).toEqual({ STRIPE_SECRET_KEY: null, STRIPE_WEBHOOK_SECRET: null });
	});
});
