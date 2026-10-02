import { createElement } from 'react';
import type { ReactNode } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CloudflareAccountPanel, cloudflareAccount } from './cloudflare-account';

// the account as the rail's foot and the band draw it, and the panel either opens, as markup. this
// package pins one node pool and no dom (../../vite.config.ts), so a face is held as what it draws
// and where its link goes.

/** `node` drawn under a router, awaited. */
async function drawn(node: () => ReactNode): Promise<string> {
	const router = createMemoryRouter([{ path: '/', Component: node }]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	// react marks where one text node meets the next; the reader sees one run of words
	return page.replaceAll('<!-- -->', '');
}

const faces = () =>
	cloudflareAccount({
		name: 'Riverside Shelter’s Account',
		openHref: '/sites?account',
		closeControl: createElement('button', { type: 'button' }, 'Close console')
	});

/** the one link a face draws, open tag to close tag. */
const link = (page: string): string => {
	const found = page.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
	expect(found).toHaveLength(1);
	return found[0] as string;
};

describe('the account row', () => {
	it('draws the logo and the account’s name as the link that opens its panel', async () => {
		const opens = link(await drawn(() => faces().row));
		expect(opens).toContain('href="/sites?account"');
		expect(opens).toContain('adm-brand--cloudflare');
		expect(opens).toContain('Riverside Shelter’s Account');
		expect(opens).not.toContain('title=');
	});

	it('keeps the close control it was handed, outside the link', async () => {
		const page = await drawn(() => faces().row);
		expect(page).toContain('<button type="button">Close console</button>');
		expect(link(page)).not.toContain('Close console');
	});

	it('carries no mark', async () => {
		const page = await drawn(() => faces().row);
		expect(page).not.toContain('adm-accountmark');
	});
});

describe('the account in the band', () => {
	it('opens the same panel, unmarked, named by the account alone', async () => {
		const opens = link(await drawn(() => faces().band));
		expect(opens).toContain('href="/sites?account"');
		expect(opens).not.toContain('adm-accountmark');
		expect(opens).toContain('aria-label="Cloudflare account Riverside Shelter’s Account"');
		expect(opens).not.toContain('title=');
	});
});

const panel = () =>
	drawn(() =>
		createElement(CloudflareAccountPanel, {
			name: 'Riverside Shelter’s Account',
			accountId: '0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4',
			back: '/sites'
		})
	);

describe('the account panel', () => {
	it('is headed by the account’s name and states its id, which neither opener carries', async () => {
		const page = await panel();
		expect(page).toMatch(/<h2 id="[^"]+">Riverside Shelter’s Account<\/h2>/);
		expect(page).toContain('Account ID');
		expect(page).toContain('0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4');
	});

	it('holds no switch and says nothing of a plan or a pace', async () => {
		const page = await panel();
		expect(page).not.toContain('<form');
		expect(page).not.toContain('type="checkbox"');
		expect(page).not.toMatch(/plan|pace/i);
	});

	it('has one press, its way out', async () => {
		const presses = (await panel()).match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
		expect(presses).toHaveLength(1);
		expect(presses[0]).toContain('Done');
	});
});
