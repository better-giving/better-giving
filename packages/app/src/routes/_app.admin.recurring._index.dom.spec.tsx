import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import RecurringGifts from './_app.admin.recurring._index';

// the status word on each row of the recurring gifts list, drawn.
//
// what it covers: which tone rung a row's `StatusWord` stands on, off its badge variant
// class. ./_app.admin.recurring._index.db.spec.ts reads the json a loader publishes, and the tone is
// chosen here in the page, from `RECURRING_STATUS_TONES` in $lib/admin/status-tones.ts. a list of
// money is mostly rows at rest, and a tone on an active one would put the accent on every row an
// operator is not looking for.
//
// it is not the browser spec AGENTS.md bans over a dashboard screen: nothing here reads a computed
// style.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

type Plan = Parameters<typeof RecurringGifts>[0]['loaderData']['plans'][number];

/** one commitment as the loader hands it over, collecting unless a case says otherwise. */
function plan(over: Partial<Plan> = {}): Plan {
	return {
		id: '019fb700-0000-7000-8000-000000000002',
		donorName: 'Ada Okafor',
		donorEmail: 'ada@example.org',
		amount: '$123.45',
		interval: 'monthly',
		status: 'active',
		nextChargeOn: '2026-09-04',
		...over
	};
}

/** the screen, drawn over the commitments given, inside a router for the row links. */
function screen(plans: Plan[]): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/recurring',
			Component: () =>
				createElement(RecurringGifts as never, {
					loaderData: { plans, limit: 50, hasMore: false },
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/recurring'] }));
}

/** the status word in the one row's Status cell. */
function statusWord(root: HTMLElement): Element | null {
	return root.querySelector('tbody .ds-badge');
}

it.each([
	['active', 'Active', 'ds-badge ds-badge-neutral'],
	['cancelled', 'Stopped', 'ds-badge ds-badge-neutral adm-state--note'],
	['lapsed', 'Payment failed', 'ds-badge ds-badge-destructive']
] as const)('draws a %s commitment’s status word on its own rung', (status, label, drawn) => {
	const word = statusWord(screen([plan({ status, nextChargeOn: null })]));
	expect(word?.textContent).toBe(label);
	expect(word?.className).toBe(drawn);
});
