import { describe, expect, it } from 'vitest';
import type { PaymentsRead, ProcessorPayments } from '../api/types';
import { configuredStanding, hoistSharedNote, processorStanding } from './processor-payments';

// where one processor stands, off the report that answers for both of them.
//
// the reading the payments fold is drawn from, held here because this package has no DOM pool
// (../../vite.config.ts) — and what it decides is whether a processor nobody configured reads as
// not set up or as failing, which no gate on the screen could see.

const UNCONFIGURED: ProcessorPayments = {
	processor: 'paypal',
	label: 'PayPal',
	state: 'unconfigured',
	unset: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']
};

const CONFIGURED: ProcessorPayments = {
	processor: 'stripe',
	label: 'Stripe',
	state: 'configured',
	rails: { state: 'read', chargesEnabled: true, evidence: 'per_rail_approval', rails: [] },
	webhook: { state: 'verifying', detail: null },
	subscription: { state: 'complete' },
	wallets: { state: 'read', hosts: [] }
};

const read = (...processors: readonly ProcessorPayments[]): PaymentsRead => ({
	kind: 'read',
	report: { processors: [...processors] }
});

describe('one processor out of the report', () => {
	it('finds the entry by its own name', () => {
		expect(processorStanding(read(CONFIGURED, UNCONFIGURED), 'paypal')).toBe(UNCONFIGURED);
	});

	it('answers nothing where the read was never taken', () => {
		expect(processorStanding(null, 'paypal')).toBe(null);
	});

	it('answers nothing where the deployment answered nothing', () => {
		expect(processorStanding({ kind: 'unread', read: { kind: 'no-session' } }, 'stripe')).toBe(
			null
		);
	});

	it('answers nothing for a processor the report left out, rather than throwing', () => {
		// the binary refuses a report short of a processor (packages/console/internal/deployment),
		// so this is a console older or newer than the deployment rather than a state to draw.
		expect(processorStanding(read(CONFIGURED), 'paypal')).toBe(null);
	});
});

describe('the readings a configured processor answered with', () => {
	it('is the entry itself where it holds credentials', () => {
		expect(configuredStanding(CONFIGURED)).toBe(CONFIGURED);
	});

	it('is nothing where the processor holds none, which is not a failure', () => {
		// the case this module exists for: an unconfigured processor has no reading at all, so a
		// screen reading one off it would be drawing blanks it had to colour in.
		expect(configuredStanding(UNCONFIGURED)).toBe(null);
	});

	it('is nothing where there is no entry', () => {
		expect(configuredStanding(null)).toBe(null);
	});
});

describe('a note every row carries', () => {
	const row = (rail: string, note: string | null) => ({ rail, note });
	const SAME = 'PayPal accepted this deployment’s credentials.';

	it('is said once over the ledger and under no row', () => {
		const rows = [row('paypal', SAME), row('venmo', SAME)];
		expect(hoistSharedNote(rows)).toEqual({
			shared: SAME,
			rows: [row('paypal', null), row('venmo', null)]
		});
	});

	it('stays under each row where the notes differ', () => {
		const rows = [row('paypal', SAME), row('venmo', 'Venmo is in review.')];
		expect(hoistSharedNote(rows)).toEqual({ shared: null, rows });
	});

	it('stays under its row where only one row carries a note', () => {
		const rows = [row('paypal', SAME), row('venmo', null)];
		expect(hoistSharedNote(rows)).toEqual({ shared: null, rows });
	});

	it('ignores rows with no note when matching the rest', () => {
		const rows = [row('paypal', SAME), row('card', null), row('venmo', SAME)];
		expect(hoistSharedNote(rows)).toEqual({
			shared: SAME,
			rows: [row('paypal', null), row('card', null), row('venmo', null)]
		});
	});
});
