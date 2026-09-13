import { parseWithZod } from '@conform-to/zod/v4';
import { describe, expect, it } from 'vitest';
import { KEY_FIELD, stripeAsked, stripeForm, stripeGap, stripeRefusals } from './stripe-keys';

// what the two key boxes are asking for and what each is told back, read against the seeds they
// were drawn with.
//
// **the act is the reading both ends make.** the screen computes it to itemise the confirm, and
// ./stripe-edits.ts makes the same reading of the body — so a disagreement between them is a
// confirm stating an act the press does not make. what arms the press is neither of them and is the
// form layer's own (./use-console-form.ts), because one box can ask for something no act performs
// and a button armed off the act would rest closed over it. this package's pool collects
// `*.spec.ts` only (../../vite.config.ts), which is why the reading is a module here rather than a
// function inside the fold.
//
// the seeds are what ./stripe-section.tsx draws the boxes with: both keys are plain vars and the
// account hands each value back, so each box arrives holding the key the deployment is holding.

const asked = (
	secret: string,
	publishable: string,
	seeds: { secret: string; publishable: string }
) =>
	stripeAsked(
		{ STRIPE_SECRET_KEY: secret, STRIPE_PUBLISHABLE_KEY: publishable },
		{ STRIPE_SECRET_KEY: seeds.secret, STRIPE_PUBLISHABLE_KEY: seeds.publishable }
	);

/** the secret key a deployment already holding one is holding, which is what its box is drawn with. */
const SECRET = 'sk_live_51stored';

/** a deployment already holding both, which is every press after the first. */
const HOLDING = { secret: SECRET, publishable: 'pk_live_51abc' };

/** a deployment holding neither, which is the first setup. */
const NOTHING = { secret: '', publishable: '' };

describe('stripeAsked', () => {
	it('asks for nothing where neither box differs from its seed', () => {
		expect(asked(SECRET, 'pk_live_51abc', HOLDING)).toEqual({ act: null, edits: [] });
	});

	it('asks for nothing on an untouched form over a deployment holding neither key', () => {
		expect(asked('', '', NOTHING)).toEqual({ act: null, edits: [] });
	});

	/**
	 * the first setup: both boxes typed over a deployment holding nothing, and the press is the
	 * whole errand.
	 */
	it('reads two typed keys over nothing held as the errand', () => {
		expect(asked('sk_live_51abc', 'pk_live_51abc', NOTHING)).toEqual({
			act: 'errand',
			edits: [
				{ name: 'STRIPE_SECRET_KEY', act: 'Set' },
				{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Set' }
			]
		});
	});

	/**
	 * a retyped secret key is the whole errand again whatever the other box holds: every call the
	 * chain makes is made with it, and what was provisioned belongs to whatever pair came before.
	 */
	it('reads a retyped secret key as the errand, and states the untouched box as no edit', () => {
		expect(asked('sk_live_99xyz', 'pk_live_51abc', HOLDING)).toEqual({
			act: 'errand',
			edits: [{ name: 'STRIPE_SECRET_KEY', act: 'Replaced' }]
		});
	});

	it('carries the publishable row on an errand that changes it too', () => {
		expect(asked('sk_live_99xyz', 'pk_live_99xyz', HOLDING)).toEqual({
			act: 'errand',
			edits: [
				{ name: 'STRIPE_SECRET_KEY', act: 'Replaced' },
				{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Replaced' }
			]
		});
	});

	/**
	 * the untouched secret key is what makes this the cheap press: the press carries no key, so no
	 * Stripe call is possible and the run is the deploy alone.
	 */
	it('reads a changed publishable key under an untouched secret key as publish', () => {
		expect(asked(SECRET, 'pk_live_99xyz', HOLDING)).toEqual({
			act: 'publish',
			edits: [{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Replaced' }]
		});
	});

	it('reads a first publishable key under an untouched secret key as publish', () => {
		expect(asked(SECRET, 'pk_live_51abc', { secret: SECRET, publishable: '' })).toEqual({
			act: 'publish',
			edits: [{ name: 'STRIPE_PUBLISHABLE_KEY', act: 'Set' }]
		});
	});

	/**
	 * an emptied box over a stored key is the removal, and it is the whole press: what the
	 * other box holds is not read, so the confirm states exactly what the press does.
	 */
	it('reads an emptied secret box as the removal and ignores the other box', () => {
		expect(asked('', 'pk_live_99xyz', HOLDING)).toEqual({
			act: 'remove',
			edits: [{ name: 'STRIPE_SECRET_KEY', act: 'Removed' }]
		});
	});

	it('asks for nothing where the secret box is empty and there is nothing to remove', () => {
		expect(asked('', 'pk_live_51abc', { secret: '', publishable: 'pk_live_51abc' })).toEqual({
			act: null,
			edits: []
		});
	});

	/**
	 * the publishable box has no removal — a deployment serving a donation form without that key
	 * takes no money — so the act is dropped rather than carried into a press that would ignore it.
	 * what that box gets instead is the refusal below, reached by a press the emptied box arms.
	 */
	it('asks for nothing where the publishable box is emptied over a stored key', () => {
		expect(asked(SECRET, '', HOLDING)).toEqual({ act: null, edits: [] });
	});

	/** and the removal is still the whole press with that box emptied beside it. */
	it('reads both boxes emptied as the removal alone', () => {
		expect(asked('', '', HOLDING)).toEqual({
			act: 'remove',
			edits: [{ name: 'STRIPE_SECRET_KEY', act: 'Removed' }]
		});
	});

	/**
	 * a box holding nothing but whitespace asks for neither. the values are never trimmed, and
	 * ./stripe-edits.ts refuses such a box — so reading it as a value would state an act in the
	 * confirm that the press cannot make. the press is armed all the same, and turned down at the
	 * box below.
	 */
	it('asks for nothing where a box holds only whitespace', () => {
		expect(asked('   ', '  ', HOLDING)).toEqual({ act: null, edits: [] });
	});

	it('asks for nothing where a box holds only whitespace over a deployment holding neither', () => {
		expect(asked(' ', ' ', NOTHING)).toEqual({ act: null, edits: [] });
	});
});

describe('the box a press is turned down at', () => {
	const gap = (
		secret: string,
		publishable: string,
		seeds: { secret: string; publishable: string }
	) =>
		stripeGap(
			{ STRIPE_SECRET_KEY: secret, STRIPE_PUBLISHABLE_KEY: publishable },
			{ STRIPE_SECRET_KEY: seeds.secret, STRIPE_PUBLISHABLE_KEY: seeds.publishable }
		);

	/**
	 * the defect this exists for: one box filled on a deployment holding neither key, and a press
	 * that would store half a pair — a fold reading as set up over a deployment that takes no money.
	 */
	it('names the secret key where only the publishable box was filled in', () => {
		expect(gap('', 'pk_live_51abc', NOTHING)).toBe('STRIPE_SECRET_KEY');
	});

	it('names the publishable key where only the secret box was filled in', () => {
		expect(gap('sk_live_51abc', '', NOTHING)).toBe('STRIPE_PUBLISHABLE_KEY');
	});

	it('names nothing where the press leaves the deployment holding both', () => {
		expect(gap('sk_live_51abc', 'pk_live_51abc', NOTHING)).toBe(null);
	});

	/**
	 * the other half of the pair is already stored, so a press over one box leaves both held. the
	 * secret box holding the mark is the value nobody went near.
	 */
	it('names nothing where the deployment already holds the other one', () => {
		expect(gap('sk_live_51xyz', 'pk_live_51abc', HOLDING)).toBe(null);
		expect(gap(SECRET, 'pk_live_51xyz', HOLDING)).toBe(null);
	});

	/**
	 * the publishable box standing empty is named whatever the press is, because no press leaves
	 * that key where it is: the errand writes it from the box, and emptied under an untouched secret
	 * key it asks for a removal this console has no errand for.
	 */
	it('names the publishable key wherever that box stands empty over a stored one', () => {
		expect(gap('sk_live_51xyz', '', HOLDING)).toBe('STRIPE_PUBLISHABLE_KEY');
		expect(gap(SECRET, '', HOLDING)).toBe('STRIPE_PUBLISHABLE_KEY');
	});

	/**
	 * a box of spaces is a box the press stores nothing from, so it is a gap and not a value —
	 * whatever the seed behind it was. the second case is the defect: such a box arms the press,
	 * because it differs from the seed it was drawn with (./use-console-form.ts), and read as a
	 * value it would be a press that publishes nothing and says nothing.
	 */
	it('reads a box holding only whitespace as empty', () => {
		expect(gap('sk_live_51abc', '   ', NOTHING)).toBe('STRIPE_PUBLISHABLE_KEY');
		expect(gap(SECRET, '   ', HOLDING)).toBe('STRIPE_PUBLISHABLE_KEY');
	});

	/**
	 * taking the secret key off a deployment is a press an operator makes on purpose, and refusing it
	 * would leave the key stored with no way to clear it.
	 */
	it('names nothing on a removal', () => {
		expect(gap('', 'pk_live_51abc', HOLDING)).toBe(null);
	});

	/**
	 * and the publishable box emptied beside it is no exception: that press writes nothing to the
	 * published slot, so refusing it would turn down a removal an operator meant to make.
	 */
	it('names nothing on a removal with the publishable box emptied too', () => {
		expect(gap('', '', HOLDING)).toBe(null);
	});

	/**
	 * the boxes of a fold nobody has touched reach this at all only where the deployment already
	 * holds both: these rules run on a submit, and a press is armed by a box differing from its seed
	 * (./use-console-form.ts).
	 */
	it('names nothing where both boxes stand at a stored key', () => {
		expect(gap(SECRET, 'pk_live_51abc', HOLDING)).toBe(null);
	});
});

/**
 * the sentence a box earns before any press is made, which is one word for one box.
 *
 * no shape is read: a value of any shape in either box is refused by nothing here, because whether
 * it is a key Stripe takes is Stripe's answer and not this console's guess. what is asserted is
 * that the one box a press would leave the pair without is named, and no other.
 *
 * the seeds are ./stripe-section.tsx's, as above: the mark over a stored credential and the
 * publishable key itself.
 */
describe('stripeRefusals', () => {
	const said = (
		secret: string,
		publishable: string,
		seeds: { secret: string; publishable: string } = NOTHING
	) =>
		stripeRefusals(
			{ STRIPE_SECRET_KEY: secret, STRIPE_PUBLISHABLE_KEY: publishable },
			{ STRIPE_SECRET_KEY: seeds.secret, STRIPE_PUBLISHABLE_KEY: seeds.publishable }
		);

	it('refuses nothing for the shape of either key', () => {
		expect(said('hunter2', 'not a key at all')).toBe(null);
		expect(said('whsec_51abc', 'sk_live_99xyz')).toBe(null);
		expect(said('pk_live_51abc', 'pk_live_51abc')).toBe(null);
		expect(said('sk_live_51abc', 'pk_test_51abc')).toBe(null);
	});

	it('says nothing about a pair', () => {
		expect(said('sk_live_51abc', 'pk_live_51abc')).toBe(null);
		expect(said('rk_test_51abc', 'pk_test_51abc')).toBe(null);
	});

	/**
	 * the charging box is read only where the press carries it. on a publish it is holding the key
	 * the deployment is already charging on, which is a box nobody went near.
	 */
	it('says nothing about the stored key on a publish', () => {
		expect(said(SECRET, 'pk_live_99xyz', HOLDING)).toBe(null);
		expect(said(SECRET, 'anything', HOLDING)).toBe(null);
	});

	/** a removal carries no key and writes no var, so neither box has anything to be refused for. */
	it('says nothing about either box on a removal', () => {
		expect(said('', 'not a key at all', HOLDING)).toBe(null);
		expect(said('', '', HOLDING)).toBe(null);
	});

	/**
	 * the press the whole reading exists for: the publishable box emptied over a stored key arms a
	 * press this console has no removal for, so it is turned down at that box rather than at none.
	 */
	it('names the publishable box emptied over a stored key', () => {
		expect(said(SECRET, '', HOLDING)).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
		expect(said('sk_live_99xyz', '', HOLDING)).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
	});

	/**
	 * a box of spaces is the emptied box again, and it is the press a button armed off the acts
	 * would rest closed over: it asks for no act at all, and nothing on the screen would say why.
	 * armed by the box differing from its seed (./use-console-form.ts), it is turned down under that
	 * box like any other.
	 */
	it('names the publishable box holding only whitespace', () => {
		expect(said('   ', '  ', HOLDING)).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
	});

	/** and nothing at all where the press leaves the deployment holding both. */
	it('says nothing where both boxes stand at a stored key', () => {
		expect(said(SECRET, 'pk_live_51abc', HOLDING)).toBe(null);
	});

	/** the box the pair would be left without is the one thing named, so the hold-back is one call. */
	it('names the box the press would leave the pair without', () => {
		expect(said('sk_live_51abc', '')).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
		expect(said('', 'pk_live_51abc')).toEqual({ STRIPE_SECRET_KEY: 'required' });
		expect(said('anything', '   ')).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
	});
});

/**
 * the same reading as it reaches a box, which is the pass ./stripe-section.tsx's press runs before
 * anything is sent (./use-console-form.ts).
 *
 * it is read through `parseWithZod` rather than off the schema, because the one thing between the
 * two is what the console has no other reading of: conform drops every empty string before the
 * schema sees it, and an empty box here is an act rather than an absence — the secret box emptied
 * is the removal, and either box left empty is the gap the rules above name. a schema that refused
 * a box for being missing would turn both of those into a press that cannot be made.
 */
describe('stripeForm', () => {
	/** the two boxes as the browser posts them, under the names ./stripe-edits.ts reads them back by. */
	const pressed = (
		secret: string,
		publishable: string,
		seeds: { secret: string; publishable: string } = NOTHING
	) => {
		const posted = new FormData();
		posted.set(KEY_FIELD('STRIPE_SECRET_KEY'), secret);
		posted.set(KEY_FIELD('STRIPE_PUBLISHABLE_KEY'), publishable);
		posted.set('intent', 'stripe:set-up');
		return parseWithZod(posted, {
			schema: stripeForm({
				STRIPE_SECRET_KEY: seeds.secret,
				STRIPE_PUBLISHABLE_KEY: seeds.publishable
			}).schema
		});
	};

	/** what a box was told, keyed by the box rather than by the field it posts under. */
	const said = (parsed: ReturnType<typeof pressed>) =>
		parsed.status === 'success' || parsed.error === null
			? null
			: Object.fromEntries(
					Object.entries(parsed.error).map(([field, messages]) => [
						field.replace('key:', ''),
						messages?.[0]
					])
				);

	it('keys every box a sentence by the name that box posts', () => {
		const parsed = pressed('', 'pk_live_51abc');
		expect(parsed.status === 'success' ? [] : Object.keys(parsed.error ?? {})).toEqual([
			'key:STRIPE_SECRET_KEY'
		]);
	});

	it('says what the same reading says', () => {
		expect(said(pressed('', 'pk_live_51abc'))).toEqual(
			stripeRefusals(
				{ STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: 'pk_live_51abc' },
				{ STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '' }
			)
		);
	});

	it('refuses nothing for the shape of either key', () => {
		expect(pressed('hunter2', 'not a key at all').status).toBe('success');
	});

	it('names the box the press would leave the pair without', () => {
		expect(said(pressed('sk_live_51abc', ''))).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
	});

	/**
	 * and the press an emptied publishable box makes is turned down at that box, keyed by the name
	 * the box posts under — a sentence keyed to anything else is drawn under nothing and focuses
	 * nothing (./use-console-form.ts).
	 */
	it('names the publishable box emptied over a stored key, by what that box posts', () => {
		const parsed = pressed(SECRET, '', HOLDING);
		expect(parsed.status === 'success' ? [] : Object.keys(parsed.error ?? {})).toEqual([
			'key:STRIPE_PUBLISHABLE_KEY'
		]);
		expect(said(parsed)).toEqual({ STRIPE_PUBLISHABLE_KEY: 'required' });
	});

	/** the removal goes through with that box emptied beside it, which is a press meant on purpose. */
	it('says nothing about both boxes emptied over a stored pair', () => {
		expect(pressed('', '', HOLDING).status).toBe('success');
	});

	/* the two presses an empty box is the whole of, and neither may be refused for the box being
	   empty: conform posts nothing for it, and a rule that read that as a box left out would refuse
	   the one act it carries. */
	it('says nothing about a removal, which reads the other box not at all', () => {
		expect(pressed('', 'not a key at all', HOLDING).status).toBe('success');
	});

	/**
	 * the boxes of a fold nobody has touched are not read by these rules at all: they run on a
	 * submit, and the press is armed by a box differing from the seed it was drawn with
	 * (./use-console-form.ts). what reaches them untouched is the pair already stored.
	 */
	it('says nothing about a form standing at what the deployment holds', () => {
		expect(pressed(SECRET, 'pk_live_51abc', HOLDING).status).toBe('success');
	});

	it('says nothing about a pair the deployment would take', () => {
		expect(pressed('sk_live_51abc', 'pk_live_51abc').status).toBe('success');
	});
});
