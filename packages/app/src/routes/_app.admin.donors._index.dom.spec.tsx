import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { browserIn } from '$lib/admin/viewer-time.testing';
import Donors from './_app.admin.donors._index';

// the Added cell of the donor list, drawn: an instant the loader hands over as ISO, written as the
// day in the viewer's zone by `LocalTime` ($lib/admin/viewer-time.react.tsx).
// ./_app.admin.donors._index.db.spec.ts reads the json a loader publishes; the zone is the page's.
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

type Loaded = Parameters<typeof Donors>[0]['loaderData'];
type Donor = Loaded['contacts'][number];

/** one donor as the loader hands it over. */
function donor(over: Partial<Donor> = {}): Donor {
	return {
		id: '019fb300-0000-7000-8000-000000000001',
		kind: 'individual',
		displayName: 'Ada Okafor',
		primaryEmail: 'ada@example.org',
		primaryPhone: null,
		consentedToContact: true,
		gifts: 2,
		given: '$50.00',
		createdAt: '2026-10-21T16:23:00.000Z',
		...over
	} as Donor;
}

/** the screen over the donors given, inside a router for the links and sort presses. */
function screen(contacts: Donor[]): HTMLElement {
	const loaded = {
		contacts,
		summary: {
			total: contacts.length,
			thisMonth: 0,
			points: [0, 0],
			first: 'Oct 2025',
			last: 'Oct 2026'
		},
		total: contacts.length,
		pages: 1,
		from: 1,
		sort: 'name',
		dir: 'asc',
		view: 'all',
		views: { all: contacts.length, recurring: 0 },
		viewLinks: { all: '/admin/donors', recurring: '/admin/donors?view=recurring' },
		sorts: {
			name: '/admin/donors?sort=name&dir=desc',
			gifts: '/admin/donors?sort=gifts&dir=desc',
			given: '/admin/donors?sort=given&dir=desc'
		},
		previous: null,
		next: null
	} as unknown as Loaded;
	const Stub = createRoutesStub([
		{
			path: '/admin/donors',
			Component: () =>
				createElement(Donors as never, { loaderData: loaded, params: {}, matches: [] })
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/donors'] }));
}

/** what the first row holds under the column headed `label`. */
function cell(root: HTMLElement, label: string): string {
	const headers = [...root.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
	const at = headers.findIndex((text) => text.includes(label));
	expect(at, `no column headed ${label}`).toBeGreaterThanOrEqual(0);
	const row = root.querySelector('tbody tr');
	const held = at === 0 ? row?.querySelector('th') : row?.querySelectorAll('td')[at - 1];
	return held?.textContent ?? '';
}

it('draws a donor added late at night in UTC as the next day in Manila', () => {
	browserIn('Asia/Manila');
	expect(cell(screen([donor()]), 'Added')).toBe('2026-10-22');
});

it('draws the same donor on the earlier day for a viewer in New York', () => {
	browserIn('America/New_York');
	expect(cell(screen([donor()]), 'Added')).toBe('2026-10-21');
});

it('turns at the viewer’s midnight, not at UTC’s', () => {
	browserIn('America/New_York');
	expect(cell(screen([donor({ createdAt: '2026-10-21T03:59:59.999Z' })]), 'Added')).toBe(
		'2026-10-20'
	);
	expect(cell(screen([donor({ createdAt: '2026-10-21T04:00:00.000Z' })]), 'Added')).toBe(
		'2026-10-21'
	);
});
