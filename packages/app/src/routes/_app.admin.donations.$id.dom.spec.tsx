import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import GiftDetailScreen from './_app.admin.donations.$id';

// the gift's own page as the route mounts it over what its loader answers: the props crossing
// whole into `GiftDetail`, and the answer to a press reaching it as `result`. what the screen draws
// for each state is $lib/admin/donations/gift-detail.dom.spec.tsx; what the loader answers is
// ./_app.admin.donations.$id.db.spec.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof GiftDetailScreen>[0];

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

function loaderData(over: Partial<Props['loaderData']> = {}): Props['loaderData'] {
	return {
		gift: {
			donorName: 'Maya Reyes',
			donorEmail: 'maya@example.org',
			amountMinor: 15000,
			currency: 'USD',
			receivedAt: '2026-11-12T16:00:00.000Z',
			paidWith: 'Card',
			status: 'completed',
			receiptSentAt: '2026-11-12T16:01:00.000Z'
		},
		match: {
			status: 'voided',
			employer: 'Northwind',
			history: [
				{
					event: 'voided',
					who: 'Nadia Hart',
					at: '2026-11-13T10:00:00.000Z',
					reason: 'Donor asked us to stop'
				}
			]
		},
		mailingAddressMissing: false,
		canOpenSettings: true,
		...over
	};
}

/** the screen at its own address, with the props a request would have handed it. */
function screen(data: Props['loaderData'], actionData?: Props['actionData']): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/donations/:id',
			Component: () =>
				createElement(GiftDetailScreen as never, {
					loaderData: data,
					actionData,
					params: { id: 'g' },
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/donations/g'] }));
}

it('names the employer and the void’s reason in the match’s history', () => {
	const root = screen(loaderData());
	const card = root.querySelector('[aria-labelledby="match-card-title"]');
	expect(card?.textContent).toContain('Northwind');
	expect(card?.textContent).toContain('By Nadia Hart');
	expect(card?.textContent).toContain('Reason: Donor asked us to stop');
});

it('tells a member who cannot open Settings who can save the address, with no press', () => {
	const root = screen(loaderData({ mailingAddressMissing: true, canOpenSettings: false }));
	expect(root.textContent).toContain(
		'Ask whoever runs this server to save the mailing address in Settings.'
	);
	const links = [...root.querySelectorAll('a')].map((a) => a.textContent);
	expect(links).not.toContain('Open Settings');
});

it('reports a refused press in the words the action answered', () => {
	// as the action answers it through `invalid()`. the generated type folds this arm into the
	// rejection that carries no sentence — an object with `form` is a supertype of one with `form` and
	// `error` — so the value is handed over as the wire carries it.
	const refused = {
		error:
			'This match was already voided, so nothing changed. Reload the page to see how it stands.',
		form: { id: 'match-filed', result: { status: 'error', error: {} } }
	};
	const root = screen(loaderData(), refused as Props['actionData']);
	expect(root.textContent).toContain('This match was already voided, so nothing changed.');
});
