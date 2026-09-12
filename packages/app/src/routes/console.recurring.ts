import type {
	RecurringReading,
	RecurringSetupReport
} from '@better-giving/operator/console/recurring';
import { consoleJson } from '$lib/server/console/surface';
import { createPaymentProviders, stripeUnreadableReason } from '$lib/server/payments/factory';
import {
	readRecurringProvision,
	setUpRecurringGifts
} from '$lib/server/payments/recurring-provision';
import { platform } from '../context';
import type { Route } from './+types/console.recurring';

// where this deployment stands on gifts that repeat, and the one press that puts it there.
//
// on the same surface and behind the same check as the report: the check is the `middleware` on
// ./console.ts and this file makes no decision about who may read or press — see the header there,
// and $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment holds the key.** the read and
// the press both go through the payment port with this deployment's own `STRIPE_SECRET_KEY`, which
// is deploy-time and lives under `$lib/server/**` (CLAUDE.md). that is the asymmetry with setting
// Stripe up in the first place: that press calls the processor with a key an operator has just
// pasted, because there is nothing on the deployment yet to ask; by the time this one is pressed
// there is.
//
// **it names Stripe because Stripe is the only processor this release charges a repeating gift on.**
// a repeating gift is a catalog product, a billing plan and a subscription on PayPal's side and this
// release builds none of the three, so the PayPal adapter refuses every recurring arm as
// `unsupported` ($lib/server/payments/paypal.ts) and a reading of it would be that refusal wearing
// this block's vocabulary. this file grows a processor the day an adapter takes one.
//
// **the read is the port's read arm and never the find-or-create one.** `prepareRecurringGifts`
// makes what the account is missing, so a screen drawn from it would provision an operator's Stripe
// account as a side effect of them opening a page. the two are told apart in
// $lib/server/payments/recurring-provision.ts and neither decision is restated here.
//
// **this is a block and never a member of the report.** a deployment that only ever wants one-time
// gifts is not incomplete, so it answers on its own address and must not join the envelope — the
// folds on the console are the run an operator works down until it is clear, and one for this would
// be a permanent unfinished item on every fork that never offers a monthly gift.
//
// **the read is a GET and the press is a POST, on one address.** the surface's other two writes
// answer a GET with a 405 because their read is the report; this one has a read of its own, and it
// is the same question the press is about. it takes no body either way: what the account holds is
// found by an id this app derives, so there is nothing for a caller to name.
//
// nothing is written down here. what the account holds is read fresh every time, because it lives on
// somebody else's account and a copy in a row would be a claim about a third party's state that
// nothing in this deployment could ever be told had changed.

export async function action({ context }: Route.ActionArgs): Promise<Response> {
	const setup = await setUpRecurringGifts(
		createPaymentProviders(context.get(platform).env).for('stripe')
	);
	const report: RecurringSetupReport = setup;

	// a hole in the deployment and a refusal from the processor are both 500s rather than 400s, for
	// the same reason: no value a caller could send fixes either.
	return consoleJson(report, report.outcome === 'failed' ? 500 : 200);
}

/**
 * where the account stands, changing nothing.
 *
 * a read that could not be made is a state and a 200 rather than a failure of the request: it says
 * nothing about what the account holds, and it carries both the sentence that names the value to fix
 * and the fact that says which of the two ways it failed. the fact is what a console acts on —
 * `packages/operator/src/console/stripe-read.ts` states what each member means to the screen — and
 * the sentence is what it shows under the one it reports.
 *
 * the reason is decided beside the variable a Stripe call cannot be made without
 * (`stripeUnreadableReason` in $lib/server/payments/factory.ts) rather than out of the port's
 * answer, so "this deployment holds no key" here and the refusal the port writes for it are one
 * deployment and not two.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	const { env } = context.get(platform);
	const provision = await readRecurringProvision(createPaymentProviders(env).for('stripe'));
	const reading: RecurringReading =
		provision.state === 'unreadable'
			? { state: 'unreadable', reason: stripeUnreadableReason(env), detail: provision.detail }
			: provision;

	return consoleJson(reading);
}
