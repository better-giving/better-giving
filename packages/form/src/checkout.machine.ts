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
// a donor-advised fund's rail is `give ─► authorizing ─► quoting ─► processing`, the other way
// round the press: its window authorizes first, the approval rides on the quote, and the server
// creates the grant inside that request, so a usable answer is the gift made and nothing is
// confirmed after it. closing the window unapproved goes back to `give`.
//
// a gift in kind is picked on the first step (`SET_UNIT`) and has no payment method to choose. a coin
// gift's rail is `details ─► give ─► holding ─► quoting ─► awaitingDeposit`: its review step is the
// receipt and the fee switch with no method rows, the quote mints an address for the estimate the coin
// amount was priced at and any fee covered on it, the donor sends the coin from their own wallet, and
// the gift is read until it arrives (`success`) or the address closes empty (`depositExpired`). a
// refusal of its amount or its coin lands back on the first step, which fixes it, rather than on
// `failed`. a stock gift has no review step: its rail is `details ─► holding ─► quoting ─► pledged`.
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

import {
	and,
	assign,
	enqueueActions,
	fromCallback,
	fromPromise,
	not,
	setup,
	type Actor,
	type ActorRefFrom
} from 'xstate';
import {
	depositIsUsable,
	estimateDeductedFee,
	estimateFee,
	quoteIsUsable,
	reconcile,
	type DeductedFee,
	type FeeEstimate,
	type Reconciliation
} from './fee';
import type {
	CheckoutPorts,
	ConfirmInput,
	ConfirmOutcome,
	FundAuthorization,
	FundRequest
} from './ports';
import {
	canonicalDecimal,
	completeAmount,
	completeFundPayer,
	completePayer,
	isWithinBounds,
	missingAmountDecisions,
	missingPayerFields,
	payerCoversFee,
	OPENED_TRIBUTE,
	isInKind,
	type AmountDecision,
	type AmountDraft,
	type FormValue,
	type GiftUnit,
	type Payer,
	type PayerDraft
} from './value';
import { employerAnswer, giftToken } from './employer';
import { isChariotRail, isPledgeRail } from './embed/rails';
import { pledgeIsUsable } from './pledge';
import {
	DONATION_STATES,
	FREQUENCIES,
	PAYMENT_METHODS,
	type DonationStatus,
	type FeeRule,
	type FormConfig,
	type PaymentMethod,
	type Quote,
	type QuoteRequest,
	type StockPledgeRequest,
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
	/** where the card starts when the page hosting it asks: `openingDraft` below reads it. */
	readonly opening?: { readonly monthly?: boolean; readonly dedication?: boolean };
	/**
	 * the program the hosting program page was drawn for, sent on every quote as `pageProgramId`
	 * (./v1.ts). the page's, not the donor's: it is no draft value and no event changes it.
	 */
	readonly pageProgramId?: string;
};

/**
 * the amount draft a fresh flow starts on where the page asks for nothing (`openingDraft` below):
 * a cadence already chosen, and nothing else.
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
 * the draft a flow starts on: `settledDraft`, with the page's `opening` laid over it.
 *
 * monthly is taken only where the form offers it, because a cadence the deployment cannot charge is
 * never offered (CLAUDE.md, repeating gifts) — so the flag is dropped rather than seeding a chip the
 * card does not draw. the dedication opens exactly as `TOGGLE_TRIBUTE` opens it, on
 * `OPENED_TRIBUTE` with nothing typed. either is a starting point the donor changes with the same
 * events as ever, and nothing past this step can tell it from their own choice.
 *
 * a resumed flow takes it the same as a fresh one: the page load a bank returns to remembers
 * neither the donor's choice nor the page's, so a declined return that hands them the card again
 * starts where the page opens. what the resume itself carries sits beside the draft, not in it —
 * the payment token, and the step and failure `resuming` reads back from it — so the opening
 * overrides none of it.
 */
function openingDraft(input: CheckoutInput): AmountDraft {
	const settled = settledDraft(input.config);
	const { opening } = input;
	const monthly = opening?.monthly === true && input.config.frequencies.includes('monthly');
	return {
		...settled,
		...(monthly ? { frequency: 'monthly' } : {}),
		...(opening?.dedication === true ? { tribute: OPENED_TRIBUTE } : {})
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
 *
 * `refusedStock` marks a stock save refused for the ticker or the shares, which the same press sent
 * again is refused for again: Try again goes back to the first step, where both are picked.
 */
export type Failure = {
	readonly message: string;
	readonly fix?: string;
	readonly refusedByRail?: true;
	readonly refusedStock?: true;
};

/**
 * the processor refusing the coin or the amount a `crypto` quote asked for, as the step that can fix
 * it states it.
 *
 * `coin` is the one the refused request named, which may no longer be the one picked by the time a
 * screen reads this. `minAmountMinor` is the floor a `below_minimum` refusal named, in the minor units
 * of the gift and with any covered fee left out (`ApiError` in ./v1.ts), and absent where it named
 * none.
 */
export type CoinRefusal =
	| {
			readonly code: 'below_minimum';
			readonly coin: string;
			readonly minAmountMinor?: number;
	  }
	| { readonly code: 'above_maximum' | 'coin_not_accepted'; readonly coin: string };

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
	readonly pageProgramId: string | null;
	readonly draft: AmountDraft;
	readonly fv: FormValue | null;
	readonly payerDraft: PayerDraft;
	readonly payer: Payer | null;
	readonly estimate: FeeEstimate | null;
	readonly quote: Quote | null;
	readonly reconciliation: Reconciliation | null;
	readonly mandateAccepted: boolean;
	readonly turnstileToken: string | null;
	/**
	 * whether the challenge is asking the visitor to solve something, from its widget entering
	 * interactive mode until it leaves it or mints a token. a press held on it waits as long as
	 * that lasts (`holding`).
	 */
	readonly challengeInteractive: boolean;
	readonly verificationDeadline: number | null;
	readonly failure: Failure | null;
	/**
	 * what a donor-advised fund's own window approved, held from its close to the grant it creates.
	 *
	 * the one rail authorized before it is quoted rather than after, so it is carried into the
	 * request rather than confirmed behind it. a send worth repeating keeps it (`keepsFundApproval`),
	 * and a Try again sends it again (`resending`); every other answer spends it, and so does every
	 * way back onto an editable step (`beginAttempt`), where the next press opens the window again.
	 */
	readonly authorization: FundAuthorization | null;
	/**
	 * the rail the donor stood on before pressing a fund's own button, saving a stock pledge or
	 * reaching a coin gift's review step, which is where they stand again when that attempt is over.
	 *
	 * each is a rail being chosen with no row of the payment box opened for it, so the rail
	 * it displaced is still the one picked in the other boxes on the card — a donor who closes the
	 * window or presses Try again is back in front of those boxes, and nothing in them reports the
	 * pick a second time.
	 */
	readonly displacedRail: PaymentMethod | undefined;
	/**
	 * the challenge token the last quote was sent with, which a resend may not spend again.
	 *
	 * a token is valid once, whether the endpoint honoured it or refused it.
	 */
	readonly sentToken: string | null;
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
	/**
	 * the last refusal of a `crypto` quote, standing on the step it was routed to until the donor
	 * changes what it was about — the amount, the coin or the rail.
	 *
	 * never `failure`: that is what `failed` reads, and these refusals do not pass through it.
	 */
	readonly coinRefusal: CoinRefusal | null;
	/**
	 * every coin the account refused as not accepted on this card, in the order they were refused.
	 *
	 * kept for the card's life rather than for one attempt: a retry of the same coin answers the same
	 * (`coin_not_accepted` in ./v1.ts), so a press for one of these is refused here instead.
	 */
	readonly refusedCoins: readonly string[];
	/**
	 * every processor that takes a repeating gift has said it never came up, while one taking a
	 * one-time gift has not — `repeatingUnavailable` on the surface in ./embed/surface.ts, which says
	 * it once. kept for the card's life: a processor that never came up does not come up later.
	 */
	readonly repeatingUnavailable: boolean;
	/**
	 * the payment surface's report that it never came up, held on a form whose first step also offers
	 * a coin or stock (`unitsOffered`): the box carries money alone, so a gift in kind is still one to
	 * give, and a gift of money is refused with this once it reaches the step the box is on
	 * (`moneyHasNoBox`). kept for the card's life, as `repeatingUnavailable` is.
	 */
	readonly paymentUnavailable: Failure | null;
	/**
	 * what the donor has typed into the thank-you's employer box, kept until the write takes it.
	 *
	 * free text, so it leaves this machine for the employer port (./ports.ts) and for nothing else, and
	 * it is emptied once that write is answered.
	 */
	readonly employer: string;
	/** why the thank-you's employer ask stands refused, or `null` where nothing refuses it. */
	readonly employerRefusal: EmployerRefusal | null;
	/**
	 * the last write's refusal, which a blank press stands over without answering, so it is what
	 * `employerRefusal` goes back to once the box holds an answer. `null` where no write has failed
	 * since one landed.
	 */
	readonly employerWriteRefusal: Exclude<EmployerRefusal, 'blank'> | null;
	/**
	 * the id the pledge is saved under, which the told press names: minted for the first save, and
	 * minted afresh (`remintPledgeId`) for the save made again where the endpoint holds nothing under
	 * the last one or holds something that is not this pledge.
	 */
	readonly pledgeId: string | null;
	/**
	 * each distinct pledge request this card has sent, keyed by `pledgeRequestKey`, and the id it was
	 * sent under. kept for the card's life: a save whose answer was lost may have landed, so a resend
	 * of the same request names that pledge and is answered with it rather than saving a second
	 * (`QuoteRequest.pledgeId` in ./v1.ts), while a changed request is a pledge of its own, since the
	 * endpoint answers a known id with its pledge only for the same pledge and refuses any other
	 * request under it as `pledge_id_taken`.
	 */
	readonly pledgeIds: Readonly<Record<string, string>>;
	/**
	 * the shares a stock pledge gives, set by `chooseStock`: the stock picked on the first step, saved
	 * by the details step's Continue, or the shares a `PLEDGE_STOCK` names.
	 */
	readonly stock: StockPick | null;
	/** the endpoint refused the custodian a save named (`pledge_detail_invalid`), until it is retyped. */
	readonly custodianRefused: boolean;
	/**
	 * the last press on the pending screen was refused: the told press, or the save made again in its
	 * place. cleared when a save made again lands or a told press reaches the organisation.
	 */
	readonly toldRefused: boolean;
	/**
	 * the last estimate answered for a coin amount, `minor` null where it could not be priced. it
	 * prices the gift only while the coin and the canonical quantity on the draft are still these.
	 */
	readonly coinPrice: (CoinPricing & { readonly minor: number | null }) | null;
	/**
	 * the donor came back to the first step by "Change what you give" on the address screen, so a
	 * renderer focuses the unit pill. cleared once the donor picks or leaves the step.
	 */
	readonly unitReturned: boolean;
	/** the coin amount waiting to be priced, from the keystroke or pick that asked until its answer. */
	readonly pricing: CoinPricing | null;
	/** the read pricing `pricing`, stopped when a newer amount replaces it. */
	readonly estimateRead: ActorRefFrom<typeof readEstimate> | null;
	/**
	 * where the pledge stands after a told press was refused `pledge_not_found`: `needed` until a
	 * save made again lands, since the endpoint holds nothing under `pledgeId` (a fresh one, minted by
	 * the refusal), so each press saves the same request again instead of telling; and `done` once
	 * that save answered with the pledge, until the next press is answered. `null` on every other
	 * pledge.
	 */
	readonly pledgeResave: 'needed' | 'done' | null;
	/**
	 * the save in flight was refused `pledge_id_taken` once and is being sent under a fresh id, so a
	 * second refusal is a failure rather than another id. cleared by the press that starts a save.
	 */
	readonly pledgeIdRetaken: boolean;
};

/** a stock pledge's ticker and shares, as `StockPledgeRequest` in ./v1.ts carries them. */
export type StockPick = { readonly ticker: string; readonly shares: string };

/** a coin and a canonical quantity of it (`canonicalDecimal` in ./value.ts), as one estimate prices it. */
export type CoinPricing = { readonly coin: string; readonly quantity: string };

/**
 * how long a typed coin amount stands unchanged before it is priced, so a donor typing `0.005` is
 * priced once rather than once per keystroke. exported for the reason `MICRODEPOSIT_WINDOW_MS` is.
 */
export const ESTIMATE_DEBOUNCE_MS = 200;

/** the id of the delayed failed answer that stands in for an estimate read gone quiet. */
const ESTIMATE_TIMEOUT = 'estimate-timeout';

/**
 * one read of `CheckoutPorts.estimate`, answering `COIN_PRICED` with what it asked about, `null` on
 * a rejection. stopping it aborts the request, and an aborted read answers nothing.
 */
const readEstimate = fromCallback<
	CheckoutEvent,
	{ readonly ports: CheckoutPorts; readonly formId: string } & CoinPricing
>(({ input, sendBack }) => {
	const { ports, formId, coin, quantity } = input;
	const controller = new AbortController();
	const answer = (estimateMinor: number | null) => {
		if (!controller.signal.aborted)
			sendBack({ type: 'COIN_PRICED', coin, quantity, estimateMinor });
	};
	const read = ports.estimate;
	if (read === undefined) answer(null);
	else {
		read({ formId, coin, amount: quantity }, controller.signal).then(
			(minor) => answer(Number.isSafeInteger(minor) ? minor : null),
			() => answer(null)
		);
	}
	return () => controller.abort();
});

/**
 * `refused` is the last write answered no or never reached the deployment, and `unconfirmed` the last
 * write called off unanswered after `PORT_TIMEOUT_MS`, which may have landed before it was: both stand
 * until a write lands. `blank` is Send pressed over a box holding no answer, and stands until it holds
 * one, over a failed write's refusal it does not answer (`employerWriteRefusal`).
 */
export type EmployerRefusal = 'refused' | 'unconfirmed' | 'blank';

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
	/**
	 * the donor picking what they give from the unit list on the first step. refused for a unit the
	 * step does not offer (`unitsOffered`); a coin or stock makes the gift one-time.
	 */
	| { readonly type: 'SET_UNIT'; readonly unit: GiftUnit }
	/** the coin amount or share count the donor typed for a gift in kind, as typed. */
	| { readonly type: 'SET_QUANTITY'; readonly quantity: string }
	/** the flow's own: a typed coin amount has stood for `ESTIMATE_DEBOUNCE_MS`, and is priced now. */
	| { readonly type: 'PRICE_COIN' }
	/** the flow's own: an estimate read's answer, naming what it priced (`readEstimate`). */
	| ({ readonly type: 'COIN_PRICED'; readonly estimateMinor: number | null } & CoinPricing)
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
	/** the donor asking to show the note on the organisation's page, or taking the ask back. */
	| { readonly type: 'TOGGLE_NOTE_PUBLIC' }
	/** the donor asking for the shown note to be signed "Anonymous", or taking the ask back. */
	| { readonly type: 'TOGGLE_NOTE_ANONYMOUS' }
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
	 * backing off a screen the flow put the donor on: the correction screen, back to the review step,
	 * and an open deposit address, back to the first step ("Change what you give").
	 *
	 * the step it moves to is written into the transition, so it says nothing
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
	/** the IRA custodian an `ira_qcd` pledge names, as the donor types it on the review step. */
	| { readonly type: 'SET_CUSTODIAN'; readonly custodian: string }
	/**
	 * shares of a ticker pledged from the details step, saved the way the details step's Continue
	 * saves a stock picked on the first step. no screen sends it: the dev page's stock control does, through
	 * `steer` in ./element.ts.
	 */
	| ({ readonly type: 'PLEDGE_STOCK' } & StockPick)
	/** "I’ve contacted my broker", "I’ve asked my custodian", and the Try again after either fails. */
	| { readonly type: 'TELL_ORGANIZATION' }
	| { readonly type: 'PAYMENT_UNAVAILABLE'; readonly failure: Failure }
	| { readonly type: 'CHALLENGE_UNAVAILABLE'; readonly failure: Failure }
	| { readonly type: 'REPEATING_UNAVAILABLE' }
	| { readonly type: 'MAKE_ONE_TIME' }
	| {
			readonly type: 'SET_CONTACT';
			readonly email?: string;
			readonly firstName?: string;
			readonly lastName?: string;
	  }
	| { readonly type: 'TOGGLE_FEE_COVERAGE' }
	| { readonly type: 'SET_CONSENT'; readonly consented: boolean }
	| { readonly type: 'SET_TURNSTILE_TOKEN'; readonly token: string }
	/** the challenge entering interactive mode, or leaving it, as its widget reports. */
	| { readonly type: 'SET_CHALLENGE_INTERACTIVE'; readonly interactive: boolean }
	| { readonly type: 'SUBMIT' }
	/**
	 * the donor pressing a fund's own button, which opens the fund's window in the same task.
	 *
	 * the press that stands in for `SUBMIT` on the daf rail, and the one that chooses that rail: the
	 * fund's own button is the fund's option on the card, so nothing reports the rail ahead of it.
	 * the window is opened by the fund's own script on that press, so this event is how the flow
	 * learns it happened — and the reading straight after it is how the adapter learns whether to let
	 * it open at all (`openFund` below). nothing is awaited between the two: a window opened more than a moment
	 * after the press is a popup the browser blocks.
	 */
	| { readonly type: 'OPEN_FUND' }
	/** the fund's window closing on an approval, carrying what it approved. */
	| ({ readonly type: 'FUND_APPROVED' } & FundAuthorization)
	/** the fund's window closing on anything else, which approved nothing. */
	| { readonly type: 'FUND_CLOSED' }
	| { readonly type: 'CONFIRM' }
	| { readonly type: 'ACCEPT_MANDATE' }
	| { readonly type: 'DECLINE_MANDATE' }
	| { readonly type: 'RETRY' }
	/** the thank-you's employer box, as the donor types it. */
	| { readonly type: 'SET_EMPLOYER'; readonly employer: string }
	/** `Send me the details`, which the flow takes only over a box that is not blank. */
	| { readonly type: 'SEND_EMPLOYER' }
	/** `Skip`, which sends nothing and writes nothing. */
	| { readonly type: 'SKIP_EMPLOYER' };

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
 * how long the address screen waits between two readings of where the gift stands.
 *
 * the read is metered by the `/api/v1` bucket every endpoint there shares, per client IP
 * (`API_RATE_LIMITER` in packages/app/src/lib/server/runtime/rate-limiter.ts), and a chain
 * confirms in minutes rather than seconds — so every few seconds is as soon as a donor could be told and still leaves the bucket to
 * the presses that spend it. exported for the reason `MICRODEPOSIT_WINDOW_MS` is.
 */
export const DEPOSIT_POLL_MS = 5000;

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

/** what a donor is told when a press waited on the security check and it never answered. */
const CHECK_UNFINISHED =
	'This donation form’s security check did not finish, so nothing was charged. Try again.';

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
const GENERIC_FAILURE = 'This gift was not started, and nothing was charged. Try again.';

/**
 * what a donor is told when a pledge's save answered without the pledge, or its answer was lost
 * (`pledgeMayBeSaved` below). it may have been saved, so it promises nothing about a second save: a
 * Try again of the same request resends its `pledgeId` and is answered with that pledge, but a
 * request the donor changed first is minted an id of its own and saved as a pledge of its own
 * (`pledgeId` in ./v1.ts).
 */
const PLEDGE_UNSAVED = 'We couldn’t confirm your gift was saved. Try again.';

/**
 * what a donor is told when their fund's approval expired before the grant was created.
 *
 * the server's own sentence names the session and is written for whoever reads the log; this one
 * names the donor's next move, which is to approve again in the fund's window.
 */
const FUND_APPROVAL_EXPIRED =
	'Your fund’s approval expired before the gift was sent, and no grant was made. Press Try again, then open your fund’s window and approve the gift again.';

/**
 * what a donor is told when a send of their fund's approval may have created the grant before its
 * answer was lost.
 *
 * the server answers the same approval sent again with the grant it already holds, which is what
 * lets this promise that the request is not sent twice.
 */
const FUND_REQUEST_MAY_BE_SENT =
	'We could not confirm this gift, and your fund may already have the grant request. Press Try again to finish; your fund will not be sent the request twice.';

/** the `ApiError` code a rejected port carried, where it carried one (`EmbedFailure` in ./embed/api.ts). */
function errorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const { code } = error as { code?: unknown };
	return typeof code === 'string' ? code : undefined;
}

/** the box a `pledge_detail_invalid` refusal named, where it named one (`ApiError.field` in ./v1.ts). */
function errorField(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const { field } = error as { field?: unknown };
	return typeof field === 'string' ? field : undefined;
}

/** the floor a `below_minimum` refusal named, where it named one (`EmbedFailure` in ./embed/api.ts). */
function minAmountOf(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const { minAmountMinor } = error as { minAmountMinor?: unknown };
	return typeof minAmountMinor === 'number' ? minAmountMinor : undefined;
}

/**
 * a rejected quote as the refusal a `crypto` gift is routed on, or `null` where it is not one.
 *
 * only the three codes a donor fixes on a step of the form. every other refusal takes `failed`,
 * except an IRA (QCD) save refused for its custodian (`refusesCustodian` below) and a first
 * `pledge_id_taken`, which is sent again under a fresh id (`retakesPledgeId`).
 */
function coinRefusalOf(context: CheckoutContext, error: unknown): CoinRefusal | null {
	const coin = context.payer?.method === 'crypto' ? context.payer.coin : undefined;
	if (coin === undefined) return null;
	const code = errorCode(error);
	if (code === 'below_minimum') {
		const minAmountMinor = minAmountOf(error);
		return minAmountMinor === undefined ? { code, coin } : { code, coin, minAmountMinor };
	}
	if (code === 'above_maximum' || code === 'coin_not_accepted') return { code, coin };
	return null;
}

/**
 * whether the flow takes a press on the review step: the payer `completePayer` (./value.ts) builds,
 * on a coin the account has not refused on this card.
 *
 * exported for the reason `stepIsReachable` below is: it is the guard on `SUBMIT` and the
 * `payerComplete` a renderer explains a refusal from (./connect.ts), and one expression is what keeps
 * the two from parting.
 */
export function payerIsComplete(context: CheckoutContext): boolean {
	const payer = completePayer(context.payerDraft, context.config);
	return payer !== null && (payer.coin === undefined || !context.refusedCoins.includes(payer.coin));
}

/** whether a rejected port never heard back from the endpoint (`EmbedFailure` in ./embed/api.ts). */
function wentUnanswered(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { unanswered?: unknown }).unanswered === true
	);
}

/**
 * a failed pledge save after which the pledge may nonetheless be saved: every failure but a refusal
 * the endpoint coded — an unanswered request, and an answer that was not the endpoint's own words
 * (a proxy's error page, a body that is not json), each of which may follow the write.
 */
function pledgeMayBeSaved(context: CheckoutContext, error: unknown): boolean {
	return (
		context.payer !== null && isPledgeRail(context.payer.method) && errorCode(error) === undefined
	);
}

/** a failed send of a fund's approval after which the grant may nonetheless exist. */
function maybeSentGrant(error: unknown): boolean {
	return errorCode(error) === 'payments_unavailable' || wentUnanswered(error);
}

/**
 * whether a fund's approval is kept for a Try again after a send that failed.
 *
 * only where the same approval can be answered differently next time; every other refusal answers
 * it the same way again, and a resend would hold the donor in front of that refusal with no way back
 * to the fund's window short of a reload.
 */
function keepsFundApproval(error: unknown): boolean {
	return maybeSentGrant(error) || errorCode(error) === 'challenge_failed';
}

/** the request the quote port is handed, assembled from everything decided so far. */
function quoteRequest(context: CheckoutContext, payer: Payer): QuoteRequest {
	const fv = context.fv;
	if (fv === null) throw new Error('unreachable: a quote is only requested past `completeAmount`');
	return {
		formId: context.config.formId,
		amountMinor: fv.amountMinor,
		frequency: fv.frequency,
		method: payer.method,
		// the review step's switch, a coin gift's as well: covered, the server grosses the price the
		// address is minted for up by the same fee, so the deposit asks for the gift and the fee.
		coversFee: payer.coversFee,
		email: payer.email,
		firstName: payer.firstName,
		lastName: payer.lastName,
		consentedToContact: payer.consentedToContact,
		...(payer.coin === undefined ? {} : { coin: payer.coin }),
		...(fv.note === undefined ? {} : { note: fv.note }),
		...(fv.noteShown === undefined ? {} : { note_public: true }),
		...(fv.noteShown === 'anonymous' ? { note_anonymous: true } : {}),
		// omitted where the donor chose no cause, which is what the endpoint reads as the gift going
		// where it is needed most — and it is also every gift on a pinned form, because that pin is
		// written from the form record and nothing on such a card writes an id onto the draft.
		...(fv.programId === null ? {} : { programId: fv.programId }),
		...(context.pageProgramId === null ? {} : { pageProgramId: context.pageProgramId }),
		...flatTribute(fv.tribute),
		...(context.authorization === null
			? {}
			: {
					authorizationId: context.authorization.authorizationId,
					authorizedMinor: context.authorization.authorizedMinor
				}),
		...challengeField(context)
	};
}

/**
 * what one press sends to `POST /api/v1/forms/:id/donations`: a quote to mint on a processor's rail,
 * or a pledge to save on a pledge rail (`PLEDGE_RAILS` in ./embed/rails.ts), each through its own
 * port.
 */
type Minting =
	| { readonly kind: 'quote'; readonly body: QuoteRequest }
	| { readonly kind: 'pledge'; readonly body: QuoteRequest | StockPledgeRequest };

function minting(context: CheckoutContext, payer: Payer): Minting {
	if (!isPledgeRail(payer.method)) return { kind: 'quote', body: quoteRequest(context, payer) };
	if (context.pledgeId === null) throw new Error('unreachable: `quoting` mints the id on entry');
	return { kind: 'pledge', body: pledgeRequest(context, payer, context.pledgeId) };
}

/** a pledge's save under `pledgeId`, from everything decided so far. */
function pledgeRequest(
	context: CheckoutContext,
	payer: Payer,
	pledgeId: string
): QuoteRequest | StockPledgeRequest {
	// the donor fields, the note, the cause and the tribute ride as on every gift. a pledge covers
	// no fee, because nothing is charged.
	const gift = quoteRequest(context, payer);
	if (payer.method === 'ira_qcd') {
		return { ...gift, coversFee: false, pledgeId, custodian: payer.custodian ?? '' };
	}
	if (context.stock === null)
		throw new Error('unreachable: `chooseStock` sets the shares with the stock rail');
	const { amountMinor: _amount, coversFee: _covers, method: _method, ...rest } = gift;
	return { ...rest, method: 'stock', pledgeId, ...context.stock };
}

/**
 * what makes two pledge saves the same request: everything the save sends but its id and the
 * challenge token, which is valid once and so differs on every send.
 */
function pledgeRequestKey(context: CheckoutContext, payer: Payer): string {
	const {
		pledgeId: _id,
		turnstileToken: _turnstile,
		altchaPayload: _altcha,
		...request
	} = pledgeRequest(context, payer, '');
	return JSON.stringify(request);
}

/**
 * the challenge token under the name the served config's own check reads it by, or nothing.
 *
 * one slot holds either kind, because the flow treats them alike: each is valid once and is
 * replaced by the challenge on its own (./embed/challenge.ts). only the wire tells them apart.
 */
function challengeField(
	context: CheckoutContext
): Pick<QuoteRequest, 'turnstileToken' | 'altchaPayload'> {
	const token = context.turnstileToken;
	if (token === null) return {};
	return context.config.altchaChallengeUrl === undefined
		? { turnstileToken: token }
		: { altchaPayload: token };
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

/**
 * the rail the donor stands on once a fund's, a stock pledge's or a coin gift's attempt is over: each
 * rail is held only for that attempt (`isHeldRail`), and gives way to the rail it displaced.
 */
function standingRail(context: CheckoutContext): PaymentMethod | undefined {
	const { method } = context.payerDraft;
	return method !== undefined && isHeldRail(method) ? context.displacedRail : method;
}

/**
 * a rail the flow holds rather than a row of the payment box: a gift in kind's, set by the details
 * step's press for stock and by the review step's entry for a coin (`standOnGift`), and a fund's, set
 * by its own button's press.
 */
function isHeldRail(method: PaymentMethod): boolean {
	return method === 'stock' || method === 'crypto' || isChariotRail(method);
}

/**
 * whether a press on `method` is the details step's: a stock gift has no review step, so its press,
 * its wait for a token and its Try again all belong to the details step. exported for ./connect.ts,
 * which projects the held press there.
 */
export function pressesOnDetails(method: PaymentMethod | undefined): boolean {
	return method === 'stock';
}

/**
 * the donor's press of a fund's own button, told to the flow, and what the fund's window is opened
 * on — or `null` where the flow did not take the press.
 *
 * one call for both halves, with nothing awaited between them: the fund's script asks for this
 * synchronously on the press and opens its window straight after, so a `null` here is the window
 * kept shut. exported for both surfaces that run this flow, so neither holds a second reading of
 * which press was taken. the figure is the total the donor was shown — the gift and any fee they chose
 * to cover — because that is what the fund is asked to grant.
 */
export function openFund(
	actor: Pick<Actor<typeof checkoutMachine>, 'send' | 'getSnapshot'>
): FundRequest | null {
	// a second press while the window is already open is not a press the flow took.
	if (actor.getSnapshot().value === 'authorizing') return null;
	actor.send({ type: 'OPEN_FUND' });
	const { context, value } = actor.getSnapshot();
	const { payer } = context;
	const amountMinor = shownTotalMinor(context);
	if (value !== 'authorizing' || payer === null || amountMinor === null) return null;
	return {
		amountMinor,
		email: payer.email,
		firstName: payer.firstName,
		lastName: payer.lastName
	};
}

/** a decided one-time gift in the deployment's own currency, which is the gift a fund may grant. */
function givesMoneyOnce(context: CheckoutContext): boolean {
	return context.fv?.frequency === 'one_time' && context.fv.inKind === undefined;
}

/**
 * whether a fund's own button stands on the card: the review step of a one-time gift of money on a
 * form offering the fund's rail, and the fund's window opened from it. a coin gift's review step
 * lists no payment method, so it offers no fund either.
 *
 * the window is included because its endings are heard on that element, and an element taken off
 * the page while its window is open drops the approval the donor is giving in it. exported for both
 * surfaces that run this flow, which tell their payment surface on every reading.
 */
export function fundIsOffered(snapshot: {
	readonly context: CheckoutContext;
	readonly value: unknown;
}): boolean {
	const { context, value } = snapshot;
	return (
		(value === 'give' || value === 'holding' || value === 'authorizing') &&
		givesMoneyOnce(context) &&
		context.config.paymentMethods.some(isChariotRail)
	);
}

/**
 * whether the payment box lists the Venmo option: a form offering the rail, on a gift the donor has
 * made one-time.
 *
 * Venmo has a one-time session and no subscription session (`venmo-payments` in `@paypal/paypal-js`),
 * so a repeating gift on it is a subscription nobody can approve. read off the cadence as it is being
 * picked, so the option leaves the box the moment a repeating cadence is chosen rather than once it
 * is committed. PayPal's own rail is not narrowed here. exported for both surfaces that run this
 * flow, which tell their payment surface on every reading.
 */
export function venmoIsOffered(snapshot: { readonly context: CheckoutContext }): boolean {
	const { config, draft } = snapshot.context;
	return draft.frequency === 'one_time' && config.paymentMethods.includes('venmo');
}

/**
 * whether a gift may be pledged on `rail`: a form offering it, on a gift the donor has made one-time,
 * on a surface given the pledge ports (`CheckoutPorts.pledges` in ./ports.ts).
 *
 * neither pledge rail takes a gift that repeats (`FormConfig.paymentMethods` in ./v1.ts), so the IRA
 * (QCD) row leaves the payment box with a repeating cadence, read off the cadence as it is being
 * picked for the reason `venmoIsOffered` above gives. exported for both surfaces that run this flow,
 * which tell their payment surface on every reading.
 */
export function pledgeIsOffered(
	snapshot: { readonly context: CheckoutContext },
	rail: 'stock' | 'ira_qcd'
): boolean {
	const { config, draft, ports } = snapshot.context;
	return (
		draft.frequency === 'one_time' &&
		config.paymentMethods.includes(rail) &&
		ports.pledges !== undefined
	);
}

/**
 * which units besides the deployment's own currency the first step offers.
 *
 * a coin where the form takes `crypto`, serves a coin to send and this surface can price one
 * (`CheckoutPorts.estimate` in ./ports.ts), and stock where it takes `stock` on a surface given the
 * pledge ports. either makes the gift one-time, so neither is offered on a form taking no one-time
 * gift. read off the config rather than the cadence being picked, unlike `pledgeIsOffered` above:
 * picking one is what makes the gift one-time. exported for ./connect.ts, which draws the pill off
 * it, so the pill and the guard on `SET_UNIT` are one answer.
 */
export function unitsOffered(context: CheckoutContext): { coin: boolean; stock: boolean } {
	const { config, ports } = context;
	const oneTime = config.frequencies.includes('one_time');
	return {
		coin:
			oneTime &&
			config.paymentMethods.includes('crypto') &&
			(config.coins?.length ?? 0) > 0 &&
			ports.estimate !== undefined,
		stock: oneTime && config.paymentMethods.includes('stock') && ports.pledges !== undefined
	};
}

/** whether `unit` is one the first step offers: the currency, a served coin, or any offered ticker. */
function unitIsOffered(context: CheckoutContext, unit: GiftUnit): boolean {
	const offered = unitsOffered(context);
	switch (unit.kind) {
		case 'currency':
			return true;
		case 'coin':
			return offered.coin && (context.config.coins ?? []).some((coin) => coin.coin === unit.coin);
		case 'stock':
			return offered.stock && unit.ticker.trim() !== '';
	}
}

/** whether two picks name the same unit. */
function sameUnit(a: GiftUnit | undefined, b: GiftUnit | undefined): boolean {
	const left = a ?? { kind: 'currency' };
	const right = b ?? { kind: 'currency' };
	if (left.kind === 'coin') return right.kind === 'coin' && right.coin === left.coin;
	if (left.kind === 'stock') return right.kind === 'stock' && right.ticker === left.ticker;
	return right.kind === 'currency';
}

/**
 * whether the review step offers the gift as one-time in place of the repeating one committed to:
 * no processor that takes a repeating gift is up (`repeatingUnavailable` on the context) and one
 * taking a one-time gift is.
 *
 * the dead end is for a form with no way to pay at all, which `PAYMENT_UNAVAILABLE` reports. this
 * is a gift the donor can still make, once, and `MAKE_ONE_TIME` is the press that makes it so.
 * exported for both surfaces that run this flow, which draw the offer off it.
 */
export function oneTimeIsOfferedInstead(snapshot: {
	readonly context: CheckoutContext;
	readonly value: unknown;
}): boolean {
	return (
		(snapshot.value === 'give' || snapshot.value === 'holding') &&
		repeatingIsRefused(snapshot.context)
	);
}

/** a repeating gift committed to that no processor still up can take. */
function repeatingIsRefused(context: CheckoutContext): boolean {
	const frequency = context.fv?.frequency;
	return context.repeatingUnavailable && frequency !== undefined && frequency !== 'one_time';
}

/** the coin amount on the draft as one estimate prices it, or `null` on any other draft. */
function coinPricingOf(draft: AmountDraft): CoinPricing | null {
	if (draft.unit?.kind !== 'coin') return null;
	const quantity = canonicalDecimal(draft.quantity ?? '');
	return quantity === null ? null : { coin: draft.unit.coin, quantity };
}

function samePricing(a: CoinPricing | null, b: CoinPricing | null): boolean {
	return a !== null && b !== null && a.coin === b.coin && a.quantity === b.quantity;
}

/**
 * `answer` priced `typed`. an answer of `null` is a read that failed or could not price, which is
 * never kept as the answer: the donor's next pick or keystroke for the same amount asks again.
 */
function isPricedAt(answer: CheckoutContext['coinPrice'], typed: CoinPricing): boolean {
	return samePricing(answer, typed) && answer?.minor !== null;
}

/** the estimate of the coin amount on the draft now, or `null` where none has answered for it. */
function pricedMinor(context: CheckoutContext): number | null {
	const { coinPrice } = context;
	return samePricing(coinPrice, coinPricingOf(context.draft)) ? (coinPrice?.minor ?? null) : null;
}

/**
 * where the estimate of the coin amount on the draft stands, or `null` on a draft with no coin amount:
 * `pricing` until the read for that amount answers, then `priced` or `unpriced` (the read answered
 * `null` or failed). exported for ./connect.ts, which states the estimate line off it.
 */
export function coinEstimate(
	context: CheckoutContext
): { status: 'pricing' } | { status: 'priced'; minor: number } | { status: 'unpriced' } | null {
	const typed = coinPricingOf(context.draft);
	if (typed === null) return null;
	if (samePricing(context.pricing, typed) || !samePricing(context.coinPrice, typed)) {
		return { status: 'pricing' };
	}
	const minor = context.coinPrice?.minor ?? null;
	return minor === null ? { status: 'unpriced' } : { status: 'priced', minor };
}

/**
 * the last estimate of the picked coin while a newer amount of it waits to be priced, where that
 * estimate was outside the form's bounds, else `null`. the bounds refusal stands until an answer
 * lifts it, so a renderer's sentence is not dropped and written back (re-announced) per keystroke.
 */
function heldOutOfBounds(context: CheckoutContext): number | null {
	const { coinPrice: last, pricing } = context;
	const typed = coinPricingOf(context.draft);
	if (typed === null || !samePricing(pricing, typed) || last === null) return null;
	if (last.coin !== typed.coin || last.minor === null) return null;
	return isWithinBounds(last.minor, context.config) ? null : last.minor;
}

/**
 * the amount step's decisions a press would still be refused for — `missingAmountDecisions` in
 * ./value.ts over the draft and the estimate of its coin amount. exported for ./connect.ts, so the
 * refusal a screen names and the guard on `CONTINUE` are one reading.
 */
export function missingAmount(context: CheckoutContext): readonly AmountDecision[] {
	const missing = missingAmountDecisions(
		context.draft,
		context.config,
		pricedMinor(context) ?? heldOutOfBounds(context)
	);
	const { unit } = context.draft;
	// a coin the account refused on this card is refused again (`refusedCoins`), so its amount is not
	// one a press may carry.
	const refused = unit?.kind === 'coin' && context.refusedCoins.includes(unit.coin);
	return refused && !missing.includes('quantity') ? ['quantity', ...missing] : missing;
}

/** everything the amount step exists to decide has been decided. */
function amountIsDecided(context: CheckoutContext): boolean {
	return (
		missingAmount(context).length === 0 &&
		completeAmount(context.draft, context.config, pricedMinor(context)) !== null
	);
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

/** a stock pledge may be saved from the details step: the rail offered, and every field a receipt needs. */
function stockCanPledge(context: CheckoutContext): boolean {
	return pledgeIsOffered({ context }, 'stock') && payerFieldsAreGiven(context);
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
	// a stock gift has no review step: its details step's press goes on to the pledge.
	if (to === 'give' && context.draft.unit?.kind === 'stock') return false;
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

/**
 * the state a donation read answered, or `null` for an answer that is not one of ours.
 *
 * the body is untrusted JSON off a stranger's page, and anything but a named state is a reading
 * nobody has — never `expired`, which withdraws the address.
 */
function depositState(output: unknown): DonationStatus['state'] | null {
	if (typeof output !== 'object' || output === null) return null;
	const { state } = output as { state?: unknown };
	return (DONATION_STATES as readonly unknown[]).includes(state)
		? (state as DonationStatus['state'])
		: null;
}

/** the compile-time half: a kind with no case above is not `never` here, and the build fails. */
function unroutedOutcome(_outcome: never): null {
	return null;
}

/**
 * the token of the gift page the thank-you asks for an employer on, or `null` where it asks nothing:
 * the quote named no gift page on the web, or this surface was given no employer port.
 *
 * exported for ./connect.ts, so the screen and the guard that opens the ask read one answer.
 */
export function giftTokenOf(context: CheckoutContext): string | null {
	const giftUrl = context.quote?.giftUrl;
	if (giftUrl === undefined || context.ports.employer === undefined) return null;
	return giftToken(giftUrl);
}

export const checkoutMachine = setup({
	types: {
		context: {} as CheckoutContext,
		events: {} as CheckoutEvent,
		input: {} as CheckoutInput
	},
	actors: {
		readEstimate,
		/**
		 * `POST /api/v1/forms/:id/donations`.
		 *
		 * the one state that invokes it cannot be re-entered without leaving first, so one press
		 * mints one intent. a donor who backs out and presses again has made a second attempt and
		 * mints a second intent; see the header.
		 */
		mintQuote: fromPromise<Quote, { ports: CheckoutPorts; request: Minting }>(({ input }) => {
			const { ports, request } = input;
			if (request.kind === 'quote') return ports.quote(request.body);
			if (ports.pledges === undefined) {
				throw new Error('unreachable: a pledge rail is offered only where its ports are given');
			}
			return ports.pledges.save(request.body);
		}),
		/** `POST /api/v1/forms/:id/donations/:pledgeId/told`, from the pending screen's primary. */
		tellOrganization: fromPromise<void, { ports: CheckoutPorts; formId: string; pledgeId: string }>(
			({ input: { ports, ...input } }) => {
				if (ports.pledges === undefined) {
					throw new Error('unreachable: a pledge is saved only where its ports are given');
				}
				return ports.pledges.told(input);
			}
		),
		confirmPayment: fromPromise<ConfirmOutcome, { ports: CheckoutPorts; input: ConfirmInput }>(
			({ input }) => input.ports.confirm(input.input)
		),
		resumeIntent: fromPromise<ConfirmOutcome, { ports: CheckoutPorts; paymentToken: string }>(
			({ input }) => input.ports.resume({ paymentToken: input.paymentToken })
		),
		readDeposit: fromPromise<
			DonationStatus,
			{ ports: CheckoutPorts; formId: string; paymentToken: string }
		>(({ input }) =>
			input.ports.status({ formId: input.formId, paymentToken: input.paymentToken })
		),
		/** `POST /api/v1/forms/:id/gifts/:token/employer`, reached only past `asksForEmployer`. */
		writeEmployer: fromPromise<
			void,
			{ ports: CheckoutPorts; formId: string; giftToken: string; employer: string }
		>(({ input: { ports, ...input }, signal }) => {
			if (ports.employer === undefined) {
				throw new Error('unreachable: the employer is asked only where its port is given');
			}
			return ports.employer(input, signal);
		})
	},
	guards: {
		/** the donor arrived on a URL carrying a payment token, so this is a return rather than a start. */
		isResuming: ({ context }) => context.resumeToken !== null,

		/**
		 * the thank-you asks for the donor's employer: the quote named a gift page on the web and this
		 * surface can write to it. a resumed gift holds no quote and is not asked.
		 */
		asksForEmployer: ({ context }) => giftTokenOf(context) !== null,

		/** the employer box holds an answer the endpoint takes. */
		employerIsGiven: ({ context }) => employerAnswer(context.employer) !== null,

		/** the rail on the draft is one the flow holds, not a row of the payment box (`isHeldRail`). */
		holdsRail: ({ context }) => {
			const { method } = context.payerDraft;
			return method !== undefined && isHeldRail(method);
		},

		/** a pick the first step offers — see `unitsOffered`. */
		unitIsOffered: ({ context, event }) =>
			event.type === 'SET_UNIT' && unitIsOffered(context, event.unit),

		/** an estimate's answer for the coin amount waiting to be priced. */
		pricesWhatIsTyped: ({ context, event }) =>
			event.type === 'COIN_PRICED' && samePricing(context.pricing, event),

		/** a cadence the gift may take: any, except a repeating one on a gift in kind. */
		cadenceIsOpen: ({ context, event }) =>
			event.type === 'SET_FREQUENCY' &&
			(event.frequency === 'one_time' || !isInKind(context.draft.unit)),

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

		stockCanPledge: ({ context }) => stockCanPledge(context),

		// the details step's Continue, by what the decided gift gives.
		givesStockFromHere: ({ context }) =>
			context.fv?.inKind?.kind === 'stock' && stockCanPledge(context),
		reviewsFromHere: ({ context }) =>
			context.fv?.inKind?.kind !== 'stock' && payerFieldsAreGiven(context),

		/** the first step offers a coin or stock, which the payment box does not carry. */
		givesInKindWithoutBox: ({ context }) => {
			const offered = unitsOffered(context);
			return offered.coin || offered.stock;
		},

		/** a gift of money on a card whose payment box never came up (`paymentUnavailable`). */
		moneyHasNoBox: ({ context }) =>
			context.paymentUnavailable !== null && context.fv?.inKind === undefined,

		/** the press being retried was a stock gift's, which is made from the details step. */
		givesStock: ({ context }) => pressesOnDetails(context.payerDraft.method),

		/** the failure is a stock save refused for its ticker or shares (`Failure.refusedStock`). */
		stockIsRefused: ({ context }) => context.failure?.refusedStock === true,

		/** a mark pressed for the first step while a stock gift's press is held. */
		givesStockToFirstStep: ({ context, event }) =>
			event.type === 'GO_TO_STEP' &&
			event.step === 'amount' &&
			pressesOnDetails(context.payerDraft.method),

		/** the donor has filled in everything a typed rail needs before an intent can be minted. */
		payerIsComplete: ({ context }) => payerIsComplete(context),

		/** the review step offering the gift as one-time — see `oneTimeIsOfferedInstead`. */
		repeatingIsRefused: ({ context }) => repeatingIsRefused(context),

		/**
		 * the donor on a fund's rail may open its window: a one-time gift of money and every field the
		 * receipt needs. a fund's grant repeats nowhere this deployment can match, so a repeating gift
		 * never reaches the window, and a coin is sent from the donor's own wallet rather than granted.
		 */
		fundCanOpen: ({ context }) =>
			givesMoneyOnce(context) &&
			completeFundPayer({ ...context.payerDraft, method: 'daf' }, context.config) !== null,

		/**
		 * a quote minted for an address, which is the whole of that rail's press: nothing is confirmed
		 * after it, because the donor sends the coin from their own wallet.
		 *
		 * `quoteIsUsable` and `depositIsUsable` both, because the address screen states the total as
		 * well as the address — `About {total} today` — and neither is checked again.
		 */
		quoteIsDeposit: ({ context }, params: { quote: Quote }): boolean =>
			context.payer?.method === 'crypto' &&
			context.fv !== null &&
			quoteIsUsable(params.quote, context.fv.amountMinor) &&
			depositIsUsable(params.quote),

		/**
		 * a pledge saved: the answer carries the pledge this save named, whole (`pledgeIsUsable` in
		 * ./pledge.ts). nothing is charged and nothing is confirmed after it.
		 */
		quoteIsPledge: ({ context }, params: { quote: Quote }): boolean => {
			const method = context.payer?.method;
			return (
				method !== undefined &&
				isPledgeRail(method) &&
				context.pledgeId !== null &&
				pledgeIsUsable(params.quote.pledge, method, context.pledgeId)
			);
		},

		/** the last told press was refused `pledge_not_found`, so the next one saves the pledge instead. */
		pledgeIsLost: ({ context }) => context.pledgeResave === 'needed',

		/**
		 * a pledge save refused because its id names something else, for the first time on this save,
		 * which the endpoint's own way back answers with one more send under a fresh id
		 * (`pledge_id_taken` in ./v1.ts).
		 */
		retakesPledgeId: ({ context, event }) =>
			'error' in event && errorCode(event.error) === 'pledge_id_taken' && !context.pledgeIdRetaken,

		/** a pledge save refused because its id names something else, on the send under a fresh one. */
		pledgeIdIsTaken: ({ event }) =>
			'error' in event && errorCode(event.error) === 'pledge_id_taken',

		/** a told press refused because the endpoint holds no pledge under its id. */
		toldFindsNoPledge: ({ event }) =>
			'error' in event && errorCode(event.error) === 'pledge_not_found',

		/** the press was a pledge's save, so an answer that is not its pledge is no pledge at all. */
		savesPledge: ({ context }) => context.payer !== null && isPledgeRail(context.payer.method),

		/** a reading of the gift paid to an address, answered with one of `DONATION_STATES`. */
		depositReads: ({ event }, params: { state: DonationStatus['state'] }): boolean =>
			'output' in event && depositState(event.output) === params.state,

		/**
		 * a quote minted on a fund's approval, which is the gift made rather than an intent to confirm.
		 *
		 * measured against its own fee rather than against the form's amount: the donor may change the
		 * figure inside the fund's window, and the grant is recorded from what the fund approved — so a
		 * total under the amount the form showed is the approval, not a garbled answer.
		 */
		quoteIsGrant: ({ context }, params: { quote: Quote }): boolean =>
			context.authorization !== null && quoteIsUsable(params.quote, params.quote.feeMinor),

		/** a fund's approval survived the failed send, so a Try again sends it again. */
		grantIsHeld: ({ context }) => context.authorization !== null,

		/** a `crypto` quote refused for the amount; the donor fixes it in the first step's coin box. */
		refusesAmountForCoin: ({ context, event }) => {
			const code = 'error' in event ? coinRefusalOf(context, event.error)?.code : undefined;
			return code === 'below_minimum' || code === 'above_maximum';
		},

		/** an IRA (QCD) save refused for its custodian; the donor fixes it in the review step's box. */
		refusesCustodian: ({ context, event }) =>
			'error' in event &&
			context.payer?.method === 'ira_qcd' &&
			errorCode(event.error) === 'pledge_detail_invalid' &&
			errorField(event.error) === 'custodian',

		/** a `crypto` quote refused for the coin; the donor picks another in the What you give panel. */
		refusesCoin: ({ context, event }) =>
			'error' in event && coinRefusalOf(context, event.error)?.code === 'coin_not_accepted',

		/** the widget has minted a token since the last send spent one. */
		tokenIsFresh: ({ context }) =>
			context.turnstileToken !== null && context.turnstileToken !== context.sentToken,

		/** the challenge is asking the visitor to solve something. */
		challengeIsInteractive: ({ context }) => context.challengeInteractive,

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
		/**
		 * the coin amount on the draft, where no answer prices it (`isPricedAt`), priced once it has
		 * stood for `ESTIMATE_DEBOUNCE_MS`, each pick or keystroke starting that wait again.
		 */
		priceTyped: enqueueActions(({ context, enqueue }) => {
			const typed = coinPricingOf(context.draft);
			const unpriced = typed !== null && !isPricedAt(context.coinPrice, typed);
			enqueue.assign({ pricing: unpriced ? typed : null });
			enqueue.cancel('pricing');
			if (unpriced) {
				enqueue.raise({ type: 'PRICE_COIN' }, { id: 'pricing', delay: ESTIMATE_DEBOUNCE_MS });
			}
		}),

		/** the one place a draft becomes the `fv` every later state is allowed to assume. */
		commitAmount: assign({
			fv: ({ context }) => completeAmount(context.draft, context.config, pricedMinor(context)),
			unitReturned: false
		}),

		/**
		 * the cause the gift is credited to, taken on any of the three steps a donor edits.
		 *
		 * the card's own select is on the amount step, but a host may draw the choice outside the
		 * card, beside every step, so the pick is written onto the decided gift as well as the
		 * draft wherever there is one. no step handling it has minted anything yet: `beginAttempt`
		 * drops an attempt on arrival at either later step. every state past the press drops it,
		 * the fund's window included, because the gift carrying the cause is already asked for.
		 *
		 * `null` is written onto the draft as an absent id rather than kept, so the draft holds the
		 * donor's answer in the one shape `completeAmount` (./value.ts) reads — where it is needed
		 * most. a form offering no choice draws no control, so nothing on such a card sends this.
		 */
		pickProgram: assign(({ context, event }) => {
			if (event.type !== 'SET_PROGRAM') return {};
			return {
				draft: { ...context.draft, programId: event.programId ?? undefined },
				fv: context.fv === null ? null : { ...context.fv, programId: event.programId }
			};
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
		beginAttempt: assign(({ context }) => ({
			quote: null,
			reconciliation: null,
			mandateAccepted: false,
			verificationDeadline: null,
			failure: null,
			authorization: null,
			payerDraft: { ...context.payerDraft, method: standingRail(context) }
		})),

		/** the payment box's report that it never came up, held rather than said (`paymentUnavailable`). */
		holdBoxDown: assign({
			paymentUnavailable: ({ context, event }) =>
				event.type === 'PAYMENT_UNAVAILABLE' ? event.failure : context.paymentUnavailable
		}),

		/** the box's report said, to a gift of money that has reached the step the box is on. */
		deliverBoxDown: assign({ failure: ({ context }) => context.paymentUnavailable }),

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

		/**
		 * a told press that did not reach the organisation, for whatever reason. a resave still owed
		 * stays owed; one that was made has been said, and the refusal is what stands now.
		 */
		refuseTold: assign({
			toldRefused: true,
			pledgeResave: ({ context }) => (context.pledgeResave === 'needed' ? 'needed' : null)
		}),

		/**
		 * a fresh id for the pledge request in flight, which every later send of that same request
		 * names (`pledgeIds` on the context): the endpoint holds nothing under the old one, or holds
		 * something that is not this pledge.
		 */
		remintPledgeId: assign(({ context }) => {
			const ports = context.ports.pledges;
			if (context.payer === null || ports === undefined) {
				throw new Error('unreachable: a pledge id is minted only for a pledge being saved');
			}
			const pledgeId = ports.id();
			const key = pledgeRequestKey(context, context.payer);
			return { pledgeId, pledgeIds: { ...context.pledgeIds, [key]: pledgeId } };
		}),

		/**
		 * the stock rail chosen by the details step's press, with the shares it pledges: the ones a
		 * `PLEDGE_STOCK` names, or the ones picked on the first step. the rail it displaces is kept to
		 * stand on again once the attempt is over (`displacedRail`).
		 */
		chooseStock: assign(({ context }, params: StockPick | undefined) => {
			const inKind = context.fv?.inKind;
			const stock =
				params ??
				(inKind?.kind === 'stock' ? { ticker: inKind.ticker, shares: inKind.shares } : null);
			return {
				stock,
				displacedRail: standingRail(context),
				payerDraft: { ...context.payerDraft, method: 'stock' as const }
			};
		}),

		/**
		 * the review step's rail, off the decided gift: a coin gift stands on the crypto rail in the coin
		 * picked on the first step, and the rail it displaces is kept to stand on again once the gift is
		 * money again (`displacedRail`). any other gift carries no coin, so no request names one.
		 */
		standOnGift: assign(({ context }) => {
			const { coin: _coin, ...payerDraft } = context.payerDraft;
			const inKind = context.fv?.inKind;
			if (inKind?.kind !== 'coin') return { payerDraft };
			return {
				displacedRail: standingRail(context),
				payerDraft: { ...payerDraft, method: 'crypto' as const, coin: inKind.coin }
			};
		}),

		/** a details-step box typed in. */
		setContact: assign({
			payerDraft: ({ context, event }) => {
				if (event.type !== 'SET_CONTACT') return context.payerDraft;
				return {
					...context.payerDraft,
					...(event.email !== undefined ? { email: event.email } : {}),
					...(event.firstName !== undefined ? { firstName: event.firstName } : {}),
					...(event.lastName !== undefined ? { lastName: event.lastName } : {})
				};
			}
		}),

		setConsent: assign({
			payerDraft: ({ context, event }) =>
				event.type === 'SET_CONSENT'
					? { ...context.payerDraft, consentedToContact: event.consented }
					: context.payerDraft
		}),

		/** the one place a donor draft becomes the payer an intent is minted for. */
		commitPayer: assign({
			payer: ({ context }) => completePayer(context.payerDraft, context.config),
			pledgeIdRetaken: false
		}),

		/**
		 * the fund's rail chosen by its own button's press, and the payer its window is opened for.
		 *
		 * one action for both, because the press is both: the rail it displaces is kept to stand on
		 * again when the attempt is over (`displacedRail`), and the estimate is restated on the fund's
		 * own fee rule so the window opens on the total the donor is asked to grant.
		 */
		chooseFund: assign(({ context }) => {
			const payerDraft = { ...context.payerDraft, method: 'daf' as const };
			const chosen = { ...context, payerDraft };
			return {
				payerDraft,
				displacedRail: standingRail(context),
				estimate: currentEstimate(chosen),
				payer: completeFundPayer(payerDraft, context.config)
			};
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

		/**
		 * what is left before the minted address stops being watched, floored at zero.
		 *
		 * off `Deposit.validUntil` and this device's clock, so a quote whose send-by has already passed
		 * here closes the address on the next tick. capped at `MICRODEPOSIT_WINDOW_MS` for the reason
		 * `verificationWindow` above gives: a delay past `setTimeout`'s 32-bit ceiling fires at once.
		 */
		depositWindow: ({ context }) => {
			const until = Date.parse(context.quote?.deposit?.validUntil ?? '');
			return Math.min(
				MICRODEPOSIT_WINDOW_MS,
				Math.max(0, (Number.isFinite(until) ? until : 0) - context.ports.now())
			);
		},

		/** the ceiling on a port the machine is allowed to give up on. */
		portTimeout: PORT_TIMEOUT_MS
	}
}).createMachine({
	id: 'checkout',
	context: ({ input }) => ({
		config: input.config,
		ports: input.ports,
		resumeToken: input.resume?.paymentToken ?? null,
		pageProgramId: input.pageProgramId ?? null,
		draft: openingDraft(input),
		fv: null,
		payerDraft: {},
		payer: null,
		estimate: null,
		quote: null,
		reconciliation: null,
		mandateAccepted: false,
		turnstileToken: null,
		challengeInteractive: false,
		verificationDeadline: null,
		failure: null,
		authorization: null,
		displacedRail: undefined,
		sentToken: null,
		heldChallenge: null,
		coinRefusal: null,
		refusedCoins: [],
		repeatingUnavailable: false,
		paymentUnavailable: null,
		employer: '',
		employerRefusal: null,
		employerWriteRefusal: null,
		pledgeId: null,
		pledgeIds: {},
		stock: null,
		custodianRefused: false,
		toldRefused: false,
		pledgeResave: null,
		pledgeIdRetaken: false,
		coinPrice: null,
		unitReturned: false,
		pricing: null,
		estimateRead: null
	}),
	// four reports from surfaces that resolve on their own schedule. none of them is a step in the
	// flow and none moves it from here, so all four are accepted wherever the machine happens to be.
	on: {
		SET_TURNSTILE_TOKEN: {
			actions: assign({ turnstileToken: ({ event }) => event.token, challengeInteractive: false })
		},
		SET_CHALLENGE_INTERACTIVE: {
			actions: assign({ challengeInteractive: ({ event }) => event.interactive })
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
		 * the payment surface reporting that a repeating gift can no longer be paid and a one-time one
		 * still can. it moves nothing: the donor may not have committed to a cadence yet, and the
		 * review step reads it against whichever one they do (`oneTimeIsOfferedInstead`).
		 */
		REPEATING_UNAVAILABLE: {
			actions: assign({ repeatingUnavailable: true })
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
		SET_METHOD: [
			// while the flow holds a rail (`isHeldRail`) — a fund's window, a gift in kind's — the box's
			// report is the rail that hold displaced, which the donor stands on again once it is over.
			{
				guard: 'holdsRail',
				actions: assign({ displacedRail: ({ event }) => event.method ?? undefined })
			},
			{
				actions: [
					assign({
						payerDraft: ({ context, event }) => ({
							...context.payerDraft,
							method: event.method ?? undefined
						}),
						// a rail reported again unchanged is not the donor changing it.
						coinRefusal: ({ context, event }) =>
							(event.method ?? undefined) === context.payerDraft.method ? context.coinRefusal : null
					}),
					'refreshEstimate'
				]
			}
		]
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
			// `on` above. the widget is drawn on the details step and outlives a move back to this one,
			// so this step is one of the three that answers.
			always: { guard: 'challengeIsHeld', target: 'failed', actions: 'deliverChallenge' },
			on: {
				SET_AMOUNT: {
					actions: assign({
						draft: ({ context, event }) => ({ ...context.draft, amountMinor: event.amountMinor }),
						coinRefusal: null
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
						draft: ({ context }) => ({ ...context.draft, amountMinor: undefined }),
						coinRefusal: null
					})
				},
				// a gift in kind is one-time only, so a repeating cadence is refused while one is picked:
				// the track draws each repeating cadence `aria-disabled` and still sends this.
				SET_FREQUENCY: {
					guard: 'cadenceIsOpen',
					actions: assign({
						draft: ({ context, event }) => ({ ...context.draft, frequency: event.frequency })
					})
				},
				/**
				 * a unit picked. a different unit drops the typed quantity, which was a count of the old
				 * one; picking the currency again restores no cadence the coin or stock displaced. the same
				 * coin picked again over an amount no read has priced asks again (`priceTyped`).
				 */
				SET_UNIT: {
					guard: 'unitIsOffered',
					actions: [
						assign(({ context, event }) => {
							const changed = !sameUnit(context.draft.unit, event.unit);
							return {
								draft: {
									...context.draft,
									unit: event.unit,
									...(changed ? { quantity: undefined } : {}),
									...(isInKind(event.unit) ? { frequency: 'one_time' as const } : {})
								},
								coinRefusal: changed ? null : context.coinRefusal,
								unitReturned: false
							};
						}),
						'priceTyped'
					]
				},
				/**
				 * a coin amount or share count typed, and a coin amount priced (`priceTyped`). a refusal of
				 * the amount is lifted by it; a refusal of the coin is not, since no amount of it is taken.
				 */
				SET_QUANTITY: {
					actions: [
						assign({
							draft: ({ context, event }) => ({ ...context.draft, quantity: event.quantity }),
							coinRefusal: ({ context }) =>
								context.coinRefusal?.code === 'coin_not_accepted' ? context.coinRefusal : null
						}),
						'priceTyped'
					]
				},
				// the newer amount's read replaces the one before it, which is stopped and so aborted. a
				// read with no answer after `PORT_TIMEOUT_MS` is answered as a failed one, for the
				// reason `PORT_TIMEOUT_MS` gives.
				PRICE_COIN: {
					actions: enqueueActions(({ context, enqueue }) => {
						if (context.estimateRead !== null) enqueue.stopChild(context.estimateRead);
						enqueue.cancel(ESTIMATE_TIMEOUT);
						const { pricing } = context;
						if (pricing !== null) {
							enqueue.raise(
								{ type: 'COIN_PRICED', ...pricing, estimateMinor: null },
								{ id: ESTIMATE_TIMEOUT, delay: PORT_TIMEOUT_MS }
							);
						}
						enqueue.assign({
							estimateRead: ({ spawn }) =>
								pricing === null
									? null
									: spawn('readEstimate', {
											input: { ports: context.ports, formId: context.config.formId, ...pricing }
										})
						});
					})
				},
				// an answer for anything but the amount waiting to be priced is stale, and dropped.
				// the read is stopped once answered, which aborts it where the answer was the timeout's.
				COIN_PRICED: {
					guard: 'pricesWhatIsTyped',
					actions: enqueueActions(({ context, event, enqueue }) => {
						if (context.estimateRead !== null) enqueue.stopChild(context.estimateRead);
						enqueue.cancel(ESTIMATE_TIMEOUT);
						enqueue.assign({
							coinPrice: { coin: event.coin, quantity: event.quantity, minor: event.estimateMinor },
							pricing: null,
							estimateRead: null
						});
					})
				},
				SET_NOTE: {
					actions: assign({
						draft: ({ context, event }) => ({ ...context.draft, note: event.note })
					})
				},
				SET_PROGRAM: { actions: 'pickProgram' },
				/**
				 * the donor opening the note, or closing it again.
				 *
				 * an opened note is `''` and a closed one is absent, which is the distinction
				 * `missingAmountDecisions` (./value.ts) reads to hold a donor to a note they asked
				 * for. closing it drops what was typed: the donor has said there is no note, and a
				 * draft that kept the text would carry it to the endpoint on a gift whose card no
				 * longer shows it. the consent to show it goes with it, either way: an opened note
				 * starts private.
				 */
				TOGGLE_NOTE: {
					actions: assign({
						draft: ({ context }) => ({
							...context.draft,
							note: context.draft.note === undefined ? '' : undefined,
							noteShown: undefined
						})
					})
				},
				/**
				 * the donor asking to show the note, or taking it back. dropped on a closed note, for
				 * `SET_TRIBUTE`'s reason below; taking it back takes "Anonymous" with it.
				 */
				TOGGLE_NOTE_PUBLIC: {
					actions: assign({
						draft: ({ context }) => {
							const { note, noteShown } = context.draft;
							if (note === undefined) return context.draft;
							return { ...context.draft, noteShown: noteShown === undefined ? 'named' : undefined };
						}
					})
				},
				/** signing a shown note "Anonymous", or by name again. dropped on a private note. */
				TOGGLE_NOTE_ANONYMOUS: {
					actions: assign({
						draft: ({ context }) => {
							const { noteShown } = context.draft;
							if (noteShown === undefined) return context.draft;
							return {
								...context.draft,
								noteShown: noteShown === 'named' ? 'anonymous' : 'named'
							};
						}
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
				 *
				 * except on a form whose first step offers a coin or stock, which the box does not carry:
				 * there the report is held (`paymentUnavailable`), a gift in kind goes on, and a gift of
				 * money is refused once it reaches the review step (`moneyHasNoBox`).
				 */
				PAYMENT_UNAVAILABLE: [
					{ guard: 'givesInKindWithoutBox', actions: 'holdBoxDown' },
					{ target: 'failed', actions: assign({ failure: ({ event }) => event.failure }) }
				]
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
				SET_CONTACT: { actions: 'setContact' },
				SET_CONSENT: { actions: 'setConsent' },
				SET_PROGRAM: { actions: 'pickProgram' },
				// a press with a field still missing stays on this step, the way the amount step's
				// own does: the guard is what stops a donor reaching the screen that spends the money
				// with no address for the receipt it produces.
				// a stock gift has no review step: its pledge is saved from this press, on the rail the pick
				// set, through `holding` for a token. money and a coin go on to the review step.
				CONTINUE: [
					{ guard: 'givesStockFromHere', target: 'holding', actions: 'chooseStock' },
					{ guard: 'reviewsFromHere', target: 'give' }
				],
				/**
				 * a stock pledge saved from here, through `holding` as the review step's press is, so it
				 * waits on a challenge token it may spend. the rail is set with the shares: a stock gift
				 * has no row in the payment box for a donor to open. the rail it displaces is kept to
				 * stand on again once the attempt is over (`displacedRail`), so a press on the review
				 * step after a failed save pays by the rail its box shows rather than saving these shares.
				 */
				PLEDGE_STOCK: {
					guard: 'stockCanPledge',
					target: 'holding',
					actions: {
						type: 'chooseStock',
						params: ({ event }) => ({ ticker: event.ticker, shares: event.shares })
					}
				},
				/**
				 * the marks: the amount step behind, the review step ahead.
				 *
				 * `BACK` is not handled here. the way back off a numbered step is a mark; `BACK` is
				 * sent only by the correction screen and an open deposit address (`BACK` above).
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
				// held on a form offering a gift in kind, for the reason the `amount` step's says.
				PAYMENT_UNAVAILABLE: [
					{ guard: 'givesInKindWithoutBox', actions: 'holdBoxDown' },
					{ target: 'failed', actions: assign({ failure: ({ event }) => event.failure }) }
				]
			}
		},

		/**
		 * step 3 — the receipt, the provider's own fields, and the press that spends the money.
		 *
		 * the last step a donor edits anything on, and the only one that states a total. the fee
		 * decision lives here rather than on the step before it because the control that offers it
		 * sits inside the receipt, and the receipt is here.
		 *
		 * a coin gift's is the receipt and the switch alone: its rail is the coin's (`standOnGift`),
		 * so no provider's fields are asked for, and its press mints the address.
		 */
		give: {
			// entered from the step before it and from every way back into the pair, so the attempt
			// is begun here too — see `beginAttempt`, which is idempotent for exactly this.
			entry: ['beginAttempt', 'standOnGift', 'refreshEstimate'],
			// the step a Try again usually lands on, which makes it the usual place a report held
			// through a charge is delivered — see the `amount` step's own. the payment box's report is
			// held for a gift of money until it stands here, where the box is.
			always: [
				{ guard: 'challengeIsHeld', target: 'failed', actions: 'deliverChallenge' },
				{ guard: 'moneyHasNoBox', target: 'failed', actions: 'deliverBoxDown' }
			],
			on: {
				SET_PROGRAM: { actions: 'pickProgram' },
				SET_CUSTODIAN: {
					actions: assign({
						payerDraft: ({ context, event }) => ({
							...context.payerDraft,
							custodian: event.custodian
						}),
						custodianRefused: false
					})
				},
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
				// the only thing this press can be refused for here is the rail. a press taken goes
				// through `holding`, which a held token passes straight through.
				SUBMIT: { guard: 'payerIsComplete', target: 'holding' },
				OPEN_FUND: { guard: 'fundCanOpen', target: 'authorizing', actions: 'chooseFund' },
				/**
				 * the donor taking the offer of a one-time gift in place of the repeating one no
				 * processor still up can take. the step is entered again, so the attempt is begun
				 * afresh and the estimate restated, and the one-time rails stand on it from this
				 * reading on.
				 */
				MAKE_ONE_TIME: {
					guard: 'repeatingIsRefused',
					target: 'give',
					reenter: true,
					actions: assign({
						draft: ({ context }) => ({ ...context.draft, frequency: 'one_time' }),
						fv: ({ context }) => context.fv && { ...context.fv, frequency: 'one_time' }
					})
				},
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
				// held on a form offering a gift in kind, for the reason the `amount` step's says; the
				// `always` above refuses a gift of money with it straight away.
				PAYMENT_UNAVAILABLE: [
					{ guard: 'givesInKindWithoutBox', actions: 'holdBoxDown' },
					{ target: 'failed', actions: assign({ failure: ({ event }) => event.failure }) }
				]
			}
		},

		/**
		 * a press taken on the review step, waiting on a challenge token it may spend.
		 *
		 * the widget and the ALTCHA solve both answer in the background, and a donor quicker than
		 * either would otherwise send no token, or the one the last send spent, and be refused
		 * `challenge_failed` for nothing they did. so the press waits here on the review step, busy,
		 * and is sent the moment a fresh token lands — in the same breath where one already has, so
		 * the ordinary press never stands here at all.
		 *
		 * the payer is committed on the way out rather than on the press, so the request carries
		 * what the card shows when it is sent. a rail the payment surface withdrew in the meantime
		 * is a press it would have refused, and goes back to the step to be made again.
		 *
		 * nothing has been sent, so every way this ends short of a token is safe to end on `failed`:
		 * a challenge reporting it will never mint one, and a wait long enough to be one that is not
		 * coming — a solve that stalled. a widget asking the visitor to interact is no such wait: the
		 * element draws it beside the press (`#start` in ./element.ts) and the wait is off for as long
		 * as they are solving it.
		 */
		holding: {
			always: [
				{ guard: 'challengeIsHeld', target: 'failed', actions: 'deliverChallenge' },
				{ guard: 'moneyHasNoBox', target: 'failed', actions: 'deliverBoxDown' },
				// a stock press is held on the details step, whose boxes stay open beside the puzzle.
				{ guard: and([not('payerIsComplete'), 'givesStock']), target: 'details' },
				{ guard: not('payerIsComplete'), target: 'give' },
				{ guard: 'tokenIsFresh', target: 'quoting', actions: 'commitPayer' }
			],
			after: {
				portTimeout: {
					guard: not('challengeIsInteractive'),
					target: 'failed',
					actions: assign({
						failure: (): Failure => ({
							message: CHECK_UNFINISHED,
							fix: `No fresh challenge token arrived within ${PORT_TIMEOUT_MS}ms of the press, so nothing was sent.`
						})
					})
				}
			},
			on: {
				// a stock gift's held press is sent with what its boxes hold when the token lands
				// (`commitPayer` above), so a box typed in meanwhile is kept.
				SET_CONTACT: { actions: 'setContact' },
				SET_CONSENT: { actions: 'setConsent' },
				// a stock gift's press is held on the details step, whose mark back to the first step
				// stays a way back: nothing has been sent, so leaving abandons nothing.
				GO_TO_STEP: {
					guard: 'givesStockToFirstStep',
					target: 'amount'
				},
				// re-entered so the wait runs again from here: a puzzle put away without a token
				// is the wait starting over, and one being solved is no wait at all.
				SET_CHALLENGE_INTERACTIVE: {
					target: 'holding',
					reenter: true,
					actions: assign({ challengeInteractive: ({ event }) => event.interactive })
				},
				// held on a form offering a gift in kind, for the reason the `amount` step's says; the
				// `always` above refuses a held press of money with it straight away.
				PAYMENT_UNAVAILABLE: [
					{ guard: 'givesInKindWithoutBox', actions: 'holdBoxDown' },
					{ target: 'failed', actions: assign({ failure: ({ event }) => event.failure }) }
				]
			}
		},

		/**
		 * a donor-advised fund's window is open, and the flow waits on the donor inside it.
		 *
		 * no timeout: the donor is signing in to their fund and choosing a grant, which takes as long
		 * as it takes, and nothing has been sent anywhere yet. closing without an approval goes back
		 * to the review step with nothing sent; an approval goes on to the quote, which is where the
		 * challenge token is read — after the window, so a token minted before a long stay in it has
		 * already been replaced by the widget (`refresh-expired` in ./embed/turnstile.ts).
		 */
		authorizing: {
			on: {
				FUND_APPROVED: {
					target: 'quoting',
					actions: assign({
						authorization: ({ event }) => ({
							authorizationId: event.authorizationId,
							authorizedMinor: event.authorizedMinor
						})
					})
				},
				FUND_CLOSED: { target: 'give' }
			}
		},

		/**
		 * a fund's approval, about to be sent again, waiting on a token it may spend.
		 *
		 * the server answers a repeated session with the grant it already holds, so the approval is
		 * sent again rather than asked of the donor a second time. the widget is reset on the way out
		 * of the send that failed (`#start` in ./element.ts), and this waits for the token it mints —
		 * the one before it was spent by that send. the root takes the token; the check below runs on
		 * every event that lands here.
		 */
		resending: {
			always: { guard: 'tokenIsFresh', target: 'quoting' },
			after: {
				portTimeout: {
					target: 'failed',
					actions: assign({
						failure: (): Failure => ({
							message: FUND_REQUEST_MAY_BE_SENT,
							fix: `No fresh challenge token arrived within ${PORT_TIMEOUT_MS}ms to send the fund's approval again. The approval is kept for the next attempt.`
						})
					})
				}
			}
		},

		/**
		 * a pledge save refused `pledge_id_taken`, about to be sent once more under the fresh id the
		 * refusal minted, waiting on a token it may spend: the refused send spent the last one, and the
		 * widget is reset on the way in (`#start` in ./element.ts). nothing was saved, so a wait that
		 * runs out ends on `failed` with nothing to undo.
		 */
		retaking: {
			always: { guard: 'tokenIsFresh', target: 'quoting' },
			after: {
				portTimeout: {
					target: 'failed',
					actions: assign({
						failure: (): Failure => ({
							message: GENERIC_FAILURE,
							fix: `No fresh challenge token arrived within ${PORT_TIMEOUT_MS}ms to send the pledge again under a fresh \`pledgeId\`, so nothing was saved.`
						})
					})
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
			entry: assign(({ context }) => {
				const sentToken = context.turnstileToken;
				const payer = context.payer;
				const ports = context.ports.pledges;
				if (payer === null || !isPledgeRail(payer.method) || ports === undefined) {
					return { sentToken };
				}
				// one id per distinct request (`pledgeIds` on the context).
				const key = pledgeRequestKey(context, payer);
				const pledgeId = context.pledgeIds[key] ?? ports.id();
				return { sentToken, pledgeId, pledgeIds: { ...context.pledgeIds, [key]: pledgeId } };
			}),
			invoke: {
				src: 'mintQuote',
				input: ({ context }) => {
					if (context.payer === null) throw new Error('unreachable: guarded by payerIsComplete');
					return { ports: context.ports, request: minting(context, context.payer) };
				},
				onDone: [
					{
						guard: { type: 'quoteIsPledge', params: ({ event }) => ({ quote: event.output }) },
						target: 'pledged',
						actions: assign({ quote: ({ event }) => event.output })
					},
					{
						guard: 'savesPledge',
						target: 'failed',
						actions: assign({
							failure: (): Failure => ({
								message: PLEDGE_UNSAVED,
								fix: 'POST /api/v1/forms/:id/donations answered a pledge save without the pledge it saved. Check that the answer carries `pledge` with the id the request sent and every field `Pledge` in packages/form/src/v1.ts names.'
							})
						})
					},
					{
						// the grant is created inside this same request, so a usable answer is the gift
						// made — pending until the fund pays it, which is `processing`'s own claim.
						guard: { type: 'quoteIsGrant', params: ({ event }) => ({ quote: event.output }) },
						target: 'processing',
						actions: assign({ quote: ({ event }) => event.output })
					},
					{
						guard: { type: 'quoteIsDeposit', params: ({ event }) => ({ quote: event.output }) },
						target: 'awaitingDeposit',
						actions: assign({ quote: ({ event }) => event.output })
					},
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
							}),
							// the same approval would be answered with the same unusable body.
							authorization: null
						})
					}
				],
				onError: [
					{
						guard: 'retakesPledgeId',
						target: 'retaking',
						actions: ['remintPledgeId', assign({ pledgeIdRetaken: true })]
					},
					{
						guard: 'pledgeIdIsTaken',
						target: 'failed',
						actions: assign({
							failure: (): Failure => ({
								message: GENERIC_FAILURE,
								fix: 'POST /api/v1/forms/:id/donations refused both the `pledgeId` and the fresh one minted after it as `pledge_id_taken`, so nothing was saved. Check that `pledges.id` mints a new UUID on every call.'
							})
						})
					},
					// a refusal a donor fixes on a step of the form skips the failure screen and lands
					// them on that step, where the refusal is stated.
					{
						guard: 'refusesAmountForCoin',
						target: 'amount',
						actions: assign({
							coinRefusal: ({ context, event }) => coinRefusalOf(context, event.error)
						})
					},
					{
						guard: 'refusesCustodian',
						target: 'give',
						actions: assign({ custodianRefused: true })
					},
					{
						guard: 'refusesCoin',
						target: 'amount',
						actions: assign(({ context, event }) => {
							const refusal = coinRefusalOf(context, event.error);
							return {
								coinRefusal: refusal,
								refusedCoins:
									refusal === null || context.refusedCoins.includes(refusal.coin)
										? context.refusedCoins
										: [...context.refusedCoins, refusal.coin]
							};
						})
					},
					{
						target: 'failed',
						actions: assign({
							failure: ({ context, event }) => {
								const failure = toFailure(event.error);
								if (context.authorization !== null && maybeSentGrant(event.error)) {
									return { ...failure, message: FUND_REQUEST_MAY_BE_SENT };
								}
								if (pledgeMayBeSaved(context, event.error)) {
									return { ...failure, message: PLEDGE_UNSAVED };
								}
								switch (errorCode(event.error)) {
									case 'daf_authorization_expired':
										return { ...failure, message: FUND_APPROVAL_EXPIRED };
									// the fund refusing under its own rules is the one refusal a quote carries
									// that is the rail's, so it is marked the way `rememberDecline` marks one.
									case 'daf_grant_declined':
										return { ...failure, refusedByRail: true };
									case 'ticker_not_listed':
									case 'pledge_detail_invalid':
										return context.payer?.method === 'stock'
											? { ...failure, refusedStock: true }
											: failure;
									default:
										return failure;
								}
							},
							// a kept approval is sent again by a Try again (`resending` below).
							authorization: ({ context, event }) =>
								keepsFundApproval(event.error) ? context.authorization : null
						})
					}
				]
			},
			after: {
				portTimeout: {
					target: 'failed',
					actions: assign({
						failure: ({ context }): Failure => {
							if (context.authorization !== null) {
								return {
									message: FUND_REQUEST_MAY_BE_SENT,
									fix: `POST /api/v1/forms/:id/donations did not answer within ${PORT_TIMEOUT_MS}ms. The fund's approval is kept, and the next attempt sends it again.`
								};
							}
							if (context.payer !== null && isPledgeRail(context.payer.method)) {
								return {
									message: PLEDGE_UNSAVED,
									fix: `POST /api/v1/forms/:id/donations did not answer within ${PORT_TIMEOUT_MS}ms. The pledge may be saved, and the next attempt on the same request sends the same \`pledgeId\`.`
								};
							}
							return {
								message: GENERIC_FAILURE,
								fix: `POST /api/v1/forms/:id/donations did not answer within ${PORT_TIMEOUT_MS}ms. Nothing was authorized, so this attempt can be made again.`
							};
						}
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
		 * an address is minted and the flow waits for the donor's coin to arrive at it.
		 *
		 * the gift is read every `DEPOSIT_POLL_MS` for as long as this state stands, and on no other
		 * screen. a reading that is not `received` or `expired` — `waiting`, a rejection, a body that
		 * is not ours, no answer inside `PORT_TIMEOUT_MS` — changes nothing and says nothing: the
		 * endpoint's rate limit answers with no CORS headers, so a limited read is indistinguishable
		 * here from a dropped connection, and neither says the address closed.
		 */
		awaitingDeposit: {
			type: 'parallel',
			states: {
				/**
				 * whether the address is still one to send to, by this device's clock.
				 *
				 * past `Deposit.validUntil` the address, the memo and every way to copy them are
				 * withdrawn so nobody sends to an address no longer watched, and the reading goes on:
				 * a coin sent before then may still arrive. the way back to the first step is on the open
				 * address alone, because the closed one's screen draws no control.
				 */
				address: {
					initial: 'open',
					states: {
						// "Change what you give": the first step, where the coin was picked, with the pick and
						// its amount kept and the pill to be focused (`unitReturned`).
						open: {
							after: { depositWindow: 'closed' },
							on: {
								BACK: { target: '#checkout.amount', actions: assign({ unitReturned: true }) }
							}
						},
						closed: {}
					}
				},
				reading: {
					initial: 'resting',
					states: {
						resting: { after: { [DEPOSIT_POLL_MS]: 'asking' } },
						asking: {
							invoke: {
								src: 'readDeposit',
								input: ({ context }) => {
									if (context.quote === null) {
										throw new Error('unreachable: an address is only awaited past a quote');
									}
									return {
										ports: context.ports,
										formId: context.config.formId,
										paymentToken: context.quote.paymentToken
									};
								},
								onDone: [
									{
										guard: { type: 'depositReads', params: { state: 'received' } },
										target: '#checkout.success'
									},
									{
										guard: { type: 'depositReads', params: { state: 'expired' } },
										target: '#checkout.depositExpired'
									},
									{ target: 'resting' }
								],
								onError: { target: 'resting' }
							},
							after: { portTimeout: 'resting' }
						}
					}
				}
			}
		},

		/**
		 * the address closed with nothing received, as the server read it.
		 *
		 * `RETRY` goes to the review step for the reason `verificationExpired` below gives: the entry
		 * there drops the spent quote and stands on the coin's rail again (`standOnGift`), so the next
		 * press mints a fresh address for the same coin.
		 */
		depositExpired: {
			on: {
				RETRY: { target: 'give' }
			}
		},

		/**
		 * a stock or IRA (QCD) pledge is saved, and the donor is shown where their broker or custodian
		 * sends it.
		 *
		 * the save is the answer that landed here: nothing is charged and nothing is confirmed after it,
		 * and the gift counts once the organisation's staff mark it received. what is left on this
		 * screen is the donor saying they have asked for the transfer, which tells the organisation
		 * (`TELL_ORGANIZATION`). terminal without being `final`, for `success`'s reason below.
		 *
		 * a told press that fails goes back to `pending` with the refusal standing, and the press is
		 * the same event again. the pledge is saved either way, which is what the refusal says, except
		 * where the endpoint answered `pledge_not_found`: the next press saves it again under a new id
		 * and tells nobody, and the press after that tells (`pledgeResave` on the context).
		 */
		pledged: {
			initial: 'pending',
			states: {
				pending: {
					on: {
						TELL_ORGANIZATION: { target: 'telling', actions: assign({ pledgeIdRetaken: false }) }
					}
				},
				/**
				 * the told press in flight, or, where the endpoint found no pledge under the last id, the
				 * save again in its place: the same request under the id that refusal minted, on a fresh
				 * challenge token. its answer is the pledge the screen draws from then on, new reference
				 * included, and the donor tells the organisation with the press after it, once they have
				 * the reference their transfer names.
				 */
				telling: {
					initial: 'choosing',
					states: {
						choosing: {
							always: [{ guard: 'pledgeIsLost', target: 'awaitingToken' }, { target: 'posting' }]
						},
						/**
						 * the wait `holding` is, on this screen: a challenge that will never mint a token
						 * refuses the press at once and stays reported, so each press after it is refused
						 * as quickly; and a widget asking the donor to solve something is drawn on this
						 * screen (`#start` in ./element.ts) and is no wait at all while they solve it.
						 */
						awaitingToken: {
							always: [
								{
									guard: 'challengeIsHeld',
									target: '#checkout.pledged.pending',
									actions: 'refuseTold'
								},
								{ guard: 'tokenIsFresh', target: 'saving' }
							],
							after: {
								portTimeout: {
									guard: not('challengeIsInteractive'),
									target: '#checkout.pledged.pending',
									actions: 'refuseTold'
								}
							},
							on: {
								// re-entered so the wait runs again from here, for the reason `holding`'s is.
								SET_CHALLENGE_INTERACTIVE: {
									target: 'awaitingToken',
									reenter: true,
									actions: assign({ challengeInteractive: ({ event }) => event.interactive })
								}
							}
						},
						saving: {
							entry: assign({ sentToken: ({ context }) => context.turnstileToken }),
							invoke: {
								src: 'mintQuote',
								input: ({ context }) => {
									if (context.payer === null) {
										throw new Error('unreachable: a pledge is shown only once it is saved');
									}
									return { ports: context.ports, request: minting(context, context.payer) };
								},
								onDone: [
									{
										guard: {
											type: 'quoteIsPledge',
											params: ({ event }) => ({ quote: event.output })
										},
										target: '#checkout.pledged.pending',
										actions: assign({
											quote: ({ event }) => event.output,
											toldRefused: false,
											pledgeResave: 'done'
										})
									},
									{ target: '#checkout.pledged.pending', actions: 'refuseTold' }
								],
								onError: [
									// back for a token, since the refused send spent this one (`retaking` above).
									{
										guard: 'retakesPledgeId',
										target: 'awaitingToken',
										actions: ['remintPledgeId', assign({ pledgeIdRetaken: true })]
									},
									{ target: '#checkout.pledged.pending', actions: 'refuseTold' }
								]
							},
							after: {
								portTimeout: { target: '#checkout.pledged.pending', actions: 'refuseTold' }
							}
						},
						posting: {
							invoke: {
								src: 'tellOrganization',
								input: ({ context }) => {
									if (context.pledgeId === null) {
										throw new Error('unreachable: a pledge is shown only once it is saved');
									}
									return {
										ports: context.ports,
										formId: context.config.formId,
										pledgeId: context.pledgeId
									};
								},
								onDone: {
									target: '#checkout.pledged.told',
									actions: assign({ toldRefused: false, pledgeResave: null })
								},
								onError: [
									{
										guard: 'toldFindsNoPledge',
										target: '#checkout.pledged.pending',
										actions: [
											assign({ toldRefused: true, pledgeResave: 'needed' }),
											'remintPledgeId'
										]
									},
									{
										target: '#checkout.pledged.pending',
										actions: assign({ toldRefused: true, pledgeResave: null })
									}
								]
							},
							after: {
								portTimeout: { target: '#checkout.pledged.pending', actions: 'refuseTold' }
							}
						}
					}
				},
				told: {}
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
		success: {
			initial: 'opening',
			states: {
				/** which of the two thank-yous this gift gets, decided once on arrival. */
				opening: {
					always: [{ guard: 'asksForEmployer', target: 'asking' }, { target: 'unasked' }]
				},
				/** no gift page to name an employer on, so the thank-you is the receipt alone. */
				unasked: {},
				asking: {
					on: {
						// a blank press is answered by the box holding an answer, which hands back the
						// failed write it stood over: that is answered only by a write that lands.
						SET_EMPLOYER: {
							actions: assign({
								employer: ({ event }) => event.employer,
								employerRefusal: ({ context, event }) =>
									context.employerRefusal === 'blank' && employerAnswer(event.employer) !== null
										? context.employerWriteRefusal
										: context.employerRefusal
							})
						},
						// a blank box takes the press, Enter included, and is refused for it.
						SEND_EMPLOYER: [
							{ guard: 'employerIsGiven', target: 'sending' },
							{ actions: assign({ employerRefusal: 'blank' }) }
						],
						// a refusal leaves with the ask, so the card's region stops saying it.
						SKIP_EMPLOYER: {
							target: 'skipped',
							actions: assign({ employerRefusal: null, employerWriteRefusal: null })
						}
					}
				},
				/**
				 * the write is in flight. a refusal, a dropped answer or no answer inside
				 * `PORT_TIMEOUT_MS` reopens the ask with the donor's text kept, and a second press
				 * sends it again: the endpoint records the employer named last. a refusal stands
				 * until a write lands, resend included.
				 *
				 * the box stays open to typing, and what is typed here is what a reopened ask holds;
				 * the write already sent carries the text as it was pressed. Skip is drawn and
				 * pressable throughout, so it is taken here too: leaving stops the invoked write,
				 * which aborts its request (`CheckoutPorts.employer` in ./ports.ts), and its answer
				 * lands on nothing.
				 */
				sending: {
					on: {
						SET_EMPLOYER: { actions: assign({ employer: ({ event }) => event.employer }) },
						SKIP_EMPLOYER: {
							target: 'skipped',
							actions: assign({ employerRefusal: null, employerWriteRefusal: null })
						}
					},
					invoke: {
						src: 'writeEmployer',
						input: ({ context }) => {
							const giftToken = giftTokenOf(context);
							const employer = employerAnswer(context.employer);
							if (giftToken === null || employer === null) {
								throw new Error('unreachable: a send is taken only past both guards');
							}
							return { ports: context.ports, formId: context.config.formId, giftToken, employer };
						},
						onDone: {
							target: 'sent',
							actions: assign({ employer: '', employerRefusal: null, employerWriteRefusal: null })
						},
						onError: {
							target: 'asking',
							actions: assign({ employerRefusal: 'refused', employerWriteRefusal: 'refused' })
						}
					},
					after: {
						portTimeout: {
							target: 'asking',
							actions: assign({
								employerRefusal: 'unconfirmed',
								employerWriteRefusal: 'unconfirmed'
							})
						}
					}
				},
				sent: {},
				skipped: {}
			}
		},

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
					{ guard: 'grantIsHeld', target: 'resending' },
					{ guard: not('amountIsDecided'), target: 'amount' },
					{ guard: not('payerFieldsAreGiven'), target: 'details' },
					{ guard: 'stockIsRefused', target: 'amount' },
					// a stock gift is saved by the details step's Continue and has no review step, so its
					// Try again is that save again, on the rail it held: straight to `holding`, where
					// landing on the details step would drop the rail (`beginAttempt`) and ask for the
					// press a second time.
					{ guard: 'givesStock', target: 'holding' },
					// a gift of money with no payment box goes back to the first step, where a coin or
					// stock can still be given (`paymentUnavailable`).
					{ guard: 'moneyHasNoBox', target: 'amount' },
					{ target: 'give' }
				]
			}
		}
	}
});
