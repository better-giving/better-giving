import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { CURSOR, NEXT_SIX, NOW } from './show-more-page.testing';
import { useShowMoreMessages } from './show-more';

// the wiring's list follows its `from`: ../../routes/f.$slug.tsx stays mounted from one fundraiser's address
// to the next, so the messages one page loaded must not stand on the next.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let answer: (ask: string) => Promise<Response>;

beforeEach(() => {
	answer = async () => Response.json(NEXT_SIX);
	vi.stubGlobal(
		'fetch',
		vi.fn((input: RequestInfo | URL) => answer(String(input)))
	);
	onTestFinished(() => {
		vi.unstubAllGlobals();
	});
});

let wiring: ReturnType<typeof useShowMoreMessages>;

function Probe({ from }: { from: string }) {
	wiring = useShowMoreMessages(NOW, from);
	return null;
}

function mount(from: string): Root {
	const root = createRoot(document.createElement('div'));
	act(() => root.render(createElement(Probe, { from })));
	onTestFinished(() => act(() => root.unmount()));
	return root;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('show more messages across two fundraisers', () => {
	it('drops the first fundraiser’s loaded messages when the address changes', async () => {
		const root = mount('/f/first/messages');
		await act(() => wiring.onShowMore(CURSOR));
		expect(wiring.arrived?.messages).toHaveLength(6);

		act(() => root.render(createElement(Probe, { from: '/f/second/messages' })));
		expect(wiring.arrived).toBeNull();
		expect(wiring.status).toBe('idle');
	});

	it('draws nothing from an ask the first fundraiser left in flight', async () => {
		let release = () => {};
		answer = () =>
			new Promise((resolve) => {
				release = () => resolve(Response.json(NEXT_SIX));
			});
		const root = mount('/f/first/messages');
		act(() => {
			void wiring.onShowMore(CURSOR);
		});
		expect(wiring.status).toBe('loading');

		act(() => root.render(createElement(Probe, { from: '/f/second/messages' })));
		release();
		await settle();
		expect(wiring.arrived).toBeNull();
		expect(wiring.status).toBe('idle');
	});
});
