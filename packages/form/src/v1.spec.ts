import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	type QuoteRequest,
	type StockPledgeRequest,
	API_ERROR_CODES,
	DONATION_STATES,
	FEE_COVERAGE_MODES,
	FREQUENCIES,
	MAX_CUSTODIAN,
	MAX_EMPLOYER,
	PAYMENT_METHODS,
	PAYPAL_SDK_PATH,
	TRIBUTE_KINDS
} from './v1';

// node pool. each list is pinned as a literal in order: a member renamed, removed or moved fails
// here, and a member added is an edit to this file in the same change.

describe('the v1 vocabularies', () => {
	it('keeps every frequency, in order', () => {
		expect(FREQUENCIES).toStrictEqual(['one_time', 'monthly', 'yearly']);
	});

	it('keeps every tribute kind, in order', () => {
		expect(TRIBUTE_KINDS).toStrictEqual(['honor', 'memory']);
	});

	it('keeps every fee coverage mode, in order', () => {
		expect(FEE_COVERAGE_MODES).toStrictEqual(['optional']);
	});

	it('keeps every payment method, in order', () => {
		expect(PAYMENT_METHODS).toStrictEqual([
			'card',
			'ach',
			'apple_pay',
			'google_pay',
			'paypal',
			'venmo',
			'daf',
			'crypto',
			'stock',
			'ira_qcd'
		]);
	});

	it('keeps every donation state, in order', () => {
		expect(DONATION_STATES).toStrictEqual(['waiting', 'received', 'expired']);
	});

	it('keeps every error code, in order', () => {
		expect(API_ERROR_CODES).toStrictEqual([
			'form_not_found',
			'form_not_published',
			'form_retired',
			'form_unservable',
			'org_profile_incomplete',
			'payments_not_configured',
			'payments_unavailable',
			'challenge_failed',
			'daf_authorization_expired',
			'daf_grant_declined',
			'coin_not_accepted',
			'below_minimum',
			'above_maximum',
			'pledge_detail_invalid',
			'ticker_not_listed',
			'pledge_not_found',
			'pledge_id_taken'
		]);
	});
});

// checked by `tsc` through `pnpm check`: vitest does not typecheck, so these hold the shape rather
// than a value.
describe('the v1 request shapes', () => {
	it('lets a quote request carry a contribution and a stock pledge carry none', () => {
		expectTypeOf<QuoteRequest>().toHaveProperty('contributionMinor');
		expectTypeOf<StockPledgeRequest>().not.toHaveProperty('contributionMinor');
		// the runner wants a runtime assertion in every test: the rail the pledge type is for.
		expect(PAYMENT_METHODS).toContain('stock');
	});
});

describe('the v1 constants', () => {
	it('keeps the longest custodian and employer a request may name', () => {
		expect(MAX_CUSTODIAN).toBe(200);
		expect(MAX_EMPLOYER).toBe(200);
	});

	it('keeps the path PayPal’s core SDK is loaded from', () => {
		expect(PAYPAL_SDK_PATH).toBe('/web-sdk/v6/core');
	});
});
