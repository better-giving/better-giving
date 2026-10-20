import { describe, expect, it } from 'vitest';
import type { FormConfig } from '../v1';
import { createChallenge } from './challenge';
import type { TurnstileLike } from './turnstile';

// the dom pool, because the Turnstile half draws into a node. which check runs is the whole of
// what this module decides, so each case asserts which provider was asked and nothing about what
// either then did — ./altcha.spec.ts and ./turnstile.dom.spec.ts hold that.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_live_x' }],
	currency: 'USD',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

const CONFIG_URL = 'https://give.example.org/api/v1/forms/frm_a8x2k9/config';

function providers() {
	const asked: string[] = [];
	const loads: string[] = [];
	const turnstile: TurnstileLike = { render: () => 'w1', reset: () => {}, remove: () => {} };
	const seam = {
		turnstile: {
			load: async () => {
				loads.push('turnstile');
				return turnstile;
			}
		},
		altcha: {
			fetch: ((input: RequestInfo | URL) => {
				asked.push(String(input));
				return new Promise<Response>(() => {});
			}) as typeof fetch
		}
	};
	return { asked, loads, seam };
}

describe('which check a config names', () => {
	it('reads the ALTCHA challenge from the served path, resolved against the config’s address', async () => {
		const { asked, loads, seam } = providers();
		const config = { ...CONFIG, altchaChallengeUrl: '/api/v1/forms/frm_a8x2k9/challenge' };

		createChallenge(
			config,
			document.createElement('div'),
			() => {},
			() => {},
			{
				configUrl: CONFIG_URL,
				seam
			}
		);
		await Promise.resolve();

		expect(asked).toEqual(['https://give.example.org/api/v1/forms/frm_a8x2k9/challenge']);
		expect(loads).toEqual([]);
	});

	it('draws the Turnstile widget where the config serves a sitekey', async () => {
		const { asked, loads, seam } = providers();
		const config = { ...CONFIG, turnstileSiteKey: '0x4AAAAAAABBBB' };

		createChallenge(
			config,
			document.createElement('div'),
			() => {},
			() => {},
			{
				configUrl: CONFIG_URL,
				seam
			}
		);
		await Promise.resolve();

		expect(loads).toEqual(['turnstile']);
		expect(asked).toEqual([]);
	});
});
