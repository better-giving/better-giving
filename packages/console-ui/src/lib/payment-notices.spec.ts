import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { PaymentsRead, WebhookSecretReading, WebhookSubscriptionReading } from '../api/types';
import type { WebhookRepaired } from './notices-standing';
import type { PaymentNoticesProps } from './payment-notices';
import { PaymentNotices } from './payment-notices';
import type { StripeSectionProps } from './stripe-section';
import { StripeSection } from './stripe-section';

// the payment notices row as markup, and the Stripe screen around it with and without the press
// mounted. what this package can hold of a drawing is its markup: ../../vite.config.ts pins `node`
// and there is no dom, so the focus a landed repair moves is held as a reading in
// ./notices-standing.spec.ts (`repairLanded`) and never as a press here.

const VERIFYING: WebhookSecretReading = { state: 'verifying', detail: null };
const SWITCHED_OFF: WebhookSubscriptionReading = {
	state: 'incomplete',
	delivering: false,
	missingEventTypes: []
};

const drawn = (props: Partial<PaymentNoticesProps>): string =>
	renderToStaticMarkup(
		createElement(PaymentNotices, {
			webhook: VERIFYING,
			subscription: SWITCHED_OFF,
			answer: null,
			closed: false,
			repairing: false,
			onRepair: () => {},
			...props
		})
	);

const REPAIR = />Repair</;

describe('PaymentNotices', () => {
	it('says working, and draws no press, where Stripe is telling this deployment', () => {
		const page = drawn({ subscription: { state: 'complete' } });
		expect(page).toContain('Payment notices');
		expect(page).toContain('Working');
		expect(page).toContain('Stripe tells this deployment each time a gift is paid.');
		expect(page).not.toMatch(REPAIR);
	});

	it('says not working, why, and draws the press, where the endpoint is switched off', () => {
		const page = drawn({});
		expect(page).toContain('Not working');
		expect(page).toContain('Stripe has stopped telling this deployment when a gift is paid');
		expect(page).toMatch(REPAIR);
	});

	/** the repair leaves the secret and cannot make an endpoint, so it is not offered for either. */
	it('says not working with no press where only the Save can put it right', () => {
		const missing = drawn({ subscription: { state: 'unregistered' } });
		const stale = drawn({ webhook: { state: 'stale', detail: 'Redeploy.' } });
		for (const page of [missing, stale]) {
			expect(page).toContain('Not working');
			expect(page).toContain('Press Save with your two keys');
			expect(page).not.toMatch(REPAIR);
		}
	});

	it('draws nothing where the account could not be read', () => {
		expect(drawn({ subscription: { state: 'unreadable', detail: 'no key' } })).toBe('');
	});

	/** held rather than natively closed, so the focus standing on it survives the wait. */
	it('holds the press busy while it runs, and closed while the page writes', () => {
		const running = drawn({ closed: true, repairing: true });
		expect(running).toMatch(
			/aria-disabled="true"[^>]*aria-busy="true"|aria-busy="true"[^>]*aria-disabled="true"/
		);
		expect(running).not.toMatch(/<button[^>]* disabled=""/);
		expect(drawn({})).not.toContain('aria-disabled');
	});

	it('draws the success line for a repair that landed', () => {
		const answer: WebhookRepaired = {
			kind: 'reported',
			report: { outcome: 'repaired', detail: null },
			read: null
		};
		const page = drawn({ subscription: { state: 'complete' }, answer });
		expect(page).toContain('Repaired');
		expect(page).toContain('Stripe tells this deployment each time a gift is paid from now on.');
	});

	it('draws the deployment’s own sentence for a repair that failed, marked', () => {
		const answer: WebhookRepaired = {
			kind: 'reported',
			report: {
				outcome: 'failed',
				detail: 'No endpoint answers at `https://give.example/webhooks/stripe`. Reload this page.'
			},
			read: null
		};
		const page = drawn({ answer });
		expect(page).toContain('This deployment couldn’t repair it, so nothing was changed.');
		expect(page).toContain('<code');
		expect(page).toContain('Reload this page.');
		expect(page).toMatch(REPAIR);
	});

	it('draws the console’s refusal for a press nothing answered', () => {
		const answer: WebhookRepaired = {
			kind: 'unanswered',
			report: null,
			read: { kind: 'no-session' }
		};
		expect(drawn({ answer })).toContain(
			'This console is no longer connected to this deployment, so nothing was repaired.'
		);
	});
});

const PAYMENTS: PaymentsRead = {
	kind: 'read',
	report: {
		processors: [
			{
				processor: 'stripe',
				label: 'Stripe',
				state: 'configured',
				rails: {
					state: 'read',
					chargesEnabled: true,
					evidence: 'per_rail_approval',
					rails: []
				},
				webhook: VERIFYING,
				subscription: SWITCHED_OFF,
				wallets: null
			}
		]
	}
};

const SECTION: StripeSectionProps = {
	values: {
		vars: {
			kind: 'read',
			vars: [
				{ name: 'STRIPE_SECRET_KEY', kind: 'value', value: 'sk_live_x' },
				{ name: 'STRIPE_PUBLISHABLE_KEY', kind: 'value', value: 'pk_live_x' },
				{ name: 'STRIPE_WEBHOOK_SECRET', kind: 'value', value: 'whsec_x' }
			]
		}
	},
	payments: Promise.resolve(PAYMENTS),
	recurring: Promise.resolve(null),
	workerName: 'better-giving',
	accountName: 'Riverbank Trust',
	refused: null,
	turnedDownPair: false,
	revalidating: false,
	run: null,
	removed: null,
	freed: null,
	provision: null,
	wallets: null,
	busy: false,
	pending: null
};

/** the whole screen, awaited: the row stands inside the readings the page resolves. */
async function screen(props: StripeSectionProps): Promise<string> {
	const router = createMemoryRouter([
		{ path: '/', Component: () => createElement(StripeSection, props) }
	]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	return page;
}

describe('StripeSection', () => {
	it('draws no payment notices where the page mounts no repair', async () => {
		const page = await screen(SECTION);
		// the readings did resolve: the ways of paying stand, and the row is simply not among them.
		expect(page).toContain('Donation methods');
		expect(page).not.toContain('Payment notices');
	});

	it('draws the row among the readings where it does', async () => {
		const page = await screen({ ...SECTION, webhookRepair: null, onWebhookRepair: () => {} });
		expect(page).toContain('Payment notices');
		expect(page).toMatch(REPAIR);
	});
});
