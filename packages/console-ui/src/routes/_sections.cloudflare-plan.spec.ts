import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { ClientActionFunctionArgs } from 'react-router';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VarsWritten } from '../api/types';

// the Cloudflare plan page's presses: which write each intent makes on the binary, and what the page
// draws from the sections layout's reading. the client is replaced so every write is a record of
// what it was sent.

const binary = vi.hoisted(() => ({
	written: [] as Record<string, string | null>[],
	freed: 0
}));

const SET: VarsWritten = { kind: 'set' };

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	setVars: async (values: Record<string, string | null>) => {
		binary.written.push(values);
		return SET;
	},
	freeWithheldVars: async () => {
		binary.freed += 1;
		return SET;
	}
}));

const { PLAN_FIELD, PLAN_INTENT } = await import('../lib/cloudflare-plan');
const { FREE_INTENT } = await import('../lib/withheld-values');
const page = await import('./_sections.cloudflare-plan');

const ORIGIN = 'http://localhost';
const PAGE = '/cloudflare-plan';

/** a post to the page carrying `intent` and whatever else the case names. */
const press = (intent: string, fields: Record<string, string> = {}) => {
	const posted = new FormData();
	posted.set('intent', intent);
	for (const [name, value] of Object.entries(fields)) posted.set(name, value);
	return page.clientAction({
		request: new Request(new URL(PAGE, ORIGIN), { method: 'POST', body: posted })
	} as unknown as ClientActionFunctionArgs);
};

beforeEach(() => {
	binary.written = [];
	binary.freed = 0;
});

describe('the Cloudflare plan page’s switch', () => {
	it('stores the one word where the box is ticked', async () => {
		const answer = await press(PLAN_INTENT, { [PLAN_FIELD]: 'true' });

		expect(binary.written).toEqual([{ CLOUDFLARE_PAID_PLAN: 'true' }]);
		expect(answer).toEqual({ plan: SET });
	});

	it('takes the name off where the box is not ticked', async () => {
		await press(PLAN_INTENT);

		expect(binary.written).toEqual([{ CLOUDFLARE_PAID_PLAN: null }]);
	});
});

describe('the Cloudflare plan page’s other presses', () => {
	it('frees the withheld values on the press that frees them, and writes nothing else', async () => {
		const answer = await press(FREE_INTENT);

		expect(binary.freed).toBe(1);
		expect(binary.written).toEqual([]);
		expect(answer).toEqual({ freed: SET });
	});

	it('answers a press drawn on no part of it without writing anything', async () => {
		const answer = await press('paypal:charity', { [PLAN_FIELD]: 'true' });

		expect(answer).toEqual({ unknown: true });
		expect(binary.written).toEqual([]);
		expect(binary.freed).toBe(0);
	});
});

/** the page under a root and a stand-in for the sections layout's reading, as the console mounts it. */
async function open(seed: string) {
	const router = createMemoryRouter(
		[
			{
				children: [
					{
						loader: () => ({
							workerName: 'better-giving',
							account: 'Riverbank Trust',
							reading: {
								values: {
									vars: {
										kind: 'read',
										vars: [{ name: 'CLOUDFLARE_PAID_PLAN', kind: 'value', value: seed }]
									}
								}
							}
						}),
						children: [
							{
								path: PAGE,
								action: page.clientAction as never,
								Component: UNSAFE_withComponentProps(page.default as never)
							}
						]
					}
				]
			}
		],
		{ initialEntries: [PAGE] }
	);
	await vi.waitFor(() => expect(router.state.initialized).toBe(true));
	return router;
}

/** the switch's box, found by the name only it posts. */
const box = (markup: string) => {
	const found = markup.match(new RegExp(`<input\\b[^>]*name="${PLAN_FIELD}"[^>]*>`));
	if (found === null) throw new Error('no switch drawn');
	return found[0];
};

describe('the Cloudflare plan page', () => {
	it('draws the switch in the position the deployment holds', async () => {
		const paid = await open('true');
		const free = await open('');
		try {
			expect(box(renderToString(createElement(RouterProvider, { router: paid })))).toMatch(
				/\schecked=/
			);
			expect(box(renderToString(createElement(RouterProvider, { router: free })))).not.toMatch(
				/\schecked=/
			);
		} finally {
			paid.dispose();
			free.dispose();
		}
	});
});
