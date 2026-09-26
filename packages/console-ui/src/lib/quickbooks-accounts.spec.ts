import type {
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksPressReport,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, DeployVarName, QuickbooksRead } from '../api/types';
import type { AccountsPanelProps } from './quickbooks-accounts';
import { AccountsPanel } from './quickbooks-accounts';
import type { QuickbooksSectionProps } from './quickbooks-section';
import { QuickbooksSection } from './quickbooks-section';
import type { QuickbooksAnswer } from './quickbooks-standing';
import { CHARGE_PAIRS } from './processor-links';

// the QuickBooks screen's Accounts step and its Connect step as markup. this package pins one node
// pool and no dom (../../vite.config.ts), so what is held here is what each state draws; the
// decisions under it are held one by one in ./quickbooks-standing.spec.ts.

const account = (
	id: string,
	name: string,
	type: string,
	roles: LedgerAccountLine['roles']
): LedgerAccountLine => ({ id, name, type, subType: null, classification: null, roles });

const CHART: LedgerAccountLine[] = [
	account('10', 'Donations', 'Income', ['income']),
	account('20', 'Merchant fees', 'Expense', ['fee']),
	account('30', 'Stripe balance', 'Other Current Asset', [
		'stripeBalance',
		'paypalBalance',
		'chariotBalance',
		'nowpaymentsBalance'
	]),
	account('40', 'Undeposited Funds', 'Other Current Asset', ['undepositedFunds'])
];

const company = (over: Partial<QuickbooksCompany> = {}): QuickbooksCompany => ({
	state: 'connected',
	realmId: '9130',
	companyName: 'Riverbank Trust',
	income: { id: '10', name: 'Donations' },
	fee: { id: '20', name: 'Merchant fees' },
	stripeBalance: null,
	paypalBalance: null,
	chariotBalance: null,
	nowpaymentsBalance: null,
	undepositedFunds: null,
	awaitingAccounts: false,
	startAt: '2026-01-31T00:00:00.000Z',
	...over
});

const report = (over: Partial<QuickbooksReport> = {}): QuickbooksReport => ({
	connection: company(),
	accounts: { state: 'read', accounts: CHART },
	backlog: { failed: 0, oldestWaitingAt: null, heldBehindFailed: [] },
	callbackAddress: 'https://give.example.org/quickbooks/callback',
	...over
});

/** the names a deployment set up on Stripe alone holds. */
const STRIPE_ONLY: ReadonlySet<string> = new Set(CHARGE_PAIRS.stripe);

const panel = (props: Partial<AccountsPanelProps>): string => {
	const connected = props.company ?? company();
	return renderToStaticMarkup(
		createElement(AccountsPanel, {
			report: report({ connection: connected }),
			company: connected,
			held: STRIPE_ONLY,
			answer: null,
			busy: false,
			pending: null,
			onAccounts: () => {},
			onConfirming: () => {},
			elsewhere: undefined,
			...props
		})
	);
};

/** each group's legend, and the pickers labelled under it, in the order they stand. */
function groups(page: string): string[] {
	return [...page.matchAll(/<fieldset[^>]*>([\s\S]*?)<\/fieldset>/g)].map((group) => {
		const body = group[1] ?? '';
		const legend = /<legend[^>]*>(.*?)<\/legend>/.exec(body)?.[1] ?? '';
		const labels = [...body.matchAll(/<label[^>]*>(.*?)<\/label>/g)].map((found) => found[1]);
		return `${legend}: ${labels.join(', ')}`;
	});
}

/** the options a picker's own form control offers, by the words each one draws. */
function offered(page: string, id: string): string[] {
	const select = new RegExp(`<select[^>]*name="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(page);
	return [...(select?.[1] ?? '').matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(
		(found) => found[1] ?? ''
	);
}

describe('the Accounts step’s two groups', () => {
	it('draws what a gift is recorded as, then where its money waits', () => {
		expect(groups(panel({}))).toEqual([
			'What a gift is recorded as: Income, Processing fees',
			'Where money waits before it reaches your bank: Stripe balance, Gifts recorded by hand'
		]);
	});

	it('draws a holding for every processor the deployment takes gifts through', () => {
		const every = new Set(Object.values(CHARGE_PAIRS).flat());
		expect(groups(panel({ held: every }))[1]).toBe(
			'Where money waits before it reaches your bank: Stripe balance, PayPal balance, ' +
				'Chariot balance, NOWPayments balance, Gifts recorded by hand'
		);
	});

	it('draws a holding still stored for a processor whose keys are gone', () => {
		const stored = company({ paypalBalance: { id: '30', name: 'Stripe balance' } });
		expect(groups(panel({ company: stored }))[1]).toBe(
			'Where money waits before it reaches your bank: Stripe balance, PayPal balance, ' +
				'Gifts recorded by hand'
		);
	});

	it('says over each holding that its payout is a transfer out of it, off the bank feed', () => {
		const page = panel({});
		expect(page).toContain(
			'Record each Stripe payout from your bank feed as a transfer out of this account.'
		);
		expect(page).toContain(
			'Record each deposit from your bank feed as a transfer out of this account.'
		);
	});

	it('draws the same two groups where the chart could not be read', () => {
		const page = panel({
			report: report({
				accounts: { state: 'unreadable', recourse: 'wait', detail: 'Intuit timed out.' }
			})
		});
		expect(page).toContain('What a gift is recorded as');
		expect(page).toContain('Where money waits before it reaches your bank');
		expect(page).toContain('QuickBooks can’t be reached right now.');
	});
});

describe('a holding offers none', () => {
	it('offers none on a holding the connection stores, where income offers no empty line', () => {
		const page = panel({
			company: company({ stripeBalance: { id: '30', name: 'Stripe balance' } })
		});
		expect(offered(page, 'quickbooks-stripeBalance')).toEqual([
			'None',
			'Stripe balance — Other Current Asset'
		]);
		expect(offered(page, 'quickbooks-income')).toEqual(['Donations — Income']);
	});
});

describe('a connection moved to another company', () => {
	it('says nothing is sent until its accounts are saved', () => {
		const page = panel({ company: company({ awaitingAccounts: true }) });
		expect(page).toContain(
			'This connection moved to Riverbank Trust, and nothing is sent to QuickBooks until its ' +
				'accounts are saved.'
		);
	});

	it('says nothing of the sort over a connection that stayed', () => {
		expect(panel({})).not.toContain('This connection moved');
	});
});

describe('a refusal of the accounts press', () => {
	const refused = (detail: string): QuickbooksAnswer => ({
		kind: 'unanswered',
		press: 'accounts',
		read: {
			kind: 'unreadable',
			error: 'account_wrong_type',
			detail,
			fix: 'Send the `id` of an Other Current Asset account for `stripeBalance`.',
			status: 400
		}
	});

	it('is said at the press where nothing on the screen has pressed since it was drawn', () => {
		// a form drawn over an answer it never pressed for holds nothing, so the refusal is the
		// press's own sentence and no picker is marked.
		const page = panel({ answer: refused('`stripeBalance` names Checking, a Bank account.') });
		expect(page).toContain('This deployment turned that down.');
		expect(page).not.toContain('never a bank account');
	});
});

/** the whole section, where the Connect step's answer to a disconnect is drawn. */
async function section(answer: QuickbooksAnswer | null): Promise<string> {
	const vars: DeployedVar[] = (
		['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_API_URL'] as DeployVarName[]
	).map((name) => ({ name, kind: 'value', value: 'x' }));
	const books: QuickbooksRead = {
		kind: 'read',
		report: report({ connection: { state: 'disconnected' }, accounts: null })
	};
	const props: QuickbooksSectionProps = {
		values: { vars: { kind: 'read', vars } },
		books,
		workerName: 'better-giving',
		accountName: 'Riverbank Trust',
		secrets: null,
		answer,
		preview: null,
		previewing: false,
		freed: null,
		busy: false,
		pending: null,
		revalidating: false,
		onConnect: () => {},
		onAccounts: () => {},
		onPreviewStartDate: () => {},
		onStartDate: () => {},
		onRetry: () => {},
		onDisconnect: () => {}
	};
	const router = createMemoryRouter([
		{ path: '/', Component: () => createElement(QuickbooksSection, props) }
	]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	return page;
}

const disconnected = (revoke: Extract<QuickbooksPressReport, { press: 'disconnect' }>['revoke']) =>
	({ kind: 'reported', report: { press: 'disconnect', revoke } }) as const;

describe('the answer to a disconnect', () => {
	it('draws the deployment’s detail and its fix where Intuit did not confirm the revoke', async () => {
		const page = await section(
			disconnected({
				state: 'not_revoked',
				detail: 'Intuit refused the revoke (400 invalid_grant).',
				fix: 'In QuickBooks Online, open Apps, then My Apps, and disconnect it there.'
			})
		);
		expect(page).toContain('Intuit didn’t confirm the disconnect.');
		expect(page).toContain('Intuit refused the revoke (400 invalid_grant).');
		expect(page).toContain(
			'In QuickBooks Online, open Apps, then My Apps, and disconnect it there.'
		);
		expect(page).toContain('Choose a company');
	});

	it('draws only the way back in where the revoke landed', async () => {
		const page = await section(disconnected({ state: 'revoked' }));
		expect(page).not.toContain('Intuit didn’t confirm');
		expect(page).toContain('Choose a company');
	});
});
