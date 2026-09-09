// everything the flow machine cannot do itself, as one object it is handed rather than as
// imports it reaches for.
//
// ports rather than imports, so the client's money path gets the same treatment as the
// server's: `src/lib/server/ledger/posting.ts` is pure, isolated and test-first, and this is how
// the checkout flow earns the same. a machine that imported `@stripe/stripe-js` would be
// testable only against a real browser and a real Stripe account, which is to say untested; a
// machine that imported `fetch` directly would be testable only against a network. so the
// three things that touch the world — the API, Stripe's confirmation, the read of an intent the
// machine did not watch — and the one that touches the clock arrive as functions, and
// ./checkout.machine.spec.ts passes ordinary ones.
//
// this is also where the Stripe ban is structural rather than a matter of discipline.
// CLAUDE.md routes payments through the `PaymentProvider` port on the server; the same rule
// applies on the client, with an extra edge — `packages/form/src/**` runs inside a stranger's page,
// so an SDK import is also weight and a second copy of Stripe.js on a page that may already
// have one.
//
// the clock is a port for the reason the network is: the microdeposit window is ten days, and
// a test that waited for it would not be a test. `now()` is what lets the expiry branch be
// asserted in a millisecond and, more usefully, be asserted for a deadline that has already
// passed — which is the case that actually happens, because nobody sits on a donation form for
// ten days.
//
// `../package.json` exports this module as `./ports`, types only. the deployment's own donation page
// builds this same object for itself — a same-origin quote, the clock, and the two the payment
// surface owns — so what a port is stays one declaration rather than one per surface, and the ban
// above is the same ban on both.

import type { PaymentMethod, Quote, QuoteRequest } from './v1';

/**
 * how far a confirmation got, as the machine needs to distinguish it.
 *
 * a discriminated union rather than a throw, and the difference is the whole reason this type
 * exists. Only one of these outcomes is a failure; the rest are ordinary places a donation
 * legitimately stops on this page load. Modelling them as rejections would make the error path
 * the busiest path in the machine and would flatten "the bank is deciding" into "something went
 * wrong", which is the wrong thing to tell someone who just gave money.
 *
 * the names are ours, not stripe's. Mapping `requires_action`/`processing`/
 * `requires_payment_method` happens in the adapter that implements this port, so a Stripe
 * status rename is one file rather than every guard in the machine.
 */
export type ConfirmOutcome =
	| { readonly kind: 'succeeded' }
	/**
	 * the money is in flight and the donor is free to go — ACH settles in 4–5 business days.
	 * The machine learns how it ended on a later visit, never from a timer on this page.
	 */
	| { readonly kind: 'processing' }
	/**
	 * 3DS: the browser is leaving for the donor's bank.
	 *
	 * the machine observes nothing after this on this page load — the page is gone. It is a
	 * state rather than an accident precisely so the thing that comes back has somewhere to
	 * come back to; see `CheckoutInput['resume']`.
	 */
	| { readonly kind: 'redirecting' }
	/**
	 * microdeposits are on their way to the donor's bank and must be verified there.
	 *
	 * `expiresAt` is the rail's deadline in unix milliseconds, which is the adapter's job to
	 * convert: a provider that reports seconds is the ordinary case, and a seconds value read as
	 * milliseconds is a deadline in 1970 that expires the donor's gift the instant it is written
	 * down. The machine refuses a value that cannot be Unix ms rather than trusting the
	 * conversion happened.
	 *
	 * It is optional because a resume may learn the state without the deadline, in which case the
	 * machine derives one from `MICRODEPOSIT_WINDOW_MS` — deriving a slightly-too-late deadline
	 * is safe (the next resume corrects it), while having none at all would mean the expiry
	 * branch never fires.
	 */
	| { readonly kind: 'awaiting_microdeposits'; readonly expiresAt?: number }
	/**
	 * the verification window closed and the intent now requires payment details again.
	 *
	 * reachable two ways, deliberately: a resume can report it outright, and the machine's own
	 * delayed transition reaches it when the deadline passes. Neither is redundant — the timer
	 * covers a page left open, the resume covers the ordinary case where nobody was watching.
	 */
	| { readonly kind: 'verification_expired' }
	/** the rail refused, and the donor may try again with different details. */
	| { readonly kind: 'declined'; readonly message: string }
	/**
	 * the donor has not finished the provider's own fields, so there was nothing to confirm.
	 *
	 * not a decline and not an ending of any kind: no rail was touched, nothing was refused, and
	 * the form the donor is standing in front of is simply incomplete. reported as `declined` it
	 * ends the flow on a screen saying the gift was not completed and hands back a Try again that
	 * returns to the same unfinished fields — a round trip through a failure the donor never had.
	 * so the machine answers it by staying on the payment step; see `confirming` in
	 * ./checkout.machine.ts.
	 *
	 * it carries no message, and the absence is deliberate. the provider marks its own fields and
	 * says which one is unfinished, in its own frame; a sentence carried here would be a second
	 * copy of that on the card around it, which is one more thing for a donor to reconcile rather
	 * than one more thing they are told.
	 */
	| { readonly kind: 'unfinished' }
	/**
	 * the confirmation was sent and its answer never arrived.
	 *
	 * not a decline, and the difference is a second charge. a dropped response, a timeout or a
	 * connection lost mid-confirm leaves an intent that may well have succeeded — an adapter
	 * cannot tell that apart from a refusal, and neither can anything downstream of it. Reported
	 * as `declined` it becomes a screen with a Retry button on it, and that button mints a second
	 * intent against a live one. So it is its own kind, and the machine answers it by re-reading
	 * the intent rather than by offering the form again; see the `indeterminate` state in
	 * ./checkout.machine.ts.
	 */
	| { readonly kind: 'indeterminate' };

/** what the machine hands the confirmation port. */
export type ConfirmInput = {
	readonly paymentToken: string;
	readonly method: PaymentMethod;
	/**
	 * whether the donor accepted the debit authorization on the mandate screen of this attempt.
	 *
	 * scoped to the attempt: every entry to `give` clears it, so a retry after a decline arrives
	 * `false` unless the donor accepted again.
	 *
	 * **an adapter must not gate a bank debit on it.** the screen that sets it is reached only
	 * when a quote carries `mandate`, and `Quote` in ./v1.ts documents that field as the
	 * provider's own wording, which no adapter in this tree populates — so the value is `false`
	 * on every attempt, and a confirmation refused for want of it would refuse every ACH gift.
	 * where the provider renders the authorization itself, the acceptance it collects is the one
	 * that authorizes the debit and this field says nothing about it.
	 */
	readonly mandateAccepted: boolean;
};

/**
 * the outside world, in four functions.
 *
 * small on purpose. Every function added here is one more thing a headless adapter must
 * implement and one more thing the spec must stand in for; the flow needs exactly these, and
 * the discipline that keeps the seam honest is refusing to add a fifth for convenience.
 */
export type CheckoutPorts = {
	/**
	 * `POST /api/v1/forms/:id/donations` — mints the intent and returns the authoritative fee.
	 *
	 * called once per attempt, and an attempt is a press the donor made. What the machine's shape
	 * guarantees is exactly that and no more: a second `SUBMIT` while a quote is in flight is
	 * dropped, because `quoting` has no `SUBMIT` handler. Backing out of the correction screen and
	 * pressing again is a new attempt — it mints a second intent, and the one it left behind is
	 * not cancelled from here. An unauthenticated endpoint that mints PaymentIntents is what
	 * card-testing bots hunt, and the bound on how many a caller can farm is the rate limit and
	 * the Turnstile token on that endpoint, never this seam: a caller who is not using this
	 * machine is not bounded by it at all.
	 *
	 * the machine owns the timeout for this function and for `resume`, because both can be given
	 * up on: nothing has been authorized, so abandoning the call abandons nothing. `confirm` is
	 * the exception and is waited on for as long as it takes — a timeout there could not know
	 * whether the charge landed, which is what `indeterminate` is for.
	 */
	quote(request: QuoteRequest): Promise<Quote>;

	/**
	 * the provider's confirmation for a typed rail, mapped onto our own outcome vocabulary.
	 *
	 * not timed out by the machine. See `quote` above: giving up on this call tells nobody
	 * whether the money moved. An adapter that cannot get an answer returns `indeterminate`
	 * rather than rejecting, and a rejection is treated the same way.
	 */
	confirm(input: ConfirmInput): Promise<ConfirmOutcome>;

	/**
	 * what became of an intent the machine did not watch — a 3DS return, a revisit after ACH.
	 *
	 * the cold-load half of the flow. The donor comes back to a URL on the org's page,
	 * cross-origin, with a payment token and no memory of anything; this is how the machine finds
	 * out whether that gift succeeded. It is also how the machine re-reads an intent whose
	 * confirmation went unanswered, which is why it is a read that may be repeated.
	 */
	resume(input: { readonly paymentToken: string }): Promise<ConfirmOutcome>;

	/** Unix ms. A port because ten days is not a thing a test can wait for. */
	now(): number;
};
