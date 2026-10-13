import { DEFAULT_MODEL } from '@better-giving/operator/ai-models';
import type { ClientActionFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelChoice, ModelCredits } from '../api/types';

// the model page's two halves: when its reading reaches the deployment, and what each press posts.
// the client is replaced so a read is a count and a press is a record of what was posted, and the
// console's reading is replaced with whichever face the case sets.

const binary = vi.hoisted(() => ({
	reads: 0,
	credits: { kind: 'not-asked' } as ModelCredits,
	refused: false,
	face: 'ready',
	stored: [] as unknown[],
	freed: 0
}));

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	readAiModel: async (): Promise<ModelChoice> => {
		binary.reads += 1;
		return binary.refused
			? { kind: 'refused', detail: 'Authentication error' }
			: { kind: 'read', model: { name: 'AI_MODEL', kind: 'absent' }, credits: binary.credits };
	},
	setVars: async (edit: unknown) => {
		binary.stored.push(edit);
		return { kind: 'set' as const };
	},
	freeWithheldVars: async () => {
		binary.freed += 1;
		return { kind: 'set' as const };
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
					: { kind: 'unreachable', address: 'https://a.example', read: { kind: 'no-session' } },
			values: { vars: { kind: 'read', vars: [] } }
		}
	})
}));

const bar = await import('@better-giving/operator/progress-bar');
const { forgetReadings } = await import('../lib/processor-cache');
const { MODEL_FIELD, MODEL_INTENT } = await import('../lib/ai-model');
const { FREE_INTENT } = await import('../lib/withheld-values');
const { gatedBy } = await import('../lib/console-reading');
const { clientAction, clientLoader } = await import('./_sections.ai-model');

const ORIGIN = 'http://localhost';
const CLAUDE = 'anthropic/claude-sonnet-4.6';

/** the arguments a navigation to `href` hands the page's loader. */
const move = (href: string) =>
	({ request: new Request(new URL(href, ORIGIN)) }) as unknown as ClientLoaderFunctionArgs;

beforeEach(async () => {
	await forgetReadings();
	binary.reads = 0;
	binary.credits = { kind: 'not-asked' };
	binary.refused = false;
	binary.face = 'ready';
	binary.stored = [];
	binary.freed = 0;
	bar.pageDrawn('/organisation');
});

/** a visit to the model page from another page, with the bar over it seen to its end. */
async function visit(href = '/ai-model') {
	const off = bar.subscribeProgressBar(() => {
		if (bar.progressBarFinishing()) queueMicrotask(bar.progressBarLanded);
	});
	try {
		return await clientLoader(move(href));
	} finally {
		off();
	}
}

/** a post to the model page carrying `fields`. */
const press = (fields: Record<string, string>) => {
	const posted = new FormData();
	for (const [name, value] of Object.entries(fields)) posted.set(name, value);
	return clientAction({
		request: new Request(new URL('/ai-model', ORIGIN), { method: 'POST', body: posted })
	} as unknown as ClientActionFunctionArgs);
};

/** what the layout's boundary is handed for a visit, read through a router as the page meets it. */
async function caughtOnVisit(): Promise<unknown> {
	const router = createMemoryRouter([{ path: '/ai-model', loader: () => visit() }], {
		initialEntries: ['/ai-model']
	});
	await router.initialize();
	await vi.waitFor(() => expect(router.state.initialized).toBe(true));
	const caught = Object.values(router.state.errors ?? {})[0];
	router.dispose();
	return caught;
}

describe('the model page read', () => {
	it('sends a deployment that is not ready to `/`, and asks it nothing', async () => {
		binary.face = 'unconnected';
		const thrown = await visit().catch((reason: unknown) => reason);

		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(307);
		expect((thrown as Response).headers.get('Location')).toBe('/');
		expect(binary.reads).toBe(0);
	});

	it('stands a choice cloudflare would not read behind the gate the layout’s own read would', async () => {
		binary.refused = true;
		const caught = await caughtOnVisit();

		expect(gatedBy(caught)?.gate.title).toBe('Cloudflare turned this sign-in down');
	});

	it('answers the second visit from the first where the choice spends no credits', async () => {
		const first = await visit();
		bar.pageDrawn('/organisation');
		const again = await visit();

		expect(binary.reads).toBe(1);
		expect(again.choice).toEqual(first.choice);
	});

	it('is read again on every visit where credits were asked about, since a balance moves unpressed', async () => {
		binary.credits = { kind: 'held', balance: 4.2 };
		await visit();
		bar.pageDrawn('/organisation');
		await visit();

		expect(binary.reads).toBe(2);
	});

	it('is read again after a press', async () => {
		await visit();
		bar.pageDrawn('/organisation');
		await press({ intent: MODEL_INTENT, [MODEL_FIELD]: CLAUDE });
		await visit();

		expect(binary.reads).toBe(2);
	});
});

describe('a press on the model page', () => {
	it('stores the chosen model through the vars press, and hands the answer back', async () => {
		expect(await press({ intent: MODEL_INTENT, [MODEL_FIELD]: CLAUDE })).toEqual({
			model: { kind: 'set' }
		});
		expect(binary.stored).toEqual([{ AI_MODEL: CLAUDE }]);
	});

	it('takes the name off for the default model rather than storing it', async () => {
		await press({ intent: MODEL_INTENT, [MODEL_FIELD]: DEFAULT_MODEL.id });
		expect(binary.stored).toEqual([{ AI_MODEL: null }]);
	});

	it('stores nothing for a body naming a model off the list', async () => {
		expect(await press({ intent: MODEL_INTENT, [MODEL_FIELD]: 'openai/gpt-4' })).toEqual({
			unknown: true
		});
		expect(binary.stored).toEqual([]);
	});

	it('frees the withheld values on the free press, and hands that answer back apart', async () => {
		expect(await press({ intent: FREE_INTENT })).toEqual({ freed: { kind: 'set' } });
		expect(binary.freed).toBe(1);
		expect(binary.stored).toEqual([]);
	});

	it('posts nothing for an intent that names no press', async () => {
		expect(await press({ intent: 'ai-model:reset', [MODEL_FIELD]: CLAUDE })).toEqual({
			unknown: true
		});
		expect(binary.stored).toEqual([]);
		expect(binary.freed).toBe(0);
	});
});
