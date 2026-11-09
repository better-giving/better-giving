import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { DonorMessagesWiring } from '$lib/donate/sections/messages';
import DonationPage from './donate';

// /donate's Show more messages as the route wires it: the cursor a press asks
// ./donate.messages.ts for, and how that fetcher's state and answer reach the section as `status`
// and `arrived`. the page itself is a stand-in that draws the wiring it was handed, so the card and
// its checkout stay out of it; what the section does with the wiring is
// $lib/donate/sections/messages.dom.spec.tsx's, and what the read answers is ./donate.db.spec.ts's.

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

type Loaded = Parameters<typeof DonationPage>[0]['loaderData'];

const NOW = '2026-11-09T12:00:00.000Z';

const LOADED = {
	kind: 'page',
	view: {},
	profile: { messages: { messages: [], total: 12, next: 'cursor/after+6' } },
	resuming: false,
	now: NOW
} as unknown as Loaded;

const PAGE = {
	kind: 'messages',
	messages: [{ name: 'Maya R.', note: 'Paying it forward.', receivedAt: NOW }],
	total: 12,
	next: null
} as const;

/** what the show-more read does with the next ask: answer it under a status, or never settle. */
type Answer = { readonly body: unknown; readonly status: number } | 'hang';

let asked: string[];
let answers: Answer[];

beforeEach(() => {
	wired = undefined;
	asked = [];
	answers = [];
});

const never = () => new Promise<never>(() => {});

function showMore({ request }: { request: Request }) {
	const url = new URL(request.url);
	asked.push(`${url.pathname}${url.search}`);
	const next = answers.shift();
	if (next === undefined) throw new Error('show more was asked with no answer ready');
	if (next === 'hang') return never();
	return data(next.body, { status: next.status });
}

function Page() {
	return createElement(DonationPage as never, {
		loaderData: useLoaderData<Loaded>(),
		params: {},
		matches: []
	});
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function screen() {
	const Stub = createRoutesStub([
		{ path: '/donate', loader: () => LOADED, HydrateFallback: () => null, Component: Page },
		{ path: '/donate/messages', loader: showMore }
	]);
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(createElement(Stub, { initialEntries: ['/donate'] })));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	await settle();
	return {
		press: async () => {
			await act(() => host.querySelector('button')?.click());
			await settle();
		}
	};
}

const current = () => {
	if (wired === undefined) throw new Error('the page was handed no donor messages wiring');
	return wired;
};

describe('Show more messages on /donate', () => {
	it('counts ages from the loader’s read time, idle with nothing arrived', async () => {
		await screen();
		expect(current()).toMatchObject({ now: NOW, status: 'idle', arrived: null });
	});

	it('asks for the six after the cursor it is handed, encoded, and is loading meanwhile', async () => {
		const { press } = await screen();
		answers.push('hang');

		await press();

		expect(asked).toEqual([`/donate/messages?after=${encodeURIComponent('cursor/after+6')}`]);
		expect(current().status).toBe('loading');
	});

	it('hands an answered page to the section as it arrived, and goes idle', async () => {
		const { press } = await screen();
		answers.push({ body: PAGE, status: 200 });

		await press();

		expect(current().status).toBe('idle');
		expect(current().arrived).toMatchObject({
			messages: PAGE.messages,
			total: 12,
			next: null
		});
	});

	it('says error after a refused cursor, with nothing arrived', async () => {
		const { press } = await screen();
		answers.push({ body: { kind: 'refused' }, status: 400 });

		await press();

		expect(current()).toMatchObject({ status: 'error', arrived: null });
	});

	it('says error when the address is over the donor page limit', async () => {
		const { press } = await screen();
		answers.push({ body: { kind: 'refused' }, status: 429 });

		await press();

		expect(current().status).toBe('error');
	});
});
