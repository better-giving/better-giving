import { isHoldingRole, type AccountRole, type LedgerAccount } from './provider';

// which of a QuickBooks company's accounts may hold each role.
//
// every record this app sends is a JournalEntry, whose lines take an account of any type
// (https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry), so
// Intuit refuses nothing here and the narrowing is this app's: a figure posted to the wrong kind of
// account lands on the wrong statement with nothing refusing it.
// - income takes Income or Other Income, and fee takes Expense, Other Expense or Cost of Goods Sold.
// - every holding takes Other Current Asset and never Bank. no payout reaches QuickBooks from here
//   (./provider.ts's `HOLDING_ROLES`), so a gift posted to the bank is a deposit the bank feed never
//   shows, and the payout it does show is matched against nothing — a bookkeeper's quickest way past
//   it is to add the payout as income, counting every gift in it twice.
// - a processor's holding is never undeposited funds: that is where a gift received in hand waits
//   to be banked, and one account holding two parties' money no longer says what either owes.
const HOLDING_TYPES: ReadonlySet<string> = new Set(['Other Current Asset']);

export const ROLE_TYPES: Record<AccountRole, ReadonlySet<string>> = {
	income: new Set(['Income', 'Other Income']),
	fee: new Set(['Expense', 'Other Expense', 'Cost of Goods Sold']),
	stripeBalance: HOLDING_TYPES,
	paypalBalance: HOLDING_TYPES,
	chariotBalance: HOLDING_TYPES,
	nowpaymentsBalance: HOLDING_TYPES,
	undepositedFunds: HOLDING_TYPES
};

export const UNDEPOSITED_FUNDS = 'UndepositedFunds';

/** whether this app will post `role` into this account. */
export function fitsRole(account: LedgerAccount, role: AccountRole): boolean {
	if (isProcessorHolding(role) && account.subType === UNDEPOSITED_FUNDS) return false;
	return ROLE_TYPES[role].has(account.type);
}

function isProcessorHolding(role: AccountRole): boolean {
	return isHoldingRole(role) && role !== 'undepositedFunds';
}

/** one account per role, or null where the chart names none for it. */
export type DefaultAccounts = Readonly<Record<AccountRole, LedgerAccount | null>>;

/**
 * the roles the chart's own names settle, so a connection opens with them picked.
 *
 * a name match or nothing: which account a gift lands in is the operator's call, and a role left
 * null holds every send that needs it until they make it on the console. a guess by account type
 * alone would post real gifts into rent or sales with nobody having said so.
 * a processor's holding the chart names none for is one ./connection.ts may create instead.
 */
export function defaultAccounts(chart: readonly LedgerAccount[]): DefaultAccounts {
	return {
		income: firstNamed(fitting(chart, 'income'), [/donation/i, /contribution/i]),
		// fees for moving money only; a bare /fee/ also answers "Legal & Professional Fees".
		fee: firstNamed(fitting(chart, 'fee'), [
			/bank (service )?charge/i,
			/merchant/i,
			/processing/i,
			/processor/i,
			/\b(bank|card|transaction|payment|stripe|paypal) fees?\b/i
		]),
		stripeBalance: firstNamed(fitting(chart, 'stripeBalance'), [/stripe/i]),
		paypalBalance: firstNamed(fitting(chart, 'paypalBalance'), [/paypal/i]),
		chariotBalance: firstNamed(fitting(chart, 'chariotBalance'), [/chariot/i]),
		nowpaymentsBalance: firstNamed(fitting(chart, 'nowpaymentsBalance'), [/now ?payments/i]),
		// the subtype rather than a name: QuickBooks makes one for every company and a bookkeeper may
		// have renamed it.
		undepositedFunds:
			fitting(chart, 'undepositedFunds').find((account) => account.subType === UNDEPOSITED_FUNDS) ??
			null
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
