import type { AccountType } from '../../accounts/types';
import type { PostableAccountId } from './postable';

// the seeded chart of accounts and nothing else. this file names the rows every fork ships
// with and never queries — nothing in this app reads the `account` table at all, because no
// screen offers an account to pick and every write names one from the map below.
//
// it imports ./schema.ts nowhere at all — two leaves and nothing more, and a single type-only
// edge is all it would take to end that: schema.ts stamps `PostableAccountId` onto
// `ledger_entry.account_id`, `form.revenue_account_id` and `line_item.revenue_account_id` with
// `$type<PostableAccountId>()`, so a brand declared here would make the two files import each
// other. the brand lives in ./postable.ts and the `AccountType` vocabulary in
// ../../accounts/types.ts, which is what keeps the edge out.
//
// the direction is the invariant: schema.ts is the substrate every other server module is
// written against, so schema.ts -> leaf is correct and schema.ts -> a domain module inverts
// a layer. what that buys is auditable rather than stylistic — a file that may mint
// `PostableAccountId` imports nothing that can reach the database. read ./postable.ts for
// what the brand is for and for the two ways in; `postableId` below is one of them.

type SeededAccount<TId extends string = string> = {
	readonly id: TId;
	readonly code: string;
	readonly type: AccountType;
};

/**
 * the seeded chart of accounts, by semantic name. these ids are the ones hardcoded
 * in `migrations/0000_initial_schema.sql` and are identical in every
 * deployment; `accounts.workers.spec.ts` asserts the two sets are equal, which is the only
 * thing standing between a forgotten migration and an FK rejection on
 * `ledger_entry.account_id` in production on someone else's fork.
 *
 * this module is the only place app code names a seeded account. it stays a constant
 * map rather than a `where code = ?` lookup on purpose: `posting.ts` needs its ids
 * before it can build the batch, so a lookup is an extra D1 round trip per donation
 * against the free tier's 50-queries-per-invocation budget, for data that is
 * byte-identical in every fork by decision. a lookup also does not buy the safety it
 * looks like it buys — the real failure is an id present in TS and absent from the
 * database, which a lookup turns from a clear FK error into a confusing null.
 *
 * adding an account is a new migration plus a new entry here, in the same commit.
 */
export const POSTING_ACCOUNTS = {
	/**
	 * a gift received in hand — cash or a check at an event, hand-posted — and what ties to
	 * the bank statement. nothing on the card path reaches it.
	 */
	bankCash: { id: '019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9', code: '1010', type: 'asset' },
	/**
	 * processor clearing. a card charge is not cash — it is money the processor owes
	 * us. gifts are debited here at charge time and `processorFees` is debited out of here
	 * on settlement, which leaves the net sitting here. the transfer of that net into the
	 * bank is deliberately not modelled: the app cannot observe money arriving in a bank
	 * account, so it does not claim to.
	 */
	undepositedFunds: { id: '019fb0d2-7d57-7c5e-a7df-baed1f27b405', code: '1020', type: 'asset' },
	/** pledged but not yet received. */
	accountsReceivable: { id: '019fb0b4-ec6e-7ff7-960c-a441e2c603d7', code: '1200', type: 'asset' },
	/** sales/VAT collected on behalf of a jurisdiction — owed, never revenue. */
	salesTaxPayable: { id: '019fb0b4-ec6e-7ff7-960c-a442a54222ff', code: '2200', type: 'liability' },
	/** FASB ASU 2016-14's two required net-asset classes; revenue closes into these. */
	netAssetsWithoutRestrictions: {
		id: '019fb0d2-7d59-7612-9df3-962bd680f619',
		code: '3000',
		type: 'net_assets'
	},
	netAssetsWithRestrictions: {
		id: '019fb0d2-7d59-7612-9df3-962cdf9fec08',
		code: '3100',
		type: 'net_assets'
	},
	/** the receiptable portion of a gift. */
	donationsDeductible: {
		id: '019fb0b4-ec6e-7ff7-960c-a4448295b77c',
		code: '4110',
		type: 'revenue'
	},
	/** the quid-pro-quo portion — fair market value of what the donor received back. */
	donationsNonDeductible: {
		id: '019fb0b4-ec6e-7ff7-960c-a4452097e944',
		code: '4120',
		type: 'revenue'
	},
	/** what the processor keeps, expensed gross so the gift is recorded at face value. */
	processorFees: { id: '019fb0b4-ec6e-7ff7-960c-a44693a8124e', code: '5200', type: 'expense' }
} as const satisfies Record<string, SeededAccount>;

/**
 * reporting rollups. `is_postable = 0` in the database; no ledger entry may name one.
 * these are here to be read (subtree reports, chart display), never to be posted to.
 */
export const ROLLUPS = {
	/** parent of `donationsDeductible` and `donationsNonDeductible`. */
	donations: { id: '019fb0b4-ec6e-7ff7-960c-a443c29210fa', code: '4100', type: 'revenue' }
} as const satisfies Record<string, SeededAccount>;

export type PostingAccountKey = keyof typeof POSTING_ACCOUNTS;
export type RollupKey = keyof typeof ROLLUPS;

/**
 * the branded id of a seeded postable account — door (1) of the two ./postable.ts
 * enumerates. the other is `postableFromAccount`, for an account this codebase does not name.
 *
 * the cast is discharged by the argument type rather than by a check: `PostingAccountKey`
 * is `keyof typeof POSTING_ACCOUNTS`, and `ROLLUPS` is a separate map, so there is no key
 * that reaches an `is_postable = 0` row. that is also why adding a rollup to
 * `POSTING_ACCOUNTS` "for convenience" is the one edit in this file that would break the
 * brand rather than merely widen it.
 */
export function postableId(key: PostingAccountKey): PostableAccountId {
	return POSTING_ACCOUNTS[key].id as PostableAccountId;
}

/** the revenue account a gift's portion posts to, by deductibility. */
export function donationRevenueAccount(isDeductible: boolean): PostableAccountId {
	return postableId(isDeductible ? 'donationsDeductible' : 'donationsNonDeductible');
}
