import { createElement } from 'react';
import type { ReactNode } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, FeedsInUse } from '../api/types';
import type { CloudflareAccountPanelProps } from './cloudflare-account';
import { CloudflareAccount, CloudflareAccountPanel, PACED_WORD } from './cloudflare-account';
import { PAID_PLAN, PLAN_FIELD } from './cloudflare-plan';
import { heldValues } from './held-values';

// the rail foot's account row and the panel its name opens, as markup. this package pins one node
// pool and no dom (../../vite.config.ts), so a row is held as what it draws and where its link
// goes, and what the switch inside the panel posts is ./cloudflare-plan-block.spec.ts's.

/** `node` drawn under a router, awaited. */
async function drawn(node: () => ReactNode): Promise<string> {
	const router = createMemoryRouter([{ path: '/', Component: node }]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	// react marks where one text node meets the next; the reader sees one run of words
	return page.replaceAll('<!-- -->', '');
}

const row = (concern: boolean) =>
	drawn(() =>
		createElement(CloudflareAccount, {
			name: 'Riverside Shelter’s Account',
			accountId: '0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4',
			concern,
			openHref: '/sites?account',
			closeControl: createElement('button', { type: 'button' }, 'Close console')
		})
	);

/** the one link the row draws, open tag to close tag. */
const link = (page: string): string => {
	const found = page.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
	expect(found).toHaveLength(1);
	return found[0] as string;
};

describe('the account row', () => {
	it('draws the account’s name as the link that opens its panel, carrying the id', async () => {
		const opens = link(await row(false));
		expect(opens).toContain('href="/sites?account"');
		expect(opens).toContain('Riverside Shelter’s Account');
		expect(opens).toContain('title="0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4"');
	});

	it('keeps the close control it was handed, outside the link', async () => {
		const page = await row(false);
		expect(page).toContain('<button type="button">Close console</button>');
		expect(link(page)).not.toContain('Close console');
	});

	it('marks nothing where the plan is no concern', async () => {
		const page = await row(false);
		expect(page).not.toContain('adm-footaccount__status');
		expect(page).not.toContain(PACED_WORD);
	});

	it('marks the name inside its link where it is, with a word read after the name', async () => {
		const opens = link(await row(true));
		expect(opens).toContain('adm-footaccount__status');
		expect(opens).toMatch(/<span class="adm-vh">, Deliveries paced for the Free plan<\/span>/);
		expect(opens.indexOf('Riverside Shelter’s Account')).toBeLessThan(opens.indexOf(PACED_WORD));
	});
});

const IDLE: FeedsInUse = { zapier: false, webhooks: false, books: false };

const panel = (vars: DeployedVar[], feedsInUse: FeedsInUse | null) => {
	const props: CloudflareAccountPanelProps = {
		name: 'Riverside Shelter’s Account',
		feedsInUse,
		back: '/sites',
		values: heldValues(vars),
		written: null,
		freed: null,
		trouble: () => null,
		busy: false,
		pending: null
	};
	return drawn(() => createElement(CloudflareAccountPanel, props));
};

const PAID: DeployedVar[] = [{ name: PAID_PLAN, kind: 'value', value: 'true' }];

describe('the account panel', () => {
	it('is headed by the account’s name, and holds the paid-plan switch', async () => {
		const page = await panel([], IDLE);
		expect(page).toMatch(/<h2 id="[^"]+">Riverside Shelter’s Account<\/h2>/);
		expect(page).toContain(`name="${PLAN_FIELD}"`);
	});

	it('goes back to the page it was opened over, without the parameter', async () => {
		const page = await panel([], IDLE);
		expect(page).toMatch(/<a\b[^>]*href="\/sites"[^>]*>/);
	});

	it('names each feed delivered at the Free plan’s pace where that is why the row is marked', async () => {
		expect(await panel([], { zapier: true, webhooks: true, books: true })).toContain(
			'This deployment delivers to Zapier, webhook destinations and QuickBooks at the Free plan’s pace.'
		);
		expect(await panel([], { zapier: false, webhooks: true, books: false })).toContain(
			'This deployment delivers to webhook destinations at the Free plan’s pace.'
		);
	});

	it('says nothing about pace where the row is not marked', async () => {
		const all = { zapier: true, webhooks: true, books: true };
		for (const page of [
			await panel([], IDLE),
			await panel([], null),
			await panel(PAID, all),
			await panel([{ name: PAID_PLAN, kind: 'withheld' }], all)
		]) {
			expect(page).not.toContain('This deployment delivers to');
		}
	});
});
