import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeFace, HomeReading } from '../api/types';

// the sections layout's gate, through a router: which face a page stands behind when cloudflare
// would not say what the deployment holds, and what its read again asks. the client is replaced so
// every reading of the deployment is a count.

const binary = vi.hoisted(() => ({ homeReads: 0, zapierReads: 0, booksReads: 0, ready: false }));

const READY: HomeFace = { kind: 'ready', address: 'https://a.example' };
const UNANSWERED: HomeFace = {
	kind: 'blocked',
	why: { kind: 'unreachable', detail: 'dial tcp: i/o timeout', count: 0, why: '' }
};

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	homeShape: async () => ({
		workerName: 'better-giving',
		databaseName: 'better-giving',
		account: { name: 'Riverbank Trust', id: '8f3c2a1b' },
		remembered: true,
		notKept: null
	}),
	consoleVersion: async () => ({ version: '0.9.0' }),
	homeReading: async (): Promise<HomeReading> => {
		binary.homeReads += 1;
		return {
			face: binary.ready ? READY : UNANSWERED,
			values: { vars: { kind: 'read', vars: [] } },
			sites: [],
			donatePage: '',
			org: null,
			holdsStripeKey: false
		};
	},
	readQuickbooks: async () => {
		binary.booksReads += 1;
		return { kind: 'read' as const, report: { connection: { state: 'connected' } } };
	},
	pressQuickbooks: async (body: { press: string; startAt?: string }) => ({
		kind: 'reported' as const,
		report:
			body.press === 'start-date-preview'
				? { press: body.press, startAt: `${body.startAt}T00:00:00.000Z`, queues: {}, drops: {} }
				: { press: body.press }
	}),
	readZapier: async () => {
		binary.zapierReads += 1;
		return {
			kind: 'read' as const,
			report: {
				key: null,
				listening: { newGift: 0, newDonor: 0 },
				deliveries: { waiting: 0, failed: 0, oldestWaitingAt: null }
			}
		};
	}
}));

const bar = await import('@better-giving/operator/progress-bar');
const { gatedBy } = await import('../lib/console-reading');
const { forgetReadings } = await import('../lib/processor-cache');
const { quickbooksIntent } = await import('../lib/quickbooks-standing');
const { cache } = await import('remix-client-cache');
const sections = await import('./_sections');
const zapier = await import('./_sections.zapier');
const quickbooks = await import('./_sections.quickbooks');

const LAYOUT = 'sections';

const BOOKS = 'books';

/** the layout and one kept page under it, opened at that page, with every bar seen to its end. */
async function open(at: '/zapier' | '/quickbooks' = '/zapier') {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	const router = createMemoryRouter(
		[
			{
				id: LAYOUT,
				loader: sections.clientLoader as never,
				shouldRevalidate: sections.shouldRevalidate,
				ErrorBoundary: sections.ErrorBoundary as never,
				children: [
					{ path: '/zapier', loader: zapier.clientLoader as never },
					{
						id: BOOKS,
						path: '/quickbooks',
						loader: quickbooks.clientLoader as never,
						action: quickbooks.clientAction as never,
						shouldRevalidate: quickbooks.shouldRevalidate
					}
				]
			}
		],
		{ initialEntries: [at] }
	);
	await router.initialize();
	await vi.waitFor(() => expect(router.state.initialized).toBe(true));
	return { router, off };
}

beforeEach(async () => {
	await forgetReadings();
	binary.homeReads = 0;
	binary.zapierReads = 0;
	binary.booksReads = 0;
	binary.ready = false;
	bar.pageDrawn('/organisation');
});

describe('a page cloudflare did not answer for', () => {
	it('stands behind the gate, and its read again asks cloudflare again rather than a kept answer', async () => {
		const { router, off } = await open();
		try {
			expect(gatedBy(router.state.errors?.[LAYOUT])?.gate.title).toBe('Cloudflare didn’t answer');
			expect(binary.zapierReads).toBe(0);
			const before = binary.homeReads;

			// what the gate's press does
			binary.ready = true;
			await router.revalidate();

			expect(binary.homeReads).toBe(before + 1);
			expect(router.state.errors).toBeNull();
			expect(binary.zapierReads).toBe(1);
		} finally {
			off();
			router.dispose();
		}
	});

	it('stands behind the gate again when the read again meets the same silence', async () => {
		const { router, off } = await open();
		try {
			const before = binary.homeReads;
			await router.revalidate();

			expect(binary.homeReads).toBe(before + 1);
			expect(gatedBy(router.state.errors?.[LAYOUT])?.gate.retry).toBe(true);
		} finally {
			off();
			router.dispose();
		}
	});
});

describe('a page that reads for itself, gated', () => {
	it('sees its bar to full before the gate stands in its place', async () => {
		let rushed = false;
		const watch = bar.subscribeProgressBar(() => {
			if (bar.progressBarFinishing()) rushed = true;
		});
		const { router, off } = await open();
		try {
			expect(gatedBy(router.state.errors?.[LAYOUT])).not.toBeNull();
			expect(rushed).toBe(true);
		} finally {
			watch();
			off();
			router.dispose();
		}
	});
});

describe('the gate', () => {
	it('opens its close confirm without an address to navigate to', async () => {
		const { router, off } = await open();
		try {
			const page = renderToString(createElement(RouterProvider, { router }));

			expect(page).toContain('aria-label="Close console"');
			expect(page).not.toContain('?close');
		} finally {
			off();
			router.dispose();
		}
	});

	it('marks its read again busy only while a read is out, beside a region that can say it landed', async () => {
		const { router, off } = await open();
		try {
			const page = renderToString(createElement(RouterProvider, { router }));

			expect(page).toContain('Try again');
			expect(page).not.toContain('aria-busy');
			expect(page).toContain('aria-live="polite"');
		} finally {
			off();
			router.dispose();
		}
	});
});

/** a day posted from the books page as a fetcher, which is how the page posts its preview. */
async function postDay(
	router: Awaited<ReturnType<typeof open>>['router'],
	press: 'start-date' | 'start-date-preview',
	options: { defaultShouldRevalidate?: boolean }
) {
	const formData = new FormData();
	formData.set('intent', quickbooksIntent(press));
	formData.set('startAt', '2026-04-01');
	// a fetcher no component holds is dropped once idle, so its answer is read off the way there.
	let answered: unknown;
	const unsubscribe = router.subscribe((state) => {
		answered = state.fetchers.get(press)?.data ?? answered;
	});
	try {
		await router.fetch(press, BOOKS, '/quickbooks', { formMethod: 'post', formData, ...options });
		await vi.waitFor(() => expect(router.getFetcher(press).state).toBe('idle'));
		return answered;
	} finally {
		unsubscribe();
	}
}

describe('the books page', () => {
	it('answers a start-date preview without reading the page again or forgetting what it kept', async () => {
		binary.ready = true;
		const { router, off } = await open('/quickbooks');
		try {
			expect(await cache.getItem('/quickbooks')).toBeDefined();
			const reads = { home: binary.homeReads, books: binary.booksReads };

			const data = await postDay(router, 'start-date-preview', { defaultShouldRevalidate: false });

			expect(data).toMatchObject({ quickbooks: { press: 'start-date-preview' } });
			expect({ home: binary.homeReads, books: binary.booksReads }).toEqual(reads);
			expect(await cache.getItem('/quickbooks')).toBeDefined();
		} finally {
			off();
			router.dispose();
		}
	});

	it('reads the page again over a move', async () => {
		binary.ready = true;
		const { router, off } = await open('/quickbooks');
		try {
			const reads = binary.booksReads;

			await postDay(router, 'start-date', {});

			expect(binary.booksReads).toBe(reads + 1);
		} finally {
			off();
			router.dispose();
		}
	});
});
