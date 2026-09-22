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

/** one account per role, or null where the chart names none for it. */
export type DefaultAccounts = Readonly<Record<AccountRole, LedgerAccount | null>>;

/**
 * the roles the chart's own names settle, so a connection opens with them picked.
 *
 * a name match or nothing: which account a gift lands in is the operator's call, and a role left
 * null keeps every send held on `accounts_not_chosen` until they make it on the console. a guess by
 * account type alone would post real gifts into rent or sales with nobody having said so.
 */
export function defaultAccounts(chart: readonly LedgerAccount[]): DefaultAccounts {
	return {
		// bank only: an other current asset fits the role, but a reserve or prepaid account named
		// "operating" is not where a payout lands.
		deposit: firstNamed(
			chart.filter((account) => account.type === 'Bank'),
			[/checking/i, /operating/i]
		),
		income: firstNamed(fitting(chart, 'income'), [/donation/i, /contribution/i]),
		// fees for moving money only; a bare /fee/ also answers "Legal & Professional Fees".
		fee: firstNamed(fitting(chart, 'fee'), [
			/bank (service )?charge/i,
			/merchant/i,
			/processing/i,
			/processor/i,
			/\b(bank|card|transaction|payment|stripe|paypal) fees?\b/i
		])
	};
}

function fitting(chart: readonly LedgerAccount[], role: AccountRole): LedgerAccount[] {
	return chart.filter((account) => fitsRole(account, role));
}

/**
 * the first of `candidates` named by the earliest of `names` that names any, else null. each name
 * is tried over every candidate before the next, so an early narrow name wins wherever it sits.
 */
function firstNamed(
	candidates: readonly LedgerAccount[],
	names: readonly RegExp[]
): LedgerAccount | null {
	for (const name of names) {
		const named = candidates.find((account) => name.test(account.name));
		if (named !== undefined) return named;
	}
	return null;
}
