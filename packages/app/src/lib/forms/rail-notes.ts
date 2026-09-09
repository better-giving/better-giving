import type { PaymentMethod } from '@better-giving/form/v1';

// what the donation-form editor may say under each way of paying, as the screen holds it.
//
// the shape lives here and the sentences live in `$lib/server/forms/rail-notes.ts`, which is the
// same split `./readiness.ts` and `$lib/server/forms/readiness.ts` are: deciding what to say means
// reading an account off the payment provider, and that read is server-only, while the screen it is
// drawn on is a component. anything under `$lib/server/**` may import from here and nothing
// here may import from there (CLAUDE.md).

/**
 * one sentence per way of paying, or `null` where there is nothing to say.
 *
 * total over `PAYMENT_METHODS` in `packages/form/src/v1.ts`, which is a permanent contract that may gain a
 * member — total here means a rail added there without an answer is a compile error rather than a
 * rail that quietly says nothing. it stays total over the whole vocabulary rather than over
 * `OFFERED_PAYMENT_METHODS` in ./offered-rails.ts, so a rail that rejoins the offered list arrives
 * with its sentence already decided.
 *
 * `null` is the whole of "there is nothing to report", and it covers two different deployments on
 * purpose: an account approved for this way of paying, and an account nobody could read. what tells
 * them apart is not something a screen acts on — neither one gets a sentence — so the editor is
 * drawn the same for both, which is what keeps a fork with no Stripe keys editable.
 *
 * every sentence is advisory. nothing here blocks a save or blocks a publish: what a donor is
 * offered is not a form's to choose, so a sentence's whole job is to send an operator to the
 * dashboard that can change it.
 */
export type RailNotes = Readonly<Record<PaymentMethod, string | null>>;
