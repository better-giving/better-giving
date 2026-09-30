import { createElement } from 'react';
import type { ReactNode } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, FeedsInUse } from '../api/types';
import type { CloudflareAccountPanelProps } from './cloudflare-account';
import { CloudflareAccountPanel, cloudflareAccount, PACED_WORD } from './cloudflare-account';
import { PAID_PLAN, PLAN_FIELD } from './cloudflare-plan';
import type { HeldValues } from './held-values';
import { heldValues } from './held-values';

// the account as the rail's foot and the band draw it, and the panel either opens, as markup. this
// package pins one node pool and no dom (../../vite.config.ts), so a face is held as what it draws
// and where its link goes, and what the switch inside the panel posts is
// ./cloudflare-plan-block.spec.ts's.

/** `node` drawn under a router, awaited. */
async function drawn(node: () => ReactNode): Promise<string> {
	const router = createMemoryRouter([{ path: '/', Component: node }]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	// react marks where one text node meets the next; the reader sees one run of words
	return page.replaceAll('<!-- -->', '');
}

const IDLE: FeedsInUse = { zapier: false, webhooks: false, books: false };
const ZAPIER: FeedsInUse = { ...IDLE, zapier: true };

const PAID: DeployedVar[] = [{ name: PAID_PLAN, kind: 'value', value: 'true' }];

/** both faces of the account, drawn from what the deployment holds and which feeds are in use. */
const faces = (values: HeldValues | null, feedsInUse: FeedsInUse | null) =>
	cloudflareAccount({
		name: 'Riverside Shelter’s Account',
		values,
		feedsInUse,
		openHref: '/sites?account',
		closeControl: createElement('button', { type: 'button' }, 'Close console')
	});

const row = (values: HeldValues | null, feedsInUse: FeedsInUse | null) =>
	drawn(() => faces(values, feedsInUse).row);
const band = (values: HeldValues | null, feedsInUse: FeedsInUse | null) =>
	drawn(() => faces(values, feedsInUse).band);

/** the one link a face draws, open tag to close tag. */
const link = (page: string): string => {
	const found = page.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
	expect(found).toHaveLength(1);
	return found[0] as string;
};

describe('the account row', () => {
	it('draws the logo and the account’s name as the link that opens its panel', async () => {
		const opens = link(await row(heldValues([]), IDLE));
		expect(opens).toContain('href="/sites?account"');
		expect(opens).toContain('adm-brand--cloudflare');
		expect(opens).toContain('Riverside Shelter’s Account');
		expect(opens).not.toContain('title=');
	});

	it('keeps the close control it was handed, outside the link', async () => {
		const page = await row(heldValues([]), IDLE);
		expect(page).toContain('<button type="button">Close console</button>');
		expect(link(page)).not.toContain('Close console');
	});

	it('marks nothing where the plan is no concern', async () => {
		for (const page of [
			await row(heldValues([]), IDLE),
			await row(heldValues([]), null),
			await row(null, ZAPIER),
			await row(heldValues(PAID), ZAPIER)
		]) {
			expect(page).not.toContain('adm-accountmark');
			expect(page).not.toContain(PACED_WORD);
		}
	});

	it('marks the name inside its link where it is, with a word read after the name', async () => {
		const opens = link(await row(heldValues([]), ZAPIER));
		expect(opens).toContain('adm-accountmark');
		expect(opens).toMatch(/<span class="adm-vh">, Deliveries paced for the Free plan<\/span>/);
		expect(opens.indexOf('Riverside Shelter’s Account')).toBeLessThan(opens.indexOf(PACED_WORD));
	});
});

describe('the account in the band', () => {
	it('opens the same panel, marked where the row is, named with the same words', async () => {
		const marked = link(await band(heldValues([]), ZAPIER));
		expect(marked).toContain('href="/sites?account"');
		expect(marked).toContain('adm-accountmark');
		expect(marked).toContain(
			`aria-label="Cloudflare account Riverside Shelter’s Account, ${PACED_WORD}"`
		);
		expect(marked).not.toContain('title=');

		const plain = link(await band(heldValues([]), IDLE));
		expect(plain).not.toContain('adm-accountmark');
		expect(plain).toContain('aria-label="Cloudflare account Riverside Shelter’s Account"');
	});
});

const panel = (vars: DeployedVar[], feedsInUse: FeedsInUse | null) => {
	const props: CloudflareAccountPanelProps = {
		name: 'Riverside Shelter’s Account',
		accountId: '0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4',
		feedsInUse,
		back: '/sites',
		values: heldValues(vars),
		trouble: () => null
	};
	return drawn(() => createElement(CloudflareAccountPanel, props));
};

describe('the account panel', () => {
	it('is headed by the account’s name, and holds the paid-plan switch', async () => {
		const page = await panel([], IDLE);
		expect(page).toMatch(/<h2 id="[^"]+">Riverside Shelter’s Account<\/h2>/);
		expect(page).toContain(`name="${PLAN_FIELD}"`);
	});

	it('names each feed delivered at the Free plan’s pace where that is why the row is marked', async () => {
		expect(await panel([], { zapier: true, webhooks: true, books: true })).toContain(
			'This deployment delivers to Zapier, webhook destinations and QuickBooks at the Free plan’s pace.'
		);
		expect(await panel([], { zapier: false, webhooks: true, books: false })).toContain(
			'This deployment delivers to webhook destinations at the Free plan’s pace.'
		);
	});

	it('states the account’s id, which neither opener carries', async () => {
		expect(await panel([], IDLE)).toContain('0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4');
	});

	it('names only the feeds it has a word for, as the mark counts them', async () => {
		const newer = { ...IDLE, outbound: true } as FeedsInUse;
		expect(await panel([], newer)).not.toContain('This deployment delivers to');
		expect(await row(heldValues([]), newer)).not.toContain('adm-accountmark');
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
