import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeployedVar, FeedsInUse, HomeFace, HomeReading } from '../api/types';

// the sections layout through a router: which face a page stands behind when cloudflare would not
// say what the deployment holds and what its read again asks, the account panel's plan switch posted
// from over a section page, and a dialog opened over a press still in flight. the client's readings
// are replaced so each is a count; its writes are its own, answered by a stand-in for the fetch the
// binary answers.

const binary = vi.hoisted(() => ({
	homeReads: 0,
	booksReads: 0,
	booksPresses: 0,
	ready: false,
	feeds: null as FeedsInUse | null,
	vars: [] as DeployedVar[],
	/** each time the layout asked for its reading, each reading taken and each write answered. */
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
		return {
			face: binary.ready ? READY : UNANSWERED,
			values: { vars: { kind: 'read', vars: binary.vars } },
			sites: [],
			donatePage: '',
			org: null,
			holdsStripeKey: false,
			feedsInUse: binary.feeds
		};
	},
	readQuickbooks: async () => {
		binary.booksReads += 1;
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
const { PAID_PLAN, PLAN_FETCHER, PLAN_FIELD, PLAN_INTENT, PLAN_PAID } = await import(
	'../lib/cloudflare-plan'
);
const { ACCOUNT_PARAM } = await import('../lib/dialog-params');
const { FREE_INTENT } = await import('../lib/withheld-values');
const { gatedBy } = await import('../lib/console-reading');
const { forgetReadings } = await import('../lib/processor-cache');
const { quickbooksIntent } = await import('../lib/quickbooks-standing');
const { cache } = await import('remix-client-cache');
const root = await import('../root');
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
				middleware: root.clientMiddleware as never,
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
						loader: ((args: never) => {
							binary.log.push('asked');
							return sections.clientLoader(args);
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
	binary.feeds = null;
	binary.vars = [];
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

const ZAPIER_ONLY: FeedsInUse = { zapier: true, webhooks: false, books: false };

/** the rail foot's account row, open tag to its close control. */
const footRow = (page: string): string => {
	const found = page.match(/<div class="adm-footaccount">[\s\S]*?<\/a>/);
	if (found === null) throw new Error('no account row drawn');
	return found[0];
};

/** the narrow band across the top, which is what a phone draws in place of the rail's foot. */
const band = (page: string): string => {
	const found = page.match(/<div class="adm-identity">[\s\S]*?<\/div>(?=<)/);
	if (found === null) throw new Error('no band drawn');
	return page.slice(found.index, page.indexOf('<nav', found.index));
};

/** the one link in `markup` opening the account panel over the books page, as its open tag. */
const opener = (markup: string): string => {
	const found = (markup.match(/<a\b[^>]*>/g) ?? []).filter((tag) =>
		tag.includes('href="/quickbooks?account"')
	);
	expect(found).toHaveLength(1);
	return found[0] as string;
};

describe('the Cloudflare account', () => {
	it('is the rail’s foot, marked where a feed is in use on a deployment reading the plan as Free', async () => {
		binary.feeds = ZAPIER_ONLY;
		const row = footRow(await drawnReady('/quickbooks'));
		expect(row).toContain('Riverbank Trust');
		expect(row).toContain('href="/quickbooks?account"');
		expect(row).toContain('adm-accountmark');
	});

	it('is not marked where the deployment did not say which feeds are in use', async () => {
		expect(footRow(await drawnReady('/quickbooks'))).not.toContain('adm-accountmark');
	});

	it('stands in the narrow band beside the close, opening the same panel, marked alike', async () => {
		binary.feeds = ZAPIER_ONLY;
		const marked = band(await drawnReady('/quickbooks'));
		expect(opener(marked)).toContain(
			'aria-label="Cloudflare account Riverbank Trust, Deliveries paced for the Free plan"'
		);
		expect(marked).toContain('aria-label="Close console"');

		binary.feeds = null;
		expect(opener(band(await drawnReady('/quickbooks')))).toContain(
			'aria-label="Cloudflare account Riverbank Trust"'
		);
	});

	it('opens its panel off the address, headed by the account and holding the paid-plan switch', async () => {
		const closed = await drawnReady('/quickbooks');
		expect(closed).not.toContain(`name="${PLAN_FIELD}"`);

		const page = await drawnReady('/quickbooks?account');
		expect(page).toMatch(/<h2 id="[^"]+">Riverbank Trust<\/h2>/);
		expect(page).toContain(`name="${PLAN_FIELD}"`);
		expect(page).toMatch(/<a\b[^>]*href="\/quickbooks"[^>]*>/);
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
			const opening = router.navigate(`/password?${ACCOUNT_PARAM}`, { preventScrollReset: true });
			await vi.waitFor(() => expect(binary.log).toContain('asked'));
			answer({ kind: 'set' });
			await opening;

			expect(binary.log).toEqual(['asked', 'answered /values/vars/free', 'read']);
			expect(router.state.location.search).toBe(`?${ACCOUNT_PARAM}`);
		} finally {
			off();
			router.dispose();
		}
	});
});

/** what `router` draws now, with react's text-node seams taken out. */
const drawnNow = (router: Awaited<ReturnType<typeof open>>['router']): string =>
	renderToString(createElement(RouterProvider, { router })).replaceAll('<!-- -->', '');

/** the form holding the paid-plan box, as drawn: where it posts and the intent its press carries. */
function planForm(page: string): { action: string | undefined; intent: string | undefined } {
	const form = page
		.split('<form')
		.slice(1)
		.map((rest) => `<form${rest.slice(0, rest.indexOf('</form>'))}`)
		.filter((markup) => markup.includes(`name="${PLAN_FIELD}"`));
	expect(form).toHaveLength(1);
	return {
		action: form[0]?.match(/^<form[^>]*\baction="([^"]*)"/)?.[1],
		intent: form[0]?.match(/<button[^>]*type="submit"[^>]*value="([^"]*)"/)?.[1]
	};
}

describe('the account panel’s plan switch, pressed over a section page', () => {
	/** the panel open over the books page, its switch ticked and pressed, and what came back. */
	async function pressed() {
		binary.ready = true;
		binary.feeds = ZAPIER_ONLY;
		const { router, off } = await open(`/quickbooks?${ACCOUNT_PARAM}`);
		const before = drawnNow(router);
		const writes = writesAnswered(async () => {
			binary.vars = [{ name: PAID_PLAN, kind: 'value', value: PLAN_PAID }];
			return { kind: 'set' };
		});
		const { action, intent } = planForm(before);
		const formData = new FormData();
		formData.set(PLAN_FIELD, PLAN_PAID);
		formData.set('intent', intent ?? '');
		// the panel holds its fetcher for as long as it is drawn
		router.getFetcher(PLAN_FETCHER);
		let answer: unknown;
		const unsubscribe = router.subscribe((state) => {
			answer = state.fetchers.get(PLAN_FETCHER)?.data ?? answer;
		});
		const reads = binary.homeReads;
		await router.fetch(PLAN_FETCHER, LAYOUT, action ?? '', { formMethod: 'post', formData });
		// an idle fetcher leaves the router's state; asking `getFetcher` would hold it a second time
		await vi.waitFor(() => expect(router.state.fetchers.has(PLAN_FETCHER)).toBe(false));
		unsubscribe();
		return { router, off, before, writes, intent, answer, reads };
	}

	it('posts to `/`, which writes the answer, and never to the page it was pressed over', async () => {
		const { router, off, writes, intent, answer } = await pressed();
		try {
			expect(intent).toBe(PLAN_INTENT);
			expect(writes).toEqual(['/values/vars']);
			expect(answer).toEqual({ plan: { kind: 'set' } });
			expect(binary.booksPresses).toBe(0);
		} finally {
			off();
			router.dispose();
		}
	});

	it('reads the layout again, and the account’s mark is gone once the plan reads paid', async () => {
		const { router, off, before, reads } = await pressed();
		try {
			expect(footRow(before)).toContain('adm-accountmark');
			expect(binary.homeReads).toBe(reads + 1);
			expect(footRow(drawnNow(router))).not.toContain('adm-accountmark');
		} finally {
			off();
			router.dispose();
		}
	});

	it('leaves the panel open over the same page, its switch drawn from the re-read', async () => {
		const { router, off } = await pressed();
		try {
			expect(router.state.location.pathname).toBe('/quickbooks');
			expect(router.state.location.search).toBe(`?${ACCOUNT_PARAM}`);
			expect(drawnNow(router)).toMatch(new RegExp(`<input[^>]*name="${PLAN_FIELD}"[^>]*checked`));
		} finally {
			off();
			router.dispose();
		}
	});

	it('lets go of the answer once the panel is put away, so reopening it reports nothing', async () => {
		const { router, off } = await pressed();
		try {
			const deleted: string[] = [];
			router.subscribe((_, { deletedFetchers }) => {
				deleted.push(...deletedFetchers);
			});
			// the panel unmounting on its way out
			router.deleteFetcher(PLAN_FETCHER);
			await router.navigate('/quickbooks', { preventScrollReset: true });

			expect(deleted).toContain(PLAN_FETCHER);
			expect(drawnNow(router)).not.toContain(`name="${PLAN_FIELD}"`);
		} finally {
			off();
			router.dispose();
		}
	});
});
