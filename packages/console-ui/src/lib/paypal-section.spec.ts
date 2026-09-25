import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedValues, DeployedVar } from '../api/types';
import type { PaypalSectionProps } from './paypal-section';
import { PaypalSection } from './paypal-section';
import { PAYPAL_FIELD, PAYPAL_LIVE } from './paypal-setup';

// the PayPal screen's boxes as markup. what this package can hold of a drawing is its markup:
// ../../vite.config.ts pins `node` and there is no dom, so a box is read by the value it is drawn
// holding, which is ./payment-notices.spec.ts's arrangement.

const PAIR: DeployedVar[] = [
	{ name: 'PAYPAL_CLIENT_ID', kind: 'value', value: 'AYx-client' },
	{ name: 'PAYPAL_CLIENT_SECRET', kind: 'value', value: 'EOx-secret' }
];

const SECTION: Omit<PaypalSectionProps, 'values'> = {
	payments: Promise.resolve(null),
	recurring: Promise.resolve(null),
	workerName: 'better-giving',
	accountName: 'Riverbank Trust',
	paypal: { run: null, refused: null, turnedDownPair: false, unwritten: null },
	charity: null,
	freed: null,
	provision: null,
	revalidating: false,
	busy: false,
	pending: null
};

const holding = (vars: DeployedVar[]): DeployedValues => ({ vars: { kind: 'read', vars } });

/** the whole screen, awaited. */
async function screen(values: DeployedValues): Promise<string> {
	const router = createMemoryRouter([
		{ path: '/', Component: () => createElement(PaypalSection, { ...SECTION, values }) }
	]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	return page;
}

/** the one input posting `name`, as drawn. */
const input = (page: string, name: string): string => {
	const found = page.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'g')) ?? [];
	expect(found, name).toHaveLength(1);
	return found[0] as string;
};

const ADDRESS = PAYPAL_FIELD('PAYPAL_API_URL');

/** an address other than live, which the screen knows nothing about. */
const ELSEWHERE = 'https://paypal.example.org';

describe('the API address box', () => {
	it('holds the live address where the deployment stores none', async () => {
		const page = await screen(holding(PAIR));
		expect(input(page, ADDRESS)).toContain(`value="${PAYPAL_LIVE}"`);
	});

	it('holds the stored address where there is one', async () => {
		const page = await screen(
			holding([...PAIR, { name: 'PAYPAL_API_URL', kind: 'value', value: ELSEWHERE }])
		);
		expect(input(page, ADDRESS)).toContain(`value="${ELSEWHERE}"`);
	});

	it('stands in the keys form, named, with the line saying when to change it', async () => {
		const page = await screen(holding([]));
		const form = page.slice(page.indexOf('<form'), page.indexOf('</form>'));
		for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_API_URL'] as const) {
			input(form, PAYPAL_FIELD(name));
		}
		expect(input(form, ADDRESS)).toContain(`value="${PAYPAL_LIVE}"`);
		expect(form).toContain('API address');
		expect(form).toContain('Leave this as it is unless you’re rehearsing on PayPal’s sandbox');
	});
});
