import { FREQUENCIES, type Frequency } from '@better-giving/form/v1';
import type { PaymentProvider, RecurringGiftStanding } from '../payments/provider';
import { readRecurringProvision, type RecurringProvision } from '../payments/recurring-provision';

// how often a gift may repeat on this deployment, which is a fact about the processor's account
// and about no form.
//
// no column holds it and no screen sets it. what decides it is whether this deployment's own Stripe
// account holds a usable product for repeating gifts — the Set up recurring gifts button on
// the console is the one control there is — so every form this deployment serves offers the
// same cadences, read from the same place. the same move ../../forms/offered-rails.ts made for the
// rails, and its header is the reasoning this extends.
//
// it lives under `$lib/server/**` rather than beside that file because the answer comes off the
// payment port, which is server-only. what a screen states is carried to it as a prop by whichever
// `load` drew it, exactly as `railNotes` is — so no component reads the processor.
//
// nothing here writes anything down. what the account holds lives on somebody else's account, so a
// copy in a row would be a claim about a third party's state that nothing in this deployment could
// ever be told had changed. ./cadence-cache.ts is the one place an answer is kept at all, and it is
// kept at the edge with a TTL rather than in the database — its header states why that is not the
// balance CLAUDE.md bans caching.

/**
 * the cadences a deployment offers when a repeating gift cannot be collected.
 *
 * a gift that happens once needs nothing on the account, so it is what is left over from every
 * standing that is not ready — and it is never the empty list. `readFormConfig` in
 * packages/form/src/config.ts drops a config offering nothing at all, which is a donation form that
 * renders nothing on a site nobody here can see.
 */
const ONE_TIME_ONLY: readonly Frequency[] = Object.freeze(['one_time']);

/**
 * what each standing offers a donor, total over the port's own union.
 *
 * total, so a standing added to `RecurringGiftStanding` in ../payments/provider.ts is a compile
 * error here rather than a member that silently falls through to whichever answer an `if` chain
 * ended on.
 *
 * `ready` offers `FREQUENCIES` whole rather than a triple written out here. that list is the wire
 * contract and may gain a member (CLAUDE.md), and a cadence added to it is already a compile error
 * at the adapter's own mapping table — `RecurringInterval` in ../payments/provider.ts is derived
 * from it by subtraction — so nothing can reach this list that no adapter can charge.
 *
 * `archived` answers what `absent` does, and the two standings stay apart for the reason that file
 * gives: an account holding an archived product is not one holding none, and only one of them has a
 * setup button to draw. what a donor may pick turns on neither — it turns on whether a repeating
 * gift can be collected, which is false on both.
 */
const STANDING_CADENCES: Readonly<Record<RecurringGiftStanding, readonly Frequency[]>> =
	Object.freeze({
		ready: FREQUENCIES,
		absent: ONE_TIME_ONLY,
		archived: ONE_TIME_ONLY
	});

/**
 * how often a gift may repeat here, given what the account answered.
 *
 * a read that could not be made offers one-time alone, and that is the whole direction this exists
 * to hold: a cadence offered and not chargeable is a donor picking Monthly and meeting a failure at
 * the last step, on a page nobody here can see, while a cadence chargeable and not offered costs
 * them nothing they can tell. so a processor nobody could reach narrows the form rather than
 * widening it.
 */
export function offeredCadences(provision: RecurringProvision): readonly Frequency[] {
	if (provision.state === 'unreadable') return ONE_TIME_ONLY;
	return STANDING_CADENCES[provision.state];
}

/**
 * how often a gift may repeat here, read fresh from the processor.
 *
 * never throws and never rejects: `readRecurringProvision` turns every failing arm of the port into
 * a state, and the mapping above answers each of them.
 *
 * it goes through the read arm and never `prepareRecurringGifts`, which is find-or-create: this
 * runs on a `load` and on the config every embedded form boots against, so the write arm here would
 * put a product on an operator's Stripe account as a side effect of a donor opening somebody else's
 * website. the button on the console is where that write belongs.
 */
export async function readOfferedCadences(
	provider: PaymentProvider
): Promise<readonly Frequency[]> {
	return offeredCadences(await readRecurringProvision(provider));
}
