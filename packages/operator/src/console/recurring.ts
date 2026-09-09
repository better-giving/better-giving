import type { StripeUnreadableReason } from './stripe-read.js';

// where a deployment stands on gifts that repeat, and what one press about it did — named once for
// both ends of the wire.
//
// it is here for the reason ./org.ts is here: the deployment reads and writes this against its own
// processor account and answers with these values, the operator console draws them, and the two
// packages import nothing of each other's.
//
// **the read and the press are the deployment's and can be nowhere else.** both go through the
// deployment's own payment port with the key the deployment holds, which no console has and none
// may acquire. that is the whole asymmetry with setting Stripe up in the first place: that press
// calls the processor with a key an operator has just pasted, because there is nothing on the
// deployment yet to ask; this one asks the deployment, because by now there is.
//
// **it is a block and never a member of the report.** a deployment that only ever wants one-time
// gifts is not incomplete, so a line on the run an operator works down until it is clear would be a
// permanent unfinished item on every fork that never offers a monthly gift. nothing here belongs in
// ./report.ts's envelope, and the report does not carry it.
//
// nothing here states a rule about the processor. what the account may hold is decided in
// `packages/app/src/lib/server/payments/provider.ts`, and its sentences arrive in `detail`.

/**
 * what the account holds, as a closed set the console draws.
 *
 *   ready    — the account holds what a repeating gift is charged against. nothing to do.
 *   absent   — the account holds nothing. the fresh-fork state, and the one the press belongs to.
 *   archived — the account holds it and it cannot be charged against. not a failure and not
 *              something this product repairs: every gift already repeating is charged against that
 *              one, so it is unarchived where it was archived.
 */
export const RECURRING_STANDINGS = ['ready', 'absent', 'archived'] as const;

export type RecurringStanding = (typeof RECURRING_STANDINGS)[number];

/**
 * what the deployment answered a read with.
 *
 * `unreadable` is the read that could not be made — no credentials, a rejected key, a processor
 * that did not reply — carried as a state rather than as a failure of the request, because it says
 * nothing about what the account holds. `detail` is the deployment's own sentence, which names the
 * value to fix.
 *
 * `reason` says which of those it was, in the closed set ./stripe-read.ts states, and it is the
 * same union ./payments.ts's rails carry: both reads go through one port with one key, so a
 * deployment holding no key makes neither of them and a console has one thing to say about that
 * rather than one per reading. `detail` is the sentence and `reason` is the fact — a console
 * deciding between them off the prose would be a screen that changes what it draws when somebody
 * edits a string.
 */
export type RecurringReading =
	| {
			readonly state: 'unreadable';
			readonly reason: StripeUnreadableReason;
			readonly detail: string;
	  }
	| { readonly state: RecurringStanding };

/**
 * what pressing the setup did, as a closed set the console switches on.
 *
 * the two successes are the same finished state said differently, and both are worth saying: the
 * call is find-or-create, so a second press resolves to what is already there — and an operator who
 * pressed a button is owed the difference between having done something and having done nothing.
 */
export const RECURRING_SETUP_OUTCOMES = ['set_up', 'already_set_up', 'failed'] as const;

export type RecurringSetupOutcome = (typeof RECURRING_SETUP_OUTCOMES)[number];

/** what one press reports back, in one total shape whichever arm produced it. */
export interface RecurringSetupReport {
	readonly outcome: RecurringSetupOutcome;
	/**
	 * what went wrong, verbatim from the deployment's payment port. `null` on both arms that worked.
	 *
	 * an account holding an archived one lands here rather than on a third success: the port refuses
	 * to replace it, and the sentence says so.
	 */
	readonly detail: string | null;
}
