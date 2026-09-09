import { describe, expect, it } from 'vitest';
import { outcomeOf, outcomeOfConfirmation, UNCONFIRMABLE, UNSTATED_DECLINE } from './outcome';

describe('a confirmation that came back with an intent', () => {
	it('reads a succeeded intent as the gift being made', () => {
		expect(outcomeOf({ paymentIntent: { status: 'succeeded' } })).toEqual({ kind: 'succeeded' });
	});

	it('reads a processing intent as money in flight', () => {
		expect(outcomeOf({ paymentIntent: { status: 'processing' } })).toEqual({ kind: 'processing' });
	});

	// the ACH branch, and the one next action this flow has a screen for.
	it('reads a microdeposit verification as the wait it is', () => {
		const outcome = outcomeOf({
			paymentIntent: {
				status: 'requires_action',
				next_action: { type: 'verify_with_microdeposits' }
			}
		});

		expect(outcome).toEqual({ kind: 'awaiting_microdeposits' });
	});

	// Stripe states when the deposits arrive and never when the window shuts, so no deadline is
	// invented here — the machine derives one from `MICRODEPOSIT_WINDOW_MS`, which is what
	// `ConfirmOutcome`'s optional `expiresAt` is for.
	it('states no deadline it was not given', () => {
		const outcome = outcomeOf({
			paymentIntent: {
				status: 'requires_action',
				next_action: { type: 'verify_with_microdeposits' }
			}
		});

		expect(outcome).not.toHaveProperty('expiresAt');
	});

	it('reads any other pending action as the browser leaving for the bank', () => {
		const outcome = outcomeOf({
			paymentIntent: { status: 'requires_action', next_action: { type: 'redirect_to_url' } }
		});

		expect(outcome).toEqual({ kind: 'redirecting' });
	});

	// the only status this app reads as a refusal, and only with the rail's own error on it.
	it('reads a refused intent as a decline, in the rail’s words', () => {
		const outcome = outcomeOf({
			paymentIntent: {
				status: 'requires_payment_method',
				last_payment_error: { message: 'Your card was declined.' }
			}
		});

		expect(outcome).toEqual({ kind: 'declined', message: 'Your card was declined.' });
	});

	// the same status before anything was tried. nothing refused it, so nothing may say one did.
	it('refuses to call an untried intent a decline', () => {
		expect(outcomeOf({ paymentIntent: { status: 'requires_payment_method' } })).toEqual({
			kind: 'indeterminate'
		});
	});
});

describe('a confirmation that came back with an error', () => {
	it('reads a card error as the decline it is', () => {
		const outcome = outcomeOf({
			error: { type: 'card_error', message: 'Your card has insufficient funds.' }
		});

		expect(outcome).toEqual({
			kind: 'declined',
			message: 'Your card has insufficient funds.'
		});
	});

	/**
	 * the donor has not finished filling the provider's own fields, which is not an outcome of the
	 * gift at all.
	 *
	 * nothing was attempted and nothing refused: the provider's own validation stopped the
	 * confirmation before a rail was touched, and the form the donor is standing in front of is
	 * simply not finished. read as a decline it ends the flow on a screen saying the gift was not
	 * completed, over a form that was never submitted.
	 *
	 * it carries no sentence, and that absence is the point — the provider marks its own fields, and
	 * a second copy of "your card number is incomplete" is one the donor has to reconcile against the
	 * first.
	 */
	it('reads unfinished provider fields as a confirmation that never happened', () => {
		const outcome = outcomeOfConfirmation({
			error: { type: 'validation_error', message: 'Your card number is incomplete.' }
		});

		expect(outcome).toEqual({ kind: 'unfinished' });
	});

	// the whole reason `indeterminate` exists. the request left this browser and no answer came
	// back, so the intent may well have been confirmed — reported as a decline it would put a
	// Retry in front of someone whose card is already charged.
	it('reads a lost connection as an answer nobody has', () => {
		expect(outcomeOf({ error: { type: 'api_connection_error' } })).toEqual({
			kind: 'indeterminate'
		});
	});

	it('reads a fault on the provider’s own side the same way', () => {
		expect(outcomeOf({ error: { type: 'api_error' } })).toEqual({ kind: 'indeterminate' });
	});

	// an error may carry the intent it was about, and where it does that intent settles the
	// question the error type only guesses at. this is what keeps `indeterminate` rare.
	it('prefers the intent an error carries over the error’s own type', () => {
		const outcome = outcomeOf({
			error: {
				type: 'api_error',
				message: 'Something went wrong.',
				payment_intent: { status: 'succeeded' }
			}
		});

		expect(outcome).toEqual({ kind: 'succeeded' });
	});

	/**
	 * the shape the defect takes, and why the error type is read before the intent.
	 *
	 * a request the API refuses outright — an intent minted for one rail and a group confirming
	 * with another — never reaches a rail, and the intent it carries back is the intent exactly as
	 * it was minted: `requires_payment_method`, nothing attached, no `last_payment_error`. read as
	 * the intent's own answer that is an unanswered confirmation, which thanks a donor for a gift
	 * nobody charged and leaves the fault invisible.
	 */
	it('reads a refused request as a refusal, never as the untried intent it carries', () => {
		const outcome = outcomeOfConfirmation({
			error: {
				type: 'invalid_request_error',
				message:
					'The provided payment_method_types do not match the expected payment_method_types.',
				payment_intent: { status: 'requires_payment_method' }
			}
		});

		expect(outcome).toEqual({ kind: 'declined', message: UNCONFIRMABLE });
	});

	// an error type this app has never seen is not a refusal it can report as one.
	it('reads an unknown error type as an answer nobody has', () => {
		expect(outcomeOf({ error: { type: 'something_new' } })).toEqual({ kind: 'indeterminate' });
	});

	it('reads a decline with no sentence on it without inventing one', () => {
		const outcome = outcomeOf({ error: { type: 'card_error' } });

		expect(outcome).toEqual({ kind: 'declined', message: UNSTATED_DECLINE });
	});
});

/**
 * the certainty above belongs to a confirmation and to nothing else.
 *
 * a confirmation the provider refused never reached a rail, so nothing was charged. a *read* the
 * provider refuses — a resume landing with a token the URL mangled — says nothing whatever about a
 * charge that may already have settled, and answering it with "nothing was charged" would put a
 * Retry in front of a donor whose gift went through. this is the direction ../ports.ts spends
 * `indeterminate` on.
 */
describe('a read of an intent that came back with the same error', () => {
	it('stays an answer nobody has', () => {
		const outcome = outcomeOf({
			error: {
				type: 'invalid_request_error',
				message: 'No such payment_intent.'
			}
		});

		expect(outcome).toEqual({ kind: 'indeterminate' });
	});

	// the same split, from the other end: "the fields are not filled in" is a thing to say about a
	// form the donor is standing in front of, and a resume has none — the page it reads was loaded
	// on the way back from a bank. so a read is never told the gift is unfinished, which would put a
	// donor who has already paid back in front of a Donate button.
	it('never reads an unfinished form off an intent nobody is filling in', () => {
		const outcome = outcomeOf({
			error: { type: 'validation_error', message: 'Your card number is incomplete.' }
		});

		expect(outcome).toEqual({ kind: 'indeterminate' });
	});
});

describe('an answer that is not one at all', () => {
	it('reads an empty result as an answer nobody has', () => {
		expect(outcomeOf({})).toEqual({ kind: 'indeterminate' });
	});
});
