import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_INTENT, CloseConfirm, SHELL_ACTION } from './close-confirm';

// the confirm's Close press, held at the props the card is handed for it. ../../vite.config.ts pins
// `node` and there is no dom, so the card is stood in for by one that keeps what it was handed: the
// press's attributes are read off that, and its click handler is called with the one method a
// submit's turning away reads. ../closed-while-writing.spec.ts reads the same props off the source.

type Handed = {
	dangerProps: {
		'aria-busy'?: boolean;
		'aria-disabled'?: boolean;
		onClick?: (event: { preventDefault: () => void }) => void;
	};
};

const card = vi.hoisted(() => ({ handed: null as Handed | null }));

vi.mock('@better-giving/operator/behaviour/Dialog', () => ({
	Modal: (props: Handed & { children?: ReactNode }) => {
		card.handed = props;
		return null;
	}
}));

/** the key ./close-confirm.tsx keeps its one fetcher under. */
const CLOSE_FETCHER = 'close-console';

/** the route the close posts to, with an action that never answers. */
function shell() {
	const router = createMemoryRouter([
		{
			id: 'root',
			path: '/',
			children: [
				{
					id: 'index',
					index: true,
					action: () => new Promise<null>(() => {}),
					Component: () => createElement(CloseConfirm, { back: () => {} })
				}
			]
		}
	]);
	return router;
}

/** the props the card was handed on a render of the page as it stands. */
function handed(router: ReturnType<typeof createMemoryRouter>): Handed['dangerProps'] {
	card.handed = null;
	renderToStaticMarkup(createElement(RouterProvider, { router }));
	if (card.handed === null) throw new Error('the confirm drew no card');
	return (card.handed as Handed).dangerProps;
}

/** what pressing it does to the submission it would make. */
function pressed(props: Handed['dangerProps']): { stopped: boolean } {
	const preventDefault = vi.fn();
	props.onClick?.({ preventDefault });
	return { stopped: preventDefault.mock.calls.length > 0 };
}

const routers: Array<ReturnType<typeof createMemoryRouter>> = [];
afterEach(() => {
	for (const router of routers.splice(0)) router.dispose();
});

describe('the Close console press while the close is in flight', () => {
	async function inFlight() {
		const router = shell();
		routers.push(router);
		const formData = new FormData();
		formData.set('intent', CLOSE_INTENT);
		void router.fetch(CLOSE_FETCHER, 'index', SHELL_ACTION, { formMethod: 'post', formData });
		await vi.waitFor(() =>
			expect(router.state.fetchers.get(CLOSE_FETCHER)?.state).toBe('submitting')
		);
		return router;
	}

	it('is held without `disabled`, and says it is busy', async () => {
		const props = handed(await inFlight());
		expect(props).not.toHaveProperty('disabled');
		expect(props['aria-disabled']).toBe(true);
		expect(props['aria-busy']).toBe(true);
	});

	it('turns a second press away rather than posting a second close', async () => {
		expect(pressed(handed(await inFlight()))).toEqual({ stopped: true });
	});
});

describe('the Close console press at rest', () => {
	it('posts, and states no hold', () => {
		const router = shell();
		routers.push(router);
		const props = handed(router);
		expect(pressed(props)).toEqual({ stopped: false });
		expect(props['aria-disabled']).toBeFalsy();
	});
});
