import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeReading, HomeShape } from '../api/types';

// what each error boundary draws for what it caught, through a router and the real client: a
// binary that could not be reached at all, a refusal it did send, and a page that threw while
// drawing. the binary is a stand-in for `fetch`, so the error each boundary meets is the one the
// client throws.

const bar = await import('@better-giving/operator/progress-bar');
const { forgetReadings } = await import('../lib/processor-cache');
const home = await import('./_index');
const sections = await import('./_sections');
const nowpayments = await import('./_sections.payments.nowpayments');
const organisation = await import('./_sections.organisation');

const STOPPED = 'The console has stopped';
const FAILED = 'This part of the console failed';
const ORIGIN_GUARD = 'this console answers its own page only';

const SHAPE: HomeShape = {
	workerName: 'better-giving',
	databaseName: 'better-giving',
	account: { name: 'Riverbank Trust', id: '8f3c2a1b' },
	remembered: true,
	notKept: null
};

const READY: HomeReading = {
	face: { kind: 'ready', address: 'https://a.example' },
	values: { vars: { kind: 'read', vars: [] } },
	sites: [],
	donatePage: '',
	org: null,
	holdsStripeKey: false
} as HomeReading;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** a binary that answers every reading the shell takes, ready. */
function answering(path: string): Response {
	if (path === '/api/home') return json(SHAPE);
	if (path === '/api/home/reading') return json(READY);
	if (path === '/api/version') return json({ version: '0.9.0', commit: 'abc' });
	return json({ error: `no stand-in for ${path}` }, 404);
}

/**
 * a page under the shell whose own code throws. it throws from its loader rather than while drawing
 * because `renderToString` runs no error boundary over a render-time throw, and this pool has no
 * DOM to mount one in; the boundary is handed the same `Error` either way.
 */
function throws(): never {
	throw new Error('cannot read properties of undefined');
}

/** `/`, and the layout with two sections under it that throw, opened at `at`. */
async function drawn(at: string): Promise<string> {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	const router = createMemoryRouter(
		[
			{
				id: 'root',
				children: [
					{
						id: 'home',
						index: true,
						loader: home.clientLoader as never,
						ErrorBoundary: home.ErrorBoundary as never
					},
					{
						id: 'sections',
						loader: sections.clientLoader as never,
						shouldRevalidate: sections.shouldRevalidate,
						Component: UNSAFE_withComponentProps(sections.default as never),
						ErrorBoundary: sections.ErrorBoundary as never,
						children: [
							{
								path: '/payments/nowpayments',
								loader: throws,
								Component: () => null,
								ErrorBoundary: nowpayments.ErrorBoundary as never
							},
							{
								path: '/organisation',
								loader: throws,
								Component: () => null,
								ErrorBoundary: organisation.ErrorBoundary as never
							}
						]
					}
				]
			}
		],
		{ initialEntries: [at] }
	);
	try {
		await router.initialize();
		await vi.waitFor(() => expect(router.state.initialized).toBe(true));
		return renderToString(createElement(RouterProvider, { router })).replaceAll('<!-- -->', '');
	} finally {
		off();
		router.dispose();
	}
}

beforeEach(async () => {
	await forgetReadings();
	bar.pageDrawn('/organisation');
});

describe('the sections layout', () => {
	it('draws the stopped page when the binary could not be reached at all', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});

		const page = await drawn('/payments/nowpayments');

		expect(page).toContain(STOPPED);
	});

	it('draws a refusal the binary sent in its own words rather than the stopped page', async () => {
		vi.stubGlobal('fetch', async () => json({ error: ORIGIN_GUARD }, 403));

		const page = await drawn('/payments/nowpayments');

		expect(page).toContain(ORIGIN_GUARD);
		expect(page).not.toContain(STOPPED);
	});
});

describe('a payments page', () => {
	it('draws its own failure inside the shell when its own code throws', async () => {
		vi.stubGlobal('fetch', async (input: string) => answering(input));

		const page = await drawn('/payments/nowpayments');

		expect(page).toContain(FAILED);
		expect(page).not.toContain(STOPPED);
		// the shell stands around it: the rail and the main region, and not the panel a route
		// outside the shell is
		expect(page).toContain('<nav');
		expect(page).toMatch(/class="adm-main"[\s\S]*This part of the console failed/);
		expect(page).not.toContain('adm-panelroute');
	});
});

describe('a page outside payments', () => {
	it('draws its own failure inside the shell when its own code throws', async () => {
		vi.stubGlobal('fetch', async (input: string) => answering(input));

		const page = await drawn('/organisation');

		expect(page).toContain(FAILED);
		expect(page).not.toContain(STOPPED);
		expect(page).toContain('<nav');
		expect(page).toMatch(/class="adm-main"[\s\S]*This part of the console failed/);
		expect(page).not.toContain('adm-panelroute');
	});
});

describe('`/`', () => {
	it('draws the stopped page when the binary could not be reached at all', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Failed to fetch');
		});

		const page = await drawn('/');

		expect(page).toContain(STOPPED);
	});

	it('draws a refusal the binary sent in its own words rather than the stopped page', async () => {
		vi.stubGlobal('fetch', async () => json({ error: ORIGIN_GUARD }, 403));

		const page = await drawn('/');

		expect(page).toContain(ORIGIN_GUARD);
		expect(page).not.toContain(STOPPED);
	});
});
