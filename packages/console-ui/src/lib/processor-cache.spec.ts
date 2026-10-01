import type { LoaderFunctionArgs } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeRunRead } from '../api/types';

// how often a processor page reaches the binary: once for the first visit, and again only where
// what the cached reading holds could have moved. the client is replaced so a read is a count
// rather than a loopback call, and the console's reading is replaced with a ready face.

const binary = vi.hoisted(() => ({
	runs: 0,
	run: null as unknown,
	answered: null as (() => void) | null,
	payments: 0,
	failPayments: false,
	face: 'ready' as 'ready' | 'connect'
}));

vi.mock('../api/client', () => {
	const run = async () => {
		binary.runs += 1;
		binary.answered?.();
		return binary.run;
	};
	return {
		stripeRun: run,
		paypalRun: run,
		chariotRun: run,
		// an aborted signal is refused before the binary is reached, as `fetch` refuses it.
		readPayments: async (signal?: AbortSignal) => {
			signal?.throwIfAborted();
			binary.payments += 1;
			if (binary.failPayments) throw new Error('unanswered');
			return {};
		},
		readRecurring: async (signal?: AbortSignal) => {
			signal?.throwIfAborted();
			return {};
		}
	};
});

vi.mock('./console-reading', async (original) => ({
	...(await original<Record<string, unknown>>()),
	readConsole: async () => ({
		reading: {
			face:
				binary.face === 'ready'
					? { kind: 'ready', address: 'https://a.example' }
					: { kind: 'unreachable', address: 'https://a.example', read: { kind: 'no-session' } },
			values: { vars: { kind: 'read', vars: [] } }
		}
	})
}));

// the module is fresh per test: a run report no draw received is held across every forgetting, so
// one test's undrawn report would otherwise be the next test's first draw. the store is
// `remix-client-cache`'s, which a module reset leaves standing, so the last test's module forgets
// what it kept first.
let bar: typeof import('@better-giving/operator/progress-bar');
let forgetReadings: typeof import('./processor-cache').forgetReadings;
let pollRun: typeof import('./processor-cache').pollRun;
let readProcessorPage: typeof import('./processor-cache').readProcessorPage;
let runDrawn: typeof import('./processor-cache').runDrawn;
let warmProcessorPage: typeof import('./processor-cache').warmProcessorPage;

const ORIGIN = 'http://localhost';

/** the arguments a navigation to `href` hands the page's loader. */
const move = (href: string, signal: AbortSignal | null = null) =>
	({ request: new Request(new URL(href, ORIGIN), { signal }) }) as unknown as LoaderFunctionArgs;

/** a turn of the loop, which is every chance a promise with nothing to wait on would have had. */
const turn = () => new Promise((settle) => setTimeout(settle, 0));

beforeEach(async () => {
	await forgetReadings?.();
	vi.resetModules();
	bar = await import('@better-giving/operator/progress-bar');
	({ forgetReadings, pollRun, readProcessorPage, runDrawn, warmProcessorPage } = await import(
		'./processor-cache'
	));
	binary.runs = 0;
	binary.run = null;
	binary.answered = null;
	binary.payments = 0;
	binary.failPayments = false;
	binary.face = 'ready';
	bar.pageDrawn('/organisation');
});

/** the reading of a visit to `href` from another page, with the bar over it seen to its end. */
async function readForVisit(href: string, signal?: AbortSignal) {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	try {
		return await readProcessorPage(
			move(href, signal),
			href === '/payments/stripe' ? 'stripe' : 'paypal'
		);
	} finally {
		off();
	}
}

/** a visit to `href`, its run marked drawn as the page's render marks it, unless the router abandoned it. */
async function visit(href: string, signal?: AbortSignal) {
	const screen = await readForVisit(href, signal);
	if (!signal?.aborted) runDrawn(screen.run);
	return screen;
}

describe('a processor page read between visits', () => {
	it('is read off the binary once, and the second visit is answered from the first', async () => {
		await visit('/payments/stripe');
		bar.pageDrawn('/organisation');
		const again = await visit('/payments/stripe');

		expect(binary.runs).toBe(1);
		expect(again.run).toBe(binary.run);
	});

	it('draws no bar over a visit answered from the last one', async () => {
		await visit('/payments/stripe');
		bar.pageDrawn('/organisation');
		const told = vi.fn();
		const off = bar.subscribeProgressBar(told);

		await readProcessorPage(move('/payments/stripe'), 'stripe');
		off();

		expect(told).not.toHaveBeenCalled();
		expect(bar.progressBarFinishing()).toBe(false);
	});

	it('shares one reading between the page and a dialog opened over it', async () => {
		await visit('/payments/paypal');
		bar.pageDrawn('/organisation');
		await visit('/payments/paypal?close');

		expect(binary.runs).toBe(1);
	});

	it('reads a page with no run once, with no run on it, and answers the second visit from the first', async () => {
		const first = await readProcessorPage(move('/payments/nowpayments'), 'nowpayments');
		bar.pageDrawn('/organisation');
		await readProcessorPage(move('/payments/nowpayments'), 'nowpayments');

		expect(first.run).toBeNull();
		expect(binary.runs).toBe(0);
		expect(binary.payments).toBe(1);
	});

	it('reads again for a re-read of the page already on the screen', async () => {
		// a press's re-read and the page asking again once a run stops (./stripe-section.tsx) both
		// want what the binary says now.
		await visit('/payments/stripe');
		bar.pageDrawn('/payments/stripe');
		await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
	});

	it('reads again over a reading whose run was still going', async () => {
		binary.run = { kind: 'running' } satisfies Partial<StripeRunRead>;
		await visit('/payments/stripe');
		bar.pageDrawn('/organisation');
		binary.run = null;
		const again = await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
		expect(again.run).toBeNull();
	});

	it('reads again over a reading that carried a run report, so no report is drawn twice', async () => {
		binary.run = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		await visit('/payments/stripe');
		bar.pageDrawn('/organisation');
		binary.run = null;
		const again = await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
		expect(again.run).toBeNull();
	});

	it('reads again after a press on any page', async () => {
		await visit('/payments/stripe');
		bar.pageDrawn('/organisation');
		await forgetReadings();
		await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
	});

	it('keeps nothing from a reading that was in flight when a press forgot', async () => {
		const first = visit('/payments/stripe');
		await forgetReadings();
		await first;
		await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
	});

	it('keeps nothing from a reading the router abandoned after the binary answered it', async () => {
		const navigation = new AbortController();
		binary.answered = () => navigation.abort();
		await visit('/payments/stripe', navigation.signal);
		bar.pageDrawn('/organisation');
		await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
	});

	it('draws the run report on the next visit where the router abandoned the reading that took it', async () => {
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		const navigation = new AbortController();
		binary.answered = () => navigation.abort();
		await visit('/payments/stripe', navigation.signal).catch(() => {});
		binary.run = null;
		bar.pageDrawn('/organisation');
		const drawn = await visit('/payments/stripe');

		expect(drawn.run).toBe(ended);
	});

	it('draws the run report on the next visit where the router abandoned the move after the reading returned', async () => {
		// the layout's own reading can still be going when the page's lands, and a click elsewhere then
		// abandons the move with nothing drawn.
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		await readForVisit('/payments/stripe');
		binary.run = null;
		const drawn = await visit('/payments/stripe');

		expect(drawn.run).toBe(ended);
	});

	it('draws the run report on the next visit where the page’s own poll took it and was left', async () => {
		// the poll's request is in flight as the run lands and the operator moves elsewhere, so the
		// page that asked draws nothing of what came back.
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		await pollRun('stripe');
		binary.run = null;
		bar.pageDrawn('/organisation');
		const drawn = await visit('/payments/stripe');

		expect(drawn.run).toBe(ended);
	});

	it('answers a poll with the report a reading of the page took ahead of it', async () => {
		// a re-read of the page on the screen got to the landed run first, and the binary hands a run
		// out once: the poll asking after it is answered nothing, over a run this console holds.
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		await readForVisit('/payments/stripe');
		binary.run = null;

		expect(await pollRun('stripe')).toBe(ended);
	});

	it('lets go of a held report once a later read sees a newer run going', async () => {
		// run A's report was taken and never drawn, and run B has started since — from another
		// window on the same console. a poll of B answered nothing must not be handed A's outcome.
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		await pollRun('stripe');
		binary.run = { kind: 'running' } satisfies Partial<StripeRunRead>;
		await pollRun('stripe');
		binary.run = null;

		expect(await pollRun('stripe')).toBeNull();
	});

	it('lets go of a report the poll took once the page has drawn it', async () => {
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		runDrawn(await pollRun('stripe'));
		binary.run = null;
		bar.pageDrawn('/organisation');
		const drawn = await visit('/payments/stripe');

		expect(drawn.run).toBeNull();
	});

	it('asks the binary for no run where the router abandoned the reading before it got there', async () => {
		const navigation = new AbortController();
		const first = visit('/payments/stripe', navigation.signal);
		navigation.abort();

		await expect(first).rejects.toThrow();
		expect(binary.runs).toBe(0);
	});

	it('leaves no rejection unhandled where the router abandoned the reading', async () => {
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			const navigation = new AbortController();
			const abandoned = visit('/payments/stripe', navigation.signal);
			navigation.abort();
			await expect(abandoned).rejects.toThrow();
			await turn();
		} finally {
			process.off('unhandledRejection', unhandled);
		}

		expect(unhandled).not.toHaveBeenCalled();
	});

	it('reads again where the payments reading kept for it failed', async () => {
		binary.failPayments = true;
		const failed = await visit('/payments/stripe');
		await expect(failed.payments).rejects.toThrow('unanswered');
		await turn();
		binary.failPayments = false;
		await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
	});

	it('keeps nothing for a deployment that is not ready', async () => {
		binary.face = 'connect';
		await expect(visit('/payments/stripe')).rejects.toBeInstanceOf(Response);
		binary.face = 'ready';
		await visit('/payments/stripe');

		expect(binary.runs).toBe(1);
	});
});

describe('a processor page read ahead of the press on its rail cell', () => {
	it('is what the press draws, with no second read', async () => {
		warmProcessorPage('/payments/paypal', ORIGIN);
		await turn();
		await visit('/payments/paypal');

		expect(binary.runs).toBe(1);
	});

	it('hands the press the run report it read, with no second read', async () => {
		// the binary hands a landed run to one reading only (../api/client.ts), so a second read
		// would draw the page with the report gone.
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();
		binary.run = null;
		const drawn = await visit('/payments/stripe');

		expect(binary.runs).toBe(1);
		expect(drawn.run).toBe(ended);
	});

	it('hands its run report to one visit only', async () => {
		binary.run = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();
		binary.run = null;
		await visit('/payments/stripe');
		bar.pageDrawn('/organisation');
		const again = await visit('/payments/stripe');

		expect(binary.runs).toBe(2);
		expect(again.run).toBeNull();
	});

	it('keeps its run report for the next visit where the router abandoned the one that waited for it', async () => {
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		warmProcessorPage('/payments/stripe', ORIGIN);
		const navigation = new AbortController();
		const abandoned = visit('/payments/stripe', navigation.signal);
		navigation.abort();
		await abandoned;
		binary.run = null;
		const drawn = await visit('/payments/stripe');

		expect(binary.runs).toBe(1);
		expect(drawn.run).toBe(ended);
	});

	it('hands the press its run report where its payments reading failed', async () => {
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		binary.failPayments = true;
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();
		binary.run = null;
		binary.failPayments = false;
		const drawn = await visit('/payments/stripe');

		expect(drawn.run).toBe(ended);
	});

	it('hands the press its run report where a press on another page forgot every reading', async () => {
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();
		binary.run = null;
		await forgetReadings();
		const drawn = await visit('/payments/stripe');

		expect(drawn.run).toBe(ended);
	});

	it('draws its run report once where the cell is read ahead again during the press', async () => {
		const ended = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		binary.run = ended;
		binary.answered = () => {
			binary.answered = null;
			queueMicrotask(() => {
				binary.run = null;
				warmProcessorPage('/payments/stripe', ORIGIN);
			});
		};
		const drawn = await visit('/payments/stripe');
		await turn();
		const asked = binary.runs;
		bar.pageDrawn('/organisation');
		const again = await visit('/payments/stripe');

		expect(drawn.run).toBe(ended);
		expect(again.run).toBeNull();
		expect(asked).toBeLessThanOrEqual(2);
	});

	it('draws no bar while it reads', async () => {
		const told = vi.fn();
		const off = bar.subscribeProgressBar(told);
		warmProcessorPage('/payments/paypal', ORIGIN);
		await turn();
		off();

		expect(told).not.toHaveBeenCalled();
	});

	it('is read once however many times the cell is hovered', async () => {
		warmProcessorPage('/payments/stripe', ORIGIN);
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();

		expect(binary.runs).toBe(1);
	});

	it('is waited for by a press made while it is still reading', async () => {
		warmProcessorPage('/payments/stripe', ORIGIN);
		await visit('/payments/stripe');

		expect(binary.runs).toBe(1);
	});

	it('keeps nothing where it failed', async () => {
		binary.face = 'connect';
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();
		binary.face = 'ready';
		await visit('/payments/stripe');

		expect(binary.runs).toBe(1);
		expect(binary.payments).toBe(1);
	});

	it('reads nothing for the page already on the screen, whose own poll is what observes its run', async () => {
		binary.run = { kind: 'ended' } satisfies Partial<StripeRunRead>;
		bar.pageDrawn('/payments/stripe');
		warmProcessorPage('/payments/stripe', ORIGIN);
		await turn();

		expect(binary.runs).toBe(0);
	});

	it('reads a page with no run ahead of the press too', async () => {
		warmProcessorPage('/payments/nowpayments', ORIGIN);
		await turn();
		await readProcessorPage(move('/payments/nowpayments'), 'nowpayments');

		expect(binary.payments).toBe(1);
	});

	it('reads nothing for a page that is not a processor page', async () => {
		warmProcessorPage('/organisation', ORIGIN);
		await turn();

		expect(binary.payments).toBe(0);
	});
});
