// the contact `kind` vocabulary, in the one place both a component and the schema may
// import from.
//
// not under `$lib/server/**`, deliberately. the array is the source of the `kind` check
// constraint in `$lib/server/db/schema.ts` *and* the source of the labels a page renders,
// and those are the two halves of one rule: what the database accepts, and what a
// fundraiser is shown instead. under `$lib/server/**` a component cannot import it at all, so
// the labels would be re-declared in every screen that renders one and the array shipped
// through a loader payload to get past the boundary — a home per screen for a two-line list.
//
// the dependency runs server -> shared and never back: schema.ts imports this, this
// imports nothing.

export const CONTACT_KINDS = ['individual', 'organization', 'household'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/**
 * what a kind is called on a screen.
 *
 * CLAUDE.md: the schema models more than donations and its table names never reach a
 * screen. a fundraiser adds a *person*, not an "individual contact" — so `individual` is a
 * column value and "Person" is the only form of it anyone is shown. keyed by `ContactKind`
 * rather than `string`, so a fourth kind is a type error here rather than a raw
 * `individual` rendered somewhere by a `?? value` fallback.
 */
export const KIND_LABELS: Record<ContactKind, string> = {
	individual: 'Person',
	organization: 'Organization',
	household: 'Household'
};
