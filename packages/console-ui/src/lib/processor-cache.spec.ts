import type { LoaderFunctionArgs } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeRunRead } from '../api/types';

// how often a processor page reaches the binary: once for the first visit, and again only where
// what the cached reading holds could have moved. the client is replaced so a read is a count
// rather than a loopback call, and the console's reading is replaced with a ready face.

const binary = vi.hoisted(() => ({
	runs: 0,
	run: null as unknown,
	payments: 0,
	failPayments: false,
	face: 'ready' as 'ready' | 'connect'
}));

vi.mock('../api/client', () => ({
	stripeRun: async () => {
		binary.runs += 1;
		return binary.run;
	},
	paypalRun: async () => {
		binary.runs += 1;
		return binary.run;
	},
	readPayments: () => {
		binary.payments += 1;
		return binary.failPayments ? Promise.reject(new Error('unanswered')) : Promise.resolve({});
	},
	readRecurring: () => Promise.resolve({})
}));

vi.mock('./console-reading', () => ({
	readConsole: async () => ({
		reading: {
			face:
				binary.face === 'ready'
					? { kind: 'ready', address: 'https://a.example' }
					: { kind: 'connect' }
		}
	})
}));

const bar = await import('@better-giving/operator/progress-bar');
const { forgetReadings, readProcessorPage, warmProcessorPage } = await import('./processor-cache');

const ORIGIN = 'http://localhost';

/** the arguments a navigation to `href` hands the page's loader. */
const move = (href: string) =>
	({ request: new Request(new URL(href, ORIGIN)) }) as unknown as LoaderFunctionArgs;

/** a turn of the loop, which is every chance a promise with nothing to wait on would have had. */
const turn = () => new Promise((settle) => setTimeout(settle, 0));

beforeEach(async () => {
	await forgetReadings();
	binary.runs = 0;
	binary.run = null;
	binary.payments = 0;
	binary.failPayments = false;
	binary.face = 'ready';
	bar.pageDrawn('/organisation');
});

/** a visit to `href` from another page, with the bar over it seen to its end. */
async function visit(href: string) {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	try {
		return await readProcessorPage(move(href), href === '/payments/stripe' ? 'stripe' : 'paypal');
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
		expect(again.address).toBe('https://a.example');
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

	it('reads nothing for a page that is not a processor page', async () => {
		warmProcessorPage('/organisation', ORIGIN);
		await turn();

		expect(binary.payments).toBe(0);
	});
});
