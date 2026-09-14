// the two ways a gift arrives in hand, in the one place both a component and the hand-entry write
// may import from.
//
// not under `$lib/server/**`, for the reason ./statuses.ts is not: the screen that records one draws
// these words, and a component may not import from there. the members are values of the payment
// row's `method` column (`PAYMENT_METHODS` in `$lib/server/db/schema.ts`); `recordGiftInHand` in
// `$lib/server/donations/record-in-hand.ts` writes one into that column, which is what makes a member
// the column does not hold a type error there.
//
// the dependency runs server -> shared and never back: this imports nothing.

/** cash, or a cheque — the column spells the second `check`. */
export const IN_HAND_METHODS = ['cash', 'check'] as const;
export type InHandMethod = (typeof IN_HAND_METHODS)[number];

/**
 * what each is called on a screen.
 *
 * keyed by `InHandMethod`, so a third member is a type error here rather than a raw column value on
 * a screen. `Cheque`, as the repo's prose spells it; the column keeps its value.
 */
export const IN_HAND_METHOD_LABELS: Record<InHandMethod, string> = {
	cash: 'Cash',
	check: 'Cheque'
};

/** how each reads inside a sentence stating a gift — "$250.00 … by cheque". */
export const IN_HAND_METHOD_PHRASES: Record<InHandMethod, string> = {
	cash: 'in cash',
	check: 'by cheque'
};
