// the second payment adapter: PayPal's hosted approval window behind ../ports.ts, beside
// ./stripe.ts and holding the same shape.
//
// what it collects is `paypal` and `venmo` (`PAYPAL_RAILS` in ./rails.ts), and a donor paying by
// card *inside* PayPal's window is on the `paypal` rail rather than on `card` — the inline box is
// the other adapter's. no card data touches this project on this rail and none may: Expanded
// Checkout would collect a pan in this document and put this project on card-data compliance, so
// the hosted window is the whole of what is drawn here.
//
// **the entry is `@paypal/paypal-js/sdk-v6` and the package pins a loader rather than a
// behaviour.** the installed package is a hundred-odd lines that plant a script tag plus the type
// surface; the code that actually runs a checkout is whatever `https://www.paypal.com/web-sdk/v6/
// core` serves that day, and it moves with no release here. so a version bump in
// ../../package.json changes which loader is bundled and changes nothing a donor sees, and a
// behaviour this file relies on is a fact about what is served rather than a contract. the two
// places that costs something are named where they are read: `readNamespace` below, which does
// not let the loader decide which object it got, and `MOUNT_DEADLINE_MS`, which is the only thing
// standing between a served bundle that changed shape and a donor in front of a box that says
// nothing.
//
// **Venmo's return from its own app is untested on a device.** on a phone the Venmo rail
// app-switches out of the browser; the served `paypal-payments` bundle carries a `hasReturned`
// check and the served `venmo-payments` bundle carries none, the installed types carry none, and
// PayPal's published guidance says nothing either way. settling it needs a real app switch on a
// physical handset against a live account, which nothing in this repository can do. so the PayPal
// rail's return is wired (`claimReturn` below) and a Venmo return arriving through neither
// callback is `indeterminate` — a re-read rather than a second charge — and that is the safe
// direction rather than a working one.
//
// no sandbox, no stage, no test-versus-live: `environment` is the literal `'production'` on every
// page, for the reason CLAUDE.md gives under *Product surface* — nothing in this project reads a
// stage, and rehearsing is a second deployment.
//
// `../../package.json` exports this module as `./embed/paypal`. the composer in ./surface.ts is
// what presents this and ./stripe.ts to a flow as one surface, so nothing above either adapter
// learns that a deployment holds two processors.

import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6';
import type { Failure } from '../checkout.machine';
import type { CheckoutPorts, ConfirmOutcome } from '../ports';
import type { FormConfig, PaymentMethod } from '../v1';
import { INJECTING_NONCE } from './nonce';
import { UNCONFIRMABLE, UNSTATED_DECLINE } from './outcome';
import { isPaypalRail, type PaypalRail } from './rails';
import type { PaymentSurface } from './stripe';

/**
 * what this adapter's own entry on `FormConfig.providers` calls itself.
 *
 * the same word `PROVIDER_NAME` in `src/lib/server/payments/paypal.ts` writes, and the key this
 * file picks its client id out of a config that may name several processors by. a served config
 * spelling it differently is one this file draws no button for.
 */
const PROVIDER_NAME = 'paypal';

/**
 * how long the provider is given to put a button on screen.
 *
 * the same figure and the same argument as `MOUNT_DEADLINE_MS` in ./stripe.ts, and a constant of
 * its own rather than an import from that file: a module that imported it would carry the other
 * processor's SDK into every consumer of this one. the two waits are separate and may diverge.
 *
 * three things are measured against one window here rather than two: the core script arriving,
 * `createInstance` answering, and the eligibility read answering. none of the three names itself
 * when it stalls — the loader's promise stays pending for the life of the page, and a donor is
 * left in front of a box that says nothing.
 */
export const MOUNT_DEADLINE_MS = 30_000;

/**
 * PayPal's own code for the window it could not open at all.
 *
 * `presentationMode: 'auto'` ordinarily absorbs a blocked popup by falling back to an in-page
 * overlay, so reaching this code means both modes failed. nothing was authorized and no approval
 * can exist, which is what makes the retry this reports safe.
 */
const POPUP_BLOCKED = 'ERR_DEV_UNABLE_TO_OPEN_POPUP';

/** PayPal's own code for a funding source that refused before the payer approved anything. */
const INSTRUMENT_DECLINED = 'INSTRUMENT_DECLINED';

/**
 * the codes that say this integration was refused before PayPal's window ever opened.
 *
 * each one is raised by PayPal's own parameter or eligibility checking, in front of the approval
 * surface rather than behind it, so nothing was authorized and a donor pressing Try again mints an
 * order against nothing. every other code — named or not — is read as an answer nobody has; see
 * `outcomeOfTermination` on why the two directions are not symmetric.
 */
const SETUP_FAULTS: readonly string[] = [
	'ERR_INVALID_CLIENT_TOKEN',
	'ERR_DOMAIN_MISMATCH',
	'ERR_FLOW_FUNDING_SOURCE_NOT_ELIGIBLE',
	'ERR_FLOW_UNSUPPORTED_PRESENTATION_MODE'
];

/** the prefix every initialisation fault PayPal raises shares, which is the rest of that list. */
const SETUP_FAULT_PREFIX = 'ERR_INIT_';

/**
 * how one attempt at PayPal's window ended, as the four shapes this module can observe.
 *
 * `silent` is `start()` resolving with no callback having fired, and it is a real ending rather
 * than a missing branch: the surface cannot name what happened, and the two directions out of it
 * cost different things — see `outcomeOfTermination`.
 */
export type Termination =
	| { readonly kind: 'approved' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'error'; readonly code: string; readonly message: string }
	| { readonly kind: 'silent' };

/**
 * one ending of PayPal's window in this flow's own outcome vocabulary.
 *
 * the rule the whole table is written from: **only a signal PayPal itself names may be read as
 * nothing having happened.** that is the cancel callback — PayPal saying the payer closed the
 * window or pressed Cancel inside it — and a funding source it says refused. every other way an
 * attempt can end is an answer nobody has, because the payer may have pressed Pay Now a moment
 * before the connection went, and `indeterminate` in ../ports.ts is exactly that state.
 *
 * the two mistakes are not symmetric and that is what decides every unnamed case. a wrong
 * `unfinished` or a wrong `indeterminate` costs a donor a press or a re-read; a wrong `declined`
 * puts a Retry in front of them, and that press mints a **second order** against one the server is
 * about to capture from the approval PayPal already delivered.
 *
 * approval is `processing` and never `succeeded`: the browser never captures on this rail — the
 * server captures during the reconciliation read the `CHECKOUT.ORDER.APPROVED` delivery drives —
 * so a thank-you said here would be a claim this end cannot back.
 *
 * `redirecting`, `awaiting_microdeposits` and `verification_expired` are unreachable: the approval
 * is a window this page keeps control of, there is no microdeposit flow and no verification
 * window. there are no branches for them and there must not be.
 *
 * the blocked window and the setup faults land on `declined` and `declined`'s own comment does not
 * describe them — no rail refused. they are there because `declined` is the only member that both
 * carries a sentence to the donor and offers a retry this end knows is safe, and because a silent
 * `unfinished` on a press that visibly did nothing is the worse of the two.
 */
export function outcomeOfTermination(termination: Termination): ConfirmOutcome {
	switch (termination.kind) {
		case 'approved':
			return { kind: 'processing' };

		case 'cancelled':
			// PayPal reports the window closed and Cancel pressed inside it through one callback and
			// draws no distinction between them, so neither does this. it carries no message for the
			// reason `unfinished` in ../ports.ts carries none: the donor closed the window and knows
			// they did, and the button they pressed is still on the step they are returned to.
			return { kind: 'unfinished' };

		case 'error':
			if (termination.code === POPUP_BLOCKED) {
				return { kind: 'declined', message: WINDOW_BLOCKED };
			}
			if (termination.code === INSTRUMENT_DECLINED) {
				// the rail refused and the donor's next move is a different funding source inside
				// PayPal's own window. the sentence is ./outcome.ts's, which names no processor and is
				// already the right words on either rail.
				return { kind: 'declined', message: UNSTATED_DECLINE };
			}
			if (isSetupFault(termination.code)) return { kind: 'declined', message: UNCONFIRMABLE };
			return { kind: 'indeterminate' };

		case 'silent':
			return { kind: 'indeterminate' };
	}
}

/** whether a code is one PayPal raises in front of its own approval surface rather than behind it. */
function isSetupFault(code: string): boolean {
	return SETUP_FAULTS.includes(code) || code.startsWith(SETUP_FAULT_PREFIX);
}

/**
 * the key this module writes the served core's namespace to, on a page it does not own.
 *
 * a fixed, boring, collision-proof name and never the default. the core writes `window.paypal` when
 * nothing is there, nests itself at `window.paypal.v6` when something is, and overwrites whatever
 * it finds when it is given a name of its own — so taking a name of our own is what keeps this
 * project off the shared global entirely: on a page with no PayPal we add this key and nothing
 * else, and on a page running PayPal's older SDK we do not touch `window.paypal` at all.
 *
 * it is passed to the loader as `dataNamespace` **and** set on the tag this module plants, because
 * the loader sets attributes only on tags it created: a planted tag without it writes the namespace
 * to `window.paypal` while the loader reads back this key, finds nothing, and rejects with a
 * sentence that points nowhere near the cause.
 */
export const PAYPAL_NAMESPACE = 'bgDonatePayPalV6';

/** the tag the served core registers globally, and the only evidence a core we cannot reach is on the page. */
const PAYPAL_BUTTON_TAG = 'paypal-button';

/** where PayPal serves the core this adapter runs on, at the unversioned path the loader builds. */
export const PAYPAL_CORE_URL = 'https://www.paypal.com/web-sdk/v6/core';

/**
 * the substring the loader's own adoption selector matches a core script by.
 *
 * the pathname of the url above and nothing more, because that is literally what the loader tests:
 * `script[src*="<pathname>"][data-loading-state="pending"]`. spelled here so the tag this module
 * plants is one that selector finds — a src the loader would not match is a tag it plants a second
 * copy beside, and a second core throws on `customElements.define`.
 */
const PAYPAL_CORE_PATH = '/web-sdk/v6/core';

/** the attribute the loader marks its own tags with, and the half of its selector this must carry. */
const LOADING_STATE = 'data-loading-state';

/**
 * as much of the served core's namespace as this module uses.
 *
 * structural rather than the package's `PayPalV6Namespace`, so ./paypal.dom.spec.ts drives the
 * whole surface from a plain object and no spec in this repository needs an account or a network.
 * the real object satisfies it.
 */
export type PaypalNamespaceLike = {
	createInstance(options: Record<string, unknown>): Promise<PaypalSdkLike>;
};

/**
 * as much of an SDK instance as this module uses.
 *
 * the session creators are optional because the instance only carries the one whose component was
 * asked for: a deployment offering PayPal and not Venmo never downloads the Venmo bundle, so
 * `createVenmoOneTimePaymentSession` is genuinely absent rather than merely unused.
 */
export type PaypalSdkLike = {
	findEligibleMethods(options: Record<string, unknown>): Promise<EligibilityLike>;
	createPayPalOneTimePaymentSession?(options: SessionOptionsLike): PaypalSessionLike;
	createVenmoOneTimePaymentSession?(options: SessionOptionsLike): PaypalSessionLike;
};

/** PayPal's answer to which methods this buyer, this account and this currency can pay with. */
export type EligibilityLike = { isEligible(method: string): boolean };

/** the callbacks one payment session is built with, all four of which this module passes. */
export type SessionOptionsLike = {
	onApprove(data: { orderId?: string }): Promise<void>;
	onCancel(data: { orderId?: string }): void;
	onError(data: { code?: string; message?: string }): void;
};

/**
 * as much of one payment session as this module uses.
 *
 * `hasReturned` and `resume` are optional because they are: the served `paypal-payments` bundle
 * carries both and the served `venmo-payments` bundle carries neither, and the installed types say
 * the same. that absence is the whole of why Venmo's return is untested — see this file's header.
 */
export type PaypalSessionLike = {
	start(
		presentation: { presentationMode: 'auto' },
		order: Promise<{ orderId: string }>
	): Promise<unknown>;
	destroy(): void;
	cancel(): void;
	hasReturned?(): boolean;
	resume?(): Promise<void>;
};

/**
 * as much of a window as the namespace reading touches.
 *
 * an index signature because the key being read is `PAYPAL_NAMESPACE` — a name no `Window` type
 * declares — and the reading is the one thing in this module that must work against a global a
 * stranger's page wrote.
 */
export type PaypalWindowLike = {
	readonly customElements?: { readonly get: (name: string) => unknown };
	readonly [key: string]: unknown;
};

/**
 * which PayPal core this page already holds, if any, before anything is planted.
 *
 * the package's own loader cannot answer this and resolves with the wrong object on exactly the
 * page the question is about: its two namespace reads are both a bare `window[namespace]`, so with
 * a version-five `window.paypal` present it injects the core, watches it write `window.paypal.v6`,
 * re-reads `window.paypal`, finds the **five** object truthy and resolves with it — and the next
 * line calls a `createInstance` that is not there. its early-exit optional-chains the reference and
 * not `.version`, so an unrelated `window.paypal` carrying no string version makes it throw
 * *synchronously*, out of a call whose shape says to await it.
 *
 * so the reading is made here, in the order the core's own `setupWindowNamespace` writes: our own
 * key, then the nesting an older SDK forces, then a bare version-six root.
 *
 * `unreachable` is the fourth answer and it is not a failure of this reading: the button tag is
 * registered globally and unguarded by the core, and `customElements.define` throws on a name
 * already taken — so a core on the page under a namespace nothing here can name is a core beside
 * which a second one cannot be planted. the throw would land in the middle of the second core's
 * top-level evaluation, which skips the statement that writes the namespace while the script tag's
 * own `load` still fires: the loader then rejects with "the global variable is not available",
 * about a page whose only fault is that it already had PayPal on it.
 *
 * adopting a host's own root at the third reading adopts whatever origin they loaded it from, and
 * the loader's own check is version-only and origin-blind in exactly the same way. a host running
 * PayPal's sandbox on a live page is a host misconfiguring itself, and the alternative — planting a
 * second core — is the throw above.
 */
export function readNamespace(view: PaypalWindowLike): NamespaceReading {
	const ours = asNamespace(view[PAYPAL_NAMESPACE]);
	if (ours !== null) return { kind: 'found', namespace: ours };

	const root = view.paypal;
	const nested = asNamespace(read(root, 'v6'));
	if (nested !== null) return { kind: 'found', namespace: nested };

	const version = read(root, 'version');
	if (typeof version === 'string' && version.startsWith('6')) {
		const theirs = asNamespace(root);
		if (theirs !== null) return { kind: 'found', namespace: theirs };
	}

	return view.customElements?.get(PAYPAL_BUTTON_TAG) === undefined
		? { kind: 'absent' }
		: { kind: 'unreachable' };
}

/** which core this page holds, as the three answers that decide whether anything is planted. */
export type NamespaceReading =
	| { readonly kind: 'found'; readonly namespace: PaypalNamespaceLike }
	/** a version-six core is here under a name nothing can reach, and a second one cannot be planted. */
	| { readonly kind: 'unreachable' }
	| { readonly kind: 'absent' };

/** one property of a value that may be anything at all, which a host page's global is. */
function read(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/** a value as the namespace, where it is one — which is to say where it can start an SDK. */
function asNamespace(value: unknown): PaypalNamespaceLike | null {
	return typeof read(value, 'createInstance') === 'function'
		? (value as PaypalNamespaceLike)
		: null;
}

/**
 * PayPal's core script on the page ahead of the loader, so that it carries the host page's nonce.
 *
 * the loader sets no nonce on the tag it builds and takes no option for one, so a host serving
 * `script-src 'nonce-…'` without `'strict-dynamic'` refuses it — and every donor on that site is
 * stopped at the one step of a donation that cannot be skipped. the seam is the loader's own
 * adoption selector: it takes over any script already in the document whose src carries the core
 * path and which is marked pending, and sets nothing on a tag it did not create.
 *
 * so all four of these matter and missing any one breaks it. the state marker is what makes the tag
 * adoptable at all; `data-namespace` is the one a reader forgets, and without it the core writes to
 * `window.paypal` while the loader reads back `window[PAYPAL_NAMESPACE]`.
 *
 * this is a better seam than the other processor's and the difference is worth knowing: the core
 * propagates the nonce it finds on its own tag onward — to the component chunks it injects, to the
 * fraud collector, and to the `<style>` fallback — so one nonce on one planted tag covers the whole
 * subtree and there is no second tag to chase.
 *
 * only where there is a nonce to carry. with none the loader owns its own url on every page that
 * does not serve such a policy, which is nearly all of them.
 *
 * a core already waiting is left alone: a second core script on one page throws inside
 * `customElements.define` during its own top-level evaluation, which is the failure `readNamespace`
 * describes from the other end.
 */
export function ensurePaypalScript(doc: Document, nonce: string): HTMLScriptElement | null {
	if (nonce === '') return null;
	if (
		doc.querySelector(`script[src*="${PAYPAL_CORE_PATH}"][${LOADING_STATE}="pending"]`) !== null
	) {
		return null;
	}
	const script = doc.createElement('script');
	script.setAttribute('src', PAYPAL_CORE_URL);
	script.setAttribute(LOADING_STATE, 'pending');
	script.setAttribute('data-namespace', PAYPAL_NAMESPACE);
	// assigned rather than set as an attribute — see `scriptNonce` in ./loader.ts.
	script.nonce = nonce;
	(doc.head ?? doc.documentElement).appendChild(script);
	return script;
}

/**
 * that script, run — which is what keeps the nonce on it across every attempt on this page.
 *
 * the loader caches nothing between calls, so a second surface re-enters it and finds whatever the
 * first one left in the document. two tags it must not find, and this is where each is dealt with.
 *
 * a tag that settled without defining the namespace is taken off the page. left there marked
 * pending it is exactly what the loader's adoption selector matches next time, and the promise a
 * second surface joins is waiting for a `load` that has already fired — a donor in front of a box
 * that says nothing, for the life of the page.
 *
 * a tag that *did* define it is marked answered, which the loader would otherwise never do to a tag
 * it did not create. the cost of leaving it pending is not ours but the host's: their own later
 * `loadCoreSdkScript` would adopt our finished tag and hang on it, and the page whose integration
 * dies is the one that was working before this form arrived.
 *
 * after this the loader has nothing left to inject: it resolves off `window[PAYPAL_NAMESPACE]`
 * before it looks at the document at all.
 */
export async function loadPaypalScript(doc: Document, nonce: string): Promise<void> {
	const view = doc.defaultView;
	if (view === null) return;
	const script = ensurePaypalScript(doc, nonce);
	if (script === null) return;
	await new Promise<void>((resolve) => {
		const settled = (): void => {
			const carried = view as unknown as PaypalWindowLike;
			if (asNamespace(carried[PAYPAL_NAMESPACE]) === null) script.remove();
			else script.setAttribute(LOADING_STATE, 'resolved');
			resolve();
		};
		script.addEventListener('load', settled);
		script.addEventListener('error', settled);
	});
}

/**
 * what a donor is told when PayPal's window would not open.
 *
 * it names PayPal, and the break with ./stripe.ts's three sentences is the point rather than an
 * oversight: those say "the payment provider" because a donor on the card rail never chose Stripe
 * and the brand means nothing to them, while a donor here pressed a button with PayPal's own name
 * on it. a sentence about "the payment provider" would be describing something they cannot connect
 * to what they just pressed.
 *
 * it names the one thing they can actually do about it, which is what earns the extra clause.
 */
const WINDOW_BLOCKED =
	'PayPal’s window could not be opened, and nothing was charged. Allow pop-ups for this page and ' +
	'try again.';

/**
 * what a donor is told when no PayPal button ever appeared.
 *
 * four things reach it — the core never arriving, `createInstance` refusing, an eligibility read
 * that could not be made at all, and every offered rail coming back ineligible — and it is said at
 * most once, while the donor is still filling the form in. nothing has been authorized at that
 * point and nothing can have been, which is what lets it say so plainly.
 *
 * it points at a reload rather than at the Retry the `failed` screen offers, for the reason
 * ./stripe.ts's own does: the surface is built once for the life of the card, so only a fresh one
 * can succeed where this failed.
 */
const NO_BUTTON =
	'The PayPal button on this form did not load, and nothing was charged. Reload the page to try ' +
	'again.';

/**
 * what whoever embedded the form is told, which is the whole of what this end knows about why.
 *
 * ../ports.ts is the donor's vocabulary and has no room for an origin or a code — rightly, because
 * a donor can act on none of it — so a fault in this integration otherwise reaches nobody at all.
 * the console of the page the form is embedded in is the only place it can be read, which is the
 * same channel ./loader.ts and ./stripe.ts use for the same reason.
 */
function noButtonFix(reason: string): string {
	return (
		`The PayPal button did not finish loading: ${reason}. Check that the client id in this form’s ` +
		'configuration is a live client id for the account the gift is collected into, that ' +
		'www.paypal.com is reachable from this page, and that no Content-Security-Policy on it blocks ' +
		'the origins in README.md.'
	);
}

/** as much of a refusal as can be said about it, from either shape one arrives in. */
function named(reason: unknown): string {
	if (typeof reason === 'string' && reason.length > 0) return reason;
	if (typeof reason !== 'object' || reason === null) return 'it gave no reason';
	const carried = reason as { message?: unknown; code?: unknown };
	const message =
		typeof carried.message === 'string' && carried.message.length > 0
			? carried.message
			: 'it reported an error it did not describe';
	return typeof carried.code === 'string' && carried.code.length > 0
		? `${carried.code}: ${message}`
		: message;
}

/** the sentence only, never the payload it came in — a page this project does not own is the last
 * place to put a donor's own details. */
function report(what: string, reason: unknown): void {
	console.error(`${what}: ${named(reason)}`);
}

/** what the console is told about a page that could not be given a PayPal button. */
const UNBUTTONED = 'a donation form could not draw its PayPal button';

/** which SDK component each rail's session comes from, so only the asked-for bundles are fetched. */
const COMPONENTS: Readonly<Record<PaypalRail, string>> = Object.freeze({
	paypal: 'paypal-payments',
	venmo: 'venmo-payments'
});

/** the custom element each rail is pressed on, registered globally by the served core. */
const BUTTON_TAGS: Readonly<Record<PaypalRail, 'paypal-button' | 'venmo-button'>> = Object.freeze({
	paypal: 'paypal-button',
	venmo: 'venmo-button'
});

/**
 * PayPal's own name for each rail in the eligibility vocabulary.
 *
 * written out rather than rested on: `FundingSource` — what `isEligible` takes — is not the same
 * union as the eligible-methods shape on the wire, and the two names this module ever passes only
 * happen to spell the same as this project's rails. `SETTLED_RAILS` on the server states its own
 * mapping for the same reason.
 */
const FUNDING: Readonly<Record<PaypalRail, string>> = Object.freeze({
	paypal: 'paypal',
	venmo: 'venmo'
});

/**
 * the seam a spec reaches through, and nothing production passes.
 *
 * the same shape `PaymentSeam` in ./stripe.ts holds, and the same argument: the mistakes worth
 * catching are in what this module asks the SDK for, and the only way to assert that is to let
 * something record the asking. `load` hands back the namespace rather than a started SDK, so
 * `createInstance`, the eligibility read and every session a spec drives are the plain objects
 * above it.
 */
export type PaypalSeam = {
	readonly load?: () => Promise<PaypalNamespaceLike | null>;
	/** the timer the mount deadline is armed on, returning the cancel for it. */
	readonly delay?: (run: () => void, ms: number) => () => void;
};

/**
 * the payment surface this adapter presents, plus the one question only it can answer.
 *
 * `claimsReturn` is how ./surface.ts decides which adapter a resume with no rail behind it belongs
 * to on a deployment holding two processors. PayPal's own session is the authority on whether this
 * page load is a return from PayPal's window, and it answers without reading the payment token at
 * all — which is what keeps a card gift's 3DS return from being handed to the adapter that cannot
 * read it.
 */
export type PaypalPaymentSurface = PaymentSurface & {
	claimsReturn(): Promise<boolean>;
};

/** the loaders that were given the deadline and never answered, on this page. */
const unanswered = new WeakSet<NonNullable<PaypalSeam['load']>>();

/**
 * the namespace each loader resolved, held for the page rather than for the card.
 *
 * one core script per page by necessity: the served bundle registers `paypal-button` and nine other
 * tags globally and unguarded, and `customElements.define` throws on a name already taken — so a
 * second element on the page must join this promise rather than start its own load. keyed on the
 * loader rather than latched in a module boolean because that is what a re-boot shares and a spec
 * does not.
 *
 * a load that came up empty is forgotten rather than remembered, so a donor pressing Try again on a
 * page whose core has since arrived is not refused by a memory of the attempt before it.
 */
const namespaces = new WeakMap<
	NonNullable<PaypalSeam['load']>,
	Promise<PaypalNamespaceLike | null>
>();

/**
 * the started SDK each client id, component set and locale resolved, held for the page.
 *
 * two elements from one deployment share a client id and should share one instance and one
 * eligibility round trip; two deployments' snippets on one page carry different client ids and get
 * an instance each, which `createInstance` supports. nothing here is ever destroyed — a surface
 * stopping destroys its own sessions and leaves the instance for the other element still using it.
 */
const instances = new WeakMap<
	NonNullable<PaypalSeam['load']>,
	Map<string, Promise<PaypalSdkLike>>
>();

/** the namespace, loaded at most once per page for the reason `namespaces` above gives. */
function sharedNamespace(
	load: NonNullable<PaypalSeam['load']>
): Promise<PaypalNamespaceLike | null> {
	const held = namespaces.get(load);
	if (held !== undefined) return held;
	const loading = load().then(
		(namespace) => {
			if (namespace === null) namespaces.delete(load);
			return namespace;
		},
		(thrown: unknown) => {
			namespaces.delete(load);
			throw thrown;
		}
	);
	namespaces.set(load, loading);
	return loading;
}

/** the started SDK, at most once per page per client id, component set and locale. */
function sharedInstance(
	load: NonNullable<PaypalSeam['load']>,
	namespace: PaypalNamespaceLike,
	options: { clientId: string; components: readonly string[]; locale: string }
): Promise<PaypalSdkLike> {
	const held = instances.get(load) ?? new Map<string, Promise<PaypalSdkLike>>();
	instances.set(load, held);
	const key = `${options.clientId}\n${options.components.join(',')}\n${options.locale}`;
	const standing = held.get(key);
	if (standing !== undefined) return standing;
	const starting = namespace
		.createInstance({
			clientId: options.clientId,
			components: [...options.components],
			pageType: 'checkout',
			locale: options.locale
		})
		.catch((thrown: unknown) => {
			held.delete(key);
			throw thrown;
		});
	held.set(key, starting);
	return starting;
}

/**
 * PayPal's own approval window, behind the three ports a payment provider owns.
 *
 * the buttons are the rail picker and nothing more: a press reports which rail the donor chose, and
 * the approval window itself is opened by `confirm` below — one press later, on the review screen,
 * which is where this flow's own quote has already been minted. that ordering is what makes the
 * order handed to `start()` an already-settled promise, and PayPal's own guidance is emphatic that
 * nothing may be awaited between the donor's press and `start()` or the popup is blocked for want
 * of a transient activation.
 *
 * `onUnavailable` is called at most once and says the button is not coming up. the four routes to
 * it are the ones `NO_BUTTON` names.
 */
export function createPaymentSurface(
	config: FormConfig,
	mount: HTMLElement,
	onRail: (rail: PaymentMethod | null) => void,
	onUnavailable: (failure: Failure) => void,
	seam?: PaypalSeam
): PaypalPaymentSurface {
	/** the rails on offer that this processor settles, and never the whole offered list. */
	const rails = config.paymentMethods.filter(isPaypalRail);
	/**
	 * the client id for this file's own processor, off a config that may name several.
	 *
	 * taken by `name` rather than by position, for the reason ./stripe.ts takes its own key that
	 * way: a deployment holding two processors names both, and the one entry this file can start an
	 * SDK on is its own. PayPal's own set-up guidance is explicit that a client id is safe in
	 * front-end code, which is what `Provider.publishableKey` in ../v1.ts already says of every
	 * entry on that list.
	 */
	const clientId =
		config.providers.find((entry) => entry.name === PROVIDER_NAME)?.publishableKey ?? null;
	const load = seam?.load ?? defaultLoad;
	const delay = seam?.delay ?? defaultDelay(mount);
	const doc = mount.ownerDocument;

	/**
	 * the node this adapter was handed, dressed as the root it is.
	 *
	 * the padding is this shell's own and the separation above it is the caller's — ./surface.ts
	 * places this node, and `[part~='payment']` in ../styles/parts.css pulls the whole box out to
	 * the card's own edges by `--_inset` so that each rail's band is full bleed. the other adapter
	 * pads its rails back in by that same token through the appearance object it sends; this is the
	 * same decision said in the one channel a node in this document has, so the buttons land on the
	 * seam every other control on the card sits on rather than out at its edges.
	 *
	 * set as properties rather than through `cssText`, so a caller's own geometry on this node
	 * survives being dressed.
	 */
	mount.style.display = 'grid';
	mount.style.gap = 'var(--_sp2)';
	mount.style.paddingInline = 'var(--_inset)';

	/** the one report that the button is not coming up, said once. */
	let announced = false;
	/** cancels the mount deadline, where one is standing. */
	let disarm: (() => void) | null = null;
	const unavailable = (fix: string): void => {
		disarm?.();
		disarm = null;
		if (announced) return;
		announced = true;
		onUnavailable({ message: NO_BUTTON, fix });
	};

	/** whether the card that asked for this surface has let go of it. */
	let stopped = false;
	/** whether an earlier boot on this page already gave this loader the deadline and got nothing. */
	const abandoned = unanswered.has(load);

	/** whichever attempt is waiting on PayPal's own callbacks, answered exactly once. */
	let attempt: ((termination: Termination) => void) | null = null;
	/** how the last attempt ended, which is the whole of what a re-read on this page can learn. */
	let last: ConfirmOutcome | null = null;

	/** an attempt, armed and waiting on whichever of PayPal's signals arrives first. */
	function begin(): Promise<Termination> {
		return new Promise<Termination>((resolve) => {
			attempt = resolve;
		});
	}

	/**
	 * one signal from PayPal, answering the attempt waiting on it — the first one only.
	 *
	 * **first past the post is how an approval comes to dominate everything after it.** everything
	 * once the payer has pressed Pay Now is ambiguous by construction: PayPal has marked the order
	 * approved and the message home can still be lost, so an error arriving behind that approval
	 * says nothing about the money. answered a second time it would become a decline, and the Retry
	 * on that screen mints a second order against one the server is about to capture.
	 *
	 * so every later signal is dropped rather than merged — which covers the ordinary orderings too:
	 * PayPal fires its completion callback behind its own cancel, and an attempt already answered
	 * `unfinished` must not be reopened as an answer nobody has.
	 */
	function record(signal: Termination): void {
		const answer = attempt;
		if (answer === null) return;
		attempt = null;
		answer(signal);
	}

	/** a `start()` or `resume()` rejection, as much of it as the mapping reads. */
	function thrownTermination(thrown: unknown): Termination {
		const code = read(thrown, 'code');
		return { kind: 'error', code: typeof code === 'string' ? code : '', message: named(thrown) };
	}

	/** everything PayPal built for this card, once it is built at all. */
	type Live = { readonly sessions: ReadonlyMap<PaypalRail, PaypalSessionLike> };
	/**
	 * that, read without awaiting — which is what keeps the donor's press spendable.
	 *
	 * a popup is opened on the transient activation of the press that asked for it, and an `await`
	 * of anything that is not already settled spends it. by the time a confirmation is made this is
	 * long since assigned, so `confirm` below reads it rather than the promise.
	 */
	let live: Live | null = null;
	/** whether this page load is a return from PayPal's own window, as PayPal itself answers it. */
	let returned = false;
	/**
	 * that return, picked back up — or nothing, on the ordinary page load that is not one.
	 *
	 * awaited by `resume` below and by nothing else, which is what keeps a PayPal session that never
	 * answers from blocking anybody: `claimsReturn` reads the flag above, which is written before
	 * anything is awaited, so ./surface.ts routes a card gift's own return without waiting on this.
	 */
	let claimed: Promise<void> = Promise.resolve();

	/** every listener this surface took out, dropped in one call whatever order `stop` is reached in. */
	const letGo = new AbortController();
	/** the button elements this surface put on the page, which are its own to take back off. */
	const buttons: HTMLElement[] = [];

	async function build(): Promise<Live | null> {
		if (abandoned) {
			unavailable(
				noButtonFix('its script had already been found dead on this page by an earlier attempt')
			);
			return null;
		}
		if (clientId === null) {
			unavailable(noButtonFix(`the served config names no ${PROVIDER_NAME} processor to start it`));
			return null;
		}

		const components = [...new Set(rails.map((rail) => COMPONENTS[rail]))];

		let namespace: PaypalNamespaceLike | null;
		try {
			namespace = await sharedNamespace(load);
		} catch (thrown) {
			unavailable(noButtonFix(named(thrown)));
			return null;
		}
		// an answer, however late: a loader that came up at forty seconds would otherwise refuse
		// every boot after it for the life of the page.
		if (namespace !== null) unanswered.delete(load);
		if (stopped) return null;
		if (namespace === null) {
			unavailable(noButtonFix('it could not be started on this page at all'));
			return null;
		}

		let sdk: PaypalSdkLike;
		try {
			sdk = await sharedInstance(load, namespace, { clientId, components, locale: config.locale });
		} catch (thrown) {
			unavailable(noButtonFix(named(thrown)));
			return null;
		}
		if (stopped) return null;

		// ineligible and unreadable are distinguishable and are treated differently: a resolved
		// `false` is a button not to draw, and a rejection is this module not knowing what to draw.
		// read as "everything is ineligible" a timed-out call takes a working PayPal button off the
		// form on every load.
		let eligible: EligibilityLike;
		try {
			eligible = await sdk.findEligibleMethods({ currencyCode: config.currency });
		} catch (thrown) {
			unavailable(noButtonFix(named(thrown)));
			return null;
		}
		if (stopped) return null;

		const drawn = rails.filter((rail) => eligible.isEligible(FUNDING[rail]));
		if (drawn.length === 0) {
			// the only case where an eligibility answer becomes visible to a donor at all. the server
			// names what the deployment sells on and the browser narrows it to what this donor can pay
			// with; with nothing left there is no button, and a card with no way to pay has to say so.
			unavailable(noButtonFix('no rail this form offers can be paid with from this device'));
			return null;
		}

		const sessions = new Map<PaypalRail, PaypalSessionLike>();
		for (const rail of drawn) {
			// created once, at mount, and reused for every attempt: the order is not bound to a
			// session, it is handed to `start()` per attempt. a session per press would leave two of
			// them holding live callbacks, which is how a late cancel from one attempt lands on the
			// next one's flow.
			const create =
				rail === 'venmo'
					? sdk.createVenmoOneTimePaymentSession
					: sdk.createPayPalOneTimePaymentSession;
			if (create === undefined) continue;
			sessions.set(
				rail,
				create.call(sdk, {
					onApprove: async () => record({ kind: 'approved' }),
					onCancel: () => record({ kind: 'cancelled' }),
					onError: (data) =>
						record({
							kind: 'error',
							code: typeof data.code === 'string' ? data.code : '',
							message: typeof data.message === 'string' ? data.message : ''
						})
				})
			);
		}
		if (sessions.size === 0) {
			unavailable(noButtonFix('the started SDK carried no session for any rail this form offers'));
			return null;
		}

		// created here rather than found by query. every published PayPal example reaches for the
		// button with `document.querySelector`, and with two of these elements on one page that
		// finds the *other* card's button — pressing the hero's button would start the footer's
		// payment, at the footer's amount.
		for (const rail of sessions.keys()) {
			const button = doc.createElement(BUTTON_TAGS[rail]);
			button.addEventListener('click', () => onRail(rail), { signal: letGo.signal });
			mount.appendChild(button);
			buttons.push(button);
		}

		// one claim over all of them and never one each: the attempt below is a single latch, so two
		// sessions each claiming would leave the first waiting on a signal the second took.
		const returning = [...sessions.values()].find((session) => session.hasReturned?.() === true);
		if (returning !== undefined) claimed = claimReturn(returning);

		live = { sessions };
		return live;
	}

	/**
	 * the surface, against one window covering all three of the waits it is made of.
	 *
	 * raced rather than awaited, so this promise settles whatever the loader does. a core script that
	 * fires neither `load` nor `error` leaves the package's own loader pending for the life of the
	 * page, and a `ready` that inherited that would take every reader of it down with it — the other
	 * processor's re-read included, through ./surface.ts. the losing half keeps running: a surface
	 * that turns up late still draws its buttons and still answers a confirmation, and the donor has
	 * already been told once that it would not.
	 */
	/**
	 * the build itself, held separately from the race below it.
	 *
	 * `stop` reads this one rather than `ready`, because the two do not always agree: where the
	 * deadline won, `ready` is `null` while the build may still be on its way to creating sessions,
	 * and a teardown hung on the race would let go of a card whose sessions had not been made yet.
	 *
	 * disarmed wherever the build settles, which is every exit from it — including the two that
	 * return before the wait begins. left standing, the timer below would later mark this loader dead
	 * over a config that simply named no processor for it.
	 */
	const building: Promise<Live | null> = build().then((built) => {
		disarm?.();
		disarm = null;
		return built;
	});

	const ready: Promise<Live | null> = Promise.race([
		building,
		new Promise<null>((answer) => {
			disarm = delay(() => {
				disarm = null;
				unanswered.add(load);
				unavailable(noButtonFix('it never finished starting on this page, either way'));
				answer(null);
			}, MOUNT_DEADLINE_MS);
		})
	]);

	/**
	 * a return from PayPal's own window, picked up where the donor left it.
	 *
	 * the documented shape: ask the session whether this page load is a return, and resume it if it
	 * is — the callbacks the session was built with fire, and the outcome lands on `last` for the
	 * resume port to answer with.
	 *
	 * it covers the PayPal rail alone, and the Venmo rail is why this file's header says what it
	 * says: the served Venmo bundle carries no such check and neither do its types, so a Venmo
	 * app-switch return arrives through neither callback and `resume` below answers it as an answer
	 * nobody has — a re-read rather than a second charge.
	 */
	async function claimReturn(session: PaypalSessionLike): Promise<void> {
		if (session.hasReturned?.() !== true || session.resume === undefined) return;
		returned = true;
		const waiting = begin();
		try {
			await session.resume();
		} catch (thrown) {
			record(thrownTermination(thrown));
		}
		record({ kind: 'silent' });
		last = outcomeOfTermination(await waiting);
	}

	const confirm: CheckoutPorts['confirm'] = async ({
		paymentToken,
		method
	}): Promise<ConfirmOutcome> => {
		const held = live ?? (await ready);
		// the rail is narrowed here because `ConfirmInput.method` is the whole vocabulary and this
		// adapter settles two of it. ./surface.ts routes a confirmation to the adapter that owns the
		// rail, so nothing production sends reaches the other branch.
		const session = held !== null && isPaypalRail(method) ? held.sessions.get(method) : undefined;
		if (session === undefined) {
			report(UNCONFIRMED, `nothing on this form can settle a gift on the ${method} rail`);
			return { kind: 'declined', message: UNCONFIRMABLE };
		}

		const waiting = begin();
		// already settled, because the quote that minted this order landed a state earlier. an
		// `await` here of anything else would spend the donor's press and the popup would be blocked
		// for want of it — PayPal's own sample carries that warning against its order call.
		const order = Promise.resolve({ orderId: paymentToken });
		session.start({ presentationMode: 'auto' }, order).then(
			() => record({ kind: 'silent' }),
			(thrown: unknown) => record(thrownTermination(thrown))
		);

		const termination = await waiting;
		if (termination.kind === 'error') report(UNCONFIRMED, termination.message);
		const outcome = outcomeOfTermination(termination);
		last = outcome;
		return outcome;
	};

	/**
	 * what became of the order this page last sent to PayPal.
	 *
	 * the browser holds no read of a PayPal order — there is no client-side call a client id can
	 * make for one — so what this answers with is what PayPal's own callbacks already said on this
	 * page load, and nothing at all where they said nothing. that is the safe direction: the machine
	 * answers an answer nobody has by stopping rather than by offering the form again.
	 */
	const resume: CheckoutPorts['resume'] = async (): Promise<ConfirmOutcome> => {
		await ready;
		await claimed;
		return last ?? { kind: 'indeterminate' };
	};

	return {
		confirm,
		resume,
		async claimsReturn() {
			await ready;
			return returned;
		},
		// the total is the server's and it is on the review screen the donor already read; PayPal's
		// own window states the figure off the order the server minted, and this button carries no
		// figure of its own to correct.
		quoted() {},
		// the button is the same button on either cadence, and which rails a repeat may be collected
		// on is decided before a config is served — `offered-rails.ts` in the app. a shape asked of
		// the SDK here would be a second place that decision is made.
		cadence() {},
		stop() {
			if (stopped) return;
			stopped = true;
			disarm?.();
			disarm = null;
			announced = true;
			letGo.abort();
			// an attempt still waiting is answered, so a confirmation the card walked away from is a
			// promise that settles rather than one nothing ever will.
			record({ kind: 'silent' });
			for (const button of buttons.splice(0)) button.remove();
			void building.then((held) => {
				for (const session of held?.sessions.values() ?? []) {
					// each separately: two elements on one page hold sessions of their own off one shared
					// SDK instance, and destroying one must not reach the other.
					try {
						session.destroy();
					} catch {
						// the subscriptions are already gone, so what survives is inside PayPal's own
						// script and out of reach from here.
					}
				}
			});
		}
	};
}

/** what the console is told about a gift that never reached the rail. */
const UNCONFIRMED =
	'a donation could not be confirmed with the payment provider, and nothing was charged';

/**
 * the mount deadline's timer, off the window the card is actually in.
 *
 * `mount.ownerDocument.defaultView` rather than the ambient `setTimeout` for the reason
 * `defaultDelay` in ./stripe.ts reads its own that way: this code runs on a page this project does
 * not own, and the element may be in an iframe's document rather than the top one.
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
 * the served core, reached without letting the package's loader decide what it got.
 *
 * the reading is made first and the loader is only called where there is nothing to read — see
 * `readNamespace`, which is where every one of those answers is argued. the call sits inside `try`
 * rather than behind a `.catch()` because it is not `async`: its argument validation and its own
 * namespace read both run in the function body, before any promise exists.
 *
 * `'production'` unconditionally. the argument is required and is the obvious place a stage flag
 * would otherwise arrive; nothing in this project reads a test-versus-live distinction, and
 * rehearsing is a second deployment.
 */
async function defaultLoad(): Promise<PaypalNamespaceLike | null> {
	if (typeof window === 'undefined') return null;
	const view = window as unknown as PaypalWindowLike;

	const carried = readNamespace(view);
	if (carried.kind === 'found') return carried.namespace;
	if (carried.kind === 'unreachable') {
		report(
			UNBUTTONED,
			'another PayPal SDK on this page has already registered the <paypal-button> element, so a second core cannot be loaded beside it'
		);
		return null;
	}

	// the ambient document rather than the one the card is mounted in, because that is the document
	// the loader reads when it decides whether to adopt a tag or plant one.
	await loadPaypalScript(document, INJECTING_NONCE);
	try {
		await loadCoreSdkScript({ environment: 'production', dataNamespace: PAYPAL_NAMESPACE });
	} catch (thrown) {
		report(UNBUTTONED, thrown);
	}

	const after = readNamespace(view);
	return after.kind === 'found' ? after.namespace : null;
}
