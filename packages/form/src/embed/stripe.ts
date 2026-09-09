// the payment adapter: Stripe.js behind ../ports.ts, and the only module in `packages/form/src/**`
// that knows a payment SDK exists.
//
// the same shape `src/lib/server/payments/stripe.ts` holds on the server — one file imports the
// vendor, everything above it takes types this repository defines. here it buys one more thing
// than containment: ../checkout.machine.ts stays testable with no browser and no account,
// because everything worldly reaches it as a function rather than as an import.
//
// the deferred intent flow, and it is forced rather than chosen. the provider's fields have to
// be on screen while the donor fills them in, and the intent that names the amount is not minted
// until they press Donate — so the element group is created with no client secret and the secret
// arrives at confirmation. that shape is the deferred Payment Intent flow with Elements.
//
// what the group is created *for* is `mode`, and it follows the cadence the donor commits to: a
// gift collected once is `payment`, one collected again is `subscription`. the group renders the
// terms a schedule is authorized under only in the second, so a repeat confirmed on the first is a
// donor committed to something they were never shown — see `cadence` below. the confirmation
// itself is the same call either way, because a commitment's first collection hands back a payment
// intent's own secret, and `confirmPayment` and `retrievePaymentIntent` need no branch for it.
//
// what this module never does is decide an amount. `quoted` takes the server's own total and
// echoes it into the element group, where it is display copy for wallet and pay-later surfaces
// and nothing else; the figure that is charged is the one on the intent the server minted.
//
// `@stripe/stripe-js/pure` rather than the default entry: the default injects the provider's
// script tag when this module is imported, and this runtime is on pages that may hold no form at
// all. the loader is also what makes a second copy impossible — it adopts a `js.stripe.com`
// script the host page already has rather than adding one.
//
// `../../package.json` exports this module as `./embed/stripe`. the deployment's own donation page
// mounts this same surface, which is how the containment above reaches that page too: it declares
// no payment SDK of its own, and the vendor import stays in one file for both surfaces.

import type { StripePaymentElementOptions } from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js/pure';
import type { Failure } from '../checkout.machine';
import type { CheckoutPorts, ConfirmOutcome } from '../ports';
import { resolveAppearance } from '../styles/resolve';
import { INJECTING_NONCE } from './nonce';
import { RAILS } from './rails';
import { stampReturnUrl } from './resume';
import type { FormConfig, Frequency, PaymentMethod, Quote, QuoteRequest } from '../v1';
import {
	donorsOwn,
	outcomeOf,
	outcomeOfConfirmation,
	UNCONFIRMABLE,
	type ConfirmResult,
	type StripeErrorLike
} from './outcome';

/**
 * whether a rail may be collected from again on a schedule.
 *
 * total over `PaymentMethod` for the reason `RAILS` above is: a rail added to `PAYMENT_METHODS` in
 * ../v1.ts has to answer this question rather than inherit an answer, and the answer it would
 * inherit is a donor authorizing a repeat on a rail nothing can collect from a second time.
 *
 * both rails this deployment quotes on answer yes. cards and ACH Direct Debit are each supported by
 * Subscriptions and by the Payment Element in the provider's own product-support table
 * (https://docs.stripe.com/payments/payment-methods/payment-method-support#product-support), so
 * nothing is dropped today — what the filter in `createPaymentSurface` buys is that this stays a
 * decision rather than an assumption. the wallets answer for the card they are delivered as, which
 * is the same thing `RAILS` above already says about them.
 */
const REPEATING_RAILS: Readonly<Record<PaymentMethod, boolean>> = Object.freeze({
	card: true,
	apple_pay: true,
	google_pay: true,
	ach: true
});

/** what a donor is told when the provider's own script never arrived. */
const UNLOADABLE =
	'This gift could not be sent to the payment provider, and nothing was charged. Check the ' +
	'connection and try again.';

/**
 * what a donor is told when the provider's fields could not be put into the shape the gift needs.
 *
 * said as a refusal because nothing has been authorized at the point it is discovered: the ask is
 * made while the donor is still filling the form in, and it is read at the top of a confirmation,
 * before anything is submitted.
 */
const UNSHAPED = 'This gift could not be prepared for payment, and nothing was charged. Try again.';

/**
 * what a donor is told when the provider's own fields never appeared.
 *
 * a refusal, and it is one: this is discovered while the donor is still filling the form in, with
 * no intent minted and nothing authorized.
 *
 * it names the reload rather than the Retry the `failed` screen also offers, because the fields are
 * not coming back on this page load: the element group is built once for the life of the card, so
 * only a fresh one — which a re-boot of the element is, and a reload is the reliable way to get one
 * — can succeed where this failed. A donor who presses Retry lands back on the same dead form,
 * which is why the sentence points past it.
 */
const NO_FIELDS =
	'The payment details on this form did not load, and nothing was charged. Reload the page to ' +
	'try again.';

/**
 * how long the provider is given to finish putting its own fields on screen.
 *
 * exported so a spec asserts the boundary rather than a number copied out of this file, which is
 * how a window silently stops being tested when it is changed — the same reason
 * `MICRODEPOSIT_WINDOW_MS` is exported from ../checkout.machine.ts.
 *
 * the deadline exists because a stalled mount names itself in no other way. Mounted into a shadow
 * root the element group fires `loaderstart`, builds its container, and then reports nothing ever
 * again: no `ready`, no `loaderror`, and a frame two pixels high. So the absence of `ready` is the
 * only signal there is, and a subscription to `loaderror` alone would watch that failure happen.
 *
 * one window and two things measured against it, never at once: getting the provider's script, and
 * then mounting the group it builds. a script tag that fires neither `load` nor `error` is the same
 * silence one step earlier — `loadStripeScript` below settles on those two events and on nothing
 * else — and the donor is told the same sentence for it.
 *
 * thirty seconds because the cost of the two mistakes is not symmetric. The fields ordinarily
 * appear in under two; a deadline tight enough to be quick is one that refuses a gift from a donor
 * on a slow connection whose fields were about to arrive, and no figure this generous has any
 * chance of expiring in front of one whose fields did.
 */
export const MOUNT_DEADLINE_MS = 30_000;

/**
 * the provider's own words about a confirmation that did not go through, where somebody can read
 * them.
 *
 * nothing else carries them. `ConfirmOutcome` in ../ports.ts is the donor's vocabulary and has no
 * room for a parameter name — rightly, because a donor can act on none of it — so a fault in this
 * integration otherwise reaches nobody at all: the console of the page the form is embedded in
 * stays empty, and the form silently does nothing. this is the same channel ./loader.ts uses for a
 * runtime that would not load, for the same reason.
 *
 * the sentence only, never the payload it came in. a confirmation result carries the donor's own
 * details, and a page this project does not own is the last place to put them.
 */
function report(what: string, reason: unknown): void {
	console.error(`${what}: ${named(reason)}`);
}

/** what the console is told about a gift that never reached the rail. */
const UNCONFIRMED =
	'a donation could not be confirmed with the payment provider, and nothing was charged';

/**
 * what the console is told about a gift this page came back to and could not read.
 *
 * it claims nothing about the money, and that is the difference from `UNCONFIRMED` above: a resume
 * reads an intent that may well have been charged, so a line saying otherwise would send whoever
 * is debugging it looking for a payment that is sitting in the dashboard.
 */
const UNREADABLE = 'a donation this page came back to could not be read from the payment provider';

/**
 * whether the provider refused the call rather than failing to answer it.
 *
 * read off the thrown error's own name, which is the only thing that distinguishes the two — the
 * SDK exports no class to test against. an unrecognised name is treated as an answer nobody has,
 * which is the direction that costs nothing if this name is ever spelled differently: the flow
 * re-reads the intent instead of putting a Retry in front of a donor who may already have paid.
 */
function isIntegrationError(thrown: unknown): boolean {
	return (
		typeof thrown === 'object' &&
		thrown !== null &&
		(thrown as { name?: unknown }).name === 'IntegrationError'
	);
}

/** as much of a refusal as can be said about it, from either shape one arrives in. */
function named(reason: unknown): string {
	if (typeof reason === 'string' && reason.length > 0) return reason;
	if (typeof reason !== 'object' || reason === null) return 'it gave no reason';
	const carried = reason as { message?: unknown; type?: unknown; name?: unknown };
	const message =
		typeof carried.message === 'string' && carried.message.length > 0
			? carried.message
			: 'it gave no reason';
	// `name` is what a thrown error carries and `type` is what a returned one carries; neither is
	// present on both, and the two never disagree about the same refusal.
	const kind = typeof carried.name === 'string' ? carried.name : carried.type;
	return typeof kind === 'string' && kind.length > 0 ? `${kind}: ${message}` : message;
}

/** what an integrator is told, which is the whole of what this end knows about why. */
function noFieldsFix(reason: string): string {
	return (
		`The payment provider did not finish putting its fields on screen: ${reason}. Check that the ` +
		'publishable key in this form’s configuration is a live key for the account the gift is ' +
		'collected into, that js.stripe.com is reachable from this page, and that no Content-Security-' +
		'Policy on it blocks the provider’s frame.'
	);
}

/** the reason the provider gave, where it gave one at all. */
function namedReason(payload: PaymentLoadErrorLike): string {
	const message = payload.error?.message;
	return typeof message === 'string' && message.length > 0
		? message
		: 'it reported an error it did not describe';
}

/**
 * as much of the provider's `change` payload as this module reads.
 *
 * `value.type` is the provider's own name for the rail the donor has picked, and the event is
 * the only route to it: the SDK exposes no getter for the current selection, so the last one
 * reported is what this module holds. `collapsed` is a picker with nothing chosen in it yet.
 *
 * every field is optional here and the real payload declares them required, which is the
 * direction that is safe: this is a payload crossing from a script this repository does not
 * ship, and a reader that assumed `value` was there would throw inside the provider's own
 * callback.
 */
export type PaymentChangeLike = {
	readonly collapsed?: boolean;
	readonly empty?: boolean;
	readonly value?: { readonly type?: string };
};

/**
 * as much of the provider's `loaderror` payload as this module reads.
 *
 * optional for the reason every field of `PaymentChangeLike` is: it crosses from a script this
 * repository does not ship, and a reader that assumed `error` was there would throw inside the
 * provider's own callback — on the one path whose entire job is to report that something is wrong.
 */
export type PaymentLoadErrorLike = {
	readonly error?: { readonly message?: string; readonly code?: string; readonly type?: string };
};

/**
 * as much of the provider's payment element as this module uses.
 *
 * three subscriptions, and the two beside `change` are what make a mount that does not finish
 * visible to anybody: `ready` is the fields being on screen and `loaderror` is the provider saying
 * they will not be. Declared as overloads rather than as one widened handler because each event
 * carries a payload of its own, and a union here would push the narrowing into the callbacks.
 *
 * `off` mirrors them one for one, because a subscription is what outlives the card that took it
 * out: the handlers close over the callbacks the card was built with, so a group left subscribed
 * reports into a flow that has been stopped. `destroy` is the group's own end — the SDK's elements
 * group carries no teardown, and the element created from it is what has one.
 */
export type PaymentElementLike = {
	mount(node: HTMLElement): void;
	/**
	 * the caret, into the first of the provider's own fields that wants one.
	 *
	 * the only route there: the fields are painted in a frame on the provider's own origin, so
	 * nothing this end holds can reach inside them. `focus(): void` on `StripeElementBase`, which
	 * `StripePaymentElement` is built from (`@stripe/stripe-js`, `dist/stripe-js/elements/base.d.ts`).
	 */
	focus(): void;
	on(event: 'change', handler: (payload: PaymentChangeLike) => void): void;
	on(event: 'ready', handler: () => void): void;
	on(event: 'loaderror', handler: (payload: PaymentLoadErrorLike) => void): void;
	off(event: 'change', handler: (payload: PaymentChangeLike) => void): void;
	off(event: 'ready', handler: () => void): void;
	off(event: 'loaderror', handler: (payload: PaymentLoadErrorLike) => void): void;
	destroy(): void;
};

/**
 * as much of the provider's element group as this module uses.
 *
 * structural rather than imported from the SDK, so ./stripe.dom.spec.ts can drive the whole
 * surface from a plain object and no spec in this repository needs an account or a network. the
 * real objects satisfy these.
 */
export type ElementsLike = {
	create(type: 'payment', options: Record<string, unknown>): PaymentElementLike;
	update(options: Record<string, unknown>): Promise<void>;
	submit(): Promise<{ error?: StripeErrorLike | null }>;
};

export type StripeLike = {
	elements(options: Record<string, unknown>): ElementsLike;
	confirmPayment(options: Record<string, unknown>): Promise<ConfirmResult>;
	retrievePaymentIntent(clientSecret: string): Promise<ConfirmResult>;
};

/**
 * everything the provider built for this card, once it is built at all.
 *
 * the three travel together because they are one group: the fields are created from the element
 * group, which is created from the provider, and a handle kept beside them rather than in here is
 * one that can be read before any of it ran.
 */
type LiveGroup = {
	readonly stripe: StripeLike;
	readonly elements: ElementsLike;
	readonly element: PaymentElementLike;
};

/**
 * the seam a spec reaches through, and nothing production passes.
 *
 * the same shape `StripeSeam` in `src/lib/server/payments/stripe.ts` holds, and for the same
 * reason: the mistakes worth catching are in what this module asks the SDK for, and the only
 * way to assert that is to let something record the asking.
 */
export type PaymentSeam = {
	readonly load?: (publishableKey: string) => Promise<StripeLike | null>;
	/**
	 * the timer the mount deadline is armed on, returning the cancel for it.
	 *
	 * a seam for the reason `now` is a port in ../ports.ts: the deadline is thirty seconds, a spec
	 * that waited for it would not be a spec, and one that patched the ambient `setTimeout` would be
	 * asserting against the patch instead of against this module.
	 */
	readonly delay?: (run: () => void, ms: number) => () => void;
};

/**
 * the loaders that were given the deadline and never answered, on this page.
 *
 * the tag a load hangs on stays in the document, so `ensureStripeScript` below plants nothing on
 * the next attempt and the SDK's own loader adopts the dead one — a second surface joins the same
 * promise nothing will settle. keyed on the loader rather than latched in a boolean because that is
 * what a re-boot shares and a spec does not: production has one `defaultLoad` for the life of the
 * page, and every spec passes a loader of its own.
 *
 * module state and nothing else: it is not exported and no caller can reach it. this file is what
 * writes it — a deadline that expires records the loader, and an answer at any time afterwards
 * takes it back off, because a script that answers late is a script that answers.
 */
const unanswered = new WeakSet<NonNullable<PaymentSeam['load']>>();

/**
 * the three ports a payment provider owns, plus the two things the flow tells it out of band and
 * the one thing the card does.
 *
 * neither `quoted` nor `cadence` is a port and neither must become one. both carry a decision that
 * has already been made elsewhere — the server decided the total and who is paying it, the donor
 * decided how often the gift repeats — and the flow waits on neither; they are the card handing
 * the provider's own surface what it needs to draw itself, in the one place both are in scope.
 *
 * `stop` is not a port either, and it is the flow's opposite: the flow never learns this exists,
 * because the thing that ends a surface is the card going away rather than anything a donor did.
 */
export type PaymentSurface = {
	readonly confirm: CheckoutPorts['confirm'];
	readonly resume: CheckoutPorts['resume'];
	quoted(request: QuoteRequest, quote: Quote): void;
	/**
	 * how often the gift the donor has committed to repeats, or nothing while they are still
	 * deciding.
	 *
	 * called on every reading rather than only on a change, so the caller holds no memory of what
	 * it last said; `createPaymentSurface` is where a reading that changes nothing stops.
	 */
	cadence(frequency: Frequency | undefined): void;
	/**
	 * everything this surface holds outside the mount node, let go of.
	 *
	 * the node the card hands over is the card's to remove and removing it collects the DOM, which
	 * is the whole of what a caller could do from the outside — and none of it reaches the three
	 * subscriptions, the armed mount deadline or the group's own registration inside the provider's
	 * script. so a card that stops without this leaves one live group per gift, each still reporting
	 * into a flow that has been stopped.
	 *
	 * safe in any order a caller reaches it in, and that is this surface's own invariant rather than
	 * something a caller arranges: twice, before or after the mount node has been removed, before
	 * the provider's script has even arrived, and it raises nothing whatever the provider makes of
	 * the one call in it that can be refused.
	 */
	stop(): void;
};

/**
 * whether the deployment offers a rail that is delivered as a card, which is what the wallets ride.
 *
 * the provider draws a wallet inside its own box only where the element group takes `card`
 * (https://docs.stripe.com/js/elements_object/create_payment_element), so this is the same
 * question as "may a wallet appear at all" — and it is asked of the offered list rather than of
 * `card` alone, because a deployment whose card switch is off and whose Apple Pay switch is on
 * still confirms that wallet on a card intent.
 */
function takesCard(config: FormConfig): boolean {
	return config.paymentMethods.some((method) => RAILS[method] === 'card');
}

/** whether two rail lists say the same thing, in order, which is how the group is given them. */
function same(one: readonly string[], other: readonly string[]): boolean {
	return one.length === other.length && one.every((rail, at) => rail === other[at]);
}

/** a minor-unit figure the provider will accept, or nothing. */
function amount(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * the provider's fields, mounted once, reporting which rail the donor picked in them.
 *
 * one element group for the life of the card, created with every rail this deployment takes
 * rather than one. the provider's own picker is what a donor chooses on, so `onRail` is how the
 * flow finds out — it is called with a `PaymentMethod` when the selection is one this form
 * takes and with `null` for every other reading, and `chosenRail` below is where that is
 * decided.
 *
 * `onUnavailable` is the second report, and it is called at most once: the fields are not coming
 * up, and here is the sentence for the donor and the fix for whoever embedded the form. Four things
 * reach it — the provider's script never arriving, the element group reporting `loaderror`, a mount
 * that neither finishes nor says why inside `MOUNT_DEADLINE_MS`, and a script tag that answers
 * neither way inside the same window. The last two are what the deadline exists for; see that
 * constant.
 */
export function createPaymentSurface(
	config: FormConfig,
	mount: HTMLElement,
	onRail: (rail: PaymentMethod | null) => void,
	onUnavailable: (failure: Failure) => void,
	seam?: PaymentSeam
): PaymentSurface {
	const rails = config.paymentMethods;
	const currency = config.currency.toLowerCase();
	/**
	 * where a donor sent to their bank comes back to, decided here rather than at the press.
	 *
	 * the page this form was built on is the page it is on. read at confirm time instead, the answer
	 * is whatever the host's own router last wrote — a single-page host rewrites its url without
	 * reloading anything, and a donor would come back from their bank to a route that may render no
	 * form at all, holding a token with nothing on the page to claim it.
	 *
	 * it is also the url after `takeResumeToken` in ./resume.ts has had its go at it (./runtime.ts
	 * claims before it builds this), which is what keeps a return this page already served from
	 * riding back out on the next one.
	 */
	const returnTo = returnUrl(mount, config.formId);
	// what the provider's fields are drawn against before a gift is decided. it is display copy
	// for the surfaces that state a figure, and it is replaced by the server's own total the
	// moment one exists — see `quoted`.
	const opening = amount(config.minAmountMinor) ?? 100;

	let billing: { readonly name: string; readonly email: string } | null = null;
	/**
	 * what the element group is collecting for: a gift taken once, or the first collection of one
	 * taken again on a schedule.
	 *
	 * it opens as the single collection because that is what a form with no cadence committed to is.
	 * `cadence` below is the one thing that moves it.
	 */
	let mode: 'payment' | 'subscription' = 'payment';
	/** the last thing asked of the element group, so a confirmation cannot overtake it. */
	let settling: Promise<void> = Promise.resolve();
	/**
	 * whether the group refused something asked of it, and so is not known to be collecting for the
	 * gift the donor chose.
	 *
	 * latched rather than cleared by the next ask: the asks are deltas, so a later one that lands
	 * says nothing about the one that did not. what it costs is a form that refuses every
	 * confirmation from then on, which is the safe direction — a group whose shape this adapter
	 * cannot state is exactly the thing that authorizes a repeat nobody was shown.
	 */
	let unshaped = false;

	/**
	 * the rails a gift of the current shape may be confirmed on, as the provider names them.
	 *
	 * deduplicated, and that is load-bearing rather than tidy: three of the four rails this form
	 * vocabulary holds are delivered as `card`, so a deployment offering a card and a wallet names
	 * the same wire type twice and the provider refuses the group outright. the wallets add no type
	 * of their own — they are drawn by the `wallets` hash below, off the `card` this already
	 * carries.
	 */
	const railTypes = (): string[] => {
		const types: string[] = [];
		for (const rail of rails) {
			if (mode !== 'payment' && !REPEATING_RAILS[rail]) continue;
			const type = RAILS[rail];
			if (!types.includes(type)) types.push(type);
		}
		return types;
	};

	/**
	 * the rails the group has been told it takes, so an ask that would change nothing is not made.
	 *
	 * the same rule `cadence` below keeps about a shape that has not changed, and it matters most on
	 * the one ask made after the donor has finished typing: `confirm` narrows the group to the rail
	 * the intent names, and on a form offering that rail alone the list is already right.
	 */
	let offered: readonly string[] = railTypes();

	const load = seam?.load ?? defaultLoad;
	const delay = seam?.delay ?? defaultDelay(mount);

	/**
	 * the one report that the fields are not coming up, said once.
	 *
	 * latched because every route to it is a route to the same screen, and the provider fires
	 * `loaderror` once per retry of its own: a second report would replace the sentence a donor is
	 * already reading with the same sentence, and the deadline below would land on top of both.
	 */
	let announced = false;
	/** cancels whichever deadline is standing — the load's, then the mount's — where there is one. */
	let disarm: (() => void) | null = null;
	const unavailable = (fix: string): void => {
		disarm?.();
		disarm = null;
		if (announced) return;
		announced = true;
		onUnavailable({ message: NO_FIELDS, fix });
	};

	/** drops the three subscriptions and the group with them, once there is a group to drop. */
	let release: (() => void) | null = null;
	/** whether the card that asked for this surface has let go of it. */
	let stopped = false;

	/** whether an earlier boot on this page already gave this loader the deadline and got nothing. */
	const abandoned = unanswered.has(load);

	/**
	 * the provider's script, on the same clock its fields are.
	 *
	 * the deadline below bounds the mount; this one bounds getting something to mount at all. a tag
	 * that fires neither `load` nor `error` leaves the loader's promise pending for the life of the
	 * page, so no group is ever built, nothing arms the mount deadline, and every report this file
	 * has to make sits behind a promise with nothing to settle it — a donor in front of a box that
	 * says nothing, forever.
	 *
	 * one handle for both deadlines, because they never overlap: this one is cancelled exactly where
	 * the mount's is armed. what fires here is `unavailable` rather than a channel of its own — the
	 * fields are not coming up, which is the one thing this file has to say and the one way forward
	 * it has to offer.
	 */
	const started: Promise<StripeLike | null> = abandoned
		? Promise.resolve(null)
		: new Promise((answer) => {
				disarm = delay(() => {
					disarm = null;
					unanswered.add(load);
					unavailable(noFieldsFix('its script never answered on this page, either way'));
					answer(null);
				}, MOUNT_DEADLINE_MS);
				const answered = (stripe: StripeLike | null): void => {
					disarm?.();
					disarm = null;
					// an answer, however late. left on the record a loader that came up at forty seconds
					// would refuse every boot after it for the life of the page — the donor presses Try
					// again on a page where the provider's script is loaded and working, and is told the
					// fields are not coming up by a surface that never asked.
					unanswered.delete(load);
					answer(stripe);
				};
				load(config.provider.publishableKey).then(answered, () => answered(null));
			});

	const ready = started
		.then((stripe): LiveGroup | null => {
			if (stripe === null) return null;
			// the card stopped while the provider's script was still on its way. building the group
			// here would mount into a node already off the page and arm a fresh deadline behind it,
			// which is the orphan `stop` exists to prevent, one load later.
			if (stopped) return null;
			const elements = stripe.elements({
				mode,
				amount: opening,
				currency,
				paymentMethodTypes: railTypes(),
				appearance: resolveAppearance(mount)
			});
			// the donor's name and email are the card's own fields, so the provider is told never
			// to ask for them again; they are handed over at confirmation instead. a rail that
			// requires them — a bank debit does — is still given them, just not twice.
			//
			// so the payer identity has exactly one input surface, and it is the details step
			// (../views.ts). `'never'` is what keeps it that way: at `'auto'` the provider draws its
			// own name and email boxes on the review step, which is a second place one value can be
			// set, and the last writer wins with nothing on screen saying which won — a donor who
			// corrects a typo in the provider's box gets a receipt sent to the address they replaced.
			// there is nothing here to prefill for the same reason: a field this never asks for is a
			// field with no value to seed.
			//
			// a rail added later that collects a name itself collects *its* billing detail, and that
			// name is never written back into the payer draft. the name on a card issuer's file is
			// not necessarily the name a donor wants on a tax receipt.
			//
			// `wallets` is a hash of its own because a wallet is not a payment method type: the
			// rails named above never carry one, and each of the three is drawn inside this box by
			// its own key here wherever the device supports it.
			// `excludedPaymentMethodTypes` is not the lever for these three and naming one in it is
			// an error; the hash is, and Link is one of its three keys
			// (https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods#exclude-payment-methods,
			// https://docs.stripe.com/js/elements_object/create_payment_element).
			//
			// what a donor picking one of them gets is an *option* rather than a button, and that
			// is the whole reason this box is where they are drawn: the sheet opens inside
			// `confirmPayment` below, so the press is the form's own Donate, the quote is minted
			// before it, and a total the server moved is corrected on this app's own screen while
			// nothing has yet been authorized. a wallet pressed as a button authorizes first, and
			// there is no drawing a correction underneath an open sheet.
			//
			// each key is `never` unless the deployment offers something the wallet can settle as,
			// and that is not caution — the provider draws a wallet whenever the group takes
			// `card`, with no regard for whether this deployment quotes on it, so a wallet left on
			// `auto` on an account whose Apple Pay switch is off is an option a donor may pick and
			// `chosenRail` below then reports as no rail at all: a Donate press refused with
			// nothing on the card to explain it.
			//
			// Link has no name in `PAYMENT_METHODS` (../v1.ts) and does not gain one here. it is
			// switched on wherever a card can be settled and a donor who picks it is quoted on the
			// card rail, which is what it is: the intent carries `card` alone, so Link pays from a
			// card it holds rather than from a bank account, at the card's price. what that costs
			// is that the books cannot tell a Link gift from a typed card —
			// `SETTLED_METHODS` in `src/lib/server/payments/stripe.ts` has no `link`, so the
			// settlement leaves the quoted rail standing, which is the honest answer rather than a
			// fallback.
			//
			// **all three owe every site this form is embedded on a payment method domain
			// registration against the org's own account, which is per host and permanent**
			// (https://docs.stripe.com/payments/payment-methods/pmd-registration). the console keeps
			// that registration levelled (`packages/app/src/lib/server/payments/wallet-domains.ts`),
			// but an unregistered host still draws no wallet at all rather than failing loudly, and
			// this comment is not where anybody finds out.
			//
			// `layout` is what makes the rails read as a list of options rather than as one box
			// with a seam across it: on the accordion, `spacedAccordionItems` draws each rail in a
			// container of its own with space between them, and the `.AccordionItem` rule in
			// ../styles/appearance.ts draws that container bare, so a rail's fields sit on the
			// seam the card's own controls sit on. `radios: 'never'` leaves each rail's name a bare
			// press — its icon and its label — and what says a rail is picked is that it is the one
			// open with its fields under it; a radio beside that is a second mark for the same fact,
			// and `offer` below narrows the group to a single rail for the length of a confirmation,
			// where a mark of choice states one that is already over
			// (https://docs.stripe.com/payments/payment-element#layout,
			// https://docs.stripe.com/js/elements_object/create_payment_element#payment_element_create-options-layout).
			//
			// `satisfies` rather than a bare literal: ../ports.ts types these options as an open
			// record so nothing above this file carries the SDK, which leaves every string here
			// unchecked — a rail name or a layout value the provider does not know is an error it
			// raises at mount, on a donor's screen, where this module can only report that the
			// fields are not coming up. checked against the vendor's own type it is a failed build.
			const wallet = (rail: PaymentMethod): 'auto' | 'never' =>
				rails.includes(rail) ? 'auto' : 'never';
			const element = elements.create('payment', {
				fields: { billingDetails: { name: 'never', email: 'never' } },
				wallets: {
					applePay: wallet('apple_pay'),
					googlePay: wallet('google_pay'),
					link: takesCard(config) ? 'auto' : 'never'
				},
				layout: { type: 'accordion', spacedAccordionItems: true, radios: 'never' }
			} satisfies StripePaymentElementOptions);
			// subscribed before the fields are on screen, so a donor who picks in the first frame
			// is not the one press this misses. the same goes for the two that say whether there
			// will be a first frame at all: `ready` and `loaderror` can both land inside `mount`.
			//
			// held in named handlers because `off` takes the same function reference back, and a group
			// left subscribed is one reporting into a flow that has been stopped.
			const changed = (payload: PaymentChangeLike): void => onRail(chosenRail(rails, payload));
			const painted = (): void => {
				disarm?.();
				disarm = null;
			};
			const failed = (payload: PaymentLoadErrorLike): void =>
				unavailable(noFieldsFix(namedReason(payload)));
			element.on('change', changed);
			element.on('ready', painted);
			element.on('loaderror', failed);
			release = () => {
				element.off('change', changed);
				element.off('ready', painted);
				element.off('loaderror', failed);
				// the one call here the provider can refuse, and the `catch` is what contains the
				// refusal — being last only keeps it from stranding the three above it. a throw let out
				// of here reaches whatever asked this surface to stop, which is a re-boot mid-way
				// through taking the last gift down: the boot that replaces it never starts and the
				// error crosses into a page this project does not own. a group that refuses to be
				// destroyed has nothing left this end can do about it either way.
				try {
					element.destroy();
				} catch {
					// nothing to say to a donor and nothing to retry: the subscriptions are already off,
					// so what survives is inside the provider's own script, out of reach from here.
				}
			};
			// armed before the mount rather than after it, because the failure this catches is a
			// mount that starts and never returns an answer of any kind.
			disarm = delay(
				() => unavailable(noFieldsFix('it started and then reported nothing at all')),
				MOUNT_DEADLINE_MS
			);
			element.mount(mount);
			return { stripe, elements, element };
		})
		.catch(() => null);

	// the provider's script never arrived, or the group threw on the way up. Said now rather than
	// held until a press: `confirm` below refuses this with `UNLOADABLE`, but only to a donor who
	// has already filled the whole form in. Nothing is left armed on either path — the answer that
	// got here is what cancelled the deadline above — and the report is latched, so the
	// deadline that fired its own sentence a moment ago is not overwritten by this one.
	void ready.then((live) => {
		if (live !== null) return;
		unavailable(
			noFieldsFix(
				abandoned
					? 'its script had already been found dead on this page by an earlier attempt'
					: 'it could not be started on this page at all'
			)
		);
	});

	/**
	 * asks the element group for a change, behind everything already asked of it.
	 *
	 * chained rather than replaced, because two things ask: the cadence the donor committed to and
	 * the total the server named, and either may still be in flight when the other arrives. a field
	 * holding only the newest promise would let a confirmation start the moment the total landed
	 * while the cadence was still being applied — which is a donor authorizing a repeating gift on
	 * fields still drawn as a single collection.
	 *
	 * the chain never rejects. a refusal is recorded on `unshaped` instead, so that a donor who
	 * never presses leaves no rejected promise behind and a donor who does is refused rather than
	 * confirmed.
	 *
	 * returns that place in the chain, because one caller has to wait for its own ask rather than
	 * for whatever `settling` held when it asked: `confirm` narrows the group to the rail the intent
	 * names and then confirms on it, and reading `settling` a line later would read the chain as it
	 * stood before this ask joined it.
	 */
	function ask(options: Record<string, unknown>): Promise<void> {
		return ready.then((live) => {
			if (live === null) return;
			settling = settling.then(() =>
				live.elements.update(options).then(
					() => undefined,
					() => void (unshaped = true)
				)
			);
			return settling;
		});
	}

	/**
	 * tells the group which rails it takes, where that is not what it already takes.
	 *
	 * one entry point for both readings of that question, because they alternate on the same group:
	 * every rail this form offers while the donor is choosing, and the single rail the intent names
	 * for the length of one confirmation.
	 */
	function offer(types: readonly string[]): Promise<void> {
		if (same(offered, types)) return settling;
		offered = types;
		return ask({ paymentMethodTypes: [...types] });
	}

	const confirm: CheckoutPorts['confirm'] = async ({
		paymentToken,
		method
	}): Promise<ConfirmOutcome> => {
		const live = await ready;
		// nothing reached the provider, so nothing was authorized. said as a refusal rather than
		// as an unanswered confirmation, which is the one thing this is definitely not.
		if (live === null) return { kind: 'declined', message: UNLOADABLE };

		// the group offers every rail this form takes so that the donor picks theirs in the
		// provider's own box; the intent names exactly one, because the fee that produced its
		// amount was priced for that rail. the confirmation carries the group's own list for the
		// API to check against the intent's, so this is where the two are made to agree — a group
		// still offering the rail the donor did not choose is refused before any rail is touched,
		// which is an intent left at `requires_payment_method` with nothing attached and no
		// `last_payment_error` to read it by. narrowed to the rail the flow was quoted on rather
		// than to the last selection this module saw, because that is the rail
		// `createIntent` in `src/lib/server/payments/stripe.ts` minted for.
		const narrowed = offer([RAILS[method]]);

		// everything the element group was asked for is a request of its own, so a donor whose quote
		// lands in the same breath as their press waits for it to be applied first — and so does the
		// cadence they committed to. an ask the group refused is a refusal here rather than an
		// attempt on fields drawn for a gift the donor did not choose.
		await narrowed;
		if (unshaped) return { kind: 'declined', message: UNSHAPED };

		try {
			const validated = await live.elements.submit();
			const result = validated.error
				? { error: validated.error }
				: await live.stripe.confirmPayment({
						elements: live.elements,
						clientSecret: paymentToken,
						confirmParams: {
							// back to the page the form is on, whichever page that is: this package holds
							// no address of its own and is handed one. the provider appends the payment
							// token to it, and `takeResumeToken` in ./resume.ts is what reads it back on
							// the way in — for this form alone, which is what the stamp is for.
							// `returnTo` above is where it was read, and why it was read there.
							return_url: returnTo,
							...(billing === null ? {} : { payment_method_data: { billing_details: billing } })
						},
						// the browser is handed to the donor's bank only where the rail cannot be
						// authenticated in place. everything else resolves here, which is what lets a
						// card that needed no challenge reach the thank-you screen without the host's
						// page being navigated away from underneath it.
						redirect: 'if_required'
					});

			// what the donor is refused for is theirs to read on the screen; anything else that
			// stopped this confirmation is the integration's, and the console is the only place it
			// can be read at all.
			if (result.error && !donorsOwn(result.error)) report(UNCONFIRMED, result.error);

			const outcome = outcomeOfConfirmation(result);
			// the narrowing above lasts one attempt. a refusal and an unfinished form are the two
			// outcomes ../ports.ts describes as another try on this page load, and the picker that try
			// is made in is the provider's own — so the rails this form offers come back with the form.
			if (outcome.kind === 'declined') void offer(railTypes());
			if (outcome.kind === 'unfinished') {
				// the donor is put in front of the fields that stopped them rather than left on a press
				// that appeared to do nothing, and the provider's own marks are already on the field
				// that is unfinished.
				//
				// behind the restore above rather than beside it: putting the rails back re-renders
				// those fields, and a caret moved into fields about to be redrawn is the same press
				// doing nothing. where the form offers the one rail nothing is asked and this is the
				// next microtask.
				void offer(railTypes()).then(() => {
					// the card may have gone away while the group was being asked, and the fields went
					// with it — `stop` below destroys the group this would be reaching into.
					if (!stopped) live.element.focus();
				});
			}
			return outcome;
		} catch (thrown) {
			report(UNCONFIRMED, thrown);
			// the contract for this port: an adapter that cannot get an answer says so rather than
			// throwing. a throw out of a confirmation is not a refusal — the request may well have
			// been received — and ../ports.ts is where that costs a second charge.
			//
			// the one exception is the provider refusing the call itself, which it does by its own
			// parameter checking before anything leaves the page. that is knowable: nothing was
			// authorized, so reporting it as unanswered would be a confident answer wearing the one
			// state this flow reserves for not knowing — and ../views.ts greets that state with a
			// thank-you for a gift nobody charged.
			return isIntegrationError(thrown)
				? { kind: 'declined', message: UNCONFIRMABLE }
				: { kind: 'indeterminate' };
		}
	};

	const resume: CheckoutPorts['resume'] = async ({ paymentToken }): Promise<ConfirmOutcome> => {
		const live = await ready;
		if (live === null) return { kind: 'indeterminate' };
		try {
			return outcomeOf(await live.stripe.retrievePaymentIntent(paymentToken));
		} catch (thrown) {
			report(UNREADABLE, thrown);
			return { kind: 'indeterminate' };
		}
	};

	return {
		confirm,
		resume,
		quoted(request, quote) {
			billing = {
				name: `${request.firstName} ${request.lastName}`.trim(),
				email: request.email
			};
			const total = amount(quote.totalMinor);
			if (total === undefined) return;
			void ask({ amount: total });
		},
		/**
		 * the cadence the gift is committed to, which is what the provider's own fields are drawn
		 * for.
		 *
		 * a repeat is confirmed against the first collection of a commitment, and a group told it is
		 * collecting once renders none of the terms a schedule is authorized under and collects a
		 * method that may not be chargeable again. the rail that legally requires those terms refuses
		 * outright; a card confirms anyway, which leaves a donor committed to a repeating gift they
		 * were never shown — and that is the failure this exists for, not the loud one.
		 *
		 * the shape is what is held rather than the cadence, so a donor moving between monthly and
		 * yearly asks the group for nothing: the two are one shape, and every ask re-renders fields a
		 * donor may already be typing into.
		 */
		cadence(frequency) {
			// nothing committed is nothing to say, never a gift collected once. a donor reaches the
			// screens after a confirmation with no cadence carried onto them, and reading that as a
			// single collection would re-render the provider's fields for every gift that ended.
			if (frequency === undefined) return;
			const next = frequency === 'one_time' ? 'payment' : 'subscription';
			if (next === mode) return;
			mode = next;
			offered = railTypes();
			void ask({ mode, paymentMethodTypes: [...offered] });
		},
		stop() {
			if (stopped) return;
			stopped = true;
			// the deadline first, so nothing can fire at a flow that has been stopped part-way
			// through the rest of this. `announced` is latched with it, which is what covers the two
			// reports that are not subscriptions: a script still in flight, and a `loaderror` already
			// on the microtask queue.
			disarm?.();
			disarm = null;
			announced = true;
			release?.();
			release = null;
		}
	};
}

/**
 * the mount deadline's timer, off the window the card is actually in.
 *
 * `mount.ownerDocument.defaultView` rather than the ambient `setTimeout` for the reason
 * `sheetsFor` in ../element.ts reads its `CSSStyleSheet` off a document: this code runs on a page
 * this project does not own, and the element may be in an iframe's document rather than the top
 * one. A document with no view is one nothing is being rendered in, so there is nothing to wait
 * for and the deadline is a no-op.
 */
function defaultDelay(mount: HTMLElement): (run: () => void, ms: number) => () => void {
	return (run, ms) => {
		const view = mount.ownerDocument.defaultView;
		if (view === null) return () => {};
		const timer = view.setTimeout(run, ms);
		return () => view.clearTimeout(timer);
	};
}

/**
 * the page the donor is on, which is the page they come back to, carrying the form that sent them.
 *
 * the stamp itself is ./resume.ts's, along with the claim that reads it back: it is this project's
 * own name rather than this provider's, and a second payment adapter needs the same one.
 *
 * nothing but an `http`/`https` page is one a donor can be returned to: an `about:` or `blob:`
 * document — a preview pane, a frame written from a string — has a url that no redirect can come
 * back to, and stamping one produces a return address that resolves to nothing. `''` is what those
 * hand over, which the provider's own parameter checking refuses before anything leaves the page,
 * and `confirm` above already reads that refusal as a decline: nothing is authorized and the donor
 * is told. the origin is not compared with the document's — this url is the document's, read off
 * its own `location` — and a comparison would refuse a sandboxed frame, whose page is real and
 * whose origin is opaque.
 */
function returnUrl(mount: HTMLElement, formId: string): string {
	const view = mount.ownerDocument.defaultView;
	if (view === null) return '';
	// off `location` rather than parsed out of the href: the document's url is already taken apart,
	// and the scheme is the whole of the question.
	const { protocol, href } = view.location;
	if (protocol !== 'http:' && protocol !== 'https:') return '';
	return stampReturnUrl(href, formId);
}

/**
 * what the provider just said the donor picked, in this repository's own vocabulary.
 *
 * `null` is a real answer and never a default rail. the flow prices the fee per rail, and a
 * guess here is a figure a donor is shown for a rail they are not on; `currentEstimate` in
 * ../checkout.machine.ts already has `null` for "the rail is not chosen yet" and this is the
 * same nothing said from the other end.
 *
 * three ways to have no rail, and they are one answer: a picker still collapsed, a payload with
 * no selection in it, and a selection this form does not take. the last is what keeps the
 * element group and the intent in step — `createIntent` in `src/lib/server/payments/stripe.ts`
 * mints for one named rail, so a type nothing here recognises must not reach it.
 *
 * the provider reports a wallet under its own name rather than under the type it settles as, so
 * a rail is looked for by its own name first and by the wire type it maps to second. taken the
 * other way round the lookup is a bug that reads as working code: `RAILS` maps three rails onto
 * `card` (./rails.ts), so a payload saying `apple_pay` would find no rail at all and every wallet
 * press would be refused with nothing on the card to explain it.
 *
 * `link` is the one type answered without a rail of its own. it has no name in `PAYMENT_METHODS`
 * (../v1.ts) and the intent it is confirmed against carries `card`, so a donor who picks it is
 * quoted on the card rail — at the card's price, which is what Link charges when it pays from a
 * card it holds. it is spelled here rather than added to `RAILS` because that table is total over
 * the rail vocabulary and Link is not in it; this is the one direction that needs an answer.
 */
function chosenRail(
	rails: readonly PaymentMethod[],
	payload: PaymentChangeLike
): PaymentMethod | null {
	if (payload.collapsed === true) return null;
	const type = payload.value?.type;
	if (type === undefined) return null;
	const named = rails.find((rail) => rail === type);
	if (named !== undefined) return named;
	if (type === LINK_TYPE) return rails.find((rail) => RAILS[rail] === 'card') ?? null;
	return rails.find((rail) => RAILS[rail] === type) ?? null;
}

/**
 * the provider's name for Link, which this repository's rail vocabulary does not hold.
 *
 * a constant rather than a literal in the one branch that reads it, because the same string is
 * what the `wallets` hash switches on above and the two are one decision: a form that draws Link
 * and cannot map what a donor picked is a press refused for a reason nothing states.
 */
const LINK_TYPE = 'link';

/** where the provider serves its script. */
const STRIPE_JS_ORIGIN = 'https://js.stripe.com';

/**
 * the url the installed SDK builds for itself.
 *
 * spelled here because the SDK exports no way to ask: the path is a release train held in a
 * module-private constant. `names the url the installed SDK builds for itself` in
 * ./stripe.dom.spec.ts reads it back out of the installed package, so a version bump that moves
 * the train is a red test rather than a page that loads a build the SDK is not expecting.
 */
export const STRIPE_JS_URL = `${STRIPE_JS_ORIGIN}/dahlia/stripe.js`;

/**
 * the two url shapes the SDK's own loader recognises a provider script by.
 *
 * spelled here because the predicate that holds them is module-private and there is no export that
 * answers the question. what makes copying them safe is that a bump moving either one comes back
 * red: `matches the url shapes the installed SDK recognises` in ./stripe.dom.spec.ts reads both
 * literals out of the installed package and compares them to these.
 *
 * narrower than the origin, and that is the whole of why they are here. a merchant page may carry
 * `js.stripe.com/v3/buy-button.js`, a pricing table, a terminal script or a legacy `/v2/` tag —
 * none of which the SDK adopts. bailing on the origin would leave exactly those pages with nothing
 * planted and an un-nonced tag injected by the SDK a moment later, which is the page this exists
 * for. every url the SDK would adopt matches these too, so nothing is ever planted beside one.
 */
export const STRIPE_JS_URL_SHAPES: readonly RegExp[] = [
	/^https:\/\/js\.stripe\.com\/v3\/?(\?.*)?$/,
	/^https:\/\/js\.stripe\.com\/(v3|[a-z]+)\/stripe\.js(\?.*)?$/
];

/** whether a script is one the SDK would take for its own, read off its resolved src as it is. */
function isProviderScript(script: HTMLScriptElement): boolean {
	return STRIPE_JS_URL_SHAPES.some((shape) => shape.test(script.src));
}

/** the provider's api on a window, which is the only thing that says its script has run. */
function providerReady(view: Window): boolean {
	return (view as unknown as { Stripe?: unknown }).Stripe !== undefined;
}

/**
 * the provider's script on the page ahead of the SDK, so that it carries the host page's nonce.
 *
 * the SDK builds its own tag inside `injectScript` and sets no nonce on it, and takes no option
 * for one — so a host serving `script-src 'nonce-…'` without `'strict-dynamic'` refuses the tag,
 * the payment fields never arrive, and a donor is stopped at the one step of a donation that
 * cannot be skipped.
 *
 * only where there is a nonce to carry. with none there is nothing to fix, and the SDK owns its
 * own url on every page that does not have such a policy — which is nearly all of them.
 *
 * a script the SDK would adopt is left alone, whatever nonce it carries: a second copy is the
 * thing its loader exists to avoid.
 */
export function ensureStripeScript(doc: Document, nonce: string): HTMLScriptElement | null {
	if (nonce === '') return null;
	if (Array.from(doc.querySelectorAll('script')).some(isProviderScript)) return null;
	const script = doc.createElement('script');
	script.setAttribute('src', STRIPE_JS_URL);
	// assigned rather than set as an attribute — see `scriptNonce` in ./loader.ts.
	script.nonce = nonce;
	(doc.head ?? doc.documentElement).appendChild(script);
	return script;
}

/**
 * that script, run — which is what keeps the nonce on it through a second attempt.
 *
 * the SDK loads at most once and clears that memory when the attempt fails, so a second form
 * mounting after a transient failure re-enters its loader. There it finds the tag from the first
 * attempt, removes it, and injects a replacement of its own with no nonce on it — and planting a
 * fresh tag ahead of that changes nothing, because the branch removes whatever it finds. So the
 * answer is not to reach that branch: the SDK resolves off `window.Stripe` before it looks at the
 * document at all, so a script this module has already run leaves it nothing to inject.
 *
 * a tag that settled without defining the provider is taken back off the page, whether it errored
 * or answered with something that was not the provider's script. Left there it is what the SDK
 * finds on the next attempt, and it would be adopted for a load event that has already fired —
 * a promise nothing ever settles, in front of a donor.
 */
export async function loadStripeScript(doc: Document, nonce: string): Promise<void> {
	const view = doc.defaultView;
	if (view === null) return;
	const script = ensureStripeScript(doc, nonce);
	if (script === null) return;
	await new Promise<void>((resolve) => {
		const settled = (): void => {
			if (!providerReady(view)) script.remove();
			resolve();
		};
		script.addEventListener('load', settled);
		script.addEventListener('error', settled);
	});
}

/**
 * the provider's own loader, cast to what this module uses.
 *
 * the cast is at the boundary and nowhere else: `StripeLike` is a structural subset of the
 * SDK's own interface, which declares its methods as overload sets that no supertype can be
 * written against.
 */
async function defaultLoad(publishableKey: string): Promise<StripeLike | null> {
	// the ambient document rather than the one the card is mounted in, because that is the document
	// the SDK's own loader reads when it decides whether to inject a copy of its own.
	await loadStripeScript(document, INJECTING_NONCE);
	const stripe = await loadStripe(publishableKey);
	return stripe === null ? null : (stripe as unknown as StripeLike);
}
