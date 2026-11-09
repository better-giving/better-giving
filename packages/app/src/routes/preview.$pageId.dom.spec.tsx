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
/** how the read answers the next ask: with the page, or failing as an offline browser's `fetch` does. */
let answers: ('page' | 'offline')[];

beforeEach(() => {
	wired = undefined;
	asked = [];
	answers = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), 'http://localhost');
			asked.push(`${url.pathname}${url.search}`);
			if (answers.shift() === 'offline') throw new TypeError('Failed to fetch');
			return Response.json(PAGE);
		})
	);
	onTestFinished(() => {
		vi.unstubAllGlobals();
	});
});

function Page() {
	return createElement(PagePreview as never, {
		loaderData: useLoaderData<Loaded>(),
		params: {},
		matches: []
	});
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function preview() {
	const Stub = createRoutesStub([
		{
			path: '/preview/:pageId',
			loader: () => LOADED,
			HydrateFallback: () => null,
			Component: Page,
			ErrorBoundary: () => createElement('p', { id: 'boundary' }, 'the preview failed')
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
	return {
		press: async () => {
			await act(() => host.querySelector('button')?.click());
			await settle();
		},
		boundary: () => host.querySelector('#boundary')
	};
}

describe('Show more messages in the preview', () => {
	it('asks the read /donate asks, and hands its page to the section', async () => {
		const { press } = await preview();
		answers.push('page');

		await press();

		expect(asked).toEqual([`/donate/messages?after=${encodeURIComponent('cursor/after+6')}`]);
		expect(wired).toMatchObject({ now: NOW, status: 'idle', arrived: PAGE });
	});

	it('says error in place when the read never arrives, and asks again on the next press', async () => {
		const { press, boundary } = await preview();
		answers.push('offline', 'page');

		await press();
		expect(wired).toMatchObject({ status: 'error', arrived: null });
		expect(boundary()).toBeNull();

		await press();
		expect(asked).toHaveLength(2);
		expect(wired).toMatchObject({ status: 'idle', arrived: PAGE });
	});
});
