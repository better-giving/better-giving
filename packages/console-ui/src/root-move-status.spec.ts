import { opening } from '@better-giving/operator/progress-bar';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it } from 'vitest';
import App from './root';

// what the document says out loud over a move to another screen, held as markup.
//
// the words are `MoveStatus`'s (packages/operator/src/components/status/ProgressBar.jsx), whose own
// spec holds that one region keeps its node while its words change. what only ./root.tsx can get
// wrong is the mount: that the region stands before the move, that the line drawn over it brings no
// second one, and that the label it reads is the one the move carried. ../vite.config.ts pins
// `node` and there is no dom, so the router is driven on its own and the document drawn off its
// state at each point: a move in flight, and the move landed. that one region keeps its node across
// the two is not something a pair of renders can hold; the dashboard's
// packages/app/src/routes/_app.dom.spec.tsx holds it for the same mount over a live router.

/** the document standing on `/`, with a destination whose reading lands when `land` is called. */
function standing() {
	let land: (value: null) => void = () => {};
	const reading = new Promise<null>((resolve) => {
		land = resolve;
	});
	const router = createMemoryRouter([
		{
			id: 'root',
			Component: App,
			children: [
				{ path: '/', Component: () => null },
				{ path: '/payments', loader: () => reading, Component: () => 'arrived' }
			]
		}
	]);
	const draw = () => renderToStaticMarkup(createElement(RouterProvider, { router }));
	return { router, draw, land: () => land(null) };
}

const REGION = /<div role="status"[^>]*>([^<]*)<\/div>/g;

/** the words on every status region the markup draws. */
function regions(page: string): string[] {
	return [...page.matchAll(REGION)].map((match) => match[1] ?? '');
}

it('says the opening label on one region over a move, and empties it when the move ends', async () => {
	const { router, draw, land } = standing();
	expect(regions(draw())).toEqual(['']);

	const moved = router.navigate('/payments', { state: opening('Opening Payments') });
	const inFlight = draw();
	expect(inFlight).toContain('adm-navigation-bar');
	expect(regions(inFlight)).toEqual(['Opening Payments']);

	land();
	await moved;
	const landed = draw();
	expect(landed).toContain('arrived');
	expect(landed).not.toContain('adm-navigation-bar');
	expect(regions(landed)).toEqual(['']);
});
