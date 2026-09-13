// why a read the deployment makes against its own Stripe account could not be made — named once,
// for the one answer that carries it: the account read that opens the wallet-hostname press
// (`WalletLevellingReport` in ./payments.ts).
//
// **every reading beside it carries no reason, and that is the shape rather than an omission.** a
// reading exists only under a processor the deployment holds the credentials for, so "nothing was
// asked because no key is set" is a processor reported as unconfigured or left out of the report
// altogether — which a console reads before it draws a row. this one is a press's own answer, taken
// whatever the deployment holds, so it has nowhere else to say it.
//
// **it exists so that a console never has to read the sentence to find out which case it is in.**
// the sentence beside it is prose written for an operator and is free to change wording; a console
// matching on it is a screen that silently changes what it draws the next time somebody edits a
// string.
//
// it is on the `exports` map for one importer: the deployment side decides the member, and it
// decides it beside the variable a Stripe call cannot be made without
// (`stripeUnreadableReason` in `packages/app/src/lib/server/payments/factory.ts`), so that "no key"
// here and the refusal the port answers with can never mean different deployments. every other
// reader gets the union out of the answer that embeds it.

/**
 * why a reading of this deployment's Stripe account could not be made, as a closed set the console
 * switches on.
 *
 *   no_key — the deployment holds no `STRIPE_SECRET_KEY`, so nothing was asked and the reading is
 *            about nothing. the whole of the fix is setting that key, and a console with the box
 *            that sets it on the same screen has nothing to add by saying so a second time.
 *   failed — the deployment holds a key and the reading still could not be made: the processor
 *            refused it, did not answer, or what is in the slot is not a key that can charge. it is
 *            the member worth reporting, because nothing else on the screen says it.
 *
 * two members and not a boolean: what a console does about them is opposite — draw nothing, or say
 * so once — and a flag named for either half reads as the wrong one from the other end.
 */
export const STRIPE_UNREADABLE_REASONS = ['no_key', 'failed'] as const;

export type StripeUnreadableReason = (typeof STRIPE_UNREADABLE_REASONS)[number];
