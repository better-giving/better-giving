import type { RailEvidence } from '@better-giving/operator/console/payments';
import type { ProcessorName } from './provider';

// what a processor will tell a deployment about its own rails — an approval per rail, or only that
// the credentials authenticate.
//
// it exists because `approved` in ./rail-chargeability.ts's vocabulary means two different things
// depending on who answered, and nothing else in this app can tell them apart. a deployment derives
// `approved` from what the adapter reported; one adapter reports what the account is actually
// approved for, and another reports every rail active because its processor publishes no such read
// to a merchant holding only its own credentials — the argument is at `readAccountChargeability` in
// ./paypal.ts, where the assertion is made. read off the answer alone the two are identical, so a
// console draws a green row over an account that may never have enabled the rail beside it.
//
// a table here rather than a field on the port's answer, and the two readers are why: the sentence
// an operator is shown (../forms/rail-notes.ts) and the fact the console switches on
// (`src/routes/console.payments.ts`) have to be the same call. a caller deciding either by naming a
// processor would be the copy that stops matching the day an adapter starts reading approvals.
//
// nothing here says whether a rail can be charged. that is ./rail-chargeability.ts's, and this only
// says what its answer is worth.

/**
 * what this release's adapter for one processor can actually find out about its rails.
 *
 * total over `ProcessorName`, so a third processor is a compile error rather than one whose
 * standings are drawn as approvals nobody read.
 *
 * `credentials_only` is the safe member to be wrong in only one direction: a processor that starts
 * publishing approvals and is left on it has a console under-claiming, where the other way round is
 * a console telling an operator a way of paying is on when nothing said so.
 */
const EVIDENCE: Readonly<Record<ProcessorName, RailEvidence>> = Object.freeze({
	stripe: 'per_rail_approval',
	paypal: 'credentials_only'
});

/** what a rails reading made against this processor's account is worth. */
export function railEvidence(processor: ProcessorName): RailEvidence {
	return EVIDENCE[processor];
}
