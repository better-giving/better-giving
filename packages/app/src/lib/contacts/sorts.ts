// the orders the donor file can be read in, in the one place both the read and the screen's
// address may import from.
//
// not under `$lib/server/**`, deliberately, and for the reason ./kinds.ts states: the array is
// what `listContacts` in `$lib/server/contacts/queries.ts` accepts *and* what
// `routes/_app.admin.donors._index.tsx` reads `?sort=` against, and those are the two halves of
// one rule — what the read can order by, and what an operator may put in the address. under
// `$lib/server/**` the screen could not import it at all, and the list would be re-declared in the
// route with nothing tying the two together.
//
// the dependency runs server -> shared and never back: the query module imports this, this imports
// nothing. `packages/app/src/routes.spec.ts` is what would catch the other direction — a route
// naming a `$lib/server/**` identifier from an export react router ships to the browser puts D1 and
// this deployment's secrets in the bundle a visitor downloads.

export const CONTACT_SORTS = ['name', 'gifts', 'given'] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

/**
 * which donors the file is read as — the whole of it, or the ones giving on a schedule.
 *
 * here for the reason `CONTACT_SORTS` is: `listContacts` in `$lib/server/contacts/queries.ts`
 * filters on it and `routes/_app.admin.donors._index.tsx` reads `?view=` against it, and those are
 * the two halves of one rule.
 *
 * `all` is the first member and it is the file's own address — `/admin/donors` carries no `view=`
 * at all, so this member is what an absent parameter reads as rather than a word anything writes.
 *
 * a view and not a sort, because it changes which rows exist rather than what order they come back
 * in: the count over the list and the pages under it are the view's, and the sort applies inside
 * whichever one is open.
 */
export const CONTACT_VIEWS = ['all', 'recurring'] as const;
export type ContactView = (typeof CONTACT_VIEWS)[number];

/**
 * which way a sorted column runs.
 *
 * these two words rather than `ascending`/`descending`, which is `aria-sort`'s vocabulary and the
 * head's own: this pair is what stands in an address, and an address is read and typed by a person.
 */
export type SortDir = 'asc' | 'desc';
