// what a test send did, named once for both ends of the wire.
//
// it is here for the reason ./org.ts is here: the deployment performs the act and answers with this
// value, the operator console draws it, and the two packages import nothing of each other's — so a
// shape written out on each side is an outcome one half stops sending and the other goes on drawing
// a state for.
//
// **the act itself is the deployment's and can be nowhere else.** a test send goes over the
// deployment's own mail transport with the deployment's own SMTP credentials, which no console
// holds and none may acquire. so what crosses this wire is a press, a destination and a report of
// what the transport said — never a message and never a credential.
//
// **the destination is the caller's, and naming one grants nothing.** whoever holds the console
// credential can deploy code to that worker, including code that sends whatever mail it likes, so
// an address in the press is a shortcut to something they already have rather than a capability.
// what it buys is the only reading worth taking: a mail host checked against an inbox somebody is
// watching, rather than only against the address every alert already lands in. the deployment
// still refuses an address it cannot read, which is input validation and not a gate — and that
// refusal is not one of the outcomes below, because nothing was sent to report on.
//
// nothing here states a rule about mail. what a send may fail on is decided in
// `packages/app/src/lib/server/email/provider.ts`, and its sentences arrive in `detail`.

/**
 * the outcomes, as a closed set the console switches on.
 *
 *   sent    — it left the deployment, addressed to what the press named.
 *   failed  — it did not deliver: settings that are missing or unusable, or a host that refused.
 *             unconfigured mail is one of these and no outcome beside it may say otherwise —
 *             sending nothing is not a setting, so there is no non-failing way to press this and
 *             send none.
 *
 * a `const` array with the union derived off it, the way `ORG_PROFILE_FIELDS` in ./org.ts is
 * written: the values are what a reader switches on and what a case names, and the array is what
 * makes "did the console answer for all of them" checkable.
 */
export const TEST_SEND_OUTCOMES = ['sent', 'failed'] as const;

export type TestSendOutcome = (typeof TEST_SEND_OUTCOMES)[number];

/** what a test send reports back, in one total shape whichever arm produced it. */
export interface TestSendReport {
	readonly outcome: TestSendOutcome;
	/**
	 * what went wrong, verbatim from the deployment.
	 *
	 * those sentences name the offending value and the command that sets it, and a console that
	 * paraphrased one into something friendlier would throw away the only actionable part. `null`
	 * on the one arm where nothing went wrong.
	 */
	readonly detail: string | null;
	/**
	 * the address the message was addressed to: what the press named, echoed back.
	 *
	 * on both arms, because a failure is worth reading beside where it was headed. never absent —
	 * a press with no address the deployment could read is refused before a send is attempted, so
	 * every report is a report about one destination.
	 */
	readonly to: string;
}
