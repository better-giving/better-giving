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

describe('which accounts fit a processor’s holding', () => {
	it.each(['stripeBalance', 'paypalBalance', 'chariotBalance', 'nowpaymentsBalance'] as const)(
		'%s takes an other current asset and refuses a bank account',
		(role) => {
			expect(fitsRole(account('Other Current Asset', 'OtherCurrentAssets'), role)).toBe(true);
			expect(fitsRole(account('Bank', 'Checking'), role)).toBe(false);
		}
	);

	it('refuses undeposited funds, which holds what was received in hand', () => {
		expect(fitsRole(account('Other Current Asset', 'UndepositedFunds'), 'stripeBalance')).toBe(
			false
		);
	});
});

describe('which accounts fit undeposited funds', () => {
	it('takes the built-in undeposited funds and refuses a bank account', () => {
		expect(fitsRole(account('Other Current Asset', 'UndepositedFunds'), 'undepositedFunds')).toBe(
			true
		);
		expect(fitsRole(account('Bank', 'Checking'), 'undepositedFunds')).toBe(false);
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

describe('the default holding accounts', () => {
	it.each([
		['stripeBalance', 'Stripe balance'],
		['stripeBalance', 'Stripe Clearing'],
		['paypalBalance', 'PayPal balance'],
		['chariotBalance', 'Chariot clearing'],
		['nowpaymentsBalance', 'NOWPayments balance']
	] as const)('%s is the other current asset named %s', (role, name) => {
		const named = account('Other Current Asset', 'OtherCurrentAssets', name);
		const chart = [account('Other Current Asset', 'PrepaidExpenses', 'Prepaid'), named];

		expect(defaultAccounts(chart)[role]).toBe(named);
	});

	it('is never a bank account, whatever it is named', () => {
		const chart = [
			account('Bank', 'Checking', 'Stripe'),
			account('Bank', 'Checking', 'PayPal balance'),
			account('Bank', 'Checking', 'Undeposited Funds')
		];

		expect(defaultAccounts(chart)).toMatchObject({
			stripeBalance: null,
			paypalBalance: null,
			undepositedFunds: null
		});
	});

	it('is never undeposited funds for a processor', () => {
		const chart = [account('Other Current Asset', 'UndepositedFunds', 'Stripe undeposited')];

		expect(defaultAccounts(chart).stripeBalance).toBeNull();
	});

	it('is the built-in undeposited funds for a gift received in hand, whatever it is called', () => {
		const undeposited = account('Other Current Asset', 'UndepositedFunds', 'Payments to deposit');
		const chart = [
			account('Other Current Asset', 'OtherCurrentAssets', 'Stripe balance'),
			undeposited
		];

		expect(defaultAccounts(chart).undepositedFunds).toBe(undeposited);
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

	it('is left unpicked where no income account is named for gifts', () => {
		const chart = [
			account('Bank', null, 'Checking'),
			account('Income', null, 'Sales'),
			account('Other Income', null, 'Interest')
		];

		expect(defaultAccounts(chart).income).toBeNull();
	});
});

describe('the default fee account', () => {
	it.each([
		'Bank Charges',
		'Bank service charges',
		'Bank fees',
		'Merchant account',
		'Card processing',
		'Payment processor',
		'Payment processing fees',
		'Stripe fees',
		'PayPal fees',
		'Credit card fees',
		'Transaction fees'
	])('is the expense account named like %s', (name) => {
		const named = account('Expense', null, name);
		const chart = [account('Income', null, 'Fee income'), account('Expense', null, 'Rent'), named];

		expect(defaultAccounts(chart).fee).toBe(named);
	});

	it('prefers bank charges, then merchant, then processing, wherever each sits', () => {
		const processing = account('Expense', null, 'Card processing');
		const merchant = account('Expense', null, 'Merchant account');
		const bank = account('Expense', null, 'Bank Charges');

		expect(defaultAccounts([processing, merchant, bank]).fee).toBe(bank);
		expect(defaultAccounts([processing, merchant]).fee).toBe(merchant);
	});

	it.each(['Legal & Professional Fees', 'Dues & subscriptions fees', 'Licenses and fees'])(
		'is not %s, which is a fee nobody charged for moving a gift',
		(name) => {
			expect(defaultAccounts([account('Expense', null, name)]).fee).toBeNull();
		}
	);

	it('is left unpicked where no expense account is named for processing fees', () => {
		const chart = [
			account('Income', null, 'Donations'),
			account('Expense', null, 'Rent'),
			account('Expense', null, 'Postage')
		];

		expect(defaultAccounts(chart).fee).toBeNull();
	});
});

describe('a chart missing a role', () => {
	it('leaves that role empty rather than filling it with an account that does not fit', () => {
		const chart = [
			account('Accounts Receivable', 'AccountsReceivable', 'Accounts Receivable (A/R)'),
			account('Other Current Asset', 'PrepaidExpenses', 'Prepaid'),
			account('Equity', 'OpeningBalanceEquity', 'Donations equity')
		];

		expect(defaultAccounts(chart)).toEqual({
			income: null,
			fee: null,
			stripeBalance: null,
			paypalBalance: null,
			chariotBalance: null,
			nowpaymentsBalance: null,
			undepositedFunds: null
		});
	});
});
