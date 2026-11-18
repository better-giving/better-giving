import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SiteFooter } from '$lib/donate/site-footer';
import { StaffMarkerContext } from '$lib/donate/staff-marker-context';
import PagePreview from './preview.$pageId';

// the preview is what a donor sees, and the staff previewing a page carry the returning-staff
// marker (./root.tsx provides it to every screen). so the footer the preview draws holds no Console
// link, where the live page's holds one for that browser. the page itself is a stand-in that draws
// the real footer, so what is asserted is the context the route puts over it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('$lib/donate/page-with-card', () => ({
	PageWithCard: () =>
		createElement(SiteFooter, {
			info: {
				legalName: 'Harbor Light',
				ein: null,
				addressLines: [],
				email: 'hello@harborlight.org',
				socialLinks: []
			}
		})
}));

type Loaded = Parameters<typeof PagePreview>[0]['loaderData'];

const LOADED = {
	kind: 'page',
	view: {},
	profile: null,
	now: '2026-11-09T12:00:00.000Z'
} as unknown as Loaded;

function Page() {
	return createElement(PagePreview as never, {
		loaderData: useLoaderData<Loaded>(),
		params: {},
		matches: []
	});
}

async function drawn(marker: boolean, wrapInRoute: boolean): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			path: '/preview/:pageId',
			loader: () => LOADED,
			HydrateFallback: () => null,
			Component: () =>
				createElement(
					StaffMarkerContext,
					{ value: marker },
					wrapInRoute ? createElement(Page) : createElement(SiteFooterProbe)
				)
		}
	]);
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() =>
		root.render(
			createElement(Stub, { initialEntries: ['/preview/0198c1d2-0000-7000-8000-000000000001'] })
		)
	);
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	return host;
}

/** the same footer outside the preview route, which is what the marker reaches. */
function SiteFooterProbe() {
	return createElement(SiteFooter, {
		info: {
			legalName: 'Harbor Light',
			ein: null,
			addressLines: [],
			email: 'hello@harborlight.org',
			socialLinks: []
		}
	});
}

describe('the preview’s footer', () => {
	it('holds no console link for a browser carrying the marker', async () => {
		const host = await drawn(true, true);

		expect(host.querySelector('footer')).not.toBeNull();
		expect(host.querySelector('a[href="/admin"]')).toBeNull();
	});

	it('would hold one outside the preview, so the stand-in is a fair test', async () => {
		const host = await drawn(true, false);

		expect(host.querySelector('a[href="/admin"]')?.textContent).toBe('Console');
	});
});
