import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedValues, DeployedVar } from '../api/types';
import type { StripeSectionProps } from './stripe-section';
import { StripeSection } from './stripe-section';

// the Stripe screen's waiting words as markup. there is no dom here (../../vite.config.ts pins
// `node`), so this is ./paypal-section.spec.ts's arrangement: render once while the readings are
// pending, which a prerender would wait out, and keep what was drawn.

const SECTION: Omit<StripeSectionProps, 'values' | 'payments' | 'recurring'> = {
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

const holding = (vars: DeployedVar[]): DeployedValues => ({ vars: { kind: 'read', vars } });

const SECRET: DeployedVar = { name: 'STRIPE_SECRET_KEY', kind: 'withheld' };

const PLACEHOLDER = '<div class="adm-stack" aria-hidden="true"><div class="adm-named">';

/** what a reader's tree holds while both readings are still being asked for. */
function pending(values: DeployedValues): string {
	const asking = new Promise<never>(() => {});
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(StripeSection, { ...SECTION, payments: asking, recurring: asking, values })
		}
	]);
	// the marker comment and template the server draws for a pending boundary are not in a reader's tree.
	return renderToString(createElement(RouterProvider, { router }))
		.replace(/<template[^>]*><\/template>/g, '')
		.replace(/<!--[^>]*-->/g, '');
}

describe('the words over the readings while they are asked for', () => {
	it('stand in a region of their own ahead of the boundary, and not in the placeholder', () => {
		// `SkeletonStatus` (packages/operator/src/components/status/LedgerSkeleton.jsx) holds the
		// region for the section's life, because one inserted with a `Suspense` fallback is one a
		// reader commonly has not registered by the time its words land.
		const page = pending(holding([SECRET]));
		const placeholder = page.indexOf(PLACEHOLDER);
		expect(placeholder).toBeGreaterThan(-1);

		expect(page.slice(0, placeholder).match(/role="status"/g)).toHaveLength(1);
		expect(page.slice(0, placeholder)).toMatch(/<div role="status" class="adm-vh"><\/div>$/);
		expect(page.slice(placeholder, page.indexOf('<form'))).not.toContain('role="status"');
	});

	it('draw no skeleton and none of the words where the deployment holds no secret key', () => {
		// the route resolves both readings without a round trip here, so a placeholder would be a
		// screen saying it is asking after something it asked nobody about. the region itself
		// stays, empty, which is what lets it be there before the words are.
		const page = pending(holding([]));
		expect(page).not.toContain('adm-skeleton');
		expect(page).not.toContain(PLACEHOLDER);
		expect(page).not.toContain('Asking this deployment');
		expect(page.match(/role="status"/g)).toHaveLength(1);
		expect(page).toMatch(/<div role="status" class="adm-vh"><\/div>/);
	});
});
