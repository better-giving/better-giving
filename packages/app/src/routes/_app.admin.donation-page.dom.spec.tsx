import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { BannerState } from '$lib/page/edit-forms';
import DonationPageEditPage, { clientAction } from './_app.admin.donation-page';

// the Donation page's edit page as the route mounts it: its three section cards under the publish
// banner, each Save held until its card changes, no Unpublish, and Reset to default while there is
// something to reset. the loader and the server's action are stand-ins; what the real ones do is
// ./_app.admin.donation-page.db.spec.ts's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Drawn = Parameters<typeof DonationPageEditPage>[0]['loaderData'];
type Loaded = Extract<Drawn, { unreadable: false }>;

function fixture(state: BannerState = 'public', hasEdits = false): Loaded {
	return {
		host: 'give.example.org/',
		version: 1,
		takingGifts: true,
		banner: {
			state,
			address: '/donate',
			preview: '/preview/d1',
			unpublishable: false,
			endable: false
		},
		unreadable: false,
		hasEdits,
		seeds: {
			general: { boxes: { heading: '' } },
			giving: {
				boxes: {
					program_mode: 'none',
					program_id: '',
					min_minor: '1',
					max_minor: '10,000',
					suggested_amounts: ['25']
				},
				currency: 'USD',
				programs: [],
				retired: null
			},
			settings: {
				boxes: { open_on_monthly: false, dedication_on: false, share_message: '' },
				monthlyOffered: true
			}
		}
	};
}

let drawn: Loaded;
let posted: Record<string, string>[];

beforeEach(() => {
	drawn = fixture();
	posted = [];
});

function mount(tree: ReactNode) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
}

function Page() {
	return createElement(DonationPageEditPage as never, {
		loaderData: useLoaderData<Drawn>(),
		params: {},
		matches: []
	});
}

async function screen() {
	const Stub = createRoutesStub([
		{
			path: '/admin/donation-page',
			loader: () => drawn,
			action: (args) =>
				clientAction({
					...args,
					serverAction: async () => {
						const body = await args.request.formData();
						posted.push(Object.fromEntries([...body].map(([k, v]) => [k, String(v)])));
						return Response.json({ saved: body.get(WHICH_FORM) });
					}
				} as never),
			HydrateFallback: () => null,
			Component: Page
		}
	]);
	mount(createElement(Stub, { initialEntries: ['/admin/donation-page'] }));
	await settle();
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function button(name: string): HTMLButtonElement {
	const found = [...document.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

const held = (press: HTMLElement) => press.getAttribute('aria-disabled') === 'true';
const headings = () =>
	[...document.querySelectorAll('section.adm-card h2')].map((one) => one.textContent);

async function type(box: HTMLInputElement, text: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

describe('the Donation page edit page', () => {
	it('is a form of its three cards, with no preview and no Unpublish', async () => {
		await screen();

		expect(document.querySelector('iframe')).toBeNull();
		expect(headings()).toEqual(['General', 'Donation settings', 'Settings']);
		const banner = document.querySelector('.adm-banner') as HTMLElement;
		expect(banner.textContent).toContain('Your Donation page is public');
		expect([...banner.querySelectorAll('button, a')].map((one) => one.textContent?.trim())).toEqual(
			['View live page']
		);
	});

	it('offers Reset to default only while the page holds edits', async () => {
		drawn = fixture('changed', true);
		await screen();

		expect(headings()).toContain('Reset to default');
		expect(button('Publish changes')).toBeDefined();
	});

	it('holds each Save until its card changes, and posts the card that changed', async () => {
		await screen();
		for (const name of ['general', 'donation settings', 'settings']) {
			expect(held(button(`Save ${name}`))).toBe(true);
		}

		const title = document.querySelector<HTMLInputElement>('input[name="heading"]');
		await type(title as HTMLInputElement, 'Give to Elm Street');
		expect(held(button('Save general'))).toBe(false);
		expect(held(button('Save donation settings'))).toBe(true);

		await act(async () => {
			button('Save general').click();
		});
		await settle();

		expect(posted).toEqual([
			{
				[WHICH_FORM]: 'donation-page-general',
				[RECORD_VERSION]: '1',
				heading: 'Give to Elm Street'
			}
		]);
	});
});
