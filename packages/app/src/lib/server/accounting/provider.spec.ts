import { describe, expect, it } from 'vitest';
import {
	ACCOUNTING_FAILURE_REASONS,
	failed,
	isRetryable,
	RETRYABLE_FAILURE_REASONS,
	TERMINAL_FAILURE_REASONS
} from './provider';

// the partition the delivery reads, held to being one.
//
// the same claim ../payments/provider.spec.ts makes about its own reasons, and it is the whole
// reason `failed` derives the boolean rather than taking one: a reason added later with no place
// in either list fails here, where a hand-written `retryable: true` at one call site would have
// been a dead row nobody could explain.

describe('the retry partition', () => {
	it('places every reason in exactly one list', () => {
		const placed = [...RETRYABLE_FAILURE_REASONS, ...TERMINAL_FAILURE_REASONS];

		expect([...placed].sort()).toEqual([...ACCOUNTING_FAILURE_REASONS].sort());
	});

	it('answers for a reason worth trying again, and for one that is not', () => {
		expect(isRetryable('rate_limited')).toBe(true);
		expect(isRetryable('reconnect_needed')).toBe(false);
	});
});

describe('a failure', () => {
	it('carries the retryable boolean the queue reads, off the reason', () => {
		expect(failed('provider_error', 'QuickBooks answered 502.')).toEqual({
			ok: false,
			reason: 'provider_error',
			detail: 'QuickBooks answered 502.',
			retryable: true
		});
	});

	it('marks a refused credential as not worth a second attempt', () => {
		expect(failed('reconnect_needed', 'the refresh token was rejected.').retryable).toBe(false);
	});
});
