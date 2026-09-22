import type { AccountRole, LedgerAccount } from './provider';

// which of a QuickBooks company's accounts may hold each of the three roles.
//
// Intuit's Accounting API reference names the AccountType values each account ref takes, and an
// account outside them is refused with fault 6430 "Invalid account type"
// (https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/deposit):
// - deposit is the Deposit's `DepositToAccountRef`, which takes "Other Current Asset or Bank",
//   less undeposited funds: the same page has a deposit move money out of it, into the account
//   this ref names, and QuickBooks' own deposit screen offers no way to deposit into it.
// - income and fee are Deposit lines' `DepositLineDetail.AccountRef`, which takes Income, Other
//   Income, Expense, Other Expense, Other Current Asset, Equity or COGS. each role is narrowed to
//   the types that are income or cost, since either posted anywhere else lands on the wrong
//   statement.
// a correction's JournalEntry lines take any type, so they narrow nothing further
// (https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry).
export const ROLE_TYPES: Record<AccountRole, ReadonlySet<string>> = {
	deposit: new Set(['Bank', 'Other Current Asset']),
	income: new Set(['Income', 'Other Income']),
	fee: new Set(['Expense', 'Other Expense', 'Cost of Goods Sold'])
};

export const UNDEPOSITED_FUNDS = 'UndepositedFunds';

/** whether Intuit takes this account in the place `role` is posted to. */
export function fitsRole(account: LedgerAccount, role: AccountRole): boolean {
	if (role === 'deposit' && account.subType === UNDEPOSITED_FUNDS) return false;
	return ROLE_TYPES[role].has(account.type);
}

/** one account per role, or null where the chart holds none that fits it. */
export type DefaultAccounts = Readonly<Record<AccountRole, LedgerAccount | null>>;

/** the three roles filled from a company's own chart, so a connection needs nothing picked. */
export function defaultAccounts(chart: readonly LedgerAccount[]): DefaultAccounts {
	return {
		// an other current asset fits, but a gift landing in prepaid expenses is nobody's first guess.
		deposit: chart.find((account) => account.type === 'Bank') ?? null,
		income: preferNamed(chart, 'income', [/donation/i, /contribution/i]),
		fee: preferNamed(chart, 'fee', [/bank charge/i, /merchant/i, /processing/i, /fee/i])
	};
}

/**
 * the first account fitting `role` named by the earliest of `names` that names any, else the first
 * fitting at all. each name is tried over the whole chart before the next, so a broad late one
 * ("fee", which "Legal & Professional Fees" answers) never wins over a narrow early one.
 */
function preferNamed(
	chart: readonly LedgerAccount[],
	role: AccountRole,
	names: readonly RegExp[]
): LedgerAccount | null {
	const fitting = chart.filter((account) => fitsRole(account, role));
	for (const name of names) {
		const named = fitting.find((account) => name.test(account.name));
		if (named !== undefined) return named;
	}
	return fitting[0] ?? null;
}
