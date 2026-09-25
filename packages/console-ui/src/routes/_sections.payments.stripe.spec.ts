import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import type { ClientActionFunctionArgs, DataRouter } from 'react-router';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentsRead, WebhookRepaired } from '../api/types';

// the Stripe page's payment notices press: what its intent posts to the binary, and whether the page
// reads the deployment again over the answer. the client is replaced so the press is a count and its
// answer is whichever one the case sets.

const REPAIRED: WebhookRepaired = {
	kind: 'reported',
	report: { outcome: 'repaired', detail: null },
	read: null
};

const binary = vi.hoisted(() => ({ repairs: 0, pageReads: 0, answer: null as unknown }));

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	repairWebhook: async () => {
		binary.repairs += 1;
		return binary.answer;
	}
}));

const { WEBHOOK_REPAIR_INTENT } = await import('../lib/notices-standing');
const stripe = await import('./_sections.payments.stripe');
const { clientAction } = stripe;

const ORIGIN = 'http://localhost';
const PAGE = '/payments/stripe';
const PAGE_ID = 'stripe';

/** a post to the Stripe page carrying `intent`. */
const press = (intent: string) => {
	const posted = new FormData();
	posted.set('intent', intent);
	return clientAction({
		request: new Request(new URL(PAGE, ORIGIN), { method: 'POST', body: posted })
	} as unknown as ClientActionFunctionArgs);
};

beforeEach(() => {
	binary.repairs = 0;
	binary.pageReads = 0;
	binary.answer = REPAIRED;
});

/** a stripe account whose endpoint is this deployment's and switched off: the repair's standing. */
const PAYMENTS: PaymentsRead = {
	kind: 'read',
	report: {
		processors: [
			{
				processor: 'stripe',
				label: 'Stripe',
				state: 'configured',
				rails: { state: 'read', chargesEnabled: true, evidence: 'per_rail_approval', rails: [] },
				webhook: { state: 'verifying', detail: null },
				subscription: { state: 'incomplete', delivering: false, missingEventTypes: [] },
				wallets: null
			}
		]
	}
};

/** the sections layout's reading, as much of it as the page draws from. */
const SHELL = {
	workerName: 'better-giving',
	account: 'Riverbank Trust',
	reading: {
		values: {
			vars: {
				kind: 'read',
				vars: [
					{ name: 'STRIPE_SECRET_KEY', kind: 'value', value: 'sk_live_x' },
					{ name: 'STRIPE_PUBLISHABLE_KEY', kind: 'value', value: 'pk_live_x' },
					{ name: 'STRIPE_WEBHOOK_SECRET', kind: 'value', value: 'whsec_x' }
				]
			}
		}
	}
};

/**
 * the page under a root and the sections layout, as the console mounts it: `matches[1]` is the
 * layout's reading. the page's own reading is a count, and its press and re-read are the module's.
 */
async function open() {
	const router = createMemoryRouter(
		[
			{
				children: [
					{
						loader: () => SHELL,
						children: [
							{
								id: PAGE_ID,
								path: PAGE,
								loader: () => {
									binary.pageReads += 1;
									return {
										payments: Promise.resolve(PAYMENTS),
										recurring: Promise.resolve(null),
										run: null
									};
								},
								action: stripe.clientAction as never,
								shouldRevalidate: stripe.shouldRevalidate,
								Component: UNSAFE_withComponentProps(stripe.default as never)
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

/** the screen as markup, awaited: the row stands inside the readings the page resolves. */
async function drawn(router: DataRouter): Promise<string> {
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	return page;
}

describe('the Stripe page', () => {
	it('mounts the payment notices row with its press', async () => {
		const router = await open();
		try {
			const page = await drawn(router);

			expect(page).toContain('Payment notices');
			expect(page).toMatch(/>Repair</);
		} finally {
			router.dispose();
		}
	});
});

describe('the payment notices press', () => {
	it('asks the binary once and hands its answer back as it came', async () => {
		const answered = await press(WEBHOOK_REPAIR_INTENT);

		expect(binary.repairs).toBe(1);
		expect(answered).toEqual({
			webhookRepair: { kind: 'reported', report: { outcome: 'repaired', detail: null }, read: null }
		});
	});
});

/** the press made on the mounted page, as its row makes it, seen through to the router at rest. */
async function pressed(router: DataRouter) {
	const posted = new FormData();
	posted.set('intent', WEBHOOK_REPAIR_INTENT);
	await router.navigate(PAGE, { formMethod: 'post', formData: posted, preventScrollReset: true });
	await vi.waitFor(() => expect(router.state.navigation.state).toBe('idle'));
}

describe('the Stripe page after the payment notices press', () => {
	it('reads the deployment again over a repair that landed, so the row says where it stands now', async () => {
		const router = await open();
		try {
			const before = binary.pageReads;
			await pressed(router);

			expect(binary.pageReads).toBe(before + 1);
		} finally {
			router.dispose();
		}
	});

	const unchanged: [string, WebhookRepaired][] = [
		[
			'a repair the deployment says failed',
			{ kind: 'reported', report: { outcome: 'failed', detail: 'Reload and Save.' }, read: null }
		],
		['a press nothing answered', { kind: 'unanswered', report: null, read: { kind: 'no-session' } }]
	];

	it.each(unchanged)('reads nothing again over %s', async (_, answer) => {
		binary.answer = answer;
		const router = await open();
		try {
			const before = binary.pageReads;
			await pressed(router);

			expect(binary.repairs).toBe(1);
			expect(binary.pageReads).toBe(before);
			expect(router.state.actionData).toEqual({ [PAGE_ID]: { webhookRepair: answer } });
		} finally {
			router.dispose();
		}
	});
});
