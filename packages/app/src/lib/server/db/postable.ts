/**
 * "an account id you may post to" — the type, and the check every way in goes through.
 *
 * it is a leaf module on purpose: it imports nothing. `schema.ts` stamps the brand onto
 * three columns with `$type<PostableAccountId>()`, so anything schema.ts reaches must be
 * reachable without reaching back. what the leaf keeps is the direction: `schema.ts` is the
 * substrate every other server module is written against, and a substrate importing a module
 * that queries it is one edit away from an initialization order nobody can read. the
 * invariant that falls out is the one the allowlist below rests on: a file that may mint this
 * brand imports nothing that can reach the database.
 *
 * why it exists at all. `account` carries a reporting rollup (`4100 Donations`,
 * `is_postable = 0`) whose children already sum into it. one ledger entry naming a rollup
 * makes every report over that subtree double-count, silently and permanently, because the
 * ledger is append-only. the database refuses that on its own — see the composite
 * `(id, is_postable)` foreign key on `ledger_entry`, `form` and `line_item` — and this
 * brand is the same guard one layer up, where the failure is a compile error at the call
 * site instead of a rejection at insert time on a fork nobody can reach.
 *
 * ---------------------------------------------------------------------------
 * two ways in and no third, and both of them cast. a brand is not unforgeable
 * (`x as PostableAccountId` compiles anywhere), so what makes "every posted account id was
 * checked" a fact rather than a review item is these two doors plus ./postable.spec.ts,
 * which scans the tree and fails on a cast in any file but the two marked mints:
 *
 *   1. a seeded key — `postableId(key)` in ./accounts.ts. its argument is
 *      `keyof typeof POSTING_ACCOUNTS`, a map that excludes `ROLLUPS` by construction, so
 *      the cast there is discharged by the key type rather than by a check.
 *   2. a verified row — `postableFromAccount(row)` below, which reads `is_postable` off a
 *      row that came out of the database and hands back `null` when it is false.
 *
 * (1) covers the accounts this codebase names, which is every account any write in this app
 * posts to; (2) covers the ones an operator adds — a second fund, a restricted appeal —
 * which have no key here and are only ever discovered by reading `account`. note which door
 * is not needed: a `form` or `line_item` row already carries the brand on
 * `revenue_account_id`, because schema.ts stamps that column — reading one is not a way in,
 * it is the brand arriving intact.
 *
 * an id crossing back in from outside the process would need a third door: a read of
 * `account` by that id, handing the row to (2). no screen posts one — no operator surface
 * names an account at all — so the door does not exist rather than sitting unused. a third
 * door that casts needs a third entry in that allowlist, which is a diff a reviewer sees.
 * ---------------------------------------------------------------------------
 */
export type PostableAccountId = string & { readonly __postable: unique symbol };

/**
 * the columns `postableFromAccount` reads, stated structurally rather than as
 * `Account` from ./schema.ts — importing that type is what would make this module a
 * non-leaf and put the cycle back. an `Account` row satisfies it by shape, so the call
 * site reads `postableFromAccount(row)` with no adapter.
 */
export type PostableCandidate = {
	readonly id: string;
	readonly isPostable: boolean;
};

/**
 * the branded id of an account row that may be posted to, or `null` for a rollup.
 *
 * `null` rather than a throw, because "this account is a rollup" is a legitimate answer to
 * a question a UI asks (which accounts may a form point at?), not an exceptional one. a
 * caller that has already narrowed to a postable row still gets a value it has to unwrap,
 * which is the cost of the guarantee and the reason (1) above exists for the ids we ship.
 *
 * it takes a row rather than an id: the check is `is_postable`, and an id alone cannot
 * answer it without a read this function would then be hiding.
 */
export function postableFromAccount(row: PostableCandidate): PostableAccountId | null {
	// the second of the two casts that mint this brand — see the header. it is guarded by
	// the line above it, which is the whole of the guarantee.
	return row.isPostable ? (row.id as PostableAccountId) : null;
}
