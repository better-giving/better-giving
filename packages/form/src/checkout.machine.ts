// the donation flow, as a statechart.
//
// a donation is an async flow with a redirect in the middle of it: 3DS leaves the page and
// comes back, ACH settles days later, and a network blip mid-confirm must not
// double-charge. three rules follow from that, and they hold for this whole directory:
//
//   1. the shape bounds the presses; the endpoint bounds the attacker. no control in this
//      directory is ever rendered `disabled` and none ever may be — a disabled attribute is a
//      rendering detail, and any second entry point (a keyboard Enter, a host page's own
//      script, a re-render that dropped the prop) walks straight past it. a control the card
//      draws as unavailable says so with `aria-disabled` and still sends its event, which is
//      the same rule rather than an exception to it: the transition's guard is the gate, and
//      the word on the control is what tells a donor what the guard would answer. what this machine
//      guarantees is narrower than one intent per donor: a second `SUBMIT` while the quote is
//      in flight is dropped, because `quoting` has no `SUBMIT` handler. backing out of the
//      confirm screen and pressing again is a new attempt — a second intent is minted and the
//      first is left uncancelled — so the bound on how many an unauthenticated caller can farm
//      is the rate limit and the Turnstile token on `/api/v1`, never this file.
//      ./checkout.machine.spec.ts asserts both halves.
//   2. nothing is ever told to a donor that the machine cannot know. a confirmation whose
//      answer never arrived is not a decline, and saying so would put a Retry button in front
//      of someone whose card may already be charged — see `indeterminate`.
//   3. it is testable with no browser and no payment SDK — the same treatment
//      `src/lib/server/ledger/posting.ts` gets on the server. everything worldly arrives through
//      ./ports.ts.
//
// what is deliberately absent: no `src/lib/server/**`, no Svelte, no DOM global, no payment SDK,
// no `fetch`. this directory is meant to be liftable into a standalone package whose entire price
// of admission is depending on the `v1` HTTP contract and nothing else, and every one of those
// imports is that price going unpaid.
//
// `../package.json` exports this module as `./machine`, and that entry is the price above being
// spent rather than an exception to it. the deployment draws a donation page of its own
// (`src/lib/donate/` in packages/app) which renders this machine in react, so the flow a donor
// walks there and the flow a donor walks inside the element are one statechart, with one set of
// guards. a second copy of it is what the entry exists to refuse.
//
// ─── the shape ────────────────────────────────────────────────────────────────────────────
//
//   boot ─┬─► amount ─► details ─► give ─► quoting ─► quoted ─► confirming
//         │
//         └─► resuming
//
// `quoted` is a junction rather than a screen. it routes to `confirm` where the total moved and
// to `mandate` where the rail wants an authorization; both of those lead on to `confirming`, and
// everything else goes straight there. what `confirming` ends in:
//
//  success ◄── processing ◄── awaitingVerification ──10 days──► verificationExpired
//                                                                        │
//                            redirecting ◄──┬───────────────────────────-┘
//                                           │
//                          indeterminate ◄──┘
//
// and one answer to a confirmation that is not an ending at all: the provider's own field
// validation stopping it before a rail is touched goes back to `give`, because nothing was
// attempted and the donor is still filling the form in.
//
// three steps a donor fills in — the gift, their details, the review that takes the payment —
// and `confirm` is not one of them. it is a correction screen the flow routes to only
// where the authoritative total is not the figure the donor was last shown, which `quoted`
// above is the junction for. the guarantee that buys is exact rather than procedural: nobody is
// charged a figure they were not shown, and a deployment that shows no fee at all is not
// thereby a deployment that stops every donor on a fourth screen. `shownTotalMinor` below is
// where that comparison lives.
//
// the two branches that are genuinely different paths rather than flags on one path are the
// resume (a cold page load that finds out what happened while nobody was watching) and the
// indeterminate (a confirmation with no answer, which re-reads rather than re-charges).

import { assign, fromPromise, not, setup } from 'xstate';
import {
	estimateDeductedFee,
	estimateFee,
	quoteIsUsable,
	reconcile,
	type DeductedFee,
	type FeeEstimate,
	type Reconciliation
} from './fee';
import type { CheckoutPorts, ConfirmInput, ConfirmOutcome } from './ports';
import {
	completeAmount,
	completePayer,
	missingPayerFields,
	payerCoversFee,
	OPENED_TRIBUTE,
	type AmountDraft,
	type FormValue,
	type Payer,
	type PayerDraft
} from './value';
import {
	FREQUENCIES,
	PAYMENT_METHODS,
	type FeeRule,
	type FormConfig,
	type PaymentMethod,
	type Quote,
	type QuoteRequest,
	type TributeKind
} from './v1';

/**
 * everything the machine is handed at birth.
 *
 * `resume` is what makes a redirect return a state rather than an accident. The donor left for
 * their bank and came back to a URL on the org's page, cross-origin, with nothing but a payment
 * token in the query string and a brand-new JavaScript context. The element reads that token
 * and hands it here; the machine boots into `resuming` instead of `amount` and finds out what
 * happened. Without it, a completed 3DS donation renders an empty amount form and the donor
 * pays twice.
 */
export type CheckoutInput = {
	readonly config: FormConfig;
	readonly ports: CheckoutPorts;
	readonly resume?: { readonly paymentToken: string };
};

/**
 * the amount draft a fresh flow starts on: a cadence already chosen, and nothing else.
 *
 * one-time wherever the deployment offers it, and the first cadence it does offer where it does
 * not. that is one expression rather than two, because `FREQUENCIES` (./v1.ts) puts one-time first
 * and ./connect.ts draws the cadences in that same order — so this is also the leftmost option on
 * the track, and a donor who reads nothing sees the chip standing where they would have put it.
 *
 * the amount is seeded from the suggestions the same way: the smallest of them, so the card opens
 * with the lowest tile chosen and one press from a gift, and a donor who reads nothing is not
 * refused for an amount they were never shown a default for. a form suggesting nothing seeds
 * nothing, because there is no figure the org offered to stand in.
 *
 * this is also how a deployment that enabled one cadence is served, and it is the same line rather
 * than a case of its own: there is nothing for such a donor to pick between, the card draws no
 * frequency control at all (`chooses` in ./views.ts), and the value that would have come back from
 * one comes from here. `AmountDraft.frequency` and `FormValue.frequency` are unchanged either way —
 * nothing past this step can tell whether a donor chose the cadence or this did.
 *
 * here rather than in the renderer, because the draft is what `missingAmountDecisions` and
 * `completeAmount` (./value.ts) are read against: a selection the view invented would be a control
 * reading chosen over a flow that still refused every press for it.
 *
 * `undefined` where the config offers no cadence at all, which no config the machine is handed ever
 * is: `parseConfig` in ./config.ts returns `null` on an empty `frequencies`, and a card that fails
 * to parse never renders. the branch is kept because it is `find`'s answer rather than a state,
 * which is the reading `displayRail` below is under for the same reason.
 */
function settledDraft(config: FormConfig): AmountDraft {
	const frequency = FREQUENCIES.find((offered) => config.frequencies.includes(offered));
	const offered = config.suggestedAmountsMinor;
	return {
		...(frequency === undefined ? {} : { frequency }),
		...(offered.length === 0 ? {} : { amountMinor: Math.min(...offered) })
	};
}

/**
 * why the flow stopped, in the words the API used.
 *
 * `fix` is carried rather than dropped. CLAUDE.md: 4xx bodies are read by AI agents, not humans
 * in a console, so every one names the offending value and where to change it — and a failure
 * channel typed as a bare string is where that sentence dies one layer above the integrator who
 * needed it. ./connect.ts carries all three out to the render surface.
 *
 * `refusedByRail` marks the one failure the donor themselves can act on: an issuer said no, and
 * different details may get the same gift through. Every other way to `failed` is a quote that
 * could not be minted, a payment surface that never drew, a challenge that could not be shown or a
 * port that did not answer, and none of those is a statement about the card in their hand. It is
 * set at one site — `rememberDecline` below — and absent everywhere else, because the words cannot
 * carry the difference: `toFailure` hands a rejected quote the same bare `{ message }` it hands a
 * decline.
 */
export type Failure = {
	readonly message: string;
	readonly fix?: string;
	readonly refusedByRail?: true;
};

/**
 * everything the machine knows.
 *
 * the draft/value pairs are not redundant. `draft` is what a screen is still editing and
 * `fv` is what has been decided; the same for `payerDraft` and `payer`. Collapsing each pair
 * into one field is how a later state ends up holding a half-filled value that its type claims
 * is complete — see ./value.ts. ./connect.ts is what turns this flat record back into the
 * value-carrying `State` union the design specifies.
 *
 * `ports` lives in context rather than being closed over at module scope, for the reason
 * CLAUDE.md gives about bindings on the server: nothing built from the outside world is a
 * module-scope singleton. Here it also means one machine definition serves every test and
 * every deployment.
 */
export type CheckoutContext = {
	readonly config: FormConfig;
	readonly ports: CheckoutPorts;
	readonly resumeToken: string | null;
	readonly draft: AmountDraft;
	readonly fv: FormValue | null;
	readonly payerDraft: PayerDraft;
	readonly payer: Payer | null;
	readonly estimate: FeeEstimate | null;
	readonly quote: Quote | null;
	readonly reconciliation: Reconciliation | null;
	readonly mandateAccepted: boolean;
	readonly turnstileToken: string | null;
	readonly verificationDeadline: number | null;
	readonly failure: Failure | null;
	/**
	 * a challenge report that arrived where the flow could not answer it, kept until it can.
	 *
	 * the widget reports whenever its own script gets around to it, which may be the one window
	 * nothing may act on: past a press there is an intent at the processor and possibly a charge
	 * against it, and reaching `failed` from there would abandon a gift the donor's money may
	 * already be on. dropped instead it is never raised again — the report is one event from one
	 * surface — and the donor presses into `challenge_failed` from
	 * `POST /api/v1/forms/:id/donations` with nothing on the card to explain it. so it waits here,
	 * and the three editable steps deliver it on arrival.
	 */
	readonly heldChallenge: Failure | null;
};

/**
 * the three steps a donor fills in, in the order they are asked.
 *
 * one list, and it is what "forwards" and "backwards" mean everywhere below — `stepIsReachable`
 * reads the order off it rather than off a comparison written out per pair, so a fourth step is
 * added here and nowhere else. the states these name are the three the donor edits; every other
 * state in this machine is a screen the flow put them on.
 */
export const NUMBERED_STEPS = ['amount', 'details', 'give'] as const;

export type NumberedStep = (typeof NUMBERED_STEPS)[number];

/**
 * every event the flow accepts.
 *
 * one union, no catch-all. An event that is not here cannot be sent, and an event sent in a
 * state that does not handle it is silently ignored — which is what drops the second press of
 * a button whose first press has already left the state, so it is a feature rather than a gap.
 */
export type CheckoutEvent =
	| { readonly type: 'SET_AMOUNT'; readonly amountMinor: number }
	/**
	 * the donor taking their amount back, which is not a figure and never travels as one.
	 *
	 * its own event rather than a nullable payload on `SET_AMOUNT` above: that event's
	 * `amountMinor` is a number a guard can read as one, and a null threaded through it would put
	 * "there is no amount" and "the amount is this" down a single path for every reader to sort out
	 * again. the difference is stated once, in the transition table.
	 */
	| { readonly type: 'CLEAR_AMOUNT' }
	| { readonly type: 'SET_FREQUENCY'; readonly frequency: FormValue['frequency'] }
	| { readonly type: 'SET_NOTE'; readonly note: string }
	/**
	 * which of the form's causes the donor picked, or `null` for the option that picks none.
	 *
	 * `null` travels rather than the event being absent, for `CLEAR_AMOUNT` above's reason turned
	 * round: here there is one control and its first option is an answer — the gift going where it is
	 * needed most — so taking a choice back is a selection a donor makes and not a box they emptied.
	 * one event carries both because both come off the same `change`.
	 */
	| { readonly type: 'SET_PROGRAM'; readonly programId: string | null }
	/** the donor asking to write a note, or taking the ask back. */
	| { readonly type: 'TOGGLE_NOTE' }
	/**
	 * a box in the tribute block, or several at once.
	 *
	 * partial and one event for the whole block, the shape `SET_CONTACT` below has: four controls
	 * write one value, and four events writing four fields of it is the same assign spelled four
	 * times. it is dropped where the disclosure is closed — there is nothing to merge into, and a
	 * tribute fabricated out of a stray box is a gift dedicated by something other than the donor.
	 */
	| {
			readonly type: 'SET_TRIBUTE';
			readonly kind?: TributeKind;
			readonly honoree?: string;
			readonly notifyName?: string;
			readonly notifyEmail?: string;
	  }
	/** the donor asking to dedicate the gift, or taking the ask back. */
	| { readonly type: 'TOGGLE_TRIBUTE' }
	| { readonly type: 'CONTINUE' }
	/**
	 * backing off a screen the flow put the donor on, which is the correction screen and nothing
	 * else.
	 *
	 * it moves one step and the step it moves to is written into the transition, so it says nothing
	 * about where the donor came from. that is enough for a screen with one way off it and is not
	 * enough for the step head, where a mark on the third step stands for the first: `GO_TO_STEP`
	 * below is what names a destination, and the two sit beside each other rather than one
	 * replacing the other.
	 */
	| { readonly type: 'BACK' }
	/**
	 * the donor pressing one of the marks on the step head to go straight to that step.
	 *
	 * it names its destination rather than a direction, because the marks offer every step at once
	 * and two of the six moves they offer skip a screen. `stepIsReachable` below is the whole of
	 * what it is allowed to do, and the guard is on the transition rather than on the control: the
	 * shape bounds the presses, exactly as the header states, so a mark drawn available by a stale
	 * render still lands on a guard that reads the flow as it is now.
	 */
	| { readonly type: 'GO_TO_STEP'; readonly step: NumberedStep }
	| { readonly type: 'SET_METHOD'; readonly method: PaymentMethod | null }
	| { readonly type: 'PAYMENT_UNAVAILABLE'; readonly failure: Failure }
	| { readonly type: 'CHALLENGE_UNAVAILABLE'; readonly failure: Failure }
	| {
			readonly type: 'SET_CONTACT';
			readonly email?: string;
			readonly firstName?: string;
			readonly lastName?: string;
	  }
	| { readonly type: 'TOGGLE_FEE_COVERAGE' }
	| { readonly type: 'SET_CONSENT'; readonly consented: boolean }
	| { readonly type: 'SET_TURNSTILE_TOKEN'; readonly token: string }
	| { readonly type: 'SUBMIT' }
	| { readonly type: 'CONFIRM' }
	| { readonly type: 'ACCEPT_MANDATE' }
	| { readonly type: 'DECLINE_MANDATE' }
	| { readonly type: 'RETRY' };

/**
 * how long a donor is given to find the microdeposits in their bank account.
 *
 * exported so the spec asserts the boundary rather than a number copied out of this file,
 * which is how a window silently stops being tested when it is changed — the same reason
 * `MAX_ALLOWED_ORIGINS` is exported from `packages/operator/src/origins.ts`.
 *
 * it is both a fallback and a ceiling. The rail's own deadline rides on the outcome when it is
 * known and this is what the machine derives one from when it is not; and no delay computed
 * from a stated deadline is ever allowed to exceed it, because the ambient `setTimeout` coerces
 * its delay to a 32-bit integer — a deadline forty days out overflows to a delay of 1ms and
 * expires the gift of a donor whose microdeposits are still in the post.
 */
export const MICRODEPOSIT_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * the floor below which a stated deadline is not a Unix millisecond timestamp at all.
 *
 * a deadline in seconds is the failure this catches: it reads as a moment in 1970, the machine
 * computes a delay of zero, and the donor is told to start over while their microdeposits are
 * on their way. Any real deadline is later than this instant, and any seconds-valued timestamp
 * is far below it, so the two cannot be confused.
 */
const EARLIEST_PLAUSIBLE_DEADLINE_MS = 1_000_000_000_000;

/**
 * how long the machine waits on a port it is allowed to give up on.
 *
 * `quote` and `resume` only. Both are mints or reads with nothing authorized behind them, so
 * abandoning the call abandons nothing, and a promise that never settles otherwise leaves a
 * donation form spinning on a stranger's page with no way out of it. `confirm` has no timeout at
 * all — giving up on it tells nobody whether the money moved, and the answer to that question is
 * `indeterminate`, never `failed`.
 */
export const PORT_TIMEOUT_MS = 30_000;

/**
 * what the donor is told when a port failed without saying anything usable.
 *
 * it says outright that nothing was charged, and that is the sentence rather than a tidier one
 * because every failure that reaches it is one raised before the confirmation: the quote that
 * never landed, the surface that never came up, the challenge that will never mint a token. the
 * press that reaches those looks like an authorizing press — it is the last one on the review
 * step — so a donor not told otherwise reasonably assumes their card was taken and goes and pays
 * somewhere else. `UNCHARGED` in ./embed/api.ts says the same thing at the port.
 */
const GENERIC_FAILURE = 'This gift was not started, and nothing was charged. Please try again.';

/** the request the quote port is handed, assembled from everything decided so far. */
function quoteRequest(context: CheckoutContext, payer: Payer): QuoteRequest {
	const fv = context.fv;
	if (fv === null) throw new Error('unreachable: a quote is only requested past `completeAmount`');
	return {
		formId: context.config.formId,
		amountMinor: fv.amountMinor,
		frequency: fv.frequency,
		method: payer.method,
		coversFee: payer.coversFee,
		email: payer.email,
		firstName: payer.firstName,
		lastName: payer.lastName,
		consentedToContact: payer.consentedToContact,
		...(fv.note === undefined ? {} : { note: fv.note }),
		// omitted where the donor chose no cause, which is what the endpoint reads as the gift going
		// where it is needed most — and it is also every gift on a pinned form, because that pin is
		// written from the form record and nothing on such a card writes an id onto the draft.
		...(fv.programId === null ? {} : { programId: fv.programId }),
		...flatTribute(fv.tribute),
		...(context.turnstileToken === null ? {} : { turnstileToken: context.turnstileToken })
	};
}

/**
 * the tribute as the four flat fields the endpoint parses, or nothing at all.
 *
 * the one place the nesting `FormValue` carries becomes the wire's flatness, so no other module
 * has to know both shapes. every field is omitted rather than emptied, and it is stronger here than
 * it is for the note: an absent `tributeKind` is how a gift says it carries no tribute
 * (`parseTribute` in the app's `donations/quote-input.ts`), and an empty string in that field is
 * not a blank value it stores — it is a kind the enum refuses outright.
 */
function flatTribute(tribute: FormValue['tribute']): Partial<QuoteRequest> {
	if (tribute === undefined) return {};
	return {
		tributeKind: tribute.kind,
		tributeHonoree: tribute.honoree,
		...(tribute.notify === null
			? {}
			: { tributeNotifyName: tribute.notify.name, tributeNotifyEmail: tribute.notify.email })
	};
}

/**
 * which rail the fee row prices against while the donor has chosen none.
 *
 * the rail is picked inside the payment provider's own fields, which are on the review step — so
 * every donor stands in front of the fee decision for a while with no rail reported. priced against
 * nothing, that row asks a donor to decide something with no figure attached to either answer, which
 * is the state this exists to end.
 *
 * the first rail the deployment offers, in the order ./v1.ts lists them, which puts card first and
 * ach second. so where card is on offer the figure moves only for a donor who picks ach. that is
 * what the rules this app serves say, not a property of the input: `config.feeRules` is untrusted
 * wire JSON, as `currentEstimate` below notes, so this picks which rail is priced and promises
 * nothing about the price.
 *
 * the fee row states two readings of this rail's price — what covering adds and what declining
 * costs — and `declinedFee` below is the second. one expression for the rail, so the two readings
 * of it can never come from different rails.
 *
 * `undefined` where the config offers no rail at all, which no config the machine is handed ever is:
 * `parseConfig` in ./config.ts returns `null` on an empty `paymentMethods`, and a card that fails to
 * parse never renders. the branch is kept because it is `find`'s answer rather than a state — a
 * total return type is what would let it be dropped, and both callers below already hold a `null`
 * for a figure they cannot price.
 */
function displayRail(config: FormConfig): PaymentMethod | undefined {
	return PAYMENT_METHODS.find((method) => config.paymentMethods.includes(method));
}

/**
 * the fee the donor is shown before authority has spoken, or `null` when there is none to show.
 *
 * `null` is a real answer here, twice over: the donor declined to cover the fee, or the config
 * carries no rule for the rail. Both mean the same thing to the confirm screen — there is no
 * estimate to reconcile against — and ./fee.ts's `unestimated` kind is what says so out loud rather
 * than a zero standing in for a number nobody saw.
 *
 * a rail nobody has chosen yet is priced at `displayRail` above rather than withheld, and that
 * default belongs to this figure rather than to the render surface because the receipt is one column
 * of arithmetic: the fee row, the total under it and the Donate label are `shownTotalMinor` below
 * read three times, and a fee stated outside that expression is a receipt whose rows do not add up.
 *
 * the default can never be reconciled against, which is what keeps it out of the correction screen.
 * `payerIsComplete` refuses a `SUBMIT` while no rail is chosen, so every path into `acceptQuote` has
 * re-run `refreshEstimate` on a rail the donor is actually on.
 */
function currentEstimate(context: CheckoutContext): FeeEstimate | null {
	const { fv, config, payerDraft } = context;
	const method = payerDraft.method ?? displayRail(config);
	if (fv === null || method === undefined) return null;
	if (!payerCoversFee(payerDraft)) return null;
	// `feeRules` is untrusted JSON keyed by rail, and the type saying every rail has a rule does
	// not make the response carry one.
	const rule: FeeRule | undefined = config.feeRules[method];
	return estimateFee(fv.amountMinor, rule);
}

/**
 * what the processor would take out of the gift if the donor does not cover it, or `null` where
 * nothing can price it.
 *
 * the other half of what the fee switch decides, and the half no other figure on the card holds:
 * every number in the receipt is money leaving the donor, and this one is money the org never
 * receives. `estimateDeductedFee` in ./fee.ts is the arithmetic; the rail is the one `currentEstimate`
 * above prices against, so the two readings of the decision are always the same rail's.
 *
 * exported rather than assigned into context, and never assigned into `estimate`. nothing reconciles
 * this figure — see ./fee.ts — and `estimate` is read by `reconcile` as the record of what the donor
 * was shown, so a declining donor's absent estimate is what routes their correct gift past the
 * correction screen. ./connect.ts hands this to the row, which is the whole of where it goes.
 *
 * stated regardless of which way the switch is set: it is a fact about the rail rather than about
 * the decision, and which reading of it a donor sees is the row's to choose (./views.ts).
 */
export function declinedFee(context: CheckoutContext): DeductedFee | null {
	const { fv, config, payerDraft } = context;
	const method = payerDraft.method ?? displayRail(config);
	if (fv === null || method === undefined) return null;
	const rule: FeeRule | undefined = config.feeRules[method];
	return estimateDeductedFee(fv.amountMinor, rule);
}

/**
 * the figure the donor was last shown, which is the one thing the authoritative total is measured
 * against.
 *
 * exported because it is a promise about a control rather than an implementation detail: this is
 * the number `submitButton` projects onto the Donate label (./connect.ts), and the number
 * `acceptQuote` reconciles the server's answer against. one function, so the label and the
 * comparison cannot drift — a second derivation at either site is a donor charged a figure the
 * other site believed they had seen.
 *
 * the estimate when there is one, the gift itself when there is not. `currentEstimate` above
 * answers `null` in three ordinary situations, one of which is a donor simply declining to cover
 * the fee — so "there was no estimate" is never the discriminator.
 *
 * `null` only before an amount is decided, which is before there is anything to press.
 */
export function shownTotalMinor(context: CheckoutContext): number | null {
	return context.estimate?.totalMinor ?? context.fv?.amountMinor ?? null;
}

/** everything the amount step exists to decide has been decided. */
function amountIsDecided(context: CheckoutContext): boolean {
	return completeAmount(context.draft, context.config) !== null;
}

/**
 * the donor has given the three fields a receipt needs, which is the whole of what the details
 * step asks for.
 *
 * narrower than `payerIsComplete` in the guards below on purpose: the rail is chosen on the step
 * after this one, in the payment provider's own fields, so holding this step to a rail would refuse
 * a Continue for the one thing the donor cannot yet have done.
 */
function payerFieldsAreGiven(context: CheckoutContext): boolean {
	return missingPayerFields(context.payerDraft).length === 0;
}

/**
 * whether a donor standing on one numbered step may reach another by pressing its mark.
 *
 * exported for the reason `shownTotalMinor` above is: it is a promise about a control rather than
 * an implementation detail. this is what `stepButtons` draws as available (./connect.ts) and what
 * the `GO_TO_STEP` guard refuses on, and one expression evaluated in one place is the whole of how
 * the two cannot part — a mark drawn available over a guard that refuses is a press that does
 * nothing, and a mark drawn unavailable over a guard that would have allowed it is a way back a
 * donor cannot find.
 *
 * backwards carries no condition at all, and that is the rule rather than an omission. the marks
 * are the only way back through the form, so a step the donor has already stood on is one they may
 * always return to — a completeness test there would strand somebody who emptied a field on their
 * way past it.
 *
 * forwards is allowed only through steps that are complete, and it asks exactly the two predicates
 * above, which are the two the step's own Continue is guarded on. reaching the review screen past
 * its own gate is a donor in front of the control that spends the money with no address for the
 * receipt it produces.
 *
 * a step is not reachable from itself. it is where the donor already is, and the mark standing for
 * it is drawn as a position rather than as a control (`stepDots` in ./views.ts).
 */
export function stepIsReachable(
	context: CheckoutContext,
	from: NumberedStep,
	to: NumberedStep
): boolean {
	const at = NUMBERED_STEPS.indexOf(from);
	const target = NUMBERED_STEPS.indexOf(to);
	if (target < at) return true;
	if (target === at) return false;
	if (!amountIsDecided(context)) return false;
	return to !== 'give' || payerFieldsAreGiven(context);
}

/**
 * a thrown value as a sentence the donor or an integrating agent can act on.
 *
 * keeps the API's own words, including `fix`. CLAUDE.md: 4xx bodies are read by AI agents, not
 * humans in a console, and every one names the offending value and where to fix it. Flattening
 * that to "something went wrong" here would spend the entire benefit of writing them that way —
 * and a silently broken donation form is indistinguishable from a nonprofit having a bad month.
 * An `ApiError` body thrown by an adapter and an `Error` carrying a `fix` property are both read
 * the same way, because both are the shape that carries the sentence.
 */
function toFailure(error: unknown): Failure {
	if (typeof error === 'object' && error !== null) {
		const body = error as { message?: unknown; fix?: unknown };
		if (typeof body.message === 'string' && body.message.length > 0) {
			return typeof body.fix === 'string' && body.fix.length > 0
				? { message: body.message, fix: body.fix }
				: { message: body.message };
		}
	}
	if (typeof error === 'string' && error.length > 0) return { message: error };
	return { message: GENERIC_FAILURE };
}

/**
 * where a confirmation's outcome lands, as one total function rather than as a guard per arm.
 *
 * this is the exhaustiveness check, and it is the reason the branch tables below can be trusted
 * to mirror the outcome union. `unroutedOutcome` takes `never`, so a seventh `ConfirmOutcome`
 * kind that no case names fails `pnpm check` on the line that calls it — rather than falling
 * quietly into the arm that tells a donor their gift was refused.
 *
 * returns `null` rather than throwing for a value that is not an outcome at all. An adapter
 * that returns something else entirely is a bug, and the honest response to it is the unguarded
 * last arm of each branch table, which routes to `indeterminate`: nobody can say whether that
 * charge landed, and a throw here would stop the actor and freeze the form instead.
 */
type OutcomeRoute =
	| 'success'
	| 'processing'
	| 'redirecting'
	| 'awaitingVerification'
	| 'verificationExpired'
	| 'indeterminate'
	| 'failed'
	/**
	 * back to the step the press was made on, which is the one route here that is not an ending.
	 *
	 * a confirmation stopped by the provider's own field validation never reached a rail, so there is
	 * no outcome to land on — see `unfinished` in ./ports.ts. routed by the `confirming` state alone:
	 * a resume reads an intent with no form in front of it and cannot produce this, which is why
	 * `resuming` and `indeterminate.reading` name no branch for it.
	 */
	| 'unfinished';

function outcomeRoute(output: unknown): OutcomeRoute | null {
	if (typeof output !== 'object' || output === null || !('kind' in output)) return null;
	const outcome = output as ConfirmOutcome;
	switch (outcome.kind) {
		case 'succeeded':
			return 'success';
		case 'processing':
			return 'processing';
		case 'redirecting':
			return 'redirecting';
		case 'awaiting_microdeposits':
			return 'awaitingVerification';
		case 'verification_expired':
			return 'verificationExpired';
		case 'indeterminate':
			return 'indeterminate';
		case 'declined':
			return 'failed';
		case 'unfinished':
			return 'unfinished';
	}
	return unroutedOutcome(outcome);
}

/** the compile-time half: a kind with no case above is not `never` here, and the build fails. */
function unroutedOutcome(_outcome: never): null {
	return null;
}

export const checkoutMachine = setup({
	types: {
		context: {} as CheckoutContext,
		events: {} as CheckoutEvent,
		input: {} as CheckoutInput
	},
	actors: {
		/**
		 * `POST /api/v1/forms/:id/donations`.
		 *
		 * the one state that invokes it cannot be re-entered without leaving first, so one press
		 * mints one intent. a donor who backs out and presses again has made a second attempt and
		 * mints a second intent; see the header.
		 */
		mintQuote: fromPromise<Quote, { ports: CheckoutPorts; request: QuoteRequest }>(({ input }) =>
			input.ports.quote(input.request)
		),
		confirmPayment: fromPromise<ConfirmOutcome, { ports: CheckoutPorts; input: ConfirmInput }>(
			({ input }) => input.ports.confirm(input.input)
		),
		resumeIntent: fromPromise<ConfirmOutcome, { ports: CheckoutPorts; paymentToken: string }>(
			({ input }) => input.ports.resume({ paymentToken: input.paymentToken })
		)
	},
	guards: {
		/** the donor arrived on a URL carrying a payment token, so this is a return rather than a start. */
		isResuming: ({ context }) => context.resumeToken !== null,

		// the two predicates a step's own Continue is refused on, and the two `stepIsReachable`
		// above asks of a mark pressed forwards. stated once as functions rather than twice as
		// guards, because the second definition of "this step is complete" is what decides whether
		// a donor reaches the screen that spends the money.
		amountIsDecided: ({ context }) => amountIsDecided(context),

		payerFieldsAreGiven: ({ context }) => payerFieldsAreGiven(context),

		/**
		 * a mark press naming a step the donor may go to from the one they are standing on.
		 *
		 * both ends are parameters because neither is readable from here: a guard cannot see which
		 * state it was written on, so `from` is stated by the transition table it sits in, and `to`
		 * is what makes this branch the destination's rather than one of the other two — a single
		 * `GO_TO_STEP` offers three destinations and exactly one branch may take it.
		 */
		stepIsReachable: ({ context, event }, params: { from: NumberedStep; to: NumberedStep }) =>
			event.type === 'GO_TO_STEP' &&
			event.step === params.to &&
			stepIsReachable(context, params.from, params.to),

		/** the donor has filled in everything a typed rail needs before an intent can be minted. */
		payerIsComplete: ({ context }) => completePayer(context.payerDraft, context.config) !== null,

		/** a challenge report is waiting for a state that can answer it, and this is one. */
		challengeIsHeld: ({ context }) => context.heldChallenge !== null,

		/** the quoted rail wants an authorization the donor has to accept in their own words. */
		quoteRequiresMandate: ({ context }) => context.quote?.mandate !== undefined,

		/**
		 * authority is charging a figure the donor was not shown.
		 *
		 * the one gate on the correction screen, and it is a comparison of totals rather than a
		 * question about whether an estimate existed. `shownTotalMinor` above says why: a donor who
		 * declined the fee is charged exactly the figure on the button with nothing ever estimated,
		 * so routing on the estimate would hand them a fourth screen with nothing on it to correct.
		 */
		quoteWasAdjusted: ({ context }) => context.reconciliation?.kind === 'adjusted',

		/**
		 * the server's numbers can be charged and stated.
		 *
		 * guards the screen that makes a claim about money. The correction screen renders this total,
		 * and nothing downstream measures it against the intent again — so a response whose totals
		 * are not whole minor units at or above the gift is a failure the donor is told about rather
		 * than one that is rendered.
		 */
		quoteIsUsable: ({ context }, params: { quote: Quote }): boolean =>
			context.fv !== null && quoteIsUsable(params.quote, context.fv.amountMinor),

		/**
		 * how a confirmation ended, read off the actor's own output.
		 *
		 * parameterised rather than eight near-identical guards, so each branch table reads as the
		 * outcome union it mirrors. The exhaustiveness lives in `outcomeRoute` above: this guard is
		 * a string compare, and it is the routing function it compares against that fails the build
		 * when a kind is added and left unrouted.
		 */
		outcomeGoesTo: ({ event }, params: { route: OutcomeRoute }): boolean =>
			'output' in event && outcomeRoute(event.output) === params.route
	},
	actions: {
		/** the one place a draft becomes the `fv` every later state is allowed to assume. */
		commitAmount: assign({
			fv: ({ context }) => completeAmount(context.draft, context.config)
		}),

		/**
		 * recomputes the stated fee from whatever is decided now.
		 *
		 * run after every assign that could move it — the rail, the coverage decision, the
		 * amount — rather than derived at render time, because the fee line and the submit
		 * button both state it and two derivations drift by a minor unit.
		 */
		refreshEstimate: assign({ estimate: ({ context }) => currentEstimate(context) }),

		/**
		 * clears everything that belonged to the previous attempt.
		 *
		 * on entry to both editable steps rather than on each route back into them, because every
		 * way back — backing out of the correction screen, declining a mandate, retrying a failure,
		 * retrying an expired verification — leaves behind an intent that is spent or abandoned and
		 * the decisions that were made about it. One place, so a fifth route in cannot forget one.
		 * it is idempotent, which is what lets a donor walking from the details step to the review
		 * step run it twice without losing anything they typed.
		 *
		 * one of these costs money if it survives: a stale `mandateAccepted` confirms an ACH debit
		 * on an authorization the donor gave to a different attempt.
		 */
		beginAttempt: assign({
			quote: null,
			reconciliation: null,
			mandateAccepted: false,
			verificationDeadline: null,
			failure: null
		}),

		/**
		 * the held challenge report, said at last, and taken off the context in the same breath.
		 *
		 * cleared on delivery because a report is something that happened rather than a state of the
		 * form: left standing it would take every later step straight back to `failed`, which is a
		 * card the donor can never get off.
		 */
		deliverChallenge: assign({
			failure: ({ context }) => context.heldChallenge,
			heldChallenge: null
		}),

		/** the one place a donor draft becomes the payer an intent is minted for. */
		commitPayer: assign({
			payer: ({ context }) => completePayer(context.payerDraft, context.config)
		}),

		/**
		 * takes the server's numbers and measures them against the figure the donor was shown, in
		 * the same breath.
		 *
		 * one action, not two, because storing the quote without reconciling it is the exact
		 * moment a silent overwrite becomes possible — the screen would read the new total off
		 * `quote` and nobody would ever notice the old one was different.
		 *
		 * a flow with no shown figure is a flow with no decided gift, which nothing routes to
		 * `quoting` from. measuring the total against itself there is what keeps that unreachable
		 * case from manufacturing a correction screen over a figure nobody ever saw — and it is not
		 * a `?? 0`, which would state a difference the size of the whole gift.
		 */
		acceptQuote: assign(({ context }, params: { quote: Quote }) => ({
			quote: params.quote,
			reconciliation: reconcile(
				context.estimate,
				params.quote,
				shownTotalMinor(context) ?? params.quote.totalMinor
			)
		})),

		/**
		 * writes down when the verification window closes.
		 *
		 * falls back to `now + MICRODEPOSIT_WINDOW_MS` when the outcome carries no usable deadline,
		 * which covers an absent one and one that is not a Unix millisecond timestamp. A state with
		 * no deadline is a state the expiry branch can never leave, and a deadline that is slightly
		 * too generous is corrected by the next resume — so the fallback errs in the direction that
		 * keeps the donor's gift alive.
		 */
		rememberVerificationDeadline: assign({
			verificationDeadline: ({ context }, params: { outcome: ConfirmOutcome }) => {
				const fallback = context.ports.now() + MICRODEPOSIT_WINDOW_MS;
				if (params.outcome.kind !== 'awaiting_microdeposits') return fallback;
				const stated = params.outcome.expiresAt;
				if (stated === undefined || !Number.isFinite(stated)) return fallback;
				return stated < EARLIEST_PLAUSIBLE_DEADLINE_MS ? fallback : stated;
			}
		}),

		/**
		 * carries the rail's own words through, rather than flattening them to a shrug, and marks
		 * them as the rail's.
		 *
		 * the only site that sets `refusedByRail`, which is what lets a screen tell a refused card
		 * from every other way this flow stops. the other arm is an outcome routed to `failed` that
		 * no rail refused, so it is left unmarked.
		 */
		rememberDecline: assign({
			failure: (_, params: { outcome: ConfirmOutcome }): Failure =>
				params.outcome.kind === 'declined'
					? { message: params.outcome.message, refusedByRail: true }
					: { message: GENERIC_FAILURE }
		})
	},
	delays: {
		/**
		 * what is left of the microdeposit window, floored at zero and capped at the window.
		 *
		 * both ends are clamped and both matter. a machine resumed on day twelve computes a
		 * negative remainder, and flooring it makes the expiry fire on the next tick rather than
		 * never. A deadline further out than the window — a rail reporting one, or an adapter
		 * whose units are wrong in the other direction — would overflow `setTimeout`'s 32-bit
		 * delay and fire almost immediately, expiring a gift whose microdeposits are still in the
		 * post. One delayed transition covers the page left open, the donor who came back too
		 * late, and the deadline that cannot be believed.
		 */
		verificationWindow: ({ context }) =>
			Math.min(
				MICRODEPOSIT_WINDOW_MS,
				Math.max(0, (context.verificationDeadline ?? 0) - context.ports.now())
			),

		/** the ceiling on a port the machine is allowed to give up on. */
		portTimeout: PORT_TIMEOUT_MS
	}
}).createMachine({
	id: 'checkout',
	context: ({ input }) => ({
		config: input.config,
		ports: input.ports,
		resumeToken: input.resume?.paymentToken ?? null,
		draft: settledDraft(input.config),
		fv: null,
		payerDraft: {},
		payer: null,
		estimate: null,
		quote: null,
		reconciliation: null,
		mandateAccepted: false,
		turnstileToken: null,
		verificationDeadline: null,
		failure: null,
		heldChallenge: null
	}),
	// three reports from surfaces that resolve on their own schedule. none of them is a step in the
	// flow and none moves it from here, so all three are accepted wherever the machine happens to be.
	on: {
		SET_TURNSTILE_TOKEN: {
			actions: assign({ turnstileToken: ({ event }) => event.token })
		},
		/**
		 * the anti-abuse challenge reporting that it will never mint a token.
		 *
		 * taken here rather than refused, and it moves nothing from here: a state that can answer it
		 * takes it off `heldChallenge` on arrival, which is the `always` on the three editable steps
		 * below. that is what makes this both accepted everywhere and safe everywhere — the two
		 * states a charge is in flight in have no answer to give, and reaching `failed` from either
		 * would abandon a gift the donor's money may already be on.
		 *
		 * a step that can answer it answers it in the same breath as this: an event handled here
		 * settles into a state whose eventless transitions are then taken, so a report arriving on
		 * `give` is on the failure screen before anything renders. `CheckoutContext.heldChallenge`
		 * above is the whole of why the report is held rather than dropped.
		 *
		 * a second report replaces the first. the fix each carries names what an operator changes
		 * (`createChallenge` in ./embed/turnstile.ts writes them), and the later reading is the
		 * better one.
		 */
		CHALLENGE_UNAVAILABLE: {
			actions: assign({ heldChallenge: ({ event }) => event.failure })
		},
		/**
		 * the rail, as the payment provider's own fields report it.
		 *
		 * not a control this form draws: the provider's picker is the one on screen, and
		 * `createPaymentSurface` in ./embed/stripe.ts turns each of its `change` events into one of
		 * these. that is why it is here rather than on `give` — those fields are mounted for the
		 * life of the card and may report before a donor has reached the payment step, and an
		 * event dropped there is a rail the flow would never hear about again.
		 *
		 * `null` is a real answer and never a rail: a collapsed picker, an empty payload and a
		 * selection this form does not take all arrive as one. it clears the draft, which is what
		 * has `completePayer` in ./value.ts refuse a submit — a gift charged on a rail the donor is
		 * not on is what this answer exists to stop. the stated figure goes back to `displayRail`'s
		 * above rather than blank, which is where every donor found the row before they touched the
		 * picker, and that default is display alone: nothing is reconciled against it.
		 */
		SET_METHOD: {
			actions: [
				assign({
					payerDraft: ({ context, event }) => ({
						...context.payerDraft,
						method: event.method ?? undefined
					})
				}),
				'refreshEstimate'
			]
		}
	},
	initial: 'boot',
	states: {
		/**
		 * one eager fork, and it is the only reason this state exists.
		 *
		 * XState's `initial` cannot be computed, and a donor returning from their bank must not
		 * land on the amount screen for even one frame — that frame is a flash of an empty
		 * donation form to somebody who has already paid, on the org's own page. An `always`
		 * transition is taken before the actor's first snapshot is ever read, so nothing
		 * observes `boot` and nothing renders it.
		 */
		boot: {
			always: [{ guard: 'isResuming', target: 'resuming' }, { target: 'amount' }]
		},

		/**
		 * step 1 — how much, how often, and anything the donor wants to say about it.
		 */
		amount: {
			// a challenge report that has been waiting for a state that can answer it — see the root
			// `on` above. the widget is drawn on the details step and outlives a Back press, so this
			// step is one of the three that answers.
			always: { guard: 'challengeIsHeld', target: 'failed', actions: 'deliverChallenge' },
			on: {
				SET_AMOUNT: {
					actions: assign({
						draft: ({ context, event }) => ({ ...context.draft, amountMinor: event.amountMinor })
					})
				},
				/**
				 * the donor emptying the free entry, which puts the draft back where it started.
				 *
				 * an amount is decided on this step and nowhere else, so this is answerable here and
				 * nowhere else: past `CONTINUE` there is an `fv` a quote may already have been minted
				 * against, and a draft edited behind it would state a gift no figure on the card is
				 * for. it is dropped there the way any event in a state that does not handle it is.
				 */
				CLEAR_AMOUNT: {
					actions: assign({
						draft: ({ context }) => ({ ...context.draft, amountMinor: undefined })
					})
				},
				SET_FREQUENCY: {
					actions: assign({
						draft: ({ context, event }) => ({ ...context.draft, frequency: event.frequency })
					})
				},
				SET_NOTE: {
					actions: assign({
						draft: ({ context, event }) => ({ ...context.draft, note: event.note })
					})
				},
				/**
				 * the cause the gift is credited to, chosen on the step the gift itself is decided on.
				 *
				 * `null` is written as an absent id rather than kept, so the draft holds the donor's
				 * answer in the one shape `completeAmount` (./value.ts) reads — where it is needed
				 * most. there is no disclosure to leave open here and nothing to fabricate: a form
				 * offering no choice draws no control, so nothing on such a card sends this.
				 */
				SET_PROGRAM: {
					actions: assign({
						draft: ({ context, event }) => ({
							...context.draft,
							programId: event.programId ?? undefined
						})
					})
				},
				/**
				 * the donor opening the note, or closing it again.
				 *
				 * an opened note is `''` and a closed one is absent, which is the distinction
				 * `missingAmountDecisions` (./value.ts) reads to hold a donor to a note they asked
				 * for. closing it drops what was typed: the donor has said there is no note, and a
				 * draft that kept the text would carry it to the endpoint on a gift whose card no
				 * longer shows it.
				 */
				TOGGLE_NOTE: {
					actions: assign({
						draft: ({ context }) => ({
							...context.draft,
							note: context.draft.note === undefined ? '' : undefined
						})
					})
				},
				/**
				 * a box in the tribute block, merged into whatever the disclosure is holding.
				 *
				 * a closed disclosure is left alone rather than opened: the presence of `tribute` is
				 * the donor's ask, and an event that could create one would make the ask something a
				 * keystroke performs.
				 */
				SET_TRIBUTE: {
					actions: assign({
						draft: ({ context, event }) => {
							const { tribute } = context.draft;
							if (tribute === undefined) return context.draft;
							return {
								...context.draft,
								tribute: {
									kind: event.kind ?? tribute.kind,
									honoree: event.honoree ?? tribute.honoree,
									notifyName: event.notifyName ?? tribute.notifyName,
									notifyEmail: event.notifyEmail ?? tribute.notifyEmail
								}
							};
						}
					})
				},
				/**
				 * the donor opening the tribute, or closing it again.
				 *
				 * `TOGGLE_NOTE` above with one difference: an opened note is `''` and an opened
				 * tribute is four boxes, one of them already carrying the kind its control draws.
				 * closing drops all four for the note's reason — the donor has said this gift carries
				 * no tribute, and a draft that kept the name would send a `tributeKind` on a gift
				 * whose card no longer shows one.
				 */
				TOGGLE_TRIBUTE: {
					actions: assign({
						draft: ({ context }) => ({
							...context.draft,
							tribute: context.draft.tribute === undefined ? OPENED_TRIBUTE : undefined
						})
					})
				},
				// an undecided amount stays on this step: the guard is what stops a press from
				// carrying a draft no `fv` could be made of into the step that mints an intent.
				CONTINUE: { guard: 'amountIsDecided', target: 'details', actions: 'commitAmount' },
				/**
				 * the marks, and from the first step every move they offer is forwards.
				 *
				 * both branches commit the amount, for the reason `CONTINUE` above does: `fv` is what
				 * every state past this one is allowed to assume, and a jump that left it behind would
				 * put a donor on the review step over a gift the flow never decided. the guard is the
				 * same one, reached through `stepIsReachable` — a mark cannot carry a draft past a
				 * press that would have been refused.
				 */
				GO_TO_STEP: [
					{
						guard: { type: 'stepIsReachable', params: { from: 'amount', to: 'give' } },
						target: 'give',
						actions: 'commitAmount'
					},
					{
						guard: { type: 'stepIsReachable', params: { from: 'amount', to: 'details' } },
						target: 'details',
						actions: 'commitAmount'
					}
				],
				/**
				 * the payment surface reporting that it never came up.
				 *
				 * a report from a surface that resolves on its own schedule, and the one that moves the
				 * flow from where it lands — which is why it is here and on the two steps after it
				 * rather than at the root with the other two. Those three states are the whole of where
				 * it is answerable: nothing has been authorized on any of them, so "the fields never
				 * appeared" is the entire truth about the gift. Past a press there is an intent at the
				 * processor and possibly
				 * a charge against it, and this event says nothing whatever about what happened to
				 * that money — so it is dropped there, the way any event in a state that does not
				 * handle it is.
				 *
				 * it lands in `failed` rather than in a state of its own because there is nothing new
				 * to say: a donor is told what went wrong and offered a Retry, which is what `failed`
				 * already is. What the Retry finds is the same dead surface, and that is honest — the
				 * card is rebuilt only by a re-boot of the element, which a reload is.
				 */
				PAYMENT_UNAVAILABLE: {
					target: 'failed',
					actions: assign({ failure: ({ event }) => event.failure })
				}
			}
		},

		/**
		 * step 2 — the fields the receipt needs.
		 *
		 * no fee, no total and no rail on this step. the payment provider's own fields are on the
		 * step after it, and a figure stated twice a screen apart is a figure a donor has to
		 * reconcile for themselves.
		 */
		details: {
			// arriving here is starting an attempt, whichever way the donor arrived: `beginAttempt`
			// drops what the last one decided and the estimate is restated from what is left.
			entry: ['beginAttempt', 'refreshEstimate'],
			// after the entry above rather than before it, which is what keeps the delivered failure:
			// `beginAttempt` clears `failure`, and this is the step the widget is drawn on.
			always: { guard: 'challengeIsHeld', target: 'failed', actions: 'deliverChallenge' },
			on: {
				SET_CONTACT: {
					actions: assign({
						payerDraft: ({ context, event }) => ({
							...context.payerDraft,
							...(event.email !== undefined ? { email: event.email } : {}),
							...(event.firstName !== undefined ? { firstName: event.firstName } : {}),
							...(event.lastName !== undefined ? { lastName: event.lastName } : {})
						})
					})
				},
				SET_CONSENT: {
					actions: assign({
						payerDraft: ({ context, event }) => ({
							...context.payerDraft,
							consentedToContact: event.consented
						})
					})
				},
				// a press with a field still missing stays on this step, the way the amount step's
				// own does: the guard is what stops a donor reaching the screen that spends the money
				// with no address for the receipt it produces.
				CONTINUE: { guard: 'payerFieldsAreGiven', target: 'give' },
				/**
				 * the marks: the amount step behind, the review step ahead.
				 *
				 * `BACK` is not handled here. the way back off a numbered step is a mark, and the
				 * correction screen is the one surface that sends the other event.
				 *
				 * the backwards branch is unguarded and the forwards one asks what this step's own
				 * Continue asks, so the pair is the same gate a donor met walking here.
				 */
				GO_TO_STEP: [
					{
						guard: { type: 'stepIsReachable', params: { from: 'details', to: 'amount' } },
						target: 'amount'
					},
					{
						guard: { type: 'stepIsReachable', params: { from: 'details', to: 'give' } },
						target: 'give'
					}
				],
				PAYMENT_UNAVAILABLE: {
					target: 'failed',
					actions: assign({ failure: ({ event }) => event.failure })
				}
			}
		},

		/**
		 * step 3 — the receipt, the provider's own fields, and the press that spends the money.
		 *
		 * the last step a donor edits anything on, and the only one that states a total. the fee
		 * decision lives here rather than on the step before it because the control that offers it
		 * sits inside the receipt, and the receipt is here.
		 */
		give: {
			// entered from the step before it and from every way back into the pair, so the attempt
			// is begun here too — see `beginAttempt`, which is idempotent for exactly this.
			entry: ['beginAttempt', 'refreshEstimate'],
			// the step a Try again usually lands on, which makes it the usual place a report held
			// through a charge is delivered — see the `amount` step's own.
			always: { guard: 'challengeIsHeld', target: 'failed', actions: 'deliverChallenge' },
			on: {
				// handled on this step alone, which is where the control that sends it lives. a donor
				// who has pressed past the receipt has authorized a figure, and a fee changed behind
				// that press is a charge they never saw.
				TOGGLE_FEE_COVERAGE: {
					actions: [
						assign({
							payerDraft: ({ context }) => ({
								...context.payerDraft,
								coversFee: !payerCoversFee(context.payerDraft)
							})
						}),
						'refreshEstimate'
					]
				},
				// `payerIsComplete` refuses a rail this form may not charge — see `completePayer` in
				// ./value.ts. the typed fields it also asks for were settled on the step before, so
				// the only thing this press can be refused for here is the rail.
				SUBMIT: { guard: 'payerIsComplete', target: 'quoting', actions: 'commitPayer' },
				/**
				 * the marks, and from the last step every move they offer is backwards and so
				 * unconditional.
				 *
				 * the jump to the amount step skips the details step's entry, which is where
				 * `beginAttempt` runs. that costs nothing: the amount step has no entry of its own, so
				 * arriving there a step at a time drops no more than this does, and every way forward
				 * out of it re-enters a step that does run it — nothing a spent attempt left behind
				 * can reach a confirmation without being dropped on the way.
				 */
				GO_TO_STEP: [
					{
						guard: { type: 'stepIsReachable', params: { from: 'give', to: 'amount' } },
						target: 'amount'
					},
					{
						guard: { type: 'stepIsReachable', params: { from: 'give', to: 'details' } },
						target: 'details'
					}
				],
				PAYMENT_UNAVAILABLE: {
					target: 'failed',
					actions: assign({ failure: ({ event }) => event.failure })
				}
			}
		},

		/**
		 * the first beat of the press: the server mints the intent and names the real fee.
		 *
		 * there is no `SUBMIT` handler here, and that absence is what drops a second press: it
		 * lands in a state that does not handle the event, with no flag to check and no attribute
		 * to bypass. It bounds the double press, not the determined caller — see the header.
		 */
		quoting: {
			invoke: {
				src: 'mintQuote',
				input: ({ context }) => {
					if (context.payer === null) throw new Error('unreachable: guarded by payerIsComplete');
					return { ports: context.ports, request: quoteRequest(context, context.payer) };
				},
				onDone: [
					{
						guard: { type: 'quoteIsUsable', params: ({ event }) => ({ quote: event.output }) },
						target: 'quoted',
						actions: { type: 'acceptQuote', params: ({ event }) => ({ quote: event.output }) }
					},
					{
						target: 'failed',
						actions: assign({
							failure: (): Failure => ({
								message: GENERIC_FAILURE,
								fix: 'POST /api/v1/forms/:id/donations answered with a fee, total or payment token that cannot be charged. Check that feeMinor and totalMinor are whole minor units and that totalMinor is at least amountMinor.'
							})
						})
					}
				],
				onError: {
					target: 'failed',
					actions: assign({ failure: ({ event }) => toFailure(event.error) })
				}
			},
			after: {
				portTimeout: {
					target: 'failed',
					actions: assign({
						failure: (): Failure => ({
							message: GENERIC_FAILURE,
							fix: `POST /api/v1/forms/:id/donations did not answer within ${PORT_TIMEOUT_MS}ms. Nothing was authorized, so this attempt can be made again.`
						})
					})
				}
			}
		},

		/**
		 * the junction between the two beats of the press, and the whole of what decides whether a
		 * donor sees a fourth screen.
		 *
		 * transient, so nothing observes it and nothing renders it — the same treatment `boot` gets
		 * above, and for the same reason: a screen for "the quote landed" is a flicker between the
		 * press and the charge.
		 *
		 * the correction arm is first and the mandate arm is second, and that order is the rule.
		 * a total that moved has to be said before an authorization is collected, or the donor
		 * authorizes a debit for a figure they were never shown; and a rail that wants an
		 * authorization must never reach confirmation without one, which is what puts the mandate
		 * ahead of the fall-through rather than beside it.
		 */
		quoted: {
			always: [
				{ guard: 'quoteWasAdjusted', target: 'confirm' },
				{ guard: 'quoteRequiresMandate', target: 'mandate' },
				{ target: 'confirming' }
			]
		},

		/**
		 * the correction screen: authority is charging a figure the donor was not shown.
		 *
		 * a state rather than a silently different number in the same receipt. the donor has
		 * already pressed the button that spends the money, so the only honest thing left is to
		 * stop, name both figures and ask again — which is why this screen's own control carries a
		 * different verb from the one that reached it.
		 *
		 * it is not on the ordinary path. a quote that matches goes straight to the mandate or to
		 * the charge, and `quoteWasAdjusted` above is the whole of what routes here.
		 */
		confirm: {
			on: {
				// the mandate arm first, for the reason the junction above states.
				CONFIRM: [{ guard: 'quoteRequiresMandate', target: 'mandate' }, { target: 'confirming' }],
				// backing out abandons the intent this screen was about: the review step's entry
				// drops it, so the next press is an attempt of its own rather than a confirmation of
				// this one under details the donor may have changed in between.
				BACK: { target: 'give' }
			}
		},

		/**
		 * the donor accepts the provider's own wording authorizing a debit from their bank account.
		 *
		 * the provider's wording, never ours — the text is a legal instrument and writing one
		 * on the org's behalf is not something this project does. Declining returns to the form
		 * rather than failing: refusing to authorize a debit is a change of rail, not an error.
		 */
		mandate: {
			on: {
				ACCEPT_MANDATE: {
					target: 'confirming',
					actions: assign({ mandateAccepted: () => true })
				},
				DECLINE_MANDATE: { target: 'give' }
			}
		},

		/**
		 * money is moving, and the outcome decides where the donor lands.
		 *
		 * no timeout, deliberately. Every other invoke in this machine may be given up on; this
		 * one may not, because giving up says nothing about whether the charge landed. A
		 * confirmation with no answer is `indeterminate`, which re-reads the intent — and both
		 * the rejected promise and the outcome kind end up there for the same reason.
		 */
		confirming: {
			invoke: {
				src: 'confirmPayment',
				input: ({ context }) => {
					if (context.quote === null || context.payer === null) {
						throw new Error('unreachable: confirmation is only reached past a quote');
					}
					return {
						ports: context.ports,
						input: {
							paymentToken: context.quote.paymentToken,
							method: context.payer.method,
							mandateAccepted: context.mandateAccepted
						}
					};
				},
				onDone: [
					{ guard: { type: 'outcomeGoesTo', params: { route: 'success' } }, target: 'success' },
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'processing' } },
						target: 'processing'
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'redirecting' } },
						target: 'redirecting'
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'awaitingVerification' } },
						target: 'awaitingVerification',
						actions: {
							type: 'rememberVerificationDeadline',
							params: ({ event }) => ({ outcome: event.output })
						}
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'verificationExpired' } },
						target: 'verificationExpired'
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'failed' } },
						target: 'failed',
						actions: { type: 'rememberDecline', params: ({ event }) => ({ outcome: event.output }) }
					},
					/**
					 * the donor had not finished the provider's own fields, so nothing was attempted.
					 *
					 * the one answer to a confirmation that is not an ending, and it lands back on the step
					 * the press was made on — the same treatment `DECLINE_MANDATE` gets from `mandate`
					 * below, for the same reason: refusing to take an unfinished form is not an error, it
					 * is the form still being filled in. no `failure` is carried and none may be, because
					 * the fields say which of them is unfinished in the provider's own frame and a second
					 * sentence on the card around them is one the donor has to reconcile against the first.
					 *
					 * the step's own entry drops the quote this press minted, exactly as every other way
					 * back into it does. so the next press is an attempt of its own against a fresh intent
					 * rather than a re-confirmation of one the donor never authorized.
					 */
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'unfinished' } },
						target: 'give'
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'indeterminate' } },
						target: 'indeterminate'
					},
					// an outcome that is not one of ours at all. nobody can say whether that charge
					// landed, so it is read as the ambiguity it is rather than as a refusal.
					{
						target: 'indeterminate.unresolved',
						actions: assign({ failure: (): Failure => ({ message: GENERIC_FAILURE }) })
					}
				],
				onError: {
					// a rejected confirmation is not a decline. The request may have been received and
					// the charge may have completed; routing it to `failed` would offer a Retry that
					// mints a second intent against a live one.
					target: 'indeterminate',
					actions: assign({ failure: ({ event }) => toFailure(event.error) })
				}
			}
		},

		/**
		 * a cold page load that has to find out what happened while nobody was watching.
		 *
		 * the 3DS return, and it is a state rather than an accident. The donor left for their
		 * bank and came back to the org's page, cross-origin, in a brand-new JavaScript context
		 * that remembers nothing. Booting into `amount` would show an empty form to someone who
		 * has already paid — so the payment token in the URL routes here instead, and the port
		 * answers what the intent became.
		 *
		 * also the ACH re-entry. Settlement takes 4–5 business days and the donor is long gone,
		 * so the machine learns that outcome the same way: on a later visit, not from a timer.
		 *
		 * a read that fails lands in `indeterminate`, never in `failed`. This state exists for the
		 * donor who has already paid; telling them the gift failed is the one answer that is
		 * certainly wrong, and the Retry it would offer mints a second intent.
		 */
		resuming: {
			invoke: {
				src: 'resumeIntent',
				input: ({ context }) => {
					if (context.resumeToken === null) throw new Error('unreachable: guarded by isResuming');
					return { ports: context.ports, paymentToken: context.resumeToken };
				},
				onDone: [
					{ guard: { type: 'outcomeGoesTo', params: { route: 'success' } }, target: 'success' },
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'processing' } },
						target: 'processing'
					},
					// the donor is mid-3DS on a page that is about to be replaced again.
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'redirecting' } },
						target: 'redirecting'
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'awaitingVerification' } },
						target: 'awaitingVerification',
						actions: {
							type: 'rememberVerificationDeadline',
							params: ({ event }) => ({ outcome: event.output })
						}
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'verificationExpired' } },
						target: 'verificationExpired'
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'failed' } },
						target: 'failed',
						actions: { type: 'rememberDecline', params: ({ event }) => ({ outcome: event.output }) }
					},
					{
						guard: { type: 'outcomeGoesTo', params: { route: 'indeterminate' } },
						target: 'indeterminate.unresolved'
					},
					{
						target: 'indeterminate.unresolved',
						actions: assign({ failure: (): Failure => ({ message: GENERIC_FAILURE }) })
					}
				],
				onError: {
					target: 'indeterminate.unresolved',
					actions: assign({ failure: ({ event }) => toFailure(event.error) })
				}
			},
			after: {
				portTimeout: {
					target: 'indeterminate.unresolved',
					actions: assign({
						failure: (): Failure => ({
							message: GENERIC_FAILURE,
							fix: `The resume read did not answer within ${PORT_TIMEOUT_MS}ms. The intent named by the payment token in the URL was never read, so its state is still unknown.`
						})
					})
				}
			}
		},

		/**
		 * a confirmation was sent and nobody can say what became of it.
		 *
		 * the state that stops a second charge, and the reason `failed` is reachable only from a
		 * rail that actually refused. A dropped response, a rejected promise or an
		 * `indeterminate` outcome leaves an intent that may have succeeded; `failed` is one Retry
		 * away from `give`, and that press mints a second intent against it. So this state holds
		 * the payment token and re-reads it, and there is no transition from here back to the form.
		 *
		 * exactly one read, and then nothing. the read usually answers with a real ending; where it
		 * does not, `unresolved` is where the flow stops.
		 */
		indeterminate: {
			initial: 'reading',
			states: {
				reading: {
					invoke: {
						src: 'resumeIntent',
						input: ({ context }) => {
							// whichever token names the intent in question: the one this attempt minted,
							// or the one the URL carried into a resume that could not be read.
							const paymentToken = context.quote?.paymentToken ?? context.resumeToken;
							if (paymentToken === null) {
								throw new Error('unreachable: the flow is only indeterminate past a payment token');
							}
							return { ports: context.ports, paymentToken };
						},
						onDone: [
							{
								guard: { type: 'outcomeGoesTo', params: { route: 'success' } },
								target: '#checkout.success'
							},
							{
								guard: { type: 'outcomeGoesTo', params: { route: 'processing' } },
								target: '#checkout.processing'
							},
							{
								guard: { type: 'outcomeGoesTo', params: { route: 'redirecting' } },
								target: '#checkout.redirecting'
							},
							{
								guard: { type: 'outcomeGoesTo', params: { route: 'awaitingVerification' } },
								target: '#checkout.awaitingVerification',
								actions: {
									type: 'rememberVerificationDeadline',
									params: ({ event }) => ({ outcome: event.output })
								}
							},
							{
								guard: { type: 'outcomeGoesTo', params: { route: 'verificationExpired' } },
								target: '#checkout.verificationExpired'
							},
							{
								// the read is authoritative where the confirmation was not: a rail that
								// says the intent was refused has answered the question this state asks.
								guard: { type: 'outcomeGoesTo', params: { route: 'failed' } },
								target: '#checkout.failed',
								actions: {
									type: 'rememberDecline',
									params: ({ event }) => ({ outcome: event.output })
								}
							},
							{ target: 'unresolved' }
						],
						onError: {
							target: 'unresolved',
							actions: assign({ failure: ({ event }) => toFailure(event.error) })
						}
					},
					after: {
						portTimeout: {
							target: 'unresolved',
							actions: assign({
								failure: (): Failure => ({
									message: GENERIC_FAILURE,
									fix: `The resume read did not answer within ${PORT_TIMEOUT_MS}ms. The intent's state is still unknown and must not be assumed either way.`
								})
							})
						}
					}
				},
				/**
				 * the read did not settle it either, and the flow stops here.
				 *
				 * no event leaves this state. what became of the intent is settled server-side: the
				 * Stripe webhook at `src/routes/api.stripe.webhook.ts` posts the gift and
				 * sends the donor's receipt on `succeeded`, through
				 * `src/lib/server/donations/settle.ts`. so the donor is told the answer is coming by
				 * email rather than left holding a control that asks a question already being
				 * answered elsewhere.
				 */
				unresolved: {}
			}
		},

		/**
		 * the donor's bank is deciding, and the page they are on is about to stop existing.
		 *
		 * nothing is observed from here. There are no transitions because there is no browser
		 * left to take one — the next thing that happens is a fresh page load with a payment
		 * token in its URL, which is `resuming`.
		 */
		redirecting: {},

		/**
		 * money is in flight and the donor is free to go.
		 *
		 * not `success`, and the distinction is the receipt. An ACH debit takes 4–5 business
		 * days and can still fail; telling the donor "thank you, it's done" now is a claim the
		 * webhook has not made yet. a verified delivery is what puts the gift in the books and
		 * sends the receipt (`src/routes/api.stripe.webhook.ts` →
		 * `src/lib/server/donations/settle.ts`), and this state is the client saying so.
		 */
		processing: {},

		/**
		 * microdeposits are on their way and the donor must go and find them.
		 *
		 * the ten-day window is a transition, not a wait. The verification expires after ten days
		 * and the PaymentIntent reverts to requiring payment details, so the machine has
		 * somewhere to be when that happens — and the delay is computed from the deadline rather
		 * than being a fixed ten days, which is what makes it work on the case that actually
		 * occurs: a donor returning on day twelve gets a delay of zero and lands in
		 * `verificationExpired` immediately, without anything having waited.
		 */
		awaitingVerification: {
			after: {
				verificationWindow: { target: 'verificationExpired' }
			}
		},

		/**
		 * the window closed and the rail now wants payment details again.
		 *
		 * `RETRY` goes to the review step, which is where the spent quote is dropped: the intent it
		 * names has reverted, so carrying it forward would mean confirming an intent that cannot be
		 * confirmed, on a screen that just told the donor to try again. it needs no routing of its
		 * own — this state is only ever reached past a confirmation, so everything the earlier steps
		 * ask for was answered before the donor got here.
		 */
		verificationExpired: {
			on: {
				RETRY: { target: 'give' }
			}
		},

		/**
		 * the gift is made.
		 *
		 * terminal without being `final`. a root `final` state stops the actor, and a stopped
		 * actor logs a warning for every event a still-mounted projection sends afterwards — on
		 * the org's own page console, on somebody else's website. There is no transition out of
		 * here, which is what "terminal" is supposed to mean.
		 */
		success: {},

		/**
		 * the rail refused, and the donor may try again with different details.
		 *
		 * only a refusal reaches here. a confirmation that went unanswered is `indeterminate`,
		 * because this state offers a Retry and that press is a new attempt against an intent
		 * that may still be alive.
		 *
		 * `RETRY` never goes to `quoting`. The quote it held names an intent that is spent;
		 * re-confirming it would either fail or, worse, succeed against details the donor has since
		 * changed. the step it does go to is the earliest one whose decisions are still incomplete,
		 * because this state is reachable from every step there is: a payment surface or a challenge
		 * that reports it will never come up does so from the amount step as readily as from the
		 * review step, and landing that donor on the screen that spends the money would put them in
		 * front of a Donate button over a gift they had not chosen yet. the entry of whichever step
		 * is targeted is what clears the spent quote.
		 */
		failed: {
			on: {
				RETRY: [
					{ guard: not('amountIsDecided'), target: 'amount' },
					{ guard: not('payerFieldsAreGiven'), target: 'details' },
					{ target: 'give' }
				]
			}
		}
	}
});
