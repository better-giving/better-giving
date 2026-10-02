import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedValues, DeployedVar, PaypalFailure, PaypalSetup } from '../api/types';
import type { PaypalSectionProps } from './paypal-section';
import { PaypalSection, typedBoxes } from './paypal-section';
import { PAYPAL_FIELD, PAYPAL_DEFAULT_API_URL } from './paypal-setup';

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
async function screen(
	values: DeployedValues,
	paypal: PaypalSectionProps['paypal'] = SECTION.paypal
): Promise<string> {
	const router = createMemoryRouter([
		{ path: '/', Component: () => createElement(PaypalSection, { ...SECTION, values, paypal }) }
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

/** an address other than the default, which the screen knows nothing about. */
const ELSEWHERE = 'https://paypal.example.org';

describe('the API address box', () => {
	it('holds the default address where the deployment stores none', async () => {
		const page = await screen(holding(PAIR));
		expect(input(page, ADDRESS)).toContain(`value="${PAYPAL_DEFAULT_API_URL}"`);
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
		expect(input(form, ADDRESS)).toContain(`value="${PAYPAL_DEFAULT_API_URL}"`);
		expect(form).toContain('API address');
		expect(form).toContain('Leave this as it is unless you’re rehearsing on PayPal’s sandbox');
	});
});

describe('what the boxes are read as when the press is kept', () => {
	it('holds the pair without the whitespace it was typed with, as the address already is', () => {
		// what is kept re-seeds the boxes for the rest of the visit, and the binary stored the pair
		// trimmed (`paypalPairPosted` in ./paypal-setup.ts), so a kept value with its spaces is one
		// the deployment does not hold.
		const typed: Record<string, string> = {
			PAYPAL_CLIENT_ID: '  AYx-client\n',
			PAYPAL_CLIENT_SECRET: '\tEOx-secret  ',
			PAYPAL_API_URL: ` ${ELSEWHERE} `
		};
		expect(typedBoxes((name) => typed[name] ?? '')).toEqual({
			PAYPAL_CLIENT_ID: 'AYx-client',
			PAYPAL_CLIENT_SECRET: 'EOx-secret',
			PAYPAL_API_URL: ELSEWHERE
		});
	});

	it('falls back to the default address where its box was left blank', () => {
		expect(typedBoxes(() => '  ').PAYPAL_API_URL).toBe(PAYPAL_DEFAULT_API_URL);
	});
});

describe('a permission PayPal refused this app', () => {
	/** the screen after a reload, holding a run that stopped at `stage` with `outcome`. */
	const stoppedAt = (stage: 'authorizing' | 'registering', outcome: PaypalSetup) =>
		screen(holding(PAIR), {
			...SECTION.paypal,
			run: { kind: 'ended', stage, facts: { registration: null, elsewhere: [] }, outcome }
		});

	const PERMISSION =
		'Turn that permission on in the app’s settings in your PayPal developer dashboard';
	const WRONG_KEYS = ['These keys don’t work', 'wouldn’t let these keys', 'Check all three'];

	it('says the permission and quotes the binary when the token mint is refused one', async () => {
		const failure: PaypalFailure = {
			kind: 'forbidden',
			detail: 'NOT_AUTHORIZED: insufficient scope'
		};
		const page = await stoppedAt('authorizing', { kind: 'unauthorized', failure });
		expect(page).toContain(PERMISSION);
		expect(page).toContain(failure.detail);
		for (const wrong of WRONG_KEYS) expect(page).not.toContain(wrong);
	});

	it('says the permission and quotes the step the binary named when a later call is refused one', async () => {
		const failure: PaypalFailure = {
			kind: 'forbidden',
			detail:
				'NOT_AUTHORIZED. PayPal accepted the pair and refused this app permission to add a webhook.'
		};
		const page = await stoppedAt('registering', { kind: 'uncreated', failure });
		expect(page).toContain(PERMISSION);
		expect(page).toContain('refused this app permission to add a webhook');
		for (const wrong of WRONG_KEYS) expect(page).not.toContain(wrong);
	});

	it('quotes the fix the binary wrote and says nothing was set up when the disputes are unread', async () => {
		const failure: PaypalFailure = {
			kind: 'forbidden',
			detail:
				'NOT_AUTHORIZED. PayPal accepted the pair and refused this app permission to read its disputes. Switch Disputes on for this app in PayPal’s developer dashboard, then press Save again: every refund is checked against its disputes.'
		};
		const page = await stoppedAt('registering', { kind: 'disputes-unread', failure });
		expect(page).toContain(PERMISSION);
		expect(page).toContain('Switch Disputes on for this app');
		expect(page).toContain('no webhook was added, and nothing was set up');
		for (const wrong of WRONG_KEYS) expect(page).not.toContain(wrong);
	});
});
