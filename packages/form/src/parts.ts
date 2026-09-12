// the element's `::part()` vocabulary, which is a permanent contract in the same sense `v1` is:
// a name may be added, no name may ever be renamed or removed. the snippet is pasted into sites
// this project cannot reach, so a host's `::part(action)` rule outlives every rewrite of the
// markup underneath it (CLAUDE.md, "Permanent contracts").
//
// `legal` was withdrawn from this list, which is the one exception and was taken out loud. the
// identity footer left the card, so the name pointed at nothing a host could style; the withdrawal
// is admitted by CLAUDE.md's own pre-release carve-out — no organisation has deployed and no site
// carries the snippet — and it is recorded here rather than in a changelog so the next reader can
// tell a stated exception from an oversight. a second withdrawal needs the same argument made
// again, and it is not available once a real deployment exists.
//
// a part list carries one name and any number of tokens. `part="action submit busy"` is matched
// by `::part(action)`, `::part(submit)`, `::part(action submit)` and `::part(action busy)` alike,
// because `::part()` matches on token presence. that is the single decision keeping this list at
// twelve: state never spawns a name. there is no `amount-option-selected` and no
// `submit-loading`, and the way to serve a host who needs one more hook is a token on a part that
// already exists, never a thirteenth name.
//
// what is absent is load-bearing. across the shadow boundary a host's normal declaration beats an
// inner one, so naming a surface is handing over control of it. layout containers are unnamed
// because a host regridding the tile column reintroduces the horizontal overflow the 375px floor
// exists to prevent, on a page this code cannot see; the error and attention surfaces
// are unnamed because that absence is the whole enforcement of "semantic color is
// legibility, not brand" — an `!important` would not survive a host's own `!important`, and the
// missing name does.
//
// `custom-elements.json` at this package's root is the published copy of this list, and
// ./parts.spec.ts fails when the two disagree.
//
// `../package.json` exports this module as `./parts`. the deployment's own donation page draws this
// card in react and emits these same names, which is what lets the four sheets dress it unchanged;
// taking the names from here rather than typing them is what makes a misspelling a compile error
// instead of a surface nothing paints. the list is a host's contract either way — a name added for
// that page is a name added for every site carrying the snippet.

/**
 * every name a host may target, and the whole of it.
 *
 * ordered as a reader meets them on the card rather than alphabetically, so the list doubles as a
 * map of the surfaces the element paints.
 */
export const PART_NAMES = [
	'card',
	'heading',
	'label',
	'field',
	'checkbox',
	'frequency-option',
	'amount-option',
	'amount-input',
	'summary',
	'payment',
	'action',
	'action-quiet'
] as const;

export type PartName = (typeof PART_NAMES)[number];

/**
 * the closed set of state tokens, appearing on whichever part they apply to.
 *
 * `disabled` is not one of them, on any part. on the control that spends the money, double-submit
 * is prevented by the flow's shape — `quoting` has no `SUBMIT` handler (./checkout.machine.ts) —
 * and an attribute would invite a reader to believe the attribute is the guarantee, which any
 * second entry point walks straight past; that control takes `busy` instead, and
 * ./connect.spec.ts asserts no getter emits a `disabled` prop at all. on a frequency or an amount
 * it is a state a donor is never in: every cadence and every tile the card offers can be chosen,
 * because one this deployment cannot charge is not offered.
 */
export const STATE_TOKENS = ['selected', 'invalid', 'busy'] as const;

export type StateToken = (typeof STATE_TOKENS)[number];

/**
 * what a part is for, where its name alone does not say.
 *
 * one token today: `submit` distinguishes the control that spends the money from every other
 * `action`. `::part(submit)` therefore works on `part="action submit"` with no second name.
 */
export const ROLE_TOKENS = ['submit'] as const;

export type RoleToken = (typeof ROLE_TOKENS)[number];

/**
 * every slot the element projects light DOM through, and the whole of it.
 *
 * a slot name is permanent in the same sense a part name is: a host writing `slot="loading"` is
 * writing against this list, so a name may be added and none may ever be renamed or removed.
 * `custom-elements.json` publishes both lists and ./parts.spec.ts fails when either disagrees with
 * the code.
 *
 * the two are not the same kind of thing, which is why they are named apart rather than merged.
 * `loading` is an invitation — a host puts their own placeholder in it. `payment` is a projection
 * this element makes for itself: it holds the node a payment provider paints into, which lives in
 * the light DOM because the processor whose fields this element draws cannot complete its mount
 * inside a shadow root (`#openPaymentBox` in ./element.ts, which also records the processor that
 * can). A host may address it, and content a host puts there lands in the payment box beside the
 * provider's fields, which is nobody's idea of a good time.
 */
export const SLOT_NAMES = ['loading', 'payment'] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

/**
 * a part attribute, built so that a name cannot be misspelled and a state cannot become a name.
 *
 * the type is the enforcement: a string literal that is not in one of the three lists above is a
 * `pnpm check` failure at the call site rather than a part name that quietly ships and then
 * cannot be withdrawn.
 */
export function part(name: PartName, ...tokens: readonly (StateToken | RoleToken)[]): string {
	return tokens.length === 0 ? name : `${name} ${tokens.join(' ')}`;
}

/**
 * the same, with each token kept only where its condition holds.
 *
 * saves every call site from assembling an array conditionally, which is where a token ends up
 * spelled as a bare string and escapes the type above.
 */
export function partWhen(
	name: PartName,
	tokens: Partial<Record<StateToken | RoleToken, boolean>>
): string {
	const present = (Object.keys(tokens) as (StateToken | RoleToken)[]).filter(
		(token) => tokens[token] === true
	);
	return part(name, ...present);
}
