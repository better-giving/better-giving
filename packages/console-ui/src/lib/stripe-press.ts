// what a press of ./payments-fold.tsx is doing, and what the last one was turned down for.
//
// **a press is two router phases and the answer only lands between them.** the navigation carries
// the posted intent through both — react router builds the loading navigation from the same
// submission (`getLoadingNavigation` in the installed `react-router`) — so the intent alone says a
// press is somewhere in flight and never which half of it. the answer to it is committed with that
// loading navigation, before any loader has run, so a refusal and a still-pending press stand
// together for the whole of the re-read the fold sets off — which on this screen is every reading
// of the deployment and takes seconds.
//
// **so the phase is what tells this press's answer from the one before it.** during the submitting
// half the page is still holding whatever the previous press answered, and a fold reading that
// would mark boxes over a value it is at that moment sending.
//
// **and the answer does not stay on the page.** the router drops it on any revalidation that is not
// the submission's own (`completeNavigation`), and the fold revalidates twice by itself — when the
// run settles, and while it waits for cloudflare's edge to pick the key up. what was refused has to
// outlive that, because the boxes still hold exactly what was turned down.
//
// it is a module beside the fold rather than expressions inside it for ./smtp-fold-state.ts's
// reason: ../../vite.config.ts pins one node pool and no dom, so a reading written inline in a
// component is one nothing in this package can hold.

import type { StripeRunRead } from '../api/types';
import { REACHED } from './stripe-run-lines';

/** where the router is with this press, which is the pair rather than either flag alone. */
export type PressPhase = {
	/** this press's intent is the one the navigation is carrying, in either half. */
	readonly pending: boolean;
	/** the router is re-reading the page, which is the half where the answer has already landed. */
	readonly revalidating: boolean;
};

/**
 * what the last set-up answer said, as ../routes/_index.tsx reads it off the action's result.
 *
 * neither member says which press it is about: that is {@link PressPhase}'s.
 */
export type PressAnswer = {
	/** the binary's own door turned the pair down, so no run began. */
	readonly turnedDownPair: boolean;
	/** the boxes the answer named, or `null`. nothing left this machine either way. */
	readonly refused: Record<string, string> | null;
};

/**
 * what stands about the pair in the boxes now.
 *
 * two kinds because they reach the operator in two places — the door's is one sentence about the
 * pair, drawn at the press, and the boxes' is a sentence per box — and one type because they are
 * the same fact about the same press: it was turned down and nothing was set up.
 */
export type PressRefusal =
	| { readonly kind: 'pair' }
	| { readonly kind: 'boxes'; readonly errors: Record<string, string> };

/** whether the answer on the page is this press's own rather than the press before it. */
export const answerLanded = (phase: PressPhase): boolean => phase.pending && phase.revalidating;

/** the press whose answer has not come back yet, which is the half that holds a stale one. */
const inFlight = (phase: PressPhase): boolean => phase.pending && !phase.revalidating;

/**
 * what one answer says about the pair, whichever press it is about.
 *
 * the phase is what says whether that press is the one being made now — {@link standingRefusal}
 * and {@link runUnderway} are where the two meet.
 */
export const answeredRefusal = (answer: PressAnswer): PressRefusal | null =>
	answer.turnedDownPair
		? { kind: 'pair' }
		: answer.refused === null
			? null
			: { kind: 'boxes', errors: answer.refused };

/**
 * whether a run this press started is going.
 *
 * **the request in flight always counts and the answer decides everything after it.** a press whose
 * answer says the door turned the pair down, or names boxes, started nothing at all — so a button
 * left reading `Setting up` over that refusal is a promise about work that never began, standing
 * for the whole of the re-read.
 *
 * **a run reading as running counts on its own**, with nothing in flight: the request that starts
 * one answers at once and the reading that says it is going arrives a revalidation later, so
 * neither flag is true across the whole of a run.
 */
export function runUnderway(phase: PressPhase, answer: PressAnswer, running: boolean): boolean {
	if (running) return true;
	if (!phase.pending) return false;
	if (inFlight(phase)) return true;
	return answeredRefusal(answer) === null;
}

/**
 * what the operator is being told about the pair, from the answer where the page still carries one
 * and from what the fold remembered where it does not.
 *
 * **a new press drops both.** what the page is holding while a press is in flight is the press
 * before it, and what was remembered is about boxes this press is at that moment sending.
 */
export function standingRefusal(
	phase: PressPhase,
	answer: PressAnswer,
	remembered: PressRefusal | null
): PressRefusal | null {
	if (inFlight(phase)) return null;
	return answeredRefusal(answer) ?? remembered;
}

/**
 * a press somewhere else on the page is writing, which is what closes a control this form owns and
 * that press does not.
 *
 * the page hands every fold one flag for "something on this screen is writing", and it is true of
 * this form's own press as well — so read straight, it closes the keys form over its own answer.
 * what is wanted is the rest of the page, and the posted intent is what takes this form out of it.
 */
export const writingElsewhere = (phase: PressPhase, busy: boolean): boolean =>
	busy && !phase.pending;

/**
 * a write these two boxes made and whether the reading that follows it has landed.
 *
 * the pair rather than either flag on its own: what the boxes are waiting on is the gap between the
 * two, which ./reseed.ts is.
 */
export type KeysWrite = {
	/** the last press left something on the deployment. */
	readonly landed: boolean;
	/** the boxes have been put back to what the reading after that write says is stored. */
	readonly spent: boolean;
};

/**
 * whether the two key boxes and the press under them are closed.
 *
 * **the one thing that does not close them is a refused press being re-read.** a press the
 * door or the boxes turned down began nothing, and what has to change is a box — so the seconds the
 * page spends re-reading itself after that answer are seconds an operator sits in front of the
 * refusal unable to act on it. every other reason stands: the request carrying these boxes is in
 * flight, a run is going, or another press on the page is writing.
 *
 * **and a write that landed holds them closed until the reading that follows it lands.** the boxes
 * are put back to what the deployment holds on that reading and on no earlier moment (./reseed.ts),
 * so a box left open across the wait is one whose contents are taken away under the hand typing
 * them, and a press made in it posts boxes the page is about to rewrite.
 */
export const keysClosed = (
	phase: PressPhase,
	answer: PressAnswer,
	busy: boolean,
	running: boolean,
	write: KeysWrite
): boolean =>
	runUnderway(phase, answer, running) ||
	writingElsewhere(phase, busy) ||
	(write.landed && !write.spent);

/**
 * whether a stopped run's ledger stands under the boxes, with no card over it.
 *
 * **a run that stopped is the binary's memory and outlives the page it was pressed on**
 * (`packages/console/internal/server/stripe.go`), so it comes back with a reload as the fold's
 * reading — and the two cards that draw it are keyed on state only the page that pressed has. what
 * this says is when the ledger stands on the page itself instead: the run is held, it stopped, and
 * no card is up to be its report.
 *
 * **three stops draw nothing here, each said somewhere else already.** a run still going is a card's
 * ({@link runUnderway}); one that landed is said by the readings above the boxes, which now read
 * the account it set up; and one stopped at the key check is the sentence under the box the key was
 * typed in — `REACHED` is 0 for that one stage and nothing else (./stripe-run-lines.tsx).
 */
export function reportStands(live: StripeRunRead | null, cardUp: boolean): boolean {
	if (live === null || cardUp) return false;
	if (live.kind !== 'ended' || live.outcome.kind === 'done') return false;
	return REACHED[live.stage] > 0;
}
