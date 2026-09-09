import type { DEPLOY_VARS } from '@better-giving/operator/deploy-split';
import { z } from 'zod';
import type { StripeRunAct } from '../api/types';
import type { StatedForm } from './use-console-form';

// the two keys as the payments screen posts them, what each box is asking for, what the press that
// carries them does, and what a box is told when the pair would be left without it.
//
// the screen draws the boxes, ./stripe-edits.ts reads what they hold, and both of them need the
// same vocabulary — so it is stated here once, and nothing in it touches a network or a credential.
//
// **no shape is read off either key, here or anywhere on this surface.** whether a value is a key
// Stripe takes is Stripe's to answer: the press hands the pair over, the chain's first call asks,
// and the answer comes back onto the boxes as one sentence about the pair (./payments-fold.tsx).
// what this module refuses is only a box standing empty that the press cannot go without, which is
// the one thing a press can be turned down for before anything is sent.
//
// **the boxes are seeded, and a press is decided against the seed.** both keys are plain vars and
// the account hands each value back (`heldValues` in ./held-values.ts), so each box is drawn
// holding what the deployment holds: the seed coming back unchanged is the box nobody went near, an
// emptied box is a value taken away, and anything else is a value to set — the reading the mail
// form beside it makes, stated once in {@link stripeAsked} because both ends make it.
//
// **the publishable box has no removal, and an emptied one is refused rather than performed.** the
// press that publishes a key names it with a value, and a deployment serving a donation form
// without one takes no money — so there is no act for that box to ask for and the key stays where
// it is. but a box emptied over a stored key is an operator asking for something, and a press that
// read it as nothing at all would be a closed button with nothing on the screen saying why: the box
// differs from its seed, so the press is armed (./use-console-form.ts) and is refused under the box
// itself ({@link stripeRefusals}). a box holding nothing but whitespace is that same box — it is
// what the deployment drops — and is refused the same way. the removal is the one press that reads
// that box not at all.
//
// **one press, and which errand it is follows from the secret box.** the secret key is what every
// Stripe call in the chain is made with, so a press that retypes it re-establishes the whole setup
// — the endpoint, the events it is subscribed to, the signing secret and the item a repeating gift
// is collected against are all made afresh against the pair that was pasted, because a second key
// is very likely a second account or a second mode and nothing already provisioned may be assumed
// to belong to it. a press that leaves it alone can make no Stripe call at all, so it is the
// publishable key and nothing else. the chain itself is the binary's
// (`packages/console/internal/stripe`).

/** the box one of the two keys is typed in. */
export type StripeKeyName = Extract<
	(typeof DEPLOY_VARS)[number],
	'STRIPE_SECRET_KEY' | 'STRIPE_PUBLISHABLE_KEY'
>;

/**
 * the two names, in the order the screen draws them.
 *
 * the secret key first because it is the one that decides everything after it: the account named
 * back to the operator, the mode both keys are checked against, every Stripe call this press makes,
 * and which of the three acts the press is. the publishable key is what the deployment hands to a
 * donor's browser, and it costs a deploy rather than a request.
 */
export const STRIPE_KEY_NAMES: readonly StripeKeyName[] = [
	'STRIPE_SECRET_KEY',
	'STRIPE_PUBLISHABLE_KEY'
];

/**
 * the field one key is posted under.
 *
 * the exact name comes back rather than `string`, because it is what {@link stripeForm}'s two boxes
 * are keyed by — a shape typed at `string` is a form whose boxes cannot be named at all.
 */
export const KEY_FIELD = <N extends StripeKeyName>(name: N): `key:${N}` => `key:${name}`;

/** what the press posts, which is the submitting button's own value. */
export const SET_UP_INTENT = 'stripe:set-up';

/** what the two boxes hold, and what they were drawn holding. */
export type StripeKeyBoxes = Readonly<Record<StripeKeyName, string>>;

/**
 * what one box is asking for, in the word the confirm states it in.
 *
 * the descriptive register and no tone: none of the three is a warning, and the one that takes a
 * value away carries that in the word rather than in a colour.
 */
export type StripeKeyAct = 'Set' | 'Replaced' | 'Removed';

/** one box's ask, named by the box so the confirm can label it. */
export type StripeKeyEdit = { readonly name: StripeKeyName; readonly act: StripeKeyAct };

/**
 * what the press does, which follows from the pair rather than from a control.
 *
 * `errand` is the whole chain: name the account, register the endpoint, store both credentials,
 * provision the repeating item, write the publishable key. `publish` is that last step alone, which
 * is every press that leaves the secret key where it is — such a press carries no key, and no
 * Stripe call can be made without one. `remove` deletes the secret key and the signing secret
 * beside it, and reaches neither Stripe nor the published key: the signing secret names an account
 * this deployment can no longer charge on, so a deployment left holding it would be verifying
 * deliveries for an account nothing can reach.
 *
 * the two that are a run are the wire's own (`StripeRunAct` in ../api/types.ts), because the binary
 * reports a run under one of them; the removal is one request and seconds, so it is answered where
 * it was pressed.
 */
export type StripeAct = StripeRunAct | 'remove';

/** what a press would do, and the lines a confirm states it in. `null` is a press with no act. */
export type StripeAsked = {
	readonly act: StripeAct | null;
	readonly edits: readonly StripeKeyEdit[];
};

const edit = (name: StripeKeyName, act: StripeKeyAct): StripeKeyEdit => ({ name, act });

/**
 * what one box is asking for, read against the seed it was drawn with.
 *
 * a box holding nothing but whitespace asks for neither. the deployment drops such a string and
 * ./stripe-edits.ts refuses to store one, so reading it as a value would state an act in the confirm
 * that the press cannot make — and the values are never trimmed on the way through, deliberately and
 * for the reason written down there: a space at either end is a character of a credential. so what
 * is refused here is only the box that is whitespace and nothing else, which is the same box the
 * server refuses.
 *
 * asking for no act is not the same as leaving the press with nothing to do: the box still differs
 * from its seed, so the press is armed and {@link stripeGap} is what turns it down.
 *
 * whether what was typed is a Stripe key at all is read nowhere on this surface: it is Stripe's
 * answer to the chain's first call, carried back onto the boxes by ./payments-fold.tsx.
 */
function boxAct(value: string, seed: string, held: boolean): StripeKeyAct | null {
	if (value === seed) return null;
	if (value === '') return held ? 'Removed' : null;
	if (value.trim() === '') return null;
	return held ? 'Replaced' : 'Set';
}

/** what each box is asking for, the one act the press cannot perform included. */
function asks(
	boxes: StripeKeyBoxes,
	seeds: StripeKeyBoxes
): Readonly<Record<StripeKeyName, StripeKeyAct | null>> {
	return {
		STRIPE_SECRET_KEY: boxAct(
			boxes.STRIPE_SECRET_KEY,
			seeds.STRIPE_SECRET_KEY,
			seeds.STRIPE_SECRET_KEY !== ''
		),
		STRIPE_PUBLISHABLE_KEY: boxAct(
			boxes.STRIPE_PUBLISHABLE_KEY,
			seeds.STRIPE_PUBLISHABLE_KEY,
			seeds.STRIPE_PUBLISHABLE_KEY !== ''
		)
	};
}

/**
 * the box a press is turned down at, or `null` where the press leaves this deployment holding both
 * keys.
 *
 * **the two are one press or none, because neither half of the pair is worth anything alone.** the
 * secret key is what every charge is made with and the publishable key is what the donation form is
 * served with, so a deployment holding one and not the other takes no money either way — and the
 * fold reads as further along than it is, because a box holding a value is what says a value is
 * stored. ./smtp-fold-state.ts's `mailGaps` is the same reading over the five mail values.
 *
 * **the publishable box standing empty is the one thing named whatever the press is**, because
 * there is no press that leaves that key where it is: an errand writes it from the box and the box
 * has nothing to write, and an emptied box over a stored key asks for a removal this console has no
 * errand for. the binary's door refuses the same box for the same thing (`asking` in
 * `packages/console/internal/server/stripe.go`), so what this saves is the round trip rather than
 * the state.
 *
 * **a removal is no gap, and it reads that box not at all.** taking the secret key off a deployment
 * is a press an operator makes on purpose — refusing it would leave the key stored with no way to
 * clear it — and the press writes nothing to the published slot, so an emptied publishable box
 * beside it asks for nothing this press could refuse.
 *
 * **and a fold nobody has touched is named for nothing, by never being asked.** these rules run on
 * a submit and the button is armed by a box differing from its seed (./use-console-form.ts), so the
 * boxes of a deployment holding neither key — both empty at rest — reach no press to be refused at.
 *
 * **a box holding nothing but whitespace is the same box as an emptied one here.** it asks for no
 * act ({@link boxAct}), the deployment drops such a string and the binary's door refuses it, so a
 * press carrying one would leave this deployment serving a form it cannot take money on — and the
 * box is named for exactly that, whatever the seed behind it was.
 */
export function stripeGap(boxes: StripeKeyBoxes, seeds: StripeKeyBoxes): StripeKeyName | null {
	const { act } = stripeAsked(boxes, seeds);
	if (act === 'remove') return null;
	if (boxes.STRIPE_PUBLISHABLE_KEY.trim() === '') return 'STRIPE_PUBLISHABLE_KEY';
	if (act === 'publish') return seeds.STRIPE_SECRET_KEY === '' ? 'STRIPE_SECRET_KEY' : null;
	return null;
}

/**
 * what the two boxes are asking for, and which of the three acts that makes the press.
 *
 * **the seeds are what the boxes were drawn with and never what a body claimed.** the screen holds
 * them from the reading the page took off the account, for the reason `secretEdits` in
 * ./secret-edits.ts states — a body claiming a credential is stored would turn an empty box into a
 * delete, and one claiming it is not would turn an untouched box into a save.
 *
 * **the secret box decides, and on a removal the other one is not read.** a press that takes the
 * secret key away publishes nothing and can publish nothing, so a publishable edit stated beside it
 * would be a line in the confirm the press does not make.
 *
 * **an errand states the publishable box only where it differs.** the chain writes that key on
 * every press, and a write of the value already there is `unchanged` rather than a change
 * (`SetVars` in `packages/console/internal/deployment`) — so a row for it would be an act nothing
 * performs.
 */
export function stripeAsked(boxes: StripeKeyBoxes, seeds: StripeKeyBoxes): StripeAsked {
	const asked = asks(boxes, seeds);
	const secret = asked.STRIPE_SECRET_KEY;
	if (secret === 'Removed') {
		return { act: 'remove', edits: [edit('STRIPE_SECRET_KEY', 'Removed')] };
	}

	const published = asked.STRIPE_PUBLISHABLE_KEY;
	// the publishable box has no removal, so the one act it cannot ask for is dropped rather than
	// carried into a press that would have to ignore it. what such a box gets instead is a refusal
	// under itself ({@link stripeGap}), reached by a press the box differing from its seed arms.
	const publishable = published === 'Removed' ? null : published;

	const edits = [
		...(secret === null ? [] : [edit('STRIPE_SECRET_KEY', secret)]),
		...(publishable === null ? [] : [edit('STRIPE_PUBLISHABLE_KEY', publishable)])
	];

	if (secret !== null) return { act: 'errand', edits };
	return { act: publishable === null ? null : 'publish', edits };
}

/**
 * what a box the press cannot be made without says while it stands empty.
 *
 * one word, and the same one for either key: the label above the box names it and the box under
 * the label is empty, so the row already reads as the whole sentence — publishable key, nothing,
 * required. what a longer one would add is why the other key is not enough on its own, which is a
 * fact about the pair rather than about the box it would be standing under.
 *
 * it is the word every other fold on this screen uses for the same state, and the one both operator
 * surfaces use for a box a save refuses blank (`REQUIRED` in
 * `@better-giving/operator/console/org-rules`), so an operator meets one word for it wherever they
 * are.
 */
export const KEY_BLANK = 'required';

/**
 * what this form can already tell its own press would be refused for, keyed by the box at fault.
 *
 * **a pure function of the two boxes and their seeds, and it is the whole of what the press runs
 * first** — {@link stripeForm} mounts it as its one refinement, so what moves the day this fold is
 * built on something else is that one call. it draws nothing, reads no element and reaches nothing.
 *
 * **it names the box the press is turned down at ({@link stripeGap}) and nothing else.** no
 * shape is read off a key: whether a value is one Stripe takes is Stripe's answer, made by the
 * chain's first call and carried back onto the boxes by ./payments-fold.tsx, and the binary's door
 * refuses only a slot holding nothing or a padded value (`asking` in
 * `packages/console/internal/server/stripe.go`). a sentence about a shape here would be this
 * console guessing at what only Stripe knows.
 *
 * **a press that takes the secret key away is read for none of it, and neither is a form with no
 * press in it.** both are {@link stripeGap}'s own readings: a removal carries no key and writes no
 * var, so there is no pair to be left without — the same reading ./stripe-edits.ts makes of the
 * body — and a fold nobody has touched has no press to be refused.
 *
 * the names come back in the order the screen draws them, because the first of them is where focus
 * goes (conform's own move, argued in ./use-console-form.ts).
 */
export function stripeRefusals(
	boxes: StripeKeyBoxes,
	seeds: StripeKeyBoxes
): Partial<Record<StripeKeyName, string>> | null {
	const gap = stripeGap(boxes, seeds);
	if (gap === null) return null;
	return { [gap]: KEY_BLANK };
}

/**
 * one box as the form layer reads it, which is the one place an empty box is a value.
 *
 * conform hands `undefined` for a box holding nothing — every empty string is dropped before the
 * schema sees it (`parseWithZod` in `@conform-to/zod/v4`) — and an empty box here is an act rather
 * than an absence: the secret box emptied is the removal, and either box left empty is the gap
 * {@link stripeGap} names. so neither is refused for being absent, and {@link stripeForm}'s rule
 * reads the empty string it stood for.
 */
const heldKey = z.string().optional();

const keyBoxes = z.object({
	[KEY_FIELD('STRIPE_SECRET_KEY')]: heldKey,
	[KEY_FIELD('STRIPE_PUBLISHABLE_KEY')]: heldKey
});

/**
 * the payments fold's form: what its `<Form>` is called, and the one rule its press runs first.
 *
 * **the rule is {@link stripeRefusals} whole, and no sentence is stated twice.** what a box says
 * before anything is sent is the same string the same reading writes anywhere else, keyed by the
 * box it is about — a second spelling here is how a screen comes to disagree with itself about one
 * value.
 *
 * **it is a factory because the reading is made against the seeds**, which are what the boxes were
 * drawn with rather than anything a body claims: a box holding its seed is one nobody went near,
 * and the same box empty is a value taken away ({@link stripeAsked}).
 *
 * **the boxes are keyed by what they post** ({@link KEY_FIELD}), which is what ./stripe-edits.ts
 * reads the body back by — so the name a sentence is keyed to is the name the box carries and the
 * name the far end answers about.
 *
 * the id is the form's, and every box id on the fold is composed off it by the seam
 * (./use-console-form.ts).
 */
export function stripeForm(seeds: StripeKeyBoxes): StatedForm<typeof keyBoxes> {
	return {
		id: 'stripe',
		schema: keyBoxes.superRefine((held, ctx) => {
			const said = stripeRefusals(
				{
					STRIPE_SECRET_KEY: held[KEY_FIELD('STRIPE_SECRET_KEY')] ?? '',
					STRIPE_PUBLISHABLE_KEY: held[KEY_FIELD('STRIPE_PUBLISHABLE_KEY')] ?? ''
				},
				seeds
			);
			if (said === null) return;
			// in the order the screen draws them, because the first of them is where focus goes.
			for (const name of STRIPE_KEY_NAMES) {
				const sentence = said[name];
				if (sentence === undefined) continue;
				ctx.addIssue({ code: 'custom', message: sentence, path: [KEY_FIELD(name)] });
			}
		})
	};
}
