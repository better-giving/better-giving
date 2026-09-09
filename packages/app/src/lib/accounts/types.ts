// the `account.type` vocabulary, in a leaf both `$lib/server/db/schema.ts` and the modules
// written against it may import from.
//
// why it is not inline in schema.ts. `$lib/server/db/accounts.ts` — the seeded chart — needs
// `AccountType` to type its map, and taking it from schema.ts would be an edge from a domain
// module back into the substrate. the direction is the invariant: schema.ts is what every other
// server module is written against, so schema.ts -> leaf is correct and a leaf reaching back
// inverts a layer — accounts.ts imports schema.ts nowhere at all, and its own header states
// what keeps it that way. the vocabulary living in a leaf is one half of that. the rule it
// leaves behind, which is the one to apply next time:
//
//   `schema.ts` imports only from leaves. nothing `schema.ts` imports may import `schema.ts`.
//   a vocabulary moves to a leaf the moment a module `schema.ts` itself needs to import from
//   needs it. a consumer that only reads downstream from `schema.ts` is not a reason.
//
// client reach is the second reason a vocabulary leaves, and it is the one that has moved most
// of them: ../contacts/kinds.ts and ../forms/statuses.ts are each a list a component renders the
// words of, and a component cannot import from `$lib/server/**` at all. schema.ts's own header
// carries the whole list.
//
// not under `$lib/server/**`, matching ../contacts/kinds.ts. CLAUDE.md's server-only rule is
// about secrets and a six-string list of statement classes is not one; no screen renders an
// account type today, but the chart-of-accounts screen is the obvious next consumer, and
// when it lands an `ACCOUNT_TYPE_LABELS` map goes beside the array here exactly as
// `KIND_LABELS` sits beside `CONTACT_KINDS` — no move, no import churn.
//
// this file is a leaf: it imports nothing, and it is not a home for typescript type aliases.
// the name `types.ts` invites someone to park `Account`/`NewAccount` re-exports in it. never
// re-export a row type from `schema.ts` here — one such line makes this file import schema.ts
// and reinstates the exact cycle its existence removes. row types come from schema.ts, at the
// call site. what belongs here is the vocabulary and, later, what a screen calls each member.

/**
 * statement classes, not balance directions.
 *
 * `contra` is deliberately not a member. a contra-revenue account is a revenue
 * account whose normal balance is a debit, which the signed `amount_minor` on the
 * ledger entry already expresses; as a type it destroys statement classification —
 * a report grouping by `type` could not tell a contra-asset from a contra-revenue.
 * refunds need no contra account either: they are compensating entries against the
 * original accounts, which is what the append-only ledger requires anyway.
 *
 * `net_assets` exists because FASB ASU 2016-14 requires US nonprofits to report net
 * assets with and without donor restrictions; without it revenue can never be closed.
 * `cost_of_sales` is for event tickets and merch.
 */
export const ACCOUNT_TYPES = [
	'asset',
	'liability',
	'net_assets',
	'revenue',
	'cost_of_sales',
	'expense'
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
