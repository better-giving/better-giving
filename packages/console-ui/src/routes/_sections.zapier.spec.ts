import type { ZapierReport } from '@better-giving/operator/console/zapier';
import type { ClientActionFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// the Zapier page's two halves: when its reading reaches the deployment, and which press an intent
// names. the client is replaced so a read is a count and a press is a record of what was posted,
// and the console's reading is replaced with whichever face the case sets.

const binary = vi.hoisted(() => ({
	reads: 0,
	keyed: true,
	face: 'ready',
	posted: [] as unknown[],
	answers: true
}));

const report = (): ZapierReport => ({
	key: binary.keyed ? { madeAt: '2026-09-01T00:00:00.000Z', key: 'bgz_standing' } : null,
	listening: { newGift: 1, newDonor: 0, giftRefunded: 0 },
	deliveries: { waiting: 0, failed: 0, oldestWaitingAt: null }
});

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	readZapier: async () => {
		binary.reads += 1;
		return { kind: 'read' as const, report: report() };
	},
	pressZapier: async (body: { press: 'make' | 'replace' }) => {
		binary.posted.push(body);
		return binary.answers
			? {
					kind: 'reported' as const,
					report: {
						ok: true as const,
						press: body.press,
						key: 'bgz_key',
						madeAt: '2026-09-22T00:00:00.000Z',
						disconnected: 0,
						paused: 0,
						notPaused: 0
					}
				}
			: { kind: 'unanswered' as const, read: { kind: 'no-session' as const } };
	}
}));

vi.mock('../lib/console-reading', async (original) => ({
	...(await original<Record<string, unknown>>()),
	readConsole: async () => ({
		workerName: 'better-giving',
		account: 'Riverbank Trust',
		accountId: '8f3c2a1b',
		remembered: true,
		notKept: null,
		version: '0.9.0',
		reading: {
			face:
				binary.face === 'ready'
					? { kind: 'ready', address: 'https://a.example' }
					: binary.face === 'refused'
						? { kind: 'blocked', why: { kind: 'refused', detail: '', count: 0, why: '' } }
						: { kind: 'unreachable', address: 'https://a.example', read: { kind: 'no-session' } },
			values: { vars: { kind: 'read', vars: [] } }
		}
	})
}));

const bar = await import('@better-giving/operator/progress-bar');
const { forgetReadings } = await import('../lib/processor-cache');
const { zapierIntent } = await import('../lib/zapier-standing');
const { gatedBy } = await import('../lib/console-reading');
const { clientAction, clientLoader } = await import('./_sections.zapier');

const ORIGIN = 'http://localhost';

/** the arguments a navigation to `href` hands the page's loader. */
const move = (href: string) =>
	({ request: new Request(new URL(href, ORIGIN)) }) as unknown as ClientLoaderFunctionArgs;

beforeEach(async () => {
	await forgetReadings();
	binary.reads = 0;
	binary.keyed = true;
	binary.face = 'ready';
	binary.posted = [];
	binary.answers = true;
	bar.pageDrawn('/organisation');
});

/** a visit to the Zapier page from another page, with the bar over it seen to its end. */
async function visit(href = '/zapier') {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	try {
		return await clientLoader(move(href));
	} finally {
		off();
	}
}

/** a post to the Zapier page carrying `intent`. */
const press = (intent: string) => {
	const posted = new FormData();
	posted.set('intent', intent);
	return clientAction({
		request: new Request(new URL('/zapier', ORIGIN), { method: 'POST', body: posted })
	} as unknown as ClientActionFunctionArgs);
};

describe('the Zapier page read', () => {
	it('sends a deployment that is not ready to `/`, and asks it nothing', async () => {
		binary.face = 'unconnected';
		const thrown = await visit().catch((reason: unknown) => reason);

		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(307);
		expect((thrown as Response).headers.get('Location')).toBe('/');
		expect(binary.reads).toBe(0);
	});

	it('stands a page cloudflare turned away behind the gate in its place, and asks it nothing', async () => {
		binary.face = 'refused';
		// through a router, since what the layout's boundary is handed is the router's reading of the throw
		const router = createMemoryRouter([{ path: '/zapier', loader: () => visit() }], {
			initialEntries: ['/zapier']
		});
		await router.initialize();
		await vi.waitFor(() => expect(router.state.initialized).toBe(true));
		const caught = Object.values(router.state.errors ?? {})[0];
		router.dispose();

		expect(gatedBy(caught)?.gate.title).toBe('Cloudflare turned this sign-in down');
		expect(binary.reads).toBe(0);
	});

	it('is read again on every visit while a key stands, since a Zap turned on at Zapier moves it', async () => {
		await visit();
		bar.pageDrawn('/organisation');
		await visit();

		expect(binary.reads).toBe(2);
	});

	it('passes the report through to the page, key included', async () => {
		const read = await visit();

		expect(read.zapier).toEqual({
			kind: 'read',
			report: expect.objectContaining({
				key: { madeAt: '2026-09-01T00:00:00.000Z', key: 'bgz_standing' }
			})
		});
	});

	it('answers the second visit from the first where no key stands', async () => {
		binary.keyed = false;
		const first = await visit();
		bar.pageDrawn('/organisation');
		const again = await visit();

		expect(binary.reads).toBe(1);
		expect(again.zapier).toEqual(first.zapier);
	});

	it('is read again after a press', async () => {
		binary.keyed = false;
		await visit();
		bar.pageDrawn('/organisation');
		await press(zapierIntent('make'));
		await visit();

		expect(binary.reads).toBe(2);
	});
});

describe('a press on the Zapier page', () => {
	it('posts the press its intent names, and hands the answer back beside it', async () => {
		const answered = await press(zapierIntent('replace'));

		expect(binary.posted).toEqual([{ press: 'replace' }]);
		expect(answered).toEqual({
			zapier: {
				press: 'replace',
				pressed: {
					kind: 'reported',
					report: {
						ok: true,
						press: 'replace',
						key: 'bgz_key',
						madeAt: '2026-09-22T00:00:00.000Z',
						disconnected: 0,
						paused: 0,
						notPaused: 0
					}
				}
			}
		});
	});

	it('names the press on an answer that never came, since nothing on the wire does', async () => {
		binary.answers = false;
		const answered = await press(zapierIntent('make'));

		expect(answered).toEqual({
			zapier: { press: 'make', pressed: { kind: 'unanswered', read: { kind: 'no-session' } } }
		});
	});

	it('posts nothing for an intent that names no press', async () => {
		expect(await press('zapier:rotate')).toEqual({ unknown: true });
		expect(binary.posted).toEqual([]);
	});
});
