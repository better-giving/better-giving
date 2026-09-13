import type { RecurringSetupReason } from '@better-giving/operator/console/recurring';
import type { Processors } from './factory';
import type { PaymentProvider, ProcessorName, RecurringGiftStanding } from './provider';

// what this app asks the payment port about repeating gifts on a processor's own account, and the
// one thing it can ask for. two callers: ../forms/offered-cadences.ts, which reads every configured
// processor at once, and the console's own block, whose press reads them all or the one account it
// was named about.
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

/**
 * how loud each outcome is, so one press over several accounts can answer in one word.
 *
 * `set_up` above `already_set_up` rather than beside it: both are the same finished state, and an
 * operator who pressed a button and moved an account is owed the difference from one who moved
 * nothing. `failed` above both, because a deployment offers a repeating gift only where every
 * configured processor can collect one — so one account left short is the whole press left short.
 */
const OUTCOME_RANK: Readonly<Record<RecurringSetupOutcome, number>> = Object.freeze({
	already_set_up: 0,
	set_up: 1,
	failed: 2
});

/**
 * one account's report, with the fact a machine reads beside the sentence a person does.
 *
 * the reason is decided here rather than by {@link setUpRecurringGifts}, because it is not a fact
 * about the call: it is whether this deployment holds the credentials that call is made with, which
 * is `Processors.configured` in ./factory.ts and is read nowhere else. the same fact and the same
 * source as `stripeUnreadableReason` there, which the wallet-hostname press carries for the same
 * reason — a caller reading which case it is in off the port's own sentence is a caller matching a
 * fragment that names one processor's variable and can never match another's.
 */
export type RecurringAccountSetup = RecurringSetup & {
	readonly reason: RecurringSetupReason | null;
};

/**
 * what one press did, per account it acted on, and the one word the whole of it answers in.
 *
 * a press that acted on no account carries no report at all rather than an empty one: every line a
 * screen draws from this is an account, so a run over none is a finished-looking answer about
 * nothing — and a caller that cannot reach `setups` without narrowing is a caller that cannot
 * publish one.
 */
export type RecurringSetupRun =
	| { readonly acted: false }
	| {
			readonly acted: true;
			/** the worst of the reports below, which is what a screen puts one word on. */
			readonly outcome: RecurringSetupOutcome;
			/**
			 * one report per processor the press acted on, under the name of the account it acted on.
			 *
			 * partial over `ProcessorName` for the reason {@link RecurringProvisions} is: a report for a
			 * processor nobody named would be a claim about an account this press never asked.
			 */
			readonly setups: Readonly<Partial<Record<ProcessorName, RecurringAccountSetup>>>;
	  };

/**
 * puts what a repeating gift is charged against on the named processor's account, or on every
 * configured one where none is named.
 *
 * one press over all of them and not one control per processor, because there is no state between
 * them worth offering an operator: a donor is offered a repeating gift only where every configured
 * processor can collect one (../forms/offered-cadences.ts), so an account set up on its own moves
 * nothing a donor can see.
 *
 * **what names one is a caller pressing seconds after it stored that processor's credentials.**
 * `configured` is read off the values this deployment is serving, and a credential stored moments
 * ago is not among them yet — so a press naming none would act on every account but the one it was
 * made for, find nothing left to do on those, and report a run that never asked about the account
 * it was about. named, that account is asked whatever `configured` says, and the port's own refusal
 * is the answer that says to press again.
 *
 * **and the account it was named about is the whole of what the word over the run is taken across**,
 * so an account that refuses or holds an archived item cannot end a run about a different one.
 *
 * **a press naming nothing on a deployment holding no credentials acts on nothing.** every account
 * it could reach is an account nobody named, and what such a press would answer is a refusal per
 * processor about values nobody has begun setting.
 *
 * issued together rather than one after another, and never throws, for the reasons
 * {@link readRecurringProvisions} does neither.
 */
export async function setUpRecurringGiftsOn(
	processors: Processors,
	named: ProcessorName | null
): Promise<RecurringSetupRun> {
	const asked = named === null ? processors.configured : [named];
	if (asked.length === 0) return { acted: false };

	const configured = new Set(processors.configured);
	const setups = await Promise.all(
		asked.map(async (name) => {
			const setup = await setUpRecurringGifts(processors.for(name));
			const reason: RecurringSetupReason | null =
				setup.outcome !== 'failed' ? null : configured.has(name) ? 'failed' : 'no_key';
			return [name, { ...setup, reason }] as const;
		})
	);

	let outcome: RecurringSetupOutcome = 'already_set_up';
	for (const [, setup] of setups) {
		if (OUTCOME_RANK[setup.outcome] > OUTCOME_RANK[outcome]) outcome = setup.outcome;
	}

	return { acted: true, outcome, setups: Object.fromEntries(setups) };
}

/**
 * where every configured processor stands on repeating gifts, one reading each.
 *
 * never collapsed into one, for the reason `RailChargeabilities` in ./rail-chargeability.ts is not:
 * each reading carries its own sentence naming its own value to fix, and one processor nobody could
 * reach must not be reported as an answer about another.
 *
 * partial over `ProcessorName` because only the configured processors are asked — an entry for a
 * processor this deployment cannot charge on would be a reading of an account nobody named.
 */
export type RecurringProvisions = Readonly<Partial<Record<ProcessorName, RecurringProvision>>>;

/**
 * every configured processor's standing, read together.
 *
 * issued together rather than one after another: no reading needs another's answer, and a caller
 * waiting on this is a donor's browser booting a form or an operator holding a screen open.
 *
 * never throws and never rejects, for the reason the single read above does not.
 */
export async function readRecurringProvisions(
	processors: Processors
): Promise<RecurringProvisions> {
	const readings = await Promise.all(
		processors.configured.map(
			async (name) => [name, await readRecurringProvision(processors.for(name))] as const
		)
	);
	return Object.fromEntries(readings);
}
