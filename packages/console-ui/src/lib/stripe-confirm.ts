import type { StripeAsked, StripeKeyAct } from './stripe-keys';

// what one press of the payments fold states before it is made, which is more than the two boxes
// asked for.
//
// **it is a module rather than a closure inside ./payments-fold.tsx because nothing can render that
// fold.** this package's pool is node-only and collects `*.spec.ts` (../../vite.config.ts), so a
// decision left in a component is a decision no case can hold — and which lines a press states is
// exactly the kind that goes wrong in silence: a removal itemised as the key alone reads as a press
// that keeps everything else, and the operator agrees to it.
//
// **the credential nobody typed is the whole of what the boxes cannot say.** the signing secret is
// Stripe's, handed over once when the endpoint is registered and stored in the same breath
// (`MINTED_BY_CONSOLE` in ./secret-groups.ts), so there is no box for it and no act an operator
// chose — and yet the errand mints a new one and the removal deletes it beside the key. the names
// are handed in rather than read here, so ./secret-groups.ts stays the one list of them.

/** one line of the confirm, named by the value it is about rather than by the box. */
export type ConfirmLine = { readonly name: string; readonly act: StripeKeyAct };

/**
 * every line one press states: the boxes that were changed, and the credential nobody typed.
 *
 * **a publish states no credential at all.** it is the published key alone — such a press carries
 * no secret key, so no Stripe call is made, the endpoint is never touched and the signing secret
 * standing beside it is exactly as it was.
 *
 * **an errand always states one.** the chain registers the endpoint afresh against the pair that
 * was pasted and Stripe hands a signing secret over at creation, so the press replaces whatever was
 * held, or sets the first one where nothing was.
 *
 * **a removal states one only where the deployment is holding one.** the payload nulls both names
 * whatever is there (`STRIPE_REMOVAL` in ./stripe-edits.ts), so a line for a credential that
 * is not held would be a taking-away nobody would notice had not happened.
 */
export function confirmLines(
	asked: StripeAsked,
	minted: readonly string[],
	held: (name: string) => boolean
): readonly ConfirmLine[] {
	if (asked.act === null) return [];
	const boxes: readonly ConfirmLine[] = asked.edits.map((edit) => ({
		name: edit.name,
		act: edit.act
	}));
	if (asked.act === 'publish') return boxes;
	if (asked.act === 'remove') {
		return [
			...boxes,
			...minted.filter(held).map((name): ConfirmLine => ({ name, act: 'Removed' }))
		];
	}
	return [
		...boxes,
		...minted.map((name): ConfirmLine => ({ name, act: held(name) ? 'Replaced' : 'Set' }))
	];
}

/**
 * whether the errand is remaking a setup that already works, rather than making the first one.
 *
 * **a first press has nothing to say beyond its own rows.** every value it touches is stated above
 * as `Set`, and a sentence naming what the press does to the Stripe account would be the same fact
 * in prose. what no row can carry is a press over a deployment that is already taking gifts: the
 * endpoint at the derived address is deleted and registered again on every errand
 * (`packages/console/internal/stripe`), and the operator is agreeing to that rather than to a first
 * setup.
 *
 * the signing secret is the reading, because it is the credential the registration returns and the
 * only one this console mints — a deployment holding one has an endpoint behind it, and its line
 * says `Replaced` for exactly that reason ({@link confirmLines}).
 */
export const remakesSetup = (lines: readonly ConfirmLine[]): boolean =>
	lines.some((line) => line.act === 'Replaced');
