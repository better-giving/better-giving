import { describe, expect, it } from 'vitest';
import type { LedgerAccount } from './provider';
import { defaultAccounts, fitsRole } from './quickbooks-accounts';

// the account types below are Intuit's AccountType values as the Account query returns them.

const account = (type: string, subType: string | null = null, name = type): LedgerAccount => ({
	id: `${type}/${subType ?? ''}/${name}`,
	name,
	type,
	subType,
	classification: null
});

describe('which accounts fit the deposit role', () => {
	it('takes a bank account and refuses accounts receivable', () => {
		expect(fitsRole(account('Bank', 'Checking'), 'deposit')).toBe(true);
		expect(fitsRole(account('Accounts Receivable', 'AccountsReceivable'), 'deposit')).toBe(false);
	});

	it('takes an other current asset, but not undeposited funds', () => {
		expect(fitsRole(account('Other Current Asset', 'OtherCurrentAssets'), 'deposit')).toBe(true);
		expect(fitsRole(account('Other Current Asset', 'UndepositedFunds'), 'deposit')).toBe(false);
	});
});

describe('which accounts fit the income role', () => {
	it('takes income and other income, and refuses an expense', () => {
		expect(fitsRole(account('Income', 'NonProfitIncome'), 'income')).toBe(true);
		expect(fitsRole(account('Other Income', 'OtherMiscellaneousIncome'), 'income')).toBe(true);
		expect(fitsRole(account('Expense', 'BankCharges'), 'income')).toBe(false);
	});
});

describe('which accounts fit the fee role', () => {
	it('takes expense, other expense and cost of goods sold, and refuses income', () => {
		expect(fitsRole(account('Expense', 'BankCharges'), 'fee')).toBe(true);
		expect(fitsRole(account('Other Expense', 'OtherMiscellaneousExpense'), 'fee')).toBe(true);
		expect(fitsRole(account('Cost of Goods Sold', 'OtherCostsOfServiceCos'), 'fee')).toBe(true);
		expect(fitsRole(account('Income', 'NonProfitIncome'), 'fee')).toBe(false);
	});
});

describe('the default deposit account', () => {
	it('is the first bank account, ahead of undeposited funds and other current assets', () => {
		const checking = account('Bank', 'Checking', 'Checking');
		const chart = [
			account('Other Current Asset', 'UndepositedFunds', 'Undeposited Funds'),
			account('Other Current Asset', 'PrepaidExpenses', 'Prepaid'),
			checking,
			account('Bank', 'Savings', 'Savings')
		];

		expect(defaultAccounts(chart).deposit).toBe(checking);
	});
});

describe('the default income account', () => {
	it('is the first income account named for contributions where none is for donations', () => {
		const contributions = account('Other Income', null, 'Individual CONTRIBUTIONS');
		const chart = [
			account('Expense', null, 'Donations to other charities'),
			account('Income', null, 'Sales'),
			contributions,
			account('Income', null, 'Contributions in kind')
		];

		expect(defaultAccounts(chart).income).toBe(contributions);
	});

	it('prefers a donations account to an earlier contributions account', () => {
		const donations = account('Income', null, 'Donations');
		const chart = [account('Income', null, 'Contributions'), donations];

		expect(defaultAccounts(chart).income).toBe(donations);
	});

	it('is the first income account where none is named for gifts', () => {
		const sales = account('Income', null, 'Sales');
		const chart = [
			account('Bank', null, 'Checking'),
			sales,
			account('Other Income', null, 'Interest')
		];

		expect(defaultAccounts(chart).income).toBe(sales);
	});
});

describe('the default fee account', () => {
	it.each(['Bank Charges', 'Merchant account', 'Card processing', 'Stripe fees'])(
		'is the first expense account named like %s',
		(name) => {
			const named = account('Expense', null, name);
			const chart = [
				account('Income', null, 'Fee income'),
				account('Expense', null, 'Rent'),
				named
			];

			expect(defaultAccounts(chart).fee).toBe(named);
		}
	);

	it('prefers bank charges, then merchant, then processing, then any fee, wherever each sits', () => {
		const legal = account('Expense', null, 'Legal & Professional Fees');
		const processing = account('Expense', null, 'Card processing');
		const merchant = account('Expense', null, 'Merchant account');
		const bank = account('Expense', null, 'Bank Charges');

		expect(defaultAccounts([legal, processing, merchant, bank]).fee).toBe(bank);
		expect(defaultAccounts([legal, processing, merchant]).fee).toBe(merchant);
		expect(defaultAccounts([legal, processing]).fee).toBe(processing);
	});

	it('is the first expense account where none is named for fees', () => {
		const rent = account('Expense', null, 'Rent');
		const chart = [account('Income', null, 'Donations'), rent, account('Expense', null, 'Postage')];

		expect(defaultAccounts(chart).fee).toBe(rent);
	});
});

describe('a chart missing a role', () => {
	it('leaves that role empty rather than filling it with an account that does not fit', () => {
		const chart = [
			account('Accounts Receivable', 'AccountsReceivable', 'Accounts Receivable (A/R)'),
			account('Other Current Asset', 'PrepaidExpenses', 'Prepaid'),
			account('Equity', 'OpeningBalanceEquity', 'Donations equity')
		];

		expect(defaultAccounts(chart)).toEqual({ deposit: null, income: null, fee: null });
	});
});
