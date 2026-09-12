import type { Db } from '../db/client';
import type { Processors } from '../payments/factory';
import { isProcessor, isRetryable, type ProcessorName } from '../payments/provider';
import { readRecurringPlan, stopRecurringPlan } from './queries';

// stopping a repeating gift: the processor's cancel and this deployment's own record of it, in the
// order that decides which failure an operator can see.
//
// a module rather than the body of a form action, for the reason ../payments/recurring-provision.ts
// is one: the route turns a request into a call and an outcome into a screen, and what lives here
// is the part with decisions in it — which failures are told apart, in what order the two writes
// happen, and which non-write is a success. it is here because it is testable as a value, the port
// being an argument: ./stop.workers.spec.ts covers every arm against a real D1 with no platform to
// stand in for.
//
// no copy is in this file. every sentence an operator reads is written in the route that draws it,
// which is where the dashboard's copy lives and where it stays reviewable in one place.

/**
 * what stopping a gift turned out to be, in the five readings a screen has to tell apart plus the
 * one that is not a state of this deployment at all.
 *
 *   gone            no commitment has that id. a 404, not a failure to report on a page.
 *   already-stopped it is already stopped. a double press or a stale tab, and refusing it is what
 *                   keeps `ended_at` from being overwritten.
 *   refused         the processor said no and nothing was written. `retryable` is `isRetryable`'s
 *                   answer about the reason, which decides whether the screen may say "try again";
 *                   `detail` is the port's own sentence, which names the value to fix; `processor`
 *                   is which one said no, and `null` on the one refusal no processor issued — a
 *                   commitment recorded against a provider no adapter answers for.
 *   nothing-to-stop the processor holds no such subscription, so there was nothing to cancel — and
 *                   the row is stopped all the same. an outcome of its own rather than `stopped`
 *                   because the screen has something different to say: nothing was collecting
 *                   before this act either.
 *   unrecorded      the processor stopped it and the row write did not land. money has stopped and
 *                   this deployment may still show the gift as collecting — the one outcome where
 *                   the two halves disagree, and the reason it has a name of its own. `processor`
 *                   is never null here: one answered, which is what this arm is about.
 *   stopped         it is stopped and the row says so.
 *
 * a union rather than a boolean and a message, so a screen cannot draw a sentence for an outcome it
 * did not get: each arm carries exactly what its own sentence needs and nothing else.
 *
 * the two arms whose sentences send an operator to a dashboard carry the processor whose dashboard
 * it is. it is the row's own column and never a name the route supplied — a deployment may hold
 * keys for both, and a sentence naming the wrong one is an errand with nowhere to arrive. the name
 * and not the word: the spelling an operator reads is `PROCESSOR_LABELS` in ../payments/provider.ts,
 * and no copy is written in this file.
 */
export type StopOutcome =
	| { readonly outcome: 'gone' }
	| { readonly outcome: 'already-stopped' }
	| {
			readonly outcome: 'refused';
			readonly retryable: boolean;
			readonly detail: string;
			readonly processor: ProcessorName | null;
	  }
	| { readonly outcome: 'nothing-to-stop' }
	| { readonly outcome: 'unrecorded'; readonly processor: ProcessorName }
	| { readonly outcome: 'stopped' };

/**
 * stops a commitment at the processor and records that it stopped.
 *
 * the order is the specification and not an implementation detail, because it is what decides which
 * failure an operator can be shown:
 *
 *   1. read the row. it is where the subscription id lives, so there is nothing to call without it.
 *   2. refuse one that is already stopped, before any call. a second press must not reach the
 *      processor at all — see `already-stopped` above.
 *   3. cancel at the processor. a refusal here writes nothing: a row marked stopped over a
 *      subscription that is still collecting is the dashboard saying a donor was let go while their
 *      card goes on being charged, which is the one disagreement no later read repairs. the one
 *      refusal that does not stop the write is `not_found` — see step 4.
 *   4. record it. the date is the processor's own `endedAt` rather than this deployment's clock —
 *      when collection stopped is the rail's fact — and `stopRecurringPlan` keeps an existing one,
 *      which is what preserves the moment a lapsed commitment really ended. the row is written
 *      where the processor holds no such subscription too, which is what makes a gift cancelled in
 *      the processor's own dashboard first correctable from this dashboard at all.
 *
 * step 4 writing no row is a **success**. the inbound `customer.subscription.deleted` for the
 * cancel just made can reach the row first — `recordStanding` in ../donations/collect.ts writes
 * exactly this transition, guarded on `status = 'active'` — so the conditional update matches
 * nothing and the commitment is nonetheless stopped, dated and recorded. reporting a failure there
 * would be a failure rendered over a completed act. what the two cases share is the only thing a
 * screen needs to say: nothing further is collected.
 *
 * it never throws. the write is the one thing here that can, and it becomes `unrecorded` rather
 * than an exception, because the caller has something true and specific to say about that state and
 * a 500 says none of it.
 */
export async function stopRecurringGift(
	db: Db,
	processors: Processors,
	id: string
): Promise<StopOutcome> {
	const plan = await readRecurringPlan(db, id);
	if (plan === null) return { outcome: 'gone' };
	if (plan.status === 'cancelled') return { outcome: 'already-stopped' };

	// the processor the row was written under and never one a caller picked: the commitment lives on
	// whichever account collected its first charge, and the route cannot know which that was until
	// the row is read.
	//
	// the narrowing is the column's and not a state a row can be in: `recurring_plan.provider` is
	// typed over `PAYMENT_PROVIDERS` (../db/schema.ts), which keeps `manual` for a staff entry, and
	// ../donations/collect.ts is the only module that may insert one of these rows — it writes the
	// processor that settled. so the refusal below names the column rather than a value to fix.
	if (!isProcessor(plan.provider)) {
		return {
			outcome: 'refused',
			retryable: false,
			detail: `This gift is recorded against \`${plan.provider}\`, which no payment processor answers for, so there is nothing to cancel.`,
			// no processor issued this refusal and none has a dashboard to be sent to, so the screen
			// is given nothing to name. the detail above is the whole sentence on this arm.
			processor: null
		};
	}

	const cancelled = await processors
		.for(plan.provider)
		.cancelRecurringGift(plan.providerSubscriptionId);

	// the one refusal that is not a reason to leave the row alone. `not_found` means the processor
	// holds no such subscription, so nothing is collecting under it and the row is the half that is
	// out of date — which is the ordinary shape of an operator who cancelled in the processor's own
	// dashboard first and then came here. reported as a refusal, this dashboard had no way at all to
	// correct that row, and it stayed active or lapsed for good.
	//
	// the risk taken deliberately: if this deployment's keys for that processor name a different
	// account from the one holding the subscription, every subscription reads as missing and this
	// writes a stopped row over a gift still collecting elsewhere. that account cannot be charged
	// from here either — every collection this deployment makes is already failing — so the row is
	// wrong on a deployment that is already wrong, rather than on a working one.
	const absent = !cancelled.ok && cancelled.reason === 'not_found';

	if (!cancelled.ok && !absent) {
		return {
			outcome: 'refused',
			retryable: isRetryable(cancelled.reason),
			detail: cancelled.detail,
			processor: plan.provider
		};
	}

	try {
		// the processor's own date where it answered with one, and this deployment's clock where
		// there is no subscription to have answered. `stopRecurringPlan` writes `ended_at` only
		// where there is none, so a lapsed gift's own date survives either way.
		await stopRecurringPlan(db, id, cancelled.ok ? cancelled.value.endedAt : new Date());
	} catch (e) {
		// logged here rather than at the route, because this is the only frame that knows nothing is
		// being collected at the processor — which is what makes this line worth reading against
		// that processor's own dashboard afterwards.
		console.error('recording a stopped repeating gift failed:', e);
		// one arm for both paths above, because what a screen has to say about them is the same: no
		// money is moving and this deployment may still show the gift as collecting.
		return { outcome: 'unrecorded', processor: plan.provider };
	}

	// deliberately not `stopped.length > 0`: see the paragraph above about the webhook arriving
	// first. both readings are one outcome.
	return absent ? { outcome: 'nothing-to-stop' } : { outcome: 'stopped' };
}
