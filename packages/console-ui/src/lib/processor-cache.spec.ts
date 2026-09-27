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
	// an aborted signal is refused before the binary is reached, as `fetch` refuses it.
	const run = async (signal?: AbortSignal) => {
		signal?.throwIfAborted();
		binary.runs += 1;
		binary.answered?.();
		return binary.run;
	};
	return {
		stripeRun: run,
		paypalRun: run,
		chariotRun: run,
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

const bar = await import('@better-giving/operator/progress-bar');
const { forgetReadings, readProcessorPage, warmProcessorPage } = await import('./processor-cache');

const ORIGIN = 'http://localhost';

/** the arguments a navigation to `href` hands the page's loader. */
const move = (href: string, signal: AbortSignal | null = null) =>
	({ request: new Request(new URL(href, ORIGIN), { signal }) }) as unknown as LoaderFunctionArgs;

/** a turn of the loop, which is every chance a promise with nothing to wait on would have had. */
const turn = () => new Promise((settle) => setTimeout(settle, 0));

beforeEach(async () => {
	await forgetReadings();
	binary.runs = 0;
	binary.run = null;
	binary.answered = null;
	binary.payments = 0;
	binary.failPayments = false;
	binary.face = 'ready';
	bar.pageDrawn('/organisation');
});

/** a visit to `href` from another page, with the bar over it seen to its end. */
async function visit(href: string, signal?: AbortSignal) {
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
