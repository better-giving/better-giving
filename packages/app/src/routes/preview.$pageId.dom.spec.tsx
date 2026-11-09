import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { DonorMessagesWiring } from '$lib/donate/sections/messages';
import PagePreview from './preview.$pageId';

// the preview's Show more messages as the route wires it: the same read /donate asks
// (./donate.messages.ts), so the preview pages through exactly the messages the page shows. the page
// is a stand-in that draws the wiring it was handed; how that wiring follows the read is
// ./donate.dom.spec.tsx's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let wired: DonorMessagesWiring | undefined;

vi.mock('$lib/donate/page-with-card', () => ({
	PageWithCard: ({ donorMessages }: { donorMessages?: DonorMessagesWiring }) => {
		wired = donorMessages;
		return createElement('button', {
			type: 'button',
			onClick: () => donorMessages?.onShowMore('cursor/after+6')
		});
	}
}));

type Loaded = Parameters<typeof PagePreview>[0]['loaderData'];

const NOW = '2026-11-09T12:00:00.000Z';
const PREVIEW = '/preview/0198c1d2-0000-7000-8000-000000000001';

const LOADED = {
	kind: 'page',
	view: {},
	profile: { messages: { messages: [], total: 12, next: 'cursor/after+6' } },
	now: NOW
} as unknown as Loaded;

const PAGE = {
	kind: 'messages',
	messages: [{ name: 'Maya R.', note: 'Paying it forward.', receivedAt: NOW }],
	total: 12,
	next: null
} as const;

let asked: string[];

beforeEach(() => {
	wired = undefined;
	asked = [];
});

function Page() {
	return createElement(PagePreview as never, {
		loaderData: useLoaderData<Loaded>(),
		params: {},
		matches: []
	});
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('Show more messages in the preview', () => {
	it('asks the read /donate asks, and hands its page to the section', async () => {
		const Stub = createRoutesStub([
			{
				path: '/preview/:pageId',
				loader: () => LOADED,
				HydrateFallback: () => null,
				Component: Page
			},
			{
				path: '/donate/messages',
				loader: ({ request }) => {
					const url = new URL(request.url);
					asked.push(`${url.pathname}${url.search}`);
					return PAGE;
				}
			}
		]);
		const host = document.createElement('div');
		document.body.appendChild(host);
		const root = createRoot(host);
		act(() => root.render(createElement(Stub, { initialEntries: [PREVIEW] })));
		onTestFinished(() => {
			act(() => root.unmount());
			host.remove();
		});
		await settle();

		await act(() => host.querySelector('button')?.click());
		await settle();

		expect(asked).toEqual([`/donate/messages?after=${encodeURIComponent('cursor/after+6')}`]);
		expect(wired).toMatchObject({ now: NOW, status: 'idle', arrived: PAGE });
	});
});
