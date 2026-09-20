import type { QuickbooksReport } from '@better-giving/operator/console/quickbooks';
import type { ClientActionFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// how often the books page reaches the deployment: once for the first visit, and again only where
// what the kept reading holds could have moved. the client is replaced so a read is a count rather
// than a loopback call, and the console's reading is replaced with a ready face.

const binary = vi.hoisted(() => ({ books: 0, connected: true }));

const report = (): QuickbooksReport => ({
	connection: binary.connected
		? {
				state: 'connected',
				realmId: '9130',
				companyName: 'Sandbox Company',
				income: null,
				fee: null,
				deposit: null,
				startAt: '2026-01-01T00:00:00.000Z'
			}
		: { state: 'disconnected' },
	accounts: null,
	backlog: { failed: 0, oldestWaitingAt: null },
	callbackAddress: 'https://give.example.org/quickbooks/callback'
});

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	readQuickbooks: async () => {
		binary.books += 1;
		return { kind: 'read' as const, report: report() };
	},
	pressQuickbooks: async () => ({
		kind: 'reported' as const,
		report: { press: 'retry' as const, retried: 0 }
	})
}));

vi.mock('../lib/console-reading', async (original) => ({
	...(await original<Record<string, unknown>>()),
	readConsole: async () => ({ reading: { face: { kind: 'ready' } } })
}));

const bar = await import('@better-giving/operator/progress-bar');
const { forgetReadings } = await import('../lib/processor-cache');
const { quickbooksIntent } = await import('../lib/quickbooks-standing');
const { clientAction, clientLoader } = await import('./_sections.quickbooks');

const ORIGIN = 'http://localhost';

/** the arguments a navigation to `href` hands the page's loader. */
const move = (href: string) =>
	({ request: new Request(new URL(href, ORIGIN)) }) as unknown as ClientLoaderFunctionArgs;

beforeEach(async () => {
	await forgetReadings();
	binary.books = 0;
	binary.connected = true;
	bar.pageDrawn('/organisation');
});

/** a visit to the books page from another page, with the bar over it seen to its end. */
async function visit(href = '/quickbooks') {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	try {
		return await clientLoader(move(href));
	} finally {
		off();
	}
}

/** a press on the connection, made on this page. */
const press = (intent: string) => {
	const posted = new FormData();
	posted.set('intent', intent);
	return clientAction({
		request: new Request(new URL('/quickbooks', ORIGIN), { method: 'POST', body: posted })
	} as unknown as ClientActionFunctionArgs);
};

describe('the books page read between visits', () => {
	it('is read off the deployment once, and the second visit is answered from the first', async () => {
		const first = await visit();
		bar.pageDrawn('/organisation');
		const again = await visit();

		expect(binary.books).toBe(1);
		expect(again.books).toEqual(first.books);
	});

	it('is read again after a press on the connection', async () => {
		await visit();
		bar.pageDrawn('/organisation');
		await press(quickbooksIntent('retry'));
		await visit();

		expect(binary.books).toBe(2);
	});

	it('is read again where the reading kept for it had no company connected', async () => {
		// a company is connected in a browser at the deployment and never here, so a disconnected
		// reading could have moved with nothing pressed on this console.
		binary.connected = false;
		await visit();
		bar.pageDrawn('/organisation');
		await visit();

		expect(binary.books).toBe(2);
	});
});
