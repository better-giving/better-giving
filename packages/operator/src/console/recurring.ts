import type { PaymentProcessor } from './payments.js';

// where a deployment stands on gifts that repeat, and what one press about it did — named once for
// both ends of the wire.
//
// it is here for the reason ./org.ts is here: the deployment reads and writes this against its own
// processor accounts and answers with these values, the operator console draws them, and the two
// packages import nothing of each other's.
//
// **the read and the press are the deployment's and can be nowhere else.** both go through the
// deployment's own payment port with the keys the deployment holds, which no console has and none
// may acquire. that is the whole asymmetry with setting a processor up in the first place: that
// press calls the processor with a key an operator has just pasted, because there is nothing on the
// deployment yet to ask; this one asks the deployment, because by now there is.
//
// **a standing per processor the deployment holds a key for, and nothing at all for one it does
// not.** the same shape ./payments.ts answers in and for the same reason: a reading of an account
// nobody named is a row a console colours in, over boxes an operator has never filled. so a
// deployment set up on one processor reads as one standing, and one set up on both reads as two
// that can disagree.
//
// **one press over every one of them, and never one control per processor.** a donor is offered a
// gift that repeats only where every configured processor can collect one, so an account set up on
// its own moves nothing a donor can see — and a control offering that choice would be offering a
// state that helps nobody. what the press answers with is one report per account it acted on and
// one word over the whole, which is the worst of them.
//
// **the press may still name one processor, and the operator's never does.** what names one is a
// caller that has just stored a processor's credentials and is pressing seconds later: which
// accounts the deployment counts as configured is read from the values it is serving, and a
// credential stored moments ago is not among them yet — so a press naming none would act on every
// account but the one it was made for and report the run finished having never asked about it. the
// deployment refuses a press that names an account it holds no credentials for, which is the answer
// that says to wait and press again.
//
// **it is a block and never a member of the report.** a deployment that only ever wants one-time
// gifts is not incomplete, so a line on the run an operator works down until it is clear would be a
// permanent unfinished item on every fork that never offers a monthly gift. nothing here belongs in
// ./report.ts's envelope, and the report does not carry it.
//
// nothing here states a rule about the processor. what an account may hold is decided in
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
 * what the deployment answered a read of one account with.
 *
 * `unreadable` is the read that could not be made — a rejected key, a processor that did not reply
 * — carried as a state rather than as a failure of the request, because it says nothing about what
 * the account holds. `detail` is the deployment's own sentence, which names the value to fix.
 *
 * it carries no reason beside `detail`, the way ./payments.ts's rails reading does not: a reading
 * exists here only under a processor the deployment holds a key for, so the one thing a reason
 * could say — that nothing was asked because no credential is set — is a processor that is absent
 * from the report altogether.
 */
export type RecurringReading =
	| { readonly state: 'unreadable'; readonly detail: string }
	| { readonly state: RecurringStanding };

/** where one processor's account stands, under the name the console draws it by. */
export interface ProcessorRecurring {
	readonly processor: PaymentProcessor;
	/** what an operator is shown that processor as, decided on the deployment and travelling. */
	readonly label: string;
	readonly reading: RecurringReading;
}

/**
 * where every account this deployment can reach stands on gifts that repeat.
 *
 * one entry per processor the deployment holds the credentials for, in the deployment's own order
 * and never sorted by a consumer, so the lines always stand in one order. empty is a real
 * deployment and not an edge: a fresh fork holds no processor credential at all.
 */
export interface RecurringReport {
	readonly processors: readonly ProcessorRecurring[];
}

/**
 * what pressing the setup did, as a closed set the console switches on.
 *
 * the two successes are the same finished state said differently, and both are worth saying: the
 * call is find-or-create, so a second press resolves to what is already there — and an operator who
 * pressed a button is owed the difference between having done something and having done nothing.
 */
export const RECURRING_SETUP_OUTCOMES = ['set_up', 'already_set_up', 'failed'] as const;

export type RecurringSetupOutcome = (typeof RECURRING_SETUP_OUTCOMES)[number];

/**
 * why one account's press did not land, as a closed set the console switches on.
 *
 *   no_key — the deployment holds none of the credentials that processor is called with, so nothing
 *            was asked of the account at all. it is the answer to a press naming a processor whose
 *            credentials were stored seconds ago: the values this deployment is serving do not hold
 *            them yet, and the press is worth making again in a moment.
 *   failed — the deployment holds them and the press still did not land: the processor refused the
 *            call, did not answer, or holds an archived item it will not replace. pressing again
 *            answers the same way, and `detail` is what says what to do instead.
 *
 * **it exists so that a console never reads the sentence to find out which case it is in.** the
 * sentence beside it is prose written for an operator and is free to change wording; a console
 * matching on a fragment of it is a screen that silently changes what it draws the next time
 * somebody edits a string — and a fragment naming one processor's variable can never match
 * another's. the same fact and the same argument as `StripeUnreadableReason` in ./stripe-read.ts,
 * which is the one other answer on this surface that carries a reason.
 *
 * two members and not a boolean: what a caller does about them is opposite — wait and press again,
 * or stop and report the sentence — and a flag named for either half reads as the wrong one from
 * the other end.
 *
 * `null` on both arms that worked, where there is nothing that did not land.
 */
export const RECURRING_SETUP_REASONS = ['no_key', 'failed'] as const;

export type RecurringSetupReason = (typeof RECURRING_SETUP_REASONS)[number];

/** what the one press did to one account. */
export interface ProcessorRecurringSetup {
	readonly processor: PaymentProcessor;
	readonly label: string;
	readonly outcome: RecurringSetupOutcome;
	/**
	 * what went wrong, verbatim from the deployment's payment port. `null` on both arms that worked.
	 *
	 * an account holding an archived one lands here rather than on a third success: the port refuses
	 * to replace it, and the sentence says so.
	 */
	readonly detail: string | null;
	/**
	 * the same failure as a fact rather than a sentence, and `null` on both arms that worked.
	 *
	 * decided off what the deployment holds rather than off the words the port wrote — see
	 * {@link RECURRING_SETUP_REASONS}.
	 */
	readonly reason: RecurringSetupReason | null;
}

/**
 * what one press reports back, in one total shape whichever arm produced it.
 *
 * `outcome` is the worst of the accounts below, and the accounts below are the ones the press was
 * about: a deployment offers a repeating gift only where every configured processor can collect
 * one, so one account left short is the whole press left short, and a word taken off the best of
 * them would report a deployment as ready that is not. a press naming one processor is about that
 * account alone, so no other account's refusal is ever in that word.
 *
 * `processors` is never empty. a press that would act on no account at all — one naming nothing on
 * a deployment holding no processor credentials — is refused by the deployment rather than reported,
 * because every line of this report is an account and a report of none is a finished-looking answer
 * about nothing.
 */
export interface RecurringSetupReport {
	readonly outcome: RecurringSetupOutcome;
	readonly processors: readonly ProcessorRecurringSetup[];
}
