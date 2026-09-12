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

import type { StripeRunRead, StripeSetup } from '../api/types';
import type { StripeAct, StripeKeyBoxes } from './stripe-keys';
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
 * **and a write that landed holds them closed until they have been put back.** a box left open in
 * between is one whose contents are taken away under the hand typing them, and a press made in it
 * posts boxes the page is about to rewrite. what puts them back is {@link keysStanding}: this
 * press's own answer where it says the deployment took the pair, and the reading after it otherwise
 * (./reseed.ts).
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
 * the outcomes a run reaches with the secret key already stored.
 *
 * the store is one call part way down the chain and it carries both credentials
 * (`packages/console/internal/stripe/setup.go`), so every outcome behind it is a deployment that
 * is holding the key and every one in front of it is a deployment that is not — and only the first
 * is worth asking again about.
 */
const STORED_KEY: readonly StripeSetup['kind'][] = [
	'done',
	'unrepeating',
	'uncovered',
	'not-published'
];

/**
 * the outcomes it reaches with the published key stored beside it, which is both boxes confirmed.
 *
 * the publish is the step after the store and the last one that writes a var, so the three stops
 * behind it are the deployment holding the pair — and `not-published` is the one member of
 * {@link STORED_KEY} that is not among them: it is that write refusing, which leaves the published
 * slot exactly as it was.
 */
const STORED_PAIR: readonly StripeSetup['kind'][] = ['done', 'unrepeating', 'uncovered'];

/**
 * whether the run this fold is holding stored the secret key, which is what makes the deployment
 * worth reading again.
 *
 * **a publish stores no key, whatever it ends as.** such a press carries none — it is every press
 * that left the charging box alone (`stripeAsked` in ./stripe-keys.ts) — so a reading taken again
 * over one would be waiting on an edge nothing was written to.
 */
export const secretStored = (run: StripeRunRead | null): boolean =>
	run?.kind === 'ended' && run.act === 'errand' && STORED_KEY.includes(run.outcome.kind);

/**
 * what a press of the two key boxes carried, as the page read them when it went.
 *
 * the act with the pair, because only two of the three leave a pair on the deployment: a removal
 * deletes the charging key and reaches the published slot not at all (`stripeAsked` in
 * ./stripe-keys.ts), and a run held from an earlier press would otherwise be read as the answer to
 * it.
 */
export type KeysSent = {
	readonly act: StripeAct;
	readonly boxes: StripeKeyBoxes;
};

/** what the two key boxes are drawn holding, and whether they have been put back to it. */
export type KeysStanding = {
	readonly seeded: StripeKeyBoxes;
	readonly spent: boolean;
};

/**
 * the pair the deployment is holding because this press stored it, or `null` where no press did.
 *
 * the reading is {@link STORED_PAIR}, every stop of which is past the publish: a run that stored
 * both values and then failed further down stored them all the same.
 */
function storedPair(run: StripeRunRead | null, sent: KeysSent | null): StripeKeyBoxes | null {
	if (sent === null || sent.act === 'remove') return null;
	if (run?.kind !== 'ended' || !STORED_PAIR.includes(run.outcome.kind)) return null;
	return sent.boxes;
}

/**
 * the pair the boxes are seeded from, and whether a write has put them back to it.
 *
 * **the press's own answer seeds them, and it does so before any reading of the deployment.** the
 * fold's reading is a promise the loader hands back unresolved (../routes/_index.tsx), so it lands
 * a cloudflare round trip and the deployment's own answer after the run has ended — and the boxes
 * are held closed for the whole of that gap ({@link keysClosed}), which is a payments fold nothing
 * on the screen says anything about. what the press sent is what the deployment is holding the
 * moment it says it stored it, so there is nothing left to wait for. `storedOrg` in ./org-form.ts
 * is the same seeding, from the same camp (./reseed.ts).
 *
 * **and the reading takes it back the moment it lands.** it reports the same two values — every one
 * of the thirteen is a plain var and the account hands each back (`heldValues` in ./held-values.ts)
 * — so nothing moves under the operator when it does.
 *
 * **the one stop past the store that puts nothing back is `not-published`.** it is the publishable
 * var write refusing (`publish` in `packages/console/internal/stripe/setup.go`), so the deployment
 * is holding one of the two — and the press is left exactly as the operator made it, both boxes and
 * all, because pressing it again is the retry of the write that did not land. the pair is read as
 * one here: the charging box is holding the string that was stored anyway, so nothing is lost by it.
 */
export function keysStanding(press: {
	/** the two names as the deployment reported them, which is what a box holds with no press behind it. */
	readonly reported: StripeKeyBoxes;
	/** what the last press of this form carried, or `null` where this page has made none. */
	readonly sent: KeysSent | null;
	/** the run this fold is holding, which is where that press's own answer is read. */
	readonly run: StripeRunRead | null;
	/** whether the reading this press set off has landed (./reseed.ts). */
	readonly reread: boolean;
}): KeysStanding {
	const stored = storedPair(press.run, press.sent);
	if (stored === null) return { seeded: press.reported, spent: press.reread };
	return { seeded: press.reread ? press.reported : stored, spent: true };
}

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
