import { adminAlert } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { Db } from '../db/client';
import type { EmailProvider } from '../email/provider';
import type { PaymentProvider } from '../payments/provider';
import { readOrgProfile } from '../org/queries';

// what one verified delivery may answer with, and the one way this app tells an operator about a
// delivery it could not finish.
//
// it is a module of its own because the answer is shared by the two halves that produce it:
// ./settle.ts settles one transaction against the payment row a quote minted, and ./collect.ts
// keeps the books for a gift that repeats. both are reached from the same route and both have to
// answer in the same vocabulary — stated here once, they cannot drift, and neither half has to
// import the other to say "posted".

/**
 * what one delivery did, all of which are answered 200.
 *
 *   ignored        — a delivery this app subscribes to nothing for, or one about a repeating gift
 *                    this deployment holds no record of. answered and logged.
 *   posted         — money moved: the gift is in the books.
 *   updated        — a row was corrected and nothing was posted. it is the transaction that is not
 *                    settled (still processing, failed, cancelled), which is why failure and
 *                    cancellation are in scope at all: without this arm a `pending` row sits
 *                    pending forever. it is also a commitment the rail reports as collecting again
 *                    after this deployment had recorded it as given up on.
 *   already_posted — the books already hold this payment. a redelivery, refused by the database.
 *   unmatched      — a verified settlement for a transaction this deployment has no payment row
 *                    for, or a collection whose commitment cannot be opened here. nothing was
 *                    written and an operator was told.
 *   unactionable   — a delivery that verified and cannot be finished, where repeating it reaches
 *                    the same answer: the processor could not be read, or money moved and what is
 *                    known about it is not something the ledger can hold — a settlement carrying
 *                    figures `post()` refuses, which either half can be handed (`unpostable` in
 *                    ./entries.ts), or a settled gift whose own lines do not account for the amount
 *                    that moved (./settle.ts). an operator was told.
 *   unnamed        — a settled transaction whose intent names no gift in this deployment. nothing
 *                    was read further and nothing was written. it is the ordinary answer to the
 *                    `payment_intent.succeeded` that accompanies every collection under a
 *                    commitment — see the metadata paragraph in ./settle.ts's header, which is
 *                    where the rule that produces it lives.
 *   uncollected    — a collection under a commitment that did not succeed. nothing was written,
 *                    because a collection has no row waiting for it to correct, and the rail's own
 *                    retry schedule is what tries again.
 *   stopped        — a commitment recorded as having stopped: cancelled, or given up on.
 */
export const SETTLE_OUTCOMES = [
	'ignored',
	'posted',
	'updated',
	'already_posted',
	'unmatched',
	'unactionable',
	'unnamed',
	'uncollected',
	'stopped'
] as const;
export type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];

/**
 * a delivery that was dealt with, or one the processor should bring back.
 *
 * `ok: false` means and only means "send this again": the route answers 5xx for it and 2xx for
 * everything else. that split is `isRetryable` in ../payments/provider.ts, which exists so two
 * routes cannot disagree about it — a delivery answered the wrong way is either a settlement lost
 * to a single bad minute or a deterministic fault hammered for three days.
 */
export type SettleResult =
	| { readonly ok: true; readonly outcome: SettleOutcome; readonly detail: string }
	| { readonly ok: false; readonly reason: SettleFailure; readonly detail: string };

/**
 * why a delivery was not dealt with. both are answered non-2xx, and the processor retries either
 * way — the difference is the sentence in its own delivery log, which is where an operator with a
 * misconfigured secret actually looks.
 *
 *   unverified — the signature did not check out, so the body was not read.
 *   incomplete — everything verified and something this app depends on did not answer.
 */
export const SETTLE_FAILURES = ['unverified', 'incomplete'] as const;
export type SettleFailure = (typeof SETTLE_FAILURES)[number];

/**
 * everything the webhook's modules need that they may not build for themselves, all per request.
 *
 * three consumers: ./settle.ts and ./collect.ts, which produce the answers above, and ./receipt.ts,
 * which both of them end at and which produces none. the third reads the database and sends mail
 * and asks the processor nothing, so it is handed a `provider` it never calls — one bag rather than
 * a narrower shape per consumer, because all three are reached from the one route that builds it
 * and a second shape would be a second thing to keep in step with that route.
 */
export type SettleDeps = {
	readonly db: Db;
	readonly provider: PaymentProvider;
	/** the mail transport. its failures are reported and never raised — see ./settle.ts's header. */
	readonly email: EmailProvider;
};

/**
 * one operational alert, to the address the console names.
 *
 * silent where no address is saved, because there is nowhere to send it — `notification_email` is
 * nullable and a fresh deployment has none. the sentence still reaches the logs either way, which
 * is the floor: an alert nobody configured must not become an exception on the money path.
 */
export async function alert(deps: SettleDeps, input: adminAlert.AdminAlertData): Promise<void> {
	try {
		console.error(`${input.headline}:`, JSON.stringify(input.facts));
	} catch {
		// nothing to report it to, and nothing on this path may throw.
	}

	const profile = await readOrgProfile(deps.db);
	const to = profile?.notificationEmail ?? null;
	if (to === null) return;

	await deps.email.send({ to, ...(await renderEmail(adminAlert.template(input))) });
}
