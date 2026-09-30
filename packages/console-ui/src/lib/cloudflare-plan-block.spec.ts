import { DELIVERY_PACE } from '@better-giving/operator/delivery-pace';
import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar } from '../api/types';
import { SHELL_ACTION } from './close-confirm';
import { PAID_PLAN, PLAN_FIELD, PLAN_INTENT, PLAN_PAID } from './cloudflare-plan';
import { CloudflarePlan } from './cloudflare-plan-block';
import { heldValues } from './held-values';

// the paid-plan switch as markup. this package pins one node pool and no dom (../../vite.config.ts),
// so the press is held as what its one form posts — the box's name and value and the button's
// intent — and what one press writes is ./cloudflare-plan.spec.ts's `planEdit`.

/** the whole block, over the deployment holding `vars`, drawn over the page at `at`, awaited. */
async function drawn(vars: DeployedVar[], at = '/'): Promise<string> {
	const props = {
		values: heldValues(vars),
		written: null,
		freed: null,
		trouble: () => null,
		busy: false,
		pending: null
	};
	const router = createMemoryRouter(
		[{ path: at, Component: () => createElement(CloudflarePlan, props) }],
		{ initialEntries: [at] }
	);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	// react marks where one text node meets the next; the reader sees one run of words
	return page.replaceAll('<!-- -->', '');
}

const answered = (value: string): DeployedVar[] => [{ name: PAID_PLAN, kind: 'value', value }];

/** the one box posting the switch, as drawn. */
const box = (page: string): string => {
	const found = page.match(new RegExp(`<input[^>]*name="${PLAN_FIELD}"[^>]*>`, 'g')) ?? [];
	expect(found).toHaveLength(1);
	return found[0] as string;
};

describe('the switch', () => {
	it('posts the one word under its field, beside a press carrying its own intent, in one form', async () => {
		const page = await drawn([]);
		expect(box(page)).toContain(`value="${PLAN_PAID}"`);
		expect(page.match(/<form/g)).toHaveLength(1);
		const press = page.match(/<button[^>]*type="submit"[^>]*>/g) ?? [];
		expect(press).toHaveLength(1);
		expect(press[0]).toContain('name="intent"');
		expect(press[0]).toContain(`value="${PLAN_INTENT}"`);
	});

	it('posts to `/`, which answers it, whatever page it is drawn over', async () => {
		const forms = (await drawn([], '/quickbooks')).match(/<form[^>]*>/g) ?? [];
		expect(forms).toHaveLength(1);
		expect(forms[0]).toContain(`action="${SHELL_ACTION}"`);
	});

	it('is off where the deployment holds no answer', async () => {
		expect(box(await drawn([]))).not.toContain('checked');
	});

	it('is on wherever the deployment reads the answer as paid, in any case', async () => {
		expect(box(await drawn(answered('true')))).toContain('checked');
		expect(box(await drawn(answered('TRUE')))).toContain('checked');
	});

	it('is off for an answer the deployment reads as Free', async () => {
		expect(box(await drawn(answered('yes')))).not.toContain('checked');
	});
});

describe('what the switch changes', () => {
	it('names each feed’s pace on both plans, from the table the deployment paces by', async () => {
		const page = await drawn([]);
		const { free, paid } = DELIVERY_PACE;
		expect(page).toContain(
			`makes ${free.zapier} deliveries a minute to Zapier, ${free.webhooks} to webhook destinations and ${free.books} to QuickBooks`
		);
		expect(page).toContain(`it makes ${paid.zapier}, ${paid.webhooks} and ${paid.books}`);
	});
});

describe('an answer stored where nothing can read it back', () => {
	it('draws the press that frees it', async () => {
		const page = await drawn([{ name: PAID_PLAN, kind: 'withheld' }]);
		expect(page).toContain(`Remove ${PAID_PLAN}`);
	});

	it('draws no such press where the answer is plain', async () => {
		expect(await drawn(answered('true'))).not.toContain(`Remove ${PAID_PLAN}`);
	});
});
