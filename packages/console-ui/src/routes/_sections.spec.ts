import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeployedVar, HomeFace, HomeReading } from '../api/types';

// the sections layout through a router: which face a page stands behind when cloudflare would not
// say what the deployment holds and what its read again asks, the account and its panel, and a
// dialog opened over a press still in flight. the client's readings
// are replaced so each is a count; its writes are its own, answered by a stand-in for the fetch the
// binary answers.

const binary = vi.hoisted(() => ({
	homeReads: 0,
	booksReads: 0,
	booksPresses: 0,
	ready: false,
	vars: [] as DeployedVar[],
	/** where set, every reading waits on it before it answers. */
	held: null as Promise<void> | null,
	/** where set, the books page's own reading waits on it. */
	booksHeld: null as Promise<void> | null,
	/**
	 * each time the layout asked for its reading and handed one over, each reading taken and each
	 * write answered.
	 */
	log: [] as string[]
}));

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
		binary.log.push('read');
		await binary.held;
		return {
			face: binary.ready ? READY : UNANSWERED,
			values: { vars: { kind: 'read', vars: binary.vars } },
			sites: [],
			donatePage: '',
			org: null,
			holdsStripeKey: false
		};
	},
	readQuickbooks: async () => {
		binary.booksReads += 1;
		await binary.booksHeld;
		return { kind: 'read' as const, report: { connection: { state: 'connected' } } };
	},
	pressQuickbooks: async (body: { press: string; startAt?: string }) => {
		binary.booksPresses += 1;
		return {
			kind: 'reported' as const,
			report:
				body.press === 'start-date-preview'
					? { press: body.press, startAt: `${body.startAt}T00:00:00.000Z`, queues: {}, drops: {} }
					: { press: body.press }
		};
	}
}));

const bar = await import('@better-giving/operator/progress-bar');
const { CLOSE_PARAM } = await import('../lib/dialog-params');
const { FREE_INTENT } = await import('../lib/withheld-values');
const { gatedBy } = await import('../lib/console-reading');
const { forgetReadings } = await import('../lib/processor-cache');
const { quickbooksIntent } = await import('../lib/quickbooks-standing');
const { cache } = await import('remix-client-cache');
const home = await import('./_index');
const sections = await import('./_sections');
const password = await import('./_sections.password');
const quickbooks = await import('./_sections.quickbooks');

const LAYOUT = 'sections';

const BOOKS = 'books';

/** the layout and one kept page under it, opened at `at`, with every bar seen to its end. */
async function open(at = '/quickbooks') {
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
						action: home.clientAction as never,
						shouldRevalidate: home.shouldRevalidate
					},
					{
						id: LAYOUT,
						loader: (async (args: never) => {
							binary.log.push('asked');
							const handed = await sections.clientLoader(args);
							binary.log.push('handed');
							return handed;
						}) as never,
						shouldRevalidate: sections.shouldRevalidate,
						Component: UNSAFE_withComponentProps(sections.default as never),
						ErrorBoundary: sections.ErrorBoundary as never,
						children: [
							{
								id: BOOKS,
								path: '/quickbooks',
								loader: quickbooks.clientLoader as never,
								action: quickbooks.clientAction as never,
								shouldRevalidate: quickbooks.shouldRevalidate
							},
							{
								path: '/password',
								action: password.clientAction as never,
								shouldRevalidate: password.shouldRevalidate
							}
						]
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
	binary.booksReads = 0;
	binary.booksPresses = 0;
	binary.ready = false;
	binary.vars = [];
	binary.held = null;
	binary.booksHeld = null;
	binary.log = [];
	bar.pageDrawn('/organisation');
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('a page cloudflare did not answer for', () => {
	it('stands behind the gate, and its read again asks cloudflare again rather than a kept answer', async () => {
		const { router, off } = await open();
		try {
			expect(gatedBy(router.state.errors?.[LAYOUT])?.gate.title).toBe('Cloudflare didn’t answer');
			expect(binary.booksReads).toBe(0);
			const before = binary.homeReads;

			// what the gate's press does
			binary.ready = true;
			await router.revalidate();

			expect(binary.homeReads).toBe(before + 1);
			expect(router.state.errors).toBeNull();
			expect(binary.booksReads).toBe(1);
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
		const { router, off } = await open();
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
		const { router, off } = await open();
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

/** the ready layout opened at `at`, drawn, with react's text-node seams taken out. */
async function drawnReady(at: string): Promise<string> {
	binary.ready = true;
	const { router, off } = await open(at);
	try {
		return renderToString(createElement(RouterProvider, { router })).replaceAll('<!-- -->', '');
	} finally {
		off();
		router.dispose();
	}
}

/** the rail foot's account row, open tag to the start of its close control. */
const footRow = (page: string): string => {
	const found = page.match(
		/<div class="adm-footaccount">[\s\S]*?<span class="adm-footaccount__out">/
	);
	if (found === null) throw new Error('no account row drawn');
	return found[0];
};

/** the narrow band across the top, which is what a phone draws in place of the rail's foot. */
const band = (page: string): string => {
	const found = page.match(/<div class="adm-identity">[\s\S]*?<\/div>(?=<)/);
	if (found === null) throw new Error('no band drawn');
	return page.slice(found.index, page.indexOf('<nav', found.index));
};

/** every open tag in `markup` a reader could press or tab to. */
const controls = (markup: string): string[] =>
	markup.match(/<(?:a|button)\b[^>]*>|<[^>]*\b(?:href|tabindex)=[^>]*>/g) ?? [];

describe('the Cloudflare account', () => {
	it('is the rail’s foot, the Cloudflare logo and the name, and opens nothing', async () => {
		const row = footRow(await drawnReady('/quickbooks'));
		expect(row).toContain('adm-brand--cloudflare');
		expect(row).toContain('aria-label="Cloudflare account"');
		expect(row).toContain('<span class="adm-footaccount__name">Riverbank Trust</span>');
		expect(controls(row)).toEqual([]);
	});

	it('stands in the narrow band beside the close, named whole, and opens nothing', async () => {
		const drawn = band(await drawnReady('/quickbooks'));
		const account = drawn.match(/<span class="adm-brand[^>]*>/)?.[0] ?? '';
		expect(account).toContain('aria-label="Cloudflare account Riverbank Trust"');
		expect(account).not.toMatch(/href|tabindex/);
		expect(controls(drawn).filter((tag) => tag.includes('Cloudflare'))).toEqual([]);
		expect(drawn).toContain('aria-label="Close console"');
	});

	it('opens nothing off `?account` on the address', async () => {
		const plain = await drawnReady('/quickbooks');
		const asked = await drawnReady('/quickbooks?account');
		expect(asked).not.toContain('<dialog');
		expect(asked).not.toContain('8f3c2a1b');
		expect(asked.replaceAll('?account', '')).toBe(plain);
	});
});

/**
 * the binary's side of every write, in place of the fetch the client makes: `answer` is handed
 * each write's path and says what it answers, whenever it likes.
 */
function writesAnswered(answer: (path: string) => Promise<unknown>): string[] {
	const paths: string[] = [];
	vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
		if (init?.method !== 'POST')
			throw new Error(`the binary was asked ${input} with no answer set`);
		const path = input.replace(/^\/api/, '');
		paths.push(path);
		const body = await answer(path);
		binary.log.push(`answered ${path}`);
		return Response.json(body);
	});
	return paths;
}

describe('a dialog opened while a page’s press is in flight', () => {
	it('reads the page again once the press has answered, and never across it', async () => {
		binary.ready = true;
		const { router, off } = await open('/password');
		try {
			let answer: (body: unknown) => void = () => {};
			const out = new Promise((resolve) => {
				answer = resolve;
			});
			const writes = writesAnswered(() => out);
			const formData = new FormData();
			formData.set('intent', FREE_INTENT);
			binary.log = [];

			void router.navigate('/password', { formMethod: 'post', formData });
			await vi.waitFor(() => expect(writes).toEqual(['/values/vars/free']));
			const opening = router.navigate(`/password?${CLOSE_PARAM}`, { preventScrollReset: true });
			await vi.waitFor(() => expect(binary.log).toContain('asked'));
			answer({ kind: 'set' });
			await opening;

			expect(binary.log).toEqual(['asked', 'answered /values/vars/free', 'read', 'handed']);
			expect(router.state.location.search).toBe(`?${CLOSE_PARAM}`);
		} finally {
			off();
			router.dispose();
		}
	});

	it('reads the page again where the move that dropped the press was itself left before it drew', async () => {
		binary.ready = true;
		const { router, off } = await open('/password');
		try {
			let answer: (body: unknown) => void = () => {};
			const out = new Promise((resolve) => {
				answer = resolve;
			});
			const writes = writesAnswered(() => out);
			const formData = new FormData();
			formData.set('intent', FREE_INTENT);
			let release: () => void = () => {};
			binary.booksHeld = new Promise((resolve) => {
				release = resolve;
			});
			binary.log = [];

			// the save, then a rail link, whose layout hands over a reading taken after the save
			// lands while the page under it is still reading, so that reading is never drawn
			void router.navigate('/password', { formMethod: 'post', formData });
			await vi.waitFor(() => expect(writes).toEqual(['/values/vars/free']));
			void router.navigate('/quickbooks');
			answer({ kind: 'set' });
			await vi.waitFor(() =>
				expect(binary.log).toEqual(['asked', 'answered /values/vars/free', 'read', 'handed'])
			);
			binary.log = [];
			// then the close confirm, on the page still drawn
			const opening = router.navigate(`/password?${CLOSE_PARAM}`, { preventScrollReset: true });
			binary.booksHeld = null;
			release();
			await opening;

			expect(router.state.location.pathname).toBe('/password');
			expect(binary.log).toEqual(['asked', 'read', 'handed']);
		} finally {
			off();
			router.dispose();
		}
	});
});
