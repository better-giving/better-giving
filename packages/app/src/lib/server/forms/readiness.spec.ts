import { describe, expect, it } from 'vitest';
import { FORM_READINESS_JOBS, FORM_READINESS_SEVERITIES } from '$lib/forms/readiness';
import type { ConfigEnv } from '../config/env';
import type { OrgProfile } from '../db/schema';
import { formsReadiness } from './readiness';

// a node spec: this module reads a row and the deploy-time values handed to it and issues no
// query — the same split ./form-input.ts draws against ./queries.ts. CLAUDE.md splits the pools by
// what a spec needs, and nothing here needs a database.

/**
 * a saved profile, as the row arrives from the database.
 *
 * cast because `OrgProfile` carries columns this module never reads — the address, the
 * timestamps — and naming them here would be a fixture that has to be kept in step with a table
 * for no assertion's sake. the three it does read are stated.
 */
function profile(over: Partial<OrgProfile> = {}): OrgProfile {
	return {
		legalName: 'Hope Foundation',
		taxId: '12-3456789',
		deductibilityStatement: 'No goods or services were provided in exchange for this gift.',
		...over
	} as OrgProfile;
}

/** Stripe's charge pair and the value its payment notices are verified with. */
const STRIPE: ConfigEnv = {
	STRIPE_SECRET_KEY: 'sk_test_secret',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_publishable',
	STRIPE_WEBHOOK_SECRET: 'whsec_signing'
};

/** the line for `job`, or a failure naming the one that went missing. */
function line(lines: ReturnType<typeof formsReadiness>, job: string) {
	const found = lines?.find((l) => l.job === job);
	if (!found) throw new Error(`the block has no ${job} line`);
	return found;
}

describe('formsReadiness', () => {
	/**
	 * the block names what stops a form being served, and a blank statement stops nothing.
	 *
	 * the standard 501(c)(3) wording is what a config carries where the column is empty
	 * (`servedDeductibilityStatement` in ../org/deductibility.ts), so a deployment that never
	 * wrote one serves forms — and a blocker over it would be this screen refusing a deployment
	 * the donation path accepts.
	 */
	it('says nothing about a blank deductibility statement', () => {
		expect(formsReadiness(profile({ deductibilityStatement: null }), STRIPE)).toBe(null);
	});

	it('blocks on the organisation while either identity field is blank', () => {
		expect(line(formsReadiness(null, STRIPE), 'organisation').severity).toBe('blocker');
		expect(line(formsReadiness(profile({ taxId: null }), STRIPE), 'organisation').severity).toBe(
			'blocker'
		);
	});

	it('renders no block at all once everything is in place', () => {
		// a panel reporting that nothing is wrong is a panel an operator learns to scroll past, and
		// these screens are about forms rather than about configuration.
		expect(formsReadiness(profile(), STRIPE)).toBe(null);
	});

	it('blocks on the processor while no processor’s keys are set', () => {
		const lines = formsReadiness(profile(), {});
		expect(line(lines, 'processor').severity).toBe('blocker');
		// the organisation's line stays in the list, resolved, so the list does not renumber itself
		// as the operator works through it.
		expect(line(lines, 'organisation').severity).toBe('resolved');
	});

	it('blocks on the processor while only half of a charge pair is set', () => {
		const lines = formsReadiness(profile(), { STRIPE_SECRET_KEY: 'sk_test_secret' });
		expect(line(lines, 'processor').severity).toBe('blocker');
	});

	it.each([
		['Stripe', STRIPE],
		['PayPal', { PAYPAL_CLIENT_ID: 'AX', PAYPAL_CLIENT_SECRET: 'EC', PAYPAL_WEBHOOK_ID: 'WH' }],
		[
			'Chariot',
			{ CHARIOT_API_KEY: 'key', CHARIOT_CONNECT_ID: 'live_x', CHARIOT_WEBHOOK_SECRET: 'sec' }
		],
		[
			'NOWPayments',
			{
				NOWPAYMENTS_API_KEY: 'key',
				NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20',
				NOWPAYMENTS_IPN_SECRET: 'ipn'
			}
		]
	] as const)('clears the processor blocker with %s’s keys set', (_name, config) => {
		expect(formsReadiness(profile(), config)).toBe(null);
	});

	it('warns about payment notices when Stripe’s keys are set and its webhook secret is not', () => {
		const { STRIPE_WEBHOOK_SECRET: _unset, ...keysOnly } = STRIPE;
		const lines = formsReadiness(profile(), keysOnly);
		expect(line(lines, 'notices').severity).toBe('warning');
		expect(line(lines, 'processor').severity).toBe('resolved');
	});

	it('warns about the processor that lacks its notice value, whichever else is complete', () => {
		const lines = formsReadiness(profile(), {
			...STRIPE,
			PAYPAL_CLIENT_ID: 'AX',
			PAYPAL_CLIENT_SECRET: 'EC'
		});
		expect(line(lines, 'notices').severity).toBe('warning');
	});

	it('says nothing about notices while no processor is set, which the processor line covers', () => {
		const lines = formsReadiness(profile(), {});
		expect(lines?.map((l) => l.job)).toEqual(['organisation', 'processor']);
	});

	/**
	 * what a line may carry, asserted over the vocabulary rather than over the arms this file
	 * happens to build: a job and a severity, and no sentence. the screens word each line by its
	 * job and by who is reading (`$lib/admin/forms/readiness.tsx`).
	 */
	it('carries a job and a severity on every line, and nothing else', () => {
		for (const [row, config] of [
			[null, {}],
			[profile(), {}],
			[profile({ taxId: null }), { STRIPE_SECRET_KEY: 'sk', STRIPE_PUBLISHABLE_KEY: 'pk' }]
		] as const) {
			for (const l of formsReadiness(row, config) ?? []) {
				expect(FORM_READINESS_JOBS).toContain(l.job);
				expect(FORM_READINESS_SEVERITIES).toContain(l.severity);
				expect(Object.keys(l).sort()).toEqual(['job', 'severity']);
			}
		}
	});
});
