import type { PaymentProvider, RecurringGiftStanding } from './provider';

// what `src/routes/console.recurring.ts` asks the payment port about repeating gifts on this
// deployment's own Stripe account, and the one thing it can ask for.
//
// a module rather than two calls in the route, for the reason the rest of that route is thin: the
// route turns a request into a call and a failure into a report, and nothing else. what lives here is
// the part with a decision in it — a read that could not be made becoming a state rather than an
// exception, and the two successes of a find-or-create being told apart — and it is here because it
// is testable as a value: the port is an argument, so ./recurring-provision.spec.ts covers every
// state with no network, no account and no platform to stand in for. the same arrangement
// ./webhook-registration.ts is written under.
//
// it imports no SDK and names no processor. ./provider.ts is the whole of what it knows, which is the
// rule ./sole-importer.spec.ts holds over the tree.
//
// nothing here writes anything down. what the account holds is read fresh on every view because it
// lives on somebody else's account: a copy in a row would be a claim about a third party's state that
// nothing in this deployment could ever be told had changed. and nothing here carries an id — what
// the account holds is found by an id this app derives, so there is nothing for a form to post back.

/**
 * where this deployment stands on repeating gifts, as a screen has to draw it.
 *
 *   unreadable — the port could not answer: no credentials, a rejected key, a processor that did not
 *                reply. `detail` is the port's own sentence, which names the value to fix. it is a
 *                state of this block and never of the page — every other capability goes on
 *                rendering.
 *   ready      — the account holds what a repeating gift is charged against. nothing to do.
 *   absent     — the account holds nothing. the fresh-fork state, and the one the setup button
 *                belongs to.
 *   archived   — the account holds it and it cannot be charged against. not a failure and not
 *                something this app repairs; `RecurringGiftStanding` in ./provider.ts states why it
 *                is neither replaced here nor folded into one of the other two.
 *
 * the three readings are the port's own union rather than a second copy of it, so a standing added
 * there arrives on the screen as a type error at the one place that draws it rather than as a member
 * silently missing from a second list.
 */
export type RecurringProvision =
	| { readonly state: 'unreadable'; readonly detail: string }
	| { readonly state: RecurringGiftStanding };

/**
 * what the processor's account currently holds for repeating gifts.
 *
 * never throws and never rejects: every arm of the port answers with a value, and this turns the
 * failing one into a state rather than passing it up. that is what keeps a processor nobody can reach
 * from taking the screen down — the screen it takes down is the screen an operator opened to
 * find out why.
 *
 * it asks the read arm and never the find-or-create one, and that is the whole reason the port has
 * two: `prepareRecurringGifts` makes what the account is missing, so a page drawn from it would
 * provision an operator's account as a side effect of them looking at it.
 */
export async function readRecurringProvision(
	provider: PaymentProvider
): Promise<RecurringProvision> {
	const standing = await provider.readRecurringGiftProvision();
	if (!standing.ok) return { state: 'unreadable', detail: standing.detail };
	return { state: standing.value };
}

/** what pressing the setup button did, as a closed set the page switches on. */
export type RecurringSetupOutcome = 'set_up' | 'already_set_up' | 'failed';

/** what the setup button reports back, in one total shape whichever arm produced it. */
export type RecurringSetup = {
	readonly outcome: RecurringSetupOutcome;
	/**
	 * what went wrong, verbatim from the port. those sentences name the offending value and the
	 * command that fixes it, which is what CLAUDE.md asks of anything that lands in a 4xx body, and a
	 * friendlier paraphrase would throw away the only actionable part. `null` on both arms that
	 * worked.
	 */
	readonly detail: string | null;
};

/**
 * puts what a repeating gift is charged against on this deployment's own account, and says which of
 * the two successes it was.
 *
 * safe to press twice, which the port guarantees rather than this function: the call is
 * find-or-create against an id this app derives, so a second press resolves to the object that
 * already exists. `already_set_up` is that press — the same finished state as the first, said
 * differently because an operator who pressed a button is owed the difference between having done
 * something and having done nothing.
 *
 * an archived one is a failure here rather than a third success, and the sentence says so: the port
 * refuses to replace it, because every gift already repeating is charged against that one.
 */
export async function setUpRecurringGifts(provider: PaymentProvider): Promise<RecurringSetup> {
	const provisioned = await provider.prepareRecurringGifts();
	if (!provisioned.ok) return { outcome: 'failed', detail: provisioned.detail };

	return {
		outcome: provisioned.value.created ? 'set_up' : 'already_set_up',
		detail: null
	};
}
