// the anti-abuse adapter: Cloudflare Turnstile behind `FormRuntime.challenge` in ../element.ts,
// and the only module in `packages/form/src/**` that knows a challenge provider exists.
//
// the same shape ./stripe.ts holds for the payment provider — one file imports the vendor,
// everything above it takes types this repository defines. this one imports nothing at all: the
// widget arrives as a script tag on the host's page and hangs its API off their `window`, so what
// is vendored here is a URL, four render options and the shape of three functions.
//
// what this exists for is a hole rather than a feature. `/api/v1` is public, unauthenticated and
// payment-initiating, and the endpoint requires a challenge token on every quote it mints
// (`QuoteRequest.turnstileToken` in ../v1.ts, `verifyTurnstile` in
// `src/lib/server/api/turnstile.ts`). every other part of the path that token travels is already
// there — the flow accepts it, the projection publishes a setter for it, the served config carries
// the sitekey — and this is the one module that produces one: with nothing minting a token, every
// donation on every site is refused for arriving without it.
//
// nothing here leaves the shadow root, and that is a measurement rather than an assumption. the
// payment provider's own element cannot complete a mount inside one (`#start` in ../element.ts),
// so this widget was put through the same comparison in a real browser before the box it draws in
// was decided: rendered into a node inside an open shadow root, into an ordinary light-DOM node,
// and into a light-DOM node that is hidden. All three reached the interactive challenge, accepted
// a click and handed back a token. So the box stays in the shadow tree, where nothing on the
// host's page can reach it.
//
// `../../package.json` exports this module as `./embed/turnstile`. the deployment's own donation
// page mounts this same widget. the endpoint requires a token on every quote it mints, so a page
// that drew its own challenge would be a second answer to which widget this deployment draws and to
// what a donor is told when one never comes up.

import type { Failure } from '../checkout.machine';
import type { FormChallenge } from '../element';
import type { FormConfig } from '../v1';
import { INJECTING_NONCE } from './nonce';

/**
 * the provider's script, at the exact URL Cloudflare documents.
 *
 * it may not be proxied or copied — the provider is explicit that a cached or self-hosted copy
 * breaks when they ship a change to it
 * (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
 *
 * `render=explicit` because this adapter decides where and when. The implicit mode scans the
 * document for a `cf-turnstile` class on load, which would find nothing: the box is drawn into a
 * shadow root, minutes after that scan, and only once a donor reaches the step whose press spends
 * the token.
 */
export const TURNSTILE_SCRIPT_SRC =
	'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** the prefix a script already on the host's page is recognised by, whatever query it carries. */
const TURNSTILE_SCRIPT_PREFIX = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/**
 * how long the provider's script is given to arrive.
 *
 * exported so a spec asserts the boundary rather than a number copied out of this file, which is
 * how a window silently stops being tested when it is changed — the same reason
 * `MOUNT_DEADLINE_MS` is exported from ./stripe.ts.
 *
 * it exists because a tag that fires neither `load` nor `error` names itself in no other way: a
 * proxy that holds the connection open, or an extension that swallows the request, leaves a
 * donation form waiting on a script that is never coming and a donor in front of a control that
 * will be refused when they press it.
 */
export const SCRIPT_DEADLINE_MS = 30_000;

/**
 * the render options this adapter passes, as the provider spells them.
 *
 * hyphenated keys because that is the provider's own vocabulary and renaming them here would be a
 * second name for the same thing, one of which is wrong. only what this module sets is declared:
 * the surface is large and a field nobody passes is a field nobody has decided about.
 */
export type RenderOptions = {
	readonly sitekey: string;
	readonly appearance: 'interaction-only';
	readonly theme: 'light';
	readonly size: 'flexible';
	readonly 'refresh-expired': 'auto';
	readonly callback?: (token: string) => void;
	readonly 'error-callback'?: (code: string) => void;
	readonly 'timeout-callback'?: () => void;
};

/**
 * the three calls this adapter makes on the provider's API, and the whole of what it needs.
 *
 * a structural type rather than the vendor's own, for the reason `StripeLike` in ./stripe.ts is
 * one: this module must be drivable by a plain object in a spec, and the API arrives on a
 * stranger's `window` where nothing can be imported from anyway.
 */
export type TurnstileLike = {
	render(node: HTMLElement, options: RenderOptions): string | undefined;
	reset(id: string): void;
	remove(id: string): void;
};

/** the timer the script deadline is armed on, returning the cancel for it. */
type Delay = (run: () => void, ms: number) => () => void;

/** what a spec replaces, for the reason `PaymentSeam` in ./stripe.ts exists. */
export type ChallengeSeam = {
	readonly load?: () => Promise<TurnstileLike | null>;
	readonly delay?: Delay;
};

/** what a donor is told when the challenge in front of this form cannot be run. */
const UNCHALLENGEABLE =
	'This donation form could not run its security check, and nothing was charged. Reload the page ' +
	'to try again.';

/** what to do about a script that never arrived, which is nearly always the host page's own doing. */
const SCRIPT_FIX =
	`The form loads its security check from ${TURNSTILE_SCRIPT_PREFIX} and that request did not ` +
	'complete. Check that the page does not block it: a Content-Security-Policy needs ' +
	'challenges.cloudflare.com in both script-src and frame-src, and an ad blocker or privacy ' +
	'extension will refuse it outright.';

/** what to do about a deployment that never minted a widget. */
const NO_SITEKEY_FIX =
	'This deployment serves no Turnstile sitekey, so the form can render no security check and its ' +
	'own donation endpoint refuses every gift. Create a widget at dash.cloudflare.com > Turnstile ' +
	'and set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY on the deployment.';

/**
 * the one unrecoverable code with a single cause: Cloudflare's "Domain not authorized".
 *
 * their remedy for it is one line — add the current domain in Hostname Management — so the shared
 * sentence below sends the reader to check a sitekey that is not what is wrong.
 */
const UNAUTHORIZED_DOMAIN = '110200';

/**
 * what to do about a page the widget does not serve.
 *
 * the two lists are separate and only one of them is this deployment's. a site added under /admin
 * is where donations may be taken from; the widget's hostname list is at Cloudflare, nothing in
 * this repository can read or write it, and a page missing from it is refused with no other sign.
 */
const UNAUTHORIZED_DOMAIN_FIX =
	`The security check reported error ${UNAUTHORIZED_DOMAIN}: this page’s address is not on the ` +
	'Turnstile widget’s hostname list. Add it at dash.cloudflare.com > Turnstile > the widget > ' +
	'Hostname Management. The site list in this app’s /admin is a separate list, and adding it ' +
	'there does not add it at Cloudflare.';

/**
 * how many retryable failures in a row are a widget that is not going to mint a token.
 *
 * exported so a spec asserts the boundary rather than a number copied out of this file, for the
 * reason `SCRIPT_DEADLINE_MS` above is.
 *
 * what it draws is the line between the two mistakes. a retryable code is retried by the widget
 * itself, so reporting the first one takes a form down over a blip — and reporting none
 * of them leaves a visitor who cannot clear the challenge filling the whole form in and being
 * refused at the press, with the widget in front of them saying it failed and the form saying
 * nothing at all. The provider invokes the callback again for each failure a retry produces
 * (https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/), so a count is
 * what tells a widget retrying apart from one that has retried and gone on failing.
 *
 * three because two is reachable by a connection that dropped and came back, and because the
 * interval between the provider's own retries defaults to eight seconds — so this is around half a
 * minute of a widget failing, which is long enough to have recovered and short enough to reach a
 * donor who has not finished typing.
 *
 * it counts errors and never seconds, which is why nothing here bounds token issuance the way
 * `SCRIPT_DEADLINE_MS` bounds the script arriving. `appearance: 'interaction-only'` means a visitor
 * may legitimately sit in front of a puzzle for minutes; solving one is not erroring, so a count
 * never fires on them where a deadline would refuse them.
 */
export const RETRYABLE_FAILURE_LIMIT = 3;

/**
 * what to do about a widget that went on retrying a code of its own and went on failing it.
 *
 * it names the frame rather than the script, which is the difference from `SCRIPT_FIX` above: the
 * script arrived and ran, so what is left between this page and a token is the challenge the widget
 * draws in an iframe of its own.
 */
function repeatedFailureFix(code: string): string {
	return (
		`The security check reported error ${code} ${RETRYABLE_FAILURE_LIMIT} times in a row and ` +
		'minted no token. Cloudflare documents that code as retryable, so the widget went on retrying ' +
		'and this page went on failing it. Check that a Content-Security-Policy here carries ' +
		'challenges.cloudflare.com in frame-src as well as script-src, and that no ad blocker or ' +
		'privacy extension is interfering with the frame the widget draws in.'
	);
}

/**
 * the error codes Cloudflare publishes as not worth retrying, and only those.
 *
 * the split is theirs rather than this file's judgement: their error-code table carries a Retry
 * column, and these are its six No rows
 * (https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/).
 * Every one of them is a value in the operator's Cloudflare dashboard or on the visitor's own
 * machine, and no number of fresh challenges moves any of them.
 *
 * everything else — a challenge that timed out, an iframe that would not load, the `300*` and
 * `600*` families — is a Yes row that the widget retries by itself, and one of those is reported
 * on the count below rather than as it arrives. Reporting the first would take a donation form
 * down over a blip that had already fixed itself, which is the opposite mistake to the one this
 * module exists for and just as expensive.
 *
 * an unrecognised code is treated as retryable, because the alternative is a form that a code
 * minted after this list was written can take down.
 */
const UNRECOVERABLE_CODES: readonly string[] = [
	'110100',
	'110110',
	UNAUTHORIZED_DOMAIN,
	'200100',
	'400020',
	'400070'
];

/** the provider's API off a window, or nothing where the script has not run there. */
function readTurnstile(view: Window): TurnstileLike | null {
	const api = (view as unknown as { turnstile?: unknown }).turnstile;
	if (typeof api !== 'object' || api === null) return null;
	const named = api as Partial<TurnstileLike>;
	return typeof named.render === 'function' &&
		typeof named.reset === 'function' &&
		typeof named.remove === 'function'
		? (named as TurnstileLike)
		: null;
}

/**
 * the ambient timer, taken off the document the box lives in.
 *
 * off that view rather than the module's own globals for the reason ./stripe.ts's is: this code
 * runs on a page this project does not own, and the element may be in an iframe's document rather
 * than the top one. A document with no view is one nothing is being rendered in, so there is
 * nothing to wait for and the deadline is a no-op.
 */
function defaultDelay(doc: Document): Delay {
	return (run, ms) => {
		const view = doc.defaultView;
		if (view === null) return () => {};
		const timer = view.setTimeout(run, ms);
		return () => view.clearTimeout(timer);
	};
}

/**
 * one install per document, so two forms on one page wait on one script.
 *
 * an install that succeeded only. a failure is dropped from here the moment it resolves — see
 * `installTurnstile`.
 */
const INSTALLS = new WeakMap<Document, Promise<TurnstileLike | null>>();

/**
 * the provider's script on the page, and its API once it has run.
 *
 * `null` rather than a rejection for every way this can fail, which is the promise ./stripe.ts's
 * loader makes: a throw on this path is a donation form that renders nothing at all, where `null`
 * is a sentence on the card naming what to change.
 *
 * a script the host page already installed is adopted rather than joined by a second. The provider
 * keeps one registry of widgets behind one `window.turnstile`, so a second copy is a second
 * registry — and the URL may not be varied to force one anyway.
 *
 * every way this fails is a moment rather than a property of the page — the request did not
 * complete, or the deadline above lapsed with it still in flight — so the `null` is not kept. A
 * document holding one is every later challenge on that page refused, and there are several: a
 * second gift, an attribute change, a second element. The install that follows re-reads the window
 * before anything else, so a script that arrived late is picked up rather than installed again.
 */
export function installTurnstile(
	doc: Document,
	delay: Delay = defaultDelay(doc),
	nonce: string = INJECTING_NONCE
): Promise<TurnstileLike | null> {
	const cached = INSTALLS.get(doc);
	if (cached !== undefined) return cached;
	// dropped in a handler attached here rather than by the caller, so the entry is gone before any
	// consumer of this promise can read the `null` and ask again.
	const installing = install(doc, delay, nonce).then((api) => {
		if (api === null) INSTALLS.delete(doc);
		return api;
	});
	INSTALLS.set(doc, installing);
	return installing;
}

function install(doc: Document, delay: Delay, nonce: string): Promise<TurnstileLike | null> {
	const view = doc.defaultView;
	if (view === null) return Promise.resolve(null);

	const present = readTurnstile(view);
	if (present !== null) return Promise.resolve(present);

	const existing = Array.from(doc.querySelectorAll('script')).find((script) =>
		(script.getAttribute('src') ?? '').startsWith(TURNSTILE_SCRIPT_PREFIX)
	);
	const script = existing ?? doc.createElement('script');
	if (existing === undefined) {
		script.setAttribute('src', TURNSTILE_SCRIPT_SRC);
		// assigned rather than set as an attribute, and only where there is one — see `scriptNonce`
		// in ./loader.ts. a script the host page installed carries their own and is left alone.
		//
		// one nonce reaches everything the widget needs: Cloudflare propagates it from this `api.js`
		// tag to every resource the widget loads afterwards
		// (https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
		if (nonce !== '') script.nonce = nonce;
		script.async = true;
		script.defer = true;
		(doc.head ?? doc.documentElement).appendChild(script);
	}

	return new Promise((resolve) => {
		let settled = false;
		let disarm: (() => void) | null = null;
		const done = (api: TurnstileLike | null): void => {
			if (settled) return;
			settled = true;
			disarm?.();
			resolve(api);
		};
		// the API is defined by the script's own execution, so the `load` event is where to read it
		// from. A script that loads and defines nothing is the same outcome as one that never
		// loaded — a proxy answering the request with something that is not the provider's script.
		script.addEventListener('load', () => done(readTurnstile(view)));
		script.addEventListener('error', () => done(null));
		disarm = delay(() => done(null), SCRIPT_DEADLINE_MS);
	});
}

/** a challenge that will never draw anything, which is every path that reported instead. */
const DRAWS_NOTHING: FormChallenge = { reset: () => {}, stop: () => {} };

/**
 * one challenge widget, in the box the card handed over.
 *
 * the token travels out through `onToken` and never as a return value: the widget answers whenever
 * the visitor's own challenge settles, which for a visitor being asked to interact is whenever
 * they get to it. Every token is passed on rather than only the first — one expires after five
 * minutes and `refresh-expired` has the widget replace it — and the flow keeps the last one to
 * arrive, so a donor who filled the form in slowly still presses with a live token.
 */
export function createChallenge(
	config: FormConfig,
	mount: HTMLElement,
	onToken: (token: string) => void,
	onUnavailable: (failure: Failure) => void,
	seam?: ChallengeSeam
): FormChallenge {
	/**
	 * the report that no token is coming, made every time there is one to make.
	 *
	 * unlatched, and the flow is why: a report is answered where the flow can answer it and held
	 * where it cannot (`heldChallenge` in ../checkout.machine.ts), so nothing here has to decide
	 * which of a widget's failures is the one worth carrying. latched, the first report would be
	 * that decision — and a first report arriving in a window nothing may act on would be the last
	 * word this adapter ever got in, leaving a donor to be refused at the endpoint instead.
	 *
	 * it costs the donor no extra screen: a report the flow has already answered leaves it on the
	 * screen it is already showing.
	 */
	const unavailable = (fix: string): void => {
		onUnavailable({ message: UNCHALLENGEABLE, fix });
	};

	const sitekey = config.turnstileSiteKey?.trim() ?? '';
	if (sitekey === '') {
		// said now rather than held until a press. the endpoint refuses this deployment's every
		// donation as `challenge_unavailable` whatever the donor does, so the alternative is a form
		// that looks like a form until somebody has filled the whole of it in.
		unavailable(NO_SITEKEY_FIX);
		return DRAWS_NOTHING;
	}

	/** how many retryable failures the widget has reported, counted for `RETRYABLE_FAILURE_LIMIT`. */
	let failures = 0;

	/** the widget once it exists, held only for the two calls that name it by id. */
	let widget: { readonly api: TurnstileLike; readonly id: string } | null = null;
	/** whether the element has taken this challenge off the page already. */
	let stopped = false;

	const load = seam?.load ?? (() => installTurnstile(mount.ownerDocument, seam?.delay));

	void load()
		.then((api) => {
			// the element stops a card whose script is still in flight — a form id that changed, or
			// an element that left the document — and drawing into the box it has since dropped
			// would leave a widget registered against nothing.
			if (stopped) return;
			if (api === null) {
				unavailable(SCRIPT_FIX);
				return;
			}
			const id = api.render(mount, {
				sitekey,
				// draws nothing at all unless this visitor is actually being asked to solve
				// something, which is what lets the card reserve no space for it.
				appearance: 'interaction-only',
				// the form is light only — the card's greys are fixed near-white literals in
				// ../styles/tokens.css and no seed reaches them — so the widget's own `auto` would
				// paint a dark box on a white card for a visitor whose system asks for one.
				theme: 'light',
				// the card is 375px wide at its floor and every width above that is the host's — it
				// may be a narrow sidebar or the full width of a page — so a widget with a fixed
				// width would either overflow the step it draws in or sit marooned in it.
				size: 'flexible',
				// stated rather than inherited from the provider's default: a token expires after
				// five minutes, a donor may take longer than that over a card number, and this is
				// what replaces it under them without anything being pressed.
				'refresh-expired': 'auto',
				callback: (token) => {
					// a widget that answered is not a widget that is failing, whatever it reported on
					// the way here. the count below runs from this token rather than from the render,
					// so a blip an hour on a card a donor is slow over never adds up to a report.
					failures = 0;
					onToken(token);
				},
				'error-callback': (code) => {
					const reported = String(code);
					if (reported === UNAUTHORIZED_DOMAIN) {
						unavailable(UNAUTHORIZED_DOMAIN_FIX);
					} else if (UNRECOVERABLE_CODES.includes(reported)) {
						unavailable(
							`The security check reported error ${code}, which Cloudflare documents as not ` +
								'retryable. Check the sitekey and the hostnames on the widget at ' +
								'dash.cloudflare.com > Turnstile: this page must be served from one of them.'
						);
					} else {
						// everything else is a row Cloudflare marks retryable and the widget retries by
						// itself, so the first one is passed over on purpose — see `UNRECOVERABLE_CODES`.
						// what is counted is how many have come back without a token between them, which
						// is the one thing that tells a widget retrying apart from one that has retried
						// and gone on failing. see `RETRYABLE_FAILURE_LIMIT`.
						failures += 1;
						if (failures >= RETRYABLE_FAILURE_LIMIT) unavailable(repeatedFailureFix(reported));
					}
				},
				// the interactive challenge expired with the donor still looking at it, which the
				// provider's own troubleshooting answers with exactly this call.
				'timeout-callback': () => widget?.api.reset(widget.id)
			});
			if (id === undefined) {
				unavailable(SCRIPT_FIX);
				return;
			}
			widget = { api, id };
		})
		.catch(() => unavailable(SCRIPT_FIX));

	return {
		reset: () => widget?.api.reset(widget.id),
		stop: () => {
			stopped = true;
			widget?.api.remove(widget.id);
			widget = null;
		}
	};
}
