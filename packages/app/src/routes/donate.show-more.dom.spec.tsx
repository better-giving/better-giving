import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import Route from './donate';
import { CURSOR, NEXT_SIX, PAGE_LOADED } from '$lib/donate/show-more-page.testing';

// Show more messages through the real page, nothing stood in for it: /donate hands the section its
// wiring (`donorMessages`, ./donate.tsx), so a dropped or renamed prop there is red here.
// what the wiring does with each answer is ./donate.dom.spec.tsx's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no popover methods, and the card's closed choices are shown as one.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

type Loaded = Parameters<typeof Route>[0]['loaderData'];

let asked: string[];

beforeEach(() => {
	asked = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), 'http://localhost');
			asked.push(`${url.pathname}${url.search}`);
			return Response.json(NEXT_SIX);
		})
	);
	onTestFinished(() => {
		vi.unstubAllGlobals();
	});
});

function Page() {
	return createElement(Route as never, {
		loaderData: useLoaderData<Loaded>(),
		params: {},
		matches: []
	});
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('Show more messages through the real /donate page', () => {
	it('draws the six handed, asks for the next six and draws them', async () => {
		const Stub = createRoutesStub([
			{
				path: 'donate',
				loader: () => PAGE_LOADED,
				HydrateFallback: () => null,
				Component: Page
			}
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
		const section = () => host.querySelector('[data-area="messages"]');
		const notes = () =>
			[...(section()?.querySelectorAll('.page-messages-note') ?? [])].map((n) => n.textContent);
		expect(notes()).toEqual(PAGE_LOADED.profile.messages.messages.map((m) => m.note));

		const more = [...(section()?.querySelectorAll('button') ?? [])].find(
			(b) => b.textContent === 'Show more messages'
		);
		await act(() => more?.click());
		await settle();

		expect(asked).toEqual([`/donate/messages?after=${encodeURIComponent(CURSOR)}`]);
		expect(notes()).toEqual([
			...PAGE_LOADED.profile.messages.messages.map((m) => m.note),
			...NEXT_SIX.messages.map((m) => m.note)
		]);
		expect(section()?.querySelector('button')).toBeNull();
	});
});
