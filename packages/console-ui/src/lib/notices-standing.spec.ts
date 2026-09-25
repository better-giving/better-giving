import {
	DISPUTE_EVENT_TYPES,
	RECURRING_EVENT_TYPES,
	REFUND_EVENT_TYPES,
	SETTLEMENT_EVENT_TYPES
} from '@better-giving/operator/stripe/webhook-endpoint';
import { describe, expect, it } from 'vitest';
import type {
	WebhookRepaired,
	WebhookSecretReading,
	WebhookSubscriptionReading
} from '../api/types';
import { noticesNote, noticesStanding, repairLanded } from './notices-standing';

// what the payment notices row reads out of the endpoint's two readings, away from the row that
// draws it (./payment-notices.tsx), for the reason ./notices-standing.ts is a module at all.

const secret = (state: WebhookSecretReading['state']): WebhookSecretReading => ({
	state,
	detail: state === 'stale' ? 'Set `STRIPE_WEBHOOK_SECRET` and redeploy.' : null
});

const COMPLETE: WebhookSubscriptionReading = { state: 'complete' };

describe('noticesStanding', () => {
	it('reads working where the endpoint is on, subscribed and verifying', () => {
		expect(noticesStanding(secret('verifying'), COMPLETE)).toEqual({ kind: 'working' });
	});

	/** a secret nothing can be compared against is not a fault, so it is never drawn as one. */
	it('reads working where the secret cannot be compared', () => {
		expect(noticesStanding(secret('unconfirmable'), COMPLETE)).toEqual({ kind: 'working' });
	});

	it('reads incomplete, keeping switched off and short of an event apart', () => {
		expect(
			noticesStanding(secret('verifying'), {
				state: 'incomplete',
				delivering: false,
				missingEventTypes: []
			})
		).toEqual({ kind: 'incomplete', delivering: false, missing: 'nothing' });
		expect(
			noticesStanding(secret('verifying'), {
				state: 'incomplete',
				delivering: true,
				missingEventTypes: ['payment_intent.succeeded']
			})
		).toEqual({ kind: 'incomplete', delivering: true, missing: 'payments' });
	});

	const shortOf = (missingEventTypes: string[]) =>
		noticesStanding(secret('verifying'), {
			state: 'incomplete',
			delivering: true,
			missingEventTypes
		});

	it('reads an endpoint short only of refund or dispute events as missing reversals', () => {
		for (const type of [...REFUND_EVENT_TYPES, ...DISPUTE_EVENT_TYPES]) {
			expect(shortOf([type]), type).toEqual({
				kind: 'incomplete',
				delivering: true,
				missing: 'reversals'
			});
		}
		expect(shortOf(['refund.updated', 'charge.dispute.closed'])).toEqual({
			kind: 'incomplete',
			delivering: true,
			missing: 'reversals'
		});
	});

	it('reads an endpoint short of any event that marks a gift paid as missing payments', () => {
		for (const type of [...SETTLEMENT_EVENT_TYPES, ...RECURRING_EVENT_TYPES]) {
			expect(shortOf([type]), type).toEqual({
				kind: 'incomplete',
				delivering: true,
				missing: 'payments'
			});
		}
		// short of both, the gift never marked paid is the worse of the two and the one said.
		expect(shortOf(['refund.updated', 'payment_intent.succeeded'])).toEqual({
			kind: 'incomplete',
			delivering: true,
			missing: 'payments'
		});
	});

	/** a type this console has no list for is read at its worst rather than waved through. */
	it('reads an event it cannot place as missing payments', () => {
		expect(shortOf(['charge.refunded'])).toEqual({
			kind: 'incomplete',
			delivering: true,
			missing: 'payments'
		});
	});

	/** the Save that remakes the secret remakes the subscription with it, so it is said first. */
	it('reads a secret that does not verify ahead of an endpoint short of an event', () => {
		const short: WebhookSubscriptionReading = {
			state: 'incomplete',
			delivering: false,
			missingEventTypes: ['refund.updated']
		};
		expect(noticesStanding(secret('stale'), short)).toEqual({ kind: 'unverified' });
		expect(noticesStanding(secret('unset'), short)).toEqual({ kind: 'unverified' });
	});

	it('reads unregistered ahead of everything, since there is nothing to repair', () => {
		expect(noticesStanding(secret('unconfirmable'), { state: 'unregistered' })).toEqual({
			kind: 'unregistered'
		});
	});

	/** said once above for every reading an account read spoils, and never as a row of its own. */
	it('has nothing to say where the account could not be read', () => {
		expect(
			noticesStanding(secret('unconfirmable'), { state: 'unreadable', detail: 'no key' })
		).toBeNull();
	});
});

describe('noticesNote', () => {
	/** no machine word reaches an operator: the row is about gifts, not the endpoint behind them. */
	it('says every standing in a fundraiser’s words', () => {
		const notes = [
			noticesNote({ kind: 'working' }),
			noticesNote({ kind: 'unregistered' }),
			noticesNote({ kind: 'unverified' }),
			noticesNote({ kind: 'incomplete', delivering: false, missing: 'nothing' }),
			noticesNote({ kind: 'incomplete', delivering: true, missing: 'payments' }),
			noticesNote({ kind: 'incomplete', delivering: false, missing: 'payments' }),
			noticesNote({ kind: 'incomplete', delivering: true, missing: 'reversals' })
		];
		for (const note of notes) expect(note).not.toMatch(/webhook|endpoint|event|secret/i);
		expect(new Set(notes).size).toBe(notes.length);
	});

	it('sends the two standings the repair cannot reach to the Save', () => {
		expect(noticesNote({ kind: 'unregistered' })).toContain('Press Save');
		expect(noticesNote({ kind: 'unverified' })).toContain('Press Save');
		expect(
			noticesNote({ kind: 'incomplete', delivering: false, missing: 'nothing' })
		).not.toContain('Save');
	});

	it('says refunds and disputes are missed, and no more, where only those go untold', () => {
		const note = noticesNote({ kind: 'incomplete', delivering: true, missing: 'reversals' });
		expect(note).toContain('refunds and disputes');
		expect(note).not.toContain('never marked paid');
	});

	it('keeps the gift never marked paid where a payment goes untold', () => {
		expect(noticesNote({ kind: 'incomplete', delivering: true, missing: 'payments' })).toBe(
			'Stripe isn’t telling this deployment about every kind of payment, so card gifts can be charged and never marked paid.'
		);
	});

	/** switched off, nothing is told at all, so what goes untold beside that changes nothing. */
	it('keeps the gift never marked paid on a switched-off endpoint short only of reversals', () => {
		expect(noticesNote({ kind: 'incomplete', delivering: false, missing: 'reversals' })).toContain(
			'never marked paid'
		);
	});
});

describe('repairLanded', () => {
	/** what moves the reader to the row, since the press goes with the standing that drew it. */
	it('is true of a repair that landed and of nothing else', () => {
		const repaired: WebhookRepaired = {
			kind: 'reported',
			report: { outcome: 'repaired', detail: null },
			read: null
		};
		const failed: WebhookRepaired = {
			kind: 'reported',
			report: { outcome: 'failed', detail: 'Reload this page.' },
			read: null
		};
		const unanswered: WebhookRepaired = {
			kind: 'unanswered',
			report: null,
			read: { kind: 'no-session' }
		};
		expect(repairLanded(repaired)).toBe(true);
		expect(repairLanded(failed)).toBe(false);
		expect(repairLanded(unanswered)).toBe(false);
		expect(repairLanded(null)).toBe(false);
	});
});
