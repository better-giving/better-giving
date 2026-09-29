import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, QuickbooksRead } from '../api/types';
import { PAID_PLAN } from './cloudflare-plan';
import type { QuickbooksSectionProps } from './quickbooks-section';
import { QuickbooksSection } from './quickbooks-section';

// the Free plan's pace on the QuickBooks screen: said while the deployment reads its account as on
// the Free plan, and gone once it reads as paid. markup, for the reason ./quickbooks-accounts.spec.ts
// gives.

const BOOKS: QuickbooksRead = {
	kind: 'read',
	report: {
		connection: { state: 'disconnected' },
		accounts: null,
		backlog: { failed: 0, oldestWaitingAt: null, heldBehindFailed: [] },
		callbackAddress: 'https://give.example.org/quickbooks/callback'
	}
};

/** the whole section over a deployment holding `vars`, awaited. */
async function section(vars: DeployedVar[]): Promise<string> {
	const props: QuickbooksSectionProps = {
		values: { vars: { kind: 'read', vars } },
		books: BOOKS,
		workerName: 'better-giving',
		accountName: 'Riverbank Trust',
		secrets: null,
		answer: null,
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

const NOTICE = 'The books reach QuickBooks 1 gift a minute';

describe('the Free plan’s pace', () => {
	it('is said, with where to change it, where the deployment holds no answer', async () => {
		const page = await section([]);
		expect(page).toContain(NOTICE);
		expect(page).toContain('Cloudflare plan page');
	});

	it('is said where the answer is one the deployment reads as Free', async () => {
		expect(await section([{ name: PAID_PLAN, kind: 'value', value: 'yes' }])).toContain(NOTICE);
	});

	it('is gone once the deployment reads the account as on the paid plan', async () => {
		const page = await section([{ name: PAID_PLAN, kind: 'value', value: 'true' }]);
		expect(page).not.toContain('The books reach QuickBooks');
	});
});
