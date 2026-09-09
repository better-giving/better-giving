// the gift status vocabulary, in the one place both a component and the read that derives it may
// import from.
//
// not under `$lib/server/**`, for the reason `$lib/contacts/kinds.ts` and `$lib/forms/statuses.ts`
// are not: a component may not import from there, so the words a screen renders would have to be
// declared again in every route that renders one.
//
// the difference from `FORM_STATUSES` is worth stating, because it is what this list is not: that
// one is also the source of a check constraint, so its members are values a column holds. there is
// no status column on `donation` and there must not be one — status is derived at read time from
// the `payment` rows and the ledger, and a mutable copy kept beside an append-only ledger is a
// second source of truth for the one fact that must never disagree (see the `donation` table in
// `$lib/server/db/schema.ts`). so this array is the source of the projection and of the labels,
// and of nothing the database knows about.
//
// the dependency runs server -> shared and never back: `$lib/server/donations/queries.ts` imports
// this, this imports nothing.

/**
 * what a gift can be, derived from its settlement attempts.
 *
 * the six are exhaustive over the rows that can exist, and each one names what produces it:
 *
 *   pending            no settlement attempt yet, or none past `pending`.
 *   completed          an inbound attempt succeeded, and refunds do not reach what it collected.
 *   failed             the latest inbound attempt failed and none has succeeded.
 *   cancelled          the latest inbound attempt was abandoned and none has succeeded.
 *   refunded           succeeded refunds reach what the gift collected.
 *   partially_refunded succeeded refunds are less than that, and more than zero.
 */
export const DONATION_STATUSES = [
	'pending',
	'completed',
	'failed',
	'cancelled',
	'refunded',
	'partially_refunded'
] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/**
 * what a status is called on a screen.
 *
 * keyed by `DonationStatus` rather than `string`, so a seventh state is a type error here rather
 * than a raw `partially_refunded` rendered somewhere by a `?? value` fallback — the same
 * discipline `KIND_LABELS` in `$lib/contacts/kinds.ts` is under.
 */
export const DONATION_STATUS_LABELS: Record<DonationStatus, string> = {
	pending: 'Pending',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled',
	refunded: 'Refunded',
	partially_refunded: 'Partly refunded'
};
