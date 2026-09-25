import { describe, expect, it } from 'vitest';
import type { WebhookSecretReading, WebhookSubscriptionReading } from '../api/types';
import type { WebhookRepaired } from './notices-standing';
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
		).toEqual({ kind: 'incomplete', delivering: false, short: false });
		expect(
			noticesStanding(secret('verifying'), {
				state: 'incomplete',
				delivering: true,
				missingEventTypes: ['charge.refunded']
			})
		).toEqual({ kind: 'incomplete', delivering: true, short: true });
	});

	/** the Save that remakes the secret remakes the subscription with it, so it is said first. */
	it('reads a secret that does not verify ahead of an endpoint short of an event', () => {
		const short: WebhookSubscriptionReading = {
			state: 'incomplete',
			delivering: false,
			missingEventTypes: ['charge.refunded']
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
			noticesNote({ kind: 'incomplete', delivering: false, short: false }),
			noticesNote({ kind: 'incomplete', delivering: true, short: true }),
			noticesNote({ kind: 'incomplete', delivering: false, short: true })
		];
		for (const note of notes) expect(note).not.toMatch(/webhook|endpoint|event|secret/i);
		expect(new Set(notes).size).toBe(notes.length);
	});

	it('sends the two standings the repair cannot reach to the Save', () => {
		expect(noticesNote({ kind: 'unregistered' })).toContain('Press Save');
		expect(noticesNote({ kind: 'unverified' })).toContain('Press Save');
		expect(noticesNote({ kind: 'incomplete', delivering: false, short: false })).not.toContain(
			'Save'
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
