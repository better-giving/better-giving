import { PAYMENT_METHODS, type PaymentMethod } from '@better-giving/form/v1';
import type { RailNotes } from '$lib/forms/rail-notes';
import type { RailChargeability, RailStanding } from '../payments/rail-chargeability';
import { railEvidence } from '../payments/rail-evidence';
import { PROCESSOR_LABELS, type ProcessorName } from '../payments/provider';

// what the donation-form editor says under a way of paying this deployment cannot charge.
//
// no screen chooses a rail — every form offers `OFFERED_PAYMENT_METHODS` in
// `$lib/forms/offered-rails.ts` — and the mistake it exists to answer survives that: a rail the
// account cannot charge is still offered to a donor, the operator finds out from a donor whose
// payment failed, and the only screen that can fix it belongs to the processor. so the sentence
// stands under the rails the editor states rather than in a block at the top of the page.
//
// it renames nothing and decides nothing about an account: ../payments/rail-chargeability.ts owns
// which standing a rail is in, and the only job here is the words. that file's header states the
// constraint every sentence below is written under, and it is the reason to read it before changing
// one: an approved rail is a *necessary* condition and never a sufficient one — a real gift still
// fails on the currency, the amount or the donor's own bank — so nothing here may say a way of
// paying will work, and the standings are named for approval rather than for outcome precisely so
// that sentence has no word to be written in. what a sentence may say is the other direction, which
// is sound: a rail that is not approved cannot be charged, so every sentence below is free to state
// the failure plainly.
//
// three of the six need saying separately, and each is a place an operator is sent wrong by the
// obvious wording. a rail nobody ever asked for is not one anybody refused, and an operator sent to
// appeal a rejection that was never issued has nowhere to go. a rail asked for and not usable covers
// a requirement outstanding, onboarding unfinished, a pause for inactivity and a refusal, so naming
// only the last of those is wrong four times in five. a rail the operator switched off is neither of
// those and is undone by the switch they turned.
//
// every sentence points at the answering processor's dashboard because every standing is that
// processor's, the wallets' included: a wallet is drawn inside the provider's own box and settles as
// a card charge (`RAILS` in `packages/form/src/embed/rails.ts`), so it answers to the card approval
// with a switch of its own and there is no state it reaches that this deployment's form put it in.
//
// **and the processor is interpolated rather than written, because a deployment charges on whichever
// one it holds keys for.** a sentence naming one processor's dashboard under a rail settled by
// another sends an operator to a screen they hold no account on, which is an errand with nowhere to
// arrive. `PROCESSOR_LABELS` in ../payments/provider.ts is the one spelling of each name an operator
// is shown, so the sentences take the label rather than holding a second one.
//
// **one standing's sentence is decided by the processor and not only by the standing.** where the
// processor publishes no approval per rail, `approved` means its credentials authenticated and
// nothing was read about the rail at all (../payments/rail-evidence.ts) — so the one standing that
// is silence everywhere else is the one that has to speak there, and what it says is what was
// actually proven.
//
// all six stay written, and the record is total over `PAYMENT_METHODS` in
// `packages/form/src/v1.ts` rather than over the rails the editor draws — so a rail that rejoins
// `OFFERED_PAYMENT_METHODS` arrives with its sentence already decided rather than with silence
// nobody noticed.

/**
 * what each standing costs the form being edited, or `null` where there is nothing to say.
 *
 * one sentence per standing rather than one per severity, which is the same rule ./readiness.ts
 * keeps: three deployments reading one line about payments needing attention are three different
 * problems, and two of them are not fixable where the line points.
 *
 * two short sentences at most: what the state is, then the one door out of it. the two standings
 * with nowhere to go close by saying so rather than pointing somewhere. length is the constraint
 * that keeps being lost here — a note under a stated value is read in passing by somebody in the
 * middle of another job, and a third clause is one an operator skips, taking the second with it.
 * `approved` is the only member a caller may act on, so it is the only one with no sentence here —
 * and the only one whose sentence depends on who answered, which {@link CREDENTIALS_ONLY_NOTE}
 * below holds.
 *
 * each sentence takes the processor's label rather than spelling one, so the same six sentences
 * serve whichever account answered and none of them can name the wrong dashboard.
 *
 * total over `RailStanding`, so a seventh standing added to ../payments/rail-chargeability.ts is a
 * type error here rather than a rail that draws nothing beside it.
 */
const STANDING_NOTE: Record<RailStanding, ((processor: string) => string) | null> = {
	approved: null,
	in_review: (processor) =>
		`${processor} is still reviewing your account for this. Nothing to do but wait.`,
	// asked for and not usable, which is the whole of what is known: a requirement outstanding,
	// onboarding unfinished, a pause and a refusal all arrive here, so the sentence names none of
	// them and sends the operator to the one screen that can say which it is.
	not_approved: (processor) =>
		`Your account cannot use this yet. Your ${processor} dashboard says why.`,
	// never a refusal, in any word. "has never been asked for" and "was looked at and turned down"
	// send an operator to two different places, and only one of them exists here.
	never_requested: (processor) =>
		`You have not asked ${processor} for this yet. Turn it on in your ${processor} dashboard.`,
	// the account is fine and the operator turned this one off, so the sentence says so plainly and
	// sends them to the switch rather than to a requirement. worded as `not_approved` it would put an
	// operator through a requirements flow for something one click undoes.
	switched_off: (processor) =>
		`You have this switched off in ${processor}. Turn it on in your ${processor} dashboard.`,
	// carried in place of the rail's own standing, so it is written to be read that way: approving
	// this one way of paying underneath the block changes nothing a donor would see.
	account_cannot_charge: (processor) =>
		`Your account cannot take payments at all yet. Clear that in your ${processor} dashboard first.`
};

/**
 * what stands under an `approved` rail on a reading that read no approval.
 *
 * the one place in this file where the standing alone is not enough to write a sentence. a
 * processor that publishes no per-rail approval reports every rail active on the strength of its
 * credentials authenticating (../payments/rail-evidence.ts), so silence here — which is what
 * `approved` gets everywhere else — would be this screen letting an operator read a green row as a
 * way of paying that is switched on. it is not, and nothing on this deployment can find out: which
 * funding sources a payer is offered is settled in the payer's own browser.
 *
 * so it says what was actually proven and closes rather than pointing anywhere, which is the shape
 * the two standings with nowhere to go already take. it says nothing about the rail being usable in
 * either direction, because neither claim is one this deployment was told.
 */
const CREDENTIALS_ONLY_NOTE = (processor: string): string =>
	`${processor} accepted this deployment’s credentials. It does not publish which ways of paying ` +
	`this account may take, and it decides in each donor’s browser whether to offer this one.`;

/**
 * what to say under each way of paying on the editor, given what the account answered.
 *
 * an unreadable answer is silence on every rail rather than a warning on all of them. nothing was
 * asked — no credentials, a rejected key, a processor that did not reply — so a sentence would be
 * this screen inventing a state out of a question nobody got an answer to, and a fresh fork holding
 * no keys for the processor that settles a rail would open its first form under warnings it can do
 * nothing about.
 */
export function railNotes(processor: ProcessorName, chargeability: RailChargeability): RailNotes {
	const label = PROCESSOR_LABELS[processor];
	const approvedNote =
		railEvidence(processor) === 'credentials_only' ? CREDENTIALS_ONLY_NOTE : STANDING_NOTE.approved;

	const notes = {} as Record<PaymentMethod, string | null>;
	for (const method of PAYMENT_METHODS) {
		// a rail the read did not cover is silence too, and it is the third deployment this `null`
		// carries: the processor that was asked does not settle this rail at all
		// (`RailChargeability.rails` in ../payments/rail-chargeability.ts). there is no sentence to
		// write under it, because nothing about this account is what keeps it off a form.
		const standing = chargeability.state === 'unreadable' ? undefined : chargeability.rails[method];
		if (standing === undefined) {
			notes[method] = null;
			continue;
		}
		const write = standing === 'approved' ? approvedNote : STANDING_NOTE[standing];
		notes[method] = write === null ? null : write(label);
	}
	return notes;
}
