import { describe, expect, it } from 'vitest';
import type { PaymentsRead, ProcessorPayments } from '../api/types';
import {
	EVIDENCE_SAYS,
	configuredStanding,
	processorStanding,
	unmanagedEndpoint
} from './processor-payments';

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

describe('the endpoint this release registers for nobody', () => {
	it('carries the sentence and the address together', () => {
		const entry: ProcessorPayments = {
			...CONFIGURED,
			processor: 'paypal',
			label: 'PayPal',
			subscription: {
				state: 'unmanaged',
				detail: 'Register a webhook on your PayPal account.',
				address: 'https://give.example.org/api/v1/webhooks/paypal'
			}
		};
		expect(unmanagedEndpoint(entry)).toEqual({
			detail: 'Register a webhook on your PayPal account.',
			address: 'https://give.example.org/api/v1/webhooks/paypal'
		});
	});

	it('is nothing on an endpoint this release does register', () => {
		expect(unmanagedEndpoint(CONFIGURED)).toBe(null);
	});

	it('is nothing on a processor that holds no credentials', () => {
		expect(unmanagedEndpoint(UNCONFIGURED)).toBe(null);
	});
});

describe('what a rails ledger says over its rows', () => {
	it('says what an approval is not, where the processor publishes one per rail', () => {
		// the rows are silent under an approved rail there (`STANDING_NOTE.approved` in
		// packages/app/src/lib/server/forms/rail-notes.ts), so this is the only place it is said.
		expect(EVIDENCE_SAYS.per_rail_approval).toContain('not a promise');
	});

	it('says nothing where the deployment writes it under every row', () => {
		// the case this record exists for: a processor publishing no approval sends its own sentence
		// down as each rail's note, so a paragraph here is that sentence a third time on one screen.
		expect(EVIDENCE_SAYS.credentials_only).toBe(null);
	});
});
