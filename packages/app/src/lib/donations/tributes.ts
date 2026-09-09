import { TRIBUTE_KINDS, type TributeKind } from '@better-giving/form/v1';

// the read side of a stored dedication: two columns narrowed into one value, or nothing.
//
// the vocabulary itself is not here. `TRIBUTE_KINDS` and `TributeKind` are
// `@better-giving/form/v1`'s, where they are a permanent part of what an integrator posts, and
// every surface in this app imports them from there — the admin screens already do (CLAUDE.md:
// /admin does import the form's vocabulary and must keep being able to). a second copy under
// `$lib` would be one both sides could edit and only one side would notice.
//
// not under `$lib/server/**`, so a component may import it: the gifts list narrows the same two
// columns the receipt does.

/**
 * the dedication a `donation` row carries, from the two columns holding it, or `null` where it
 * carries none.
 *
 * the read-side counterpart to `parseTribute` in `$lib/server/donations/quote-input.ts` and to
 * `tributeOf` in `$lib/server/donations/collect.ts`, and it exists for the reason those two are the
 * whole of the constraint: `donation.tribute_kind` has no CHECK and cannot be given one, so
 * anything at all can be sitting in it (`$lib/server/db/donation-tribute.workers.spec.ts` asserts
 * the database itself takes it). a kind outside the vocabulary, half a pair, or a name that is
 * blank is a row nothing this app writes and no sentence any surface can state, so it reads as no
 * dedication rather than as a broken one.
 *
 * it hands the two columns back as one value, which is what stops every surface downstream from
 * having to answer for a kind naming nobody. one narrowing rather than one per caller: the gifts
 * list, the donor's receipt and a collection's own write all pass through here, and a second copy
 * is how they come to disagree.
 */
export function projectTribute(
	kind: string | null,
	honoree: string | null
): { kind: TributeKind; honoree: string } | null {
	const known = TRIBUTE_KINDS.find((k) => k === kind);
	if (known === undefined) return null;
	if (honoree === null || honoree.trim() === '') return null;
	return { kind: known, honoree };
}
