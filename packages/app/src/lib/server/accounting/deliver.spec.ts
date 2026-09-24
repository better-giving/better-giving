import { describe, expect, it } from 'vitest';
import {
	backoffMs,
	blockedNoticeOf,
	landingOf,
	type BlockedNotice,
	type FailureLanding
} from './deliver';
import { ACCOUNTING_FAILURE_REASONS, isRetryable, type AccountingFailureReason } from './provider';

// the two rules the delivery makes with no database in front of it: how long a row waits before it
// is tried again, and where a refusal lands.
//
// they are here rather than in ./deliver.workers.spec.ts because neither reads a row. what the
// workers spec holds is that a due row is read and a waiting one is not; what this holds is the
// ladder that decides which is which, at every rung including the ones a real backlog takes a day
// to reach.

const MINUTE = 60_000;

describe('how long a row waits before it is tried again', () => {
	it('makes a row nobody has tried due at once', () => {
		expect(backoffMs(0)).toBe(0);
	});

	it('doubles from one minute', () => {
		expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual(
			[1, 2, 4, 8, 16, 32].map((minutes) => minutes * MINUTE)
		);
	});

	it('stops at an hour, however long the outage runs', () => {
		// a day of Intuit being down costs a row about one attempt an hour, which is what keeps a
		// row nothing can fix cheap without a cap that would abandon a gift the books still owe.
		expect(backoffMs(7)).toBe(60 * MINUTE);
		expect(backoffMs(8)).toBe(60 * MINUTE);
		expect(backoffMs(400)).toBe(60 * MINUTE);
	});
});

/**
 * where each of the port's reasons lands, written out rather than read off the module under test.
 *
 * the point of the table is that it is a second copy: `landingOf` reading its own map would pass
 * whatever that map said. a reason added to ./provider.ts fails the coverage case
 * below until somebody decides whether it stops the run, kills the row, or waits.
 */
const LANDINGS: Readonly<Record<AccountingFailureReason, FailureLanding>> = {
	not_connected: 'run',
	accounts_not_chosen: 'run',
	reconnect_needed: 'run',
	rate_limited: 'run',
	unreachable: 'run',
	credential_unsaved: 'run',
	not_found: 'row',
	unmapped_account: 'row',
	invalid_record: 'row',
	internal_error: 'row',
	provider_error: 'attempt'
};

describe('where a refusal lands', () => {
	it.each(Object.entries(LANDINGS))('puts %s on the %s', (reason, landing) => {
		expect(landingOf(reason as AccountingFailureReason)).toBe(landing);
	});

	it('places every reason the port holds', () => {
		expect(Object.keys(LANDINGS).sort()).toEqual([...ACCOUNTING_FAILURE_REASONS].sort());
	});

	it('spends an attempt on no reason the port calls terminal', () => {
		// the two are not the same partition — a throttled or unreachable provider is worth asking
		// again and still stops the run, because the whole backlog is behind that one fault. what
		// must never differ is this direction: a row that waits is a row that will be sent again.
		const waiting = ACCOUNTING_FAILURE_REASONS.filter((r) => landingOf(r) === 'attempt');

		expect(waiting.every(isRetryable)).toBe(true);
	});
});

/**
 * what a run stopped by each reason tells an operator, written out for the same reason the table
 * above is: read off the module, the case would pass whatever the module said.
 */
const NOTICES: Readonly<Record<AccountingFailureReason, BlockedNotice>> = {
	reconnect_needed: 'at_once',
	accounts_not_chosen: 'at_once',
	unreachable: 'after_a_while',
	rate_limited: 'never',
	credential_unsaved: 'never',
	not_connected: 'never',
	not_found: 'never',
	unmapped_account: 'never',
	invalid_record: 'never',
	internal_error: 'never',
	provider_error: 'never'
};

describe('what a run that could not send anything tells an operator', () => {
	it.each(Object.entries(NOTICES))('on %s, %s', (reason, notice) => {
		expect(blockedNoticeOf(reason as AccountingFailureReason)).toBe(notice);
	});

	it('places every reason the port holds', () => {
		expect(Object.keys(NOTICES).sort()).toEqual([...ACCOUNTING_FAILURE_REASONS].sort());
	});

	it('notifies for no reason that leaves the run going', () => {
		// the arm only ever sees a reason that stopped a run, so one set to notify from anywhere
		// else is a rule written against a state that never happens.
		const notifying = ACCOUNTING_FAILURE_REASONS.filter((r) => blockedNoticeOf(r) !== 'never');

		expect(notifying.every((r) => landingOf(r) === 'run')).toBe(true);
	});
});
