// `<bg-donate-form>`: the donation form as a custom element, in plain TypeScript.
//
// no framework, and that is a contract rather than a preference. this element is pasted into
// sites this project cannot reach, on top of whatever they already run. it consumes the flow in
// ./checkout.machine.ts through ./connect.ts and renders it; it re-implements none of it.
//
// the public surface is closed and permanent. two attributes (`form`, `variant`), one seed custom
// property, twelve `::part()` names and two slots — all published in `custom-elements.json`,
// all add-never-rename, exactly like `v1` (CLAUDE.md, "Permanent contracts"). one object-valued
// attribute would make React support version-dependent, so the attributes stay primitive.
//
// the runtime is injected at registration, not imported. `defineDonateForm` takes the two things
// this element cannot build for itself — the read that fetches a form's configuration, and the
// ports the flow reaches the world through — and closes the element class over them. that is what
// keeps this module free of `fetch` and free of a payment SDK, and it is the same rule the server
// side keeps for the handles it builds (CLAUDE.md): nothing built from the outside world is a
// module-scope singleton. a spec registers its own runtime under
// its own tag and drives the whole element from a literal configuration.
//
// the class is declared inside the factory, so importing this module does not touch `HTMLElement`
// and does not require a DOM. only calling `defineDonateForm` does.

import { createActor, type Actor } from 'xstate';
import { checkoutMachine, type CheckoutInput, type Failure } from './checkout.machine';
import { connect, type State } from './connect';
import { readFormConfig } from './config';
import { SLOT_NAMES } from './parts';
import {
	createAnnouncer,
	createCard,
	createSkeleton,
	createUnavailable,
	domPropTypes,
	put
} from './views';
import type { FormConfig, Frequency, PaymentMethod } from './v1';
import tokens from './styles/tokens.css?inline';
import partStyles from './styles/parts.css?inline';
import layoutStyles from './styles/layout.css?inline';
import motionStyles from './styles/motion.css?inline';

/** the tag, and it is permanent: a breaking change ships as a second element beside this one. */
export const DONATE_FORM_TAG = 'bg-donate-form';

/** the attribute surface, and there is no third. */
export const OBSERVED_ATTRIBUTES = ['form', 'variant'] as const;

/**
 * how the form is projected into the page.
 *
 * one value today. an unrecognised variant renders as `inline` rather than refusing to render:
 * the attribute arrives from a snippet somebody pasted, and a donation form that renders nothing
 * because of a typo in a presentation hint is a worse answer than one that renders plainly.
 */
export const VARIANTS = ['inline'] as const;
export type Variant = (typeof VARIANTS)[number];

const DEFAULT_VARIANT: Variant = 'inline';

/** the two published slot names, off the one list that `custom-elements.json` is checked against. */
const [LOADING_SLOT, PAYMENT_SLOT] = SLOT_NAMES;

/**
 * what a runtime hands back for one configuration.
 *
 * three things across one seam. `input` is what the flow starts on; `cadence` is what this card
 * tells the runtime once it has. it is a callback rather than a field on `input` because the answer
 * changes after the flow starts — a donor may come back to the amount step and commit to a
 * different one — and because nothing about it belongs to the flow: the machine holds the decision,
 * and what needs it is the payment surface the runtime built.
 *
 * `stop` is the third and it travels no further than this element: it is what the card holds a
 * payment surface by, the same way `FormChallenge` below is what it holds a challenge widget by.
 * this is a private runtime seam rather than the element's published surface, so it is absent from
 * `custom-elements.json` and nothing an integrator can see changes with it.
 */
export type FormCheckout = {
	readonly input: CheckoutInput;
	/**
	 * how often the gift the donor has committed to repeats, or nothing while they are still
	 * deciding.
	 *
	 * a payment provider's own fields are drawn for a gift collected once or for the first
	 * collection of one collected again, and the two are not the same fields: the terms a donor
	 * authorizes a schedule under are rendered by the provider, and only for a surface that was
	 * told a schedule is what it is collecting for.
	 */
	readonly cadence: (frequency: Frequency | undefined) => void;
	/**
	 * takes the provider's own fields down, which removing the node they were mounted into does not
	 * do.
	 *
	 * the same thing `FormChallenge.stop` below is for and for the same reason: what the provider
	 * built is registered inside its own script, and a mount node collected out from under it leaves
	 * every subscription and every timer it armed reporting into a flow that has been stopped. a
	 * second gift re-boots this element once per gift, so without this it is one orphan per gift.
	 */
	readonly stop: () => void;
};

/**
 * which boot is asking a runtime for a checkout.
 *
 * the one thing about a boot a runtime cannot work out for itself. two elements showing the same
 * form and one element booting a second time are both a second `checkout` for one form id, and they
 * want opposite answers about a payment provider's return: the second element is a donor looking at
 * the gift they just made from another place on the page, and the second boot is a donor starting a
 * gift of their own.
 *
 * `first` is an element's genuine first boot and nothing else. a re-boot — "Give again", a Try again
 * on a failed read, the `form` attribute changing, a re-insertion into the document — is `again`,
 * whatever it is booting for.
 */
export type FormBoot = 'first' | 'again';

/**
 * one anti-abuse challenge, from the side the element holds it by.
 *
 * two calls, and neither is a read: the token travels the other way, through the callback the
 * runtime was handed. what the element is left holding is the two moments only it knows about.
 */
export type FormChallenge = {
	/**
	 * discards the token the widget last handed over and mints another.
	 *
	 * a challenge token is valid once and for five minutes, so the token a request carried is spent
	 * whether the server honoured it or refused it — see `#start` below for when this is called and
	 * why the answer is not "when the donor presses Try again".
	 */
	readonly reset: () => void;
	/** takes the widget off the page, which the shadow tree being replaced does not do. */
	readonly stop: () => void;
};

/**
 * everything the element cannot build for itself.
 *
 * three functions, and the smallness is still the point — the same discipline `CheckoutPorts` is
 * held to in ./ports.ts. one reads a configuration, one turns that configuration into everything
 * the flow for it runs on, one puts an anti-abuse challenge on the page. each is a third party's
 * script this module may not import; a fourth that was not would be something this element had
 * started deciding for itself.
 */
export type FormRuntime = {
	/**
	 * `GET /api/v1/forms/:id/config`, or whatever stands in for it.
	 *
	 * returns the parsed body and nothing more: what is required of it is checked by
	 * `readFormConfig` in ./config.ts, because the response is untrusted JSON reaching code that
	 * runs on a stranger's page. the signal is aborted when the element leaves the document or its
	 * `form` attribute changes, so a read for a form nobody is looking at any more is dropped
	 * rather than rendered.
	 */
	readonly loadConfig: (formId: string, signal: AbortSignal) => Promise<unknown>;

	/**
	 * everything one configuration is run on, which is the three things `FormCheckout` above
	 * describes.
	 *
	 * built per configuration rather than once, because a payment SDK is initialised with the
	 * publishable key the configuration carries.
	 *
	 * `mount` is the node a provider paints its own fields into. it is passed rather than found:
	 * the `::part()` names are a permanent contract for a host page to style with (./parts.ts)
	 * and querying one to mount into would spend that vocabulary on something it was not drawn
	 * for. nothing about the node reaches `CheckoutInput` — the flow never learns a DOM node
	 * exists, so a headless consumer is unaffected.
	 *
	 * that node is in the light DOM and `#openPaymentBox` below says why. what a runtime must not
	 * do is assume otherwise: it is handed a node to mount into and never a tree to search.
	 *
	 * `onRail` and `onUnavailable` are the two things that travel the other way, and both are
	 * callbacks rather than return values because both answer whenever the provider's script gets
	 * around to it, which is long after this call returns.
	 *
	 * this card draws no rail control: the provider's own fields are the picker, so the runtime
	 * reports what they hold and `#start` below turns each report into a `SET_METHOD`. `null` is
	 * one of the answers — see `chosenRail` in ./embed/stripe.ts.
	 *
	 * `onUnavailable` is the payment surface saying it never came up, at most once, carrying the
	 * sentence a donor reads and the fix whoever embedded the form needs. `#start` turns it into a
	 * `PAYMENT_UNAVAILABLE`, which is how a form with no card fields on it stops being a form that
	 * silently does nothing.
	 *
	 * `boot` is the last thing the element states and the only one about itself: `FormBoot` above
	 * says what a runtime does with it, and `#start` below says how this element knows the answer.
	 */
	readonly checkout: (
		config: FormConfig,
		mount: HTMLElement,
		onRail: (method: PaymentMethod | null) => void,
		onUnavailable: (failure: Failure) => void,
		boot: FormBoot
	) => FormCheckout;

	/**
	 * the anti-abuse challenge in front of the endpoint one press spends.
	 *
	 * `/api/v1` is public, unauthenticated and payment-initiating, and the endpoint requires a
	 * challenge token on every quote (`QuoteRequest.turnstileToken` in ./v1.ts). this is where that
	 * token comes from, so a form with no caller for it is a form no donation can be completed on.
	 *
	 * `mount` is the node the widget draws in, passed rather than found for the reason `checkout`'s
	 * is. unlike that one it is inside the shadow root: a challenge widget completes a mount there
	 * and paints, which is the comparison `#start` below records. a runtime is still handed a node
	 * and never a tree to search, so neither side depends on which it is.
	 *
	 * `onToken` is every token the widget mints, not just the first — one expires after five
	 * minutes and the widget replaces it on its own, so the last one to arrive is the one a press
	 * spends. `onUnavailable` is the challenge saying it will never mint one at all, at most once,
	 * carrying the sentence a donor reads and the fix whoever runs the deployment needs. Both are
	 * callbacks because both answer whenever the provider's script gets around to it.
	 *
	 * a configuration naming no challenge is a runtime that draws nothing and reports nothing — the
	 * decision belongs beside the vendor rather than here, and the endpoint refuses that deployment
	 * either way.
	 */
	readonly challenge: (
		config: FormConfig,
		mount: HTMLElement,
		onToken: (token: string) => void,
		onUnavailable: (failure: Failure) => void
	) => FormChallenge;
};

/**
 * the cadence this gift is committed to, or nothing while the donor is still deciding one.
 *
 * off the committed value rather than off the radio the donor is pressing, so a payment surface is
 * drawn for the gift an intent will be minted for and never for one being deliberated over. every
 * step that can reach a payment carries it — `commitAmount` in ./checkout.machine.ts is the one
 * place a draft becomes one — so a donor who goes back and commits to a different cadence moves it
 * again on the press that carries them forward.
 */
function committedFrequency(state: State): Frequency | undefined {
	return 'fv' in state ? state.fv?.frequency : undefined;
}

/**
 * the constructed stylesheets for one document, built once and shared by every element in it.
 *
 * keyed by document rather than held in a module variable, and that is what the two documents in
 * play need: a page may hold more than one of these elements, an element may live in an iframe's
 * document rather than the top one, and a constructed sheet may only be adopted by the document it
 * was constructed in — so an element that moves between them is served a set per document rather
 * than carrying one across (`adoptedCallback` below).
 *
 * the token sheet is held beside the set because it is the one that also belongs in the document's
 * own list, and that membership is asserted rather than assumed.
 */
const SHEETS = new WeakMap<
	Document,
	{ readonly shadow: readonly CSSStyleSheet[]; readonly token: CSSStyleSheet }
>();

/**
 * the token sheet in the document's own list, put back wherever it is not there.
 *
 * asserted on every mount rather than appended once, because the array is the host page's. a design
 * system that assigns where this appends — `document.adoptedStyleSheets = [theirs]` — takes this
 * sheet off with it, and takes every `@property` registration the seeds derive from with that. the
 * check is an `includes` over a list a page holds a handful of entries in.
 */
function adoptTokens(doc: Document, token: CSSStyleSheet): void {
	if (doc.adoptedStyleSheets.includes(token)) return;
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, token];
}

/**
 * the sheets a shadow root adopts, having put the token sheet into the document as well.
 *
 * the second adoption is load-bearing, not defensive. `@property` registrations are collected from
 * the document tree only — one that reaches the engine solely through a shadow root's stylesheet
 * is ignored — so a token sheet adopted into the shadow root alone leaves the five seeds with no
 * initial value and every step derived from them invalid at computed-value time. that is a blank
 * card on any page whose host set no seeds, which is the common case. "registers only from the
 * document tree" in ./styles/tokens.browser.spec.ts is the proof, and the `:host` block in that
 * file matches nothing in the document tree, so the second adoption costs a parse and nothing
 * else.
 *
 * the sheets are built once per document and the document adoption is checked on every call, which
 * is the asymmetry `adoptTokens` above is for: building twice would waste a parse, and appending
 * once trusts a list this code does not own to still hold what it put there.
 */
function sheetsFor(doc: Document): readonly CSSStyleSheet[] {
	const cached = SHEETS.get(doc);
	if (cached !== undefined) {
		adoptTokens(doc, cached.token);
		return cached.shadow;
	}

	const view = doc.defaultView;
	if (view === null) return [];

	const build = (css: string): CSSStyleSheet => {
		const sheet = new view.CSSStyleSheet();
		sheet.replaceSync(css);
		return sheet;
	};

	// order is cascade order for the equal-specificity rules these four files are almost entirely
	// made of. layout comes after paint so that `[hidden]` — which every `display` declaration
	// above it would otherwise outrank — is the last word on what is on screen; motion comes after
	// layout because it moves what layout has placed.
	const tokenSheet = build(tokens);
	const shadow = [tokenSheet, build(partStyles), build(layoutStyles), build(motionStyles)];
	adoptTokens(doc, tokenSheet);
	SHEETS.set(doc, { shadow, token: tokenSheet });
	return shadow;
}

/** what a donor is told about a form that never came up, wherever nothing else said it better. */
const UNLOADABLE = 'This donation form could not be loaded.';

/** the sentence a thrown value carries, where it carries one. */
function describe(error: unknown): { message: string; fix?: string } {
	if (typeof error === 'object' && error !== null) {
		const body = error as { message?: unknown; fix?: unknown };
		if (typeof body.message === 'string' && body.message.length > 0) {
			return typeof body.fix === 'string' && body.fix.length > 0
				? { message: body.message, fix: body.fix }
				: { message: body.message };
		}
	}
	return { message: UNLOADABLE };
}

/** what the wait before a configuration lands is called, for a reader with no skeleton to watch. */
const LOADING_WORDS = 'Loading the donation form.';

/**
 * how long the read a boot waits on is given to answer.
 *
 * exported so a spec asserts the boundary rather than a number copied out of this file, which is
 * how a window silently stops being tested when it is changed — the same reason
 * `MOUNT_DEADLINE_MS` is exported from ./embed/stripe.ts and `SCRIPT_DEADLINE_MS` from
 * ./embed/turnstile.ts.
 *
 * it exists because a read that stalls names itself in no other way. a captive portal, a proxy
 * holding the connection open or an origin that accepted the request and answers nothing leaves the
 * skeleton on screen for the life of the page, which is exactly what a read still in flight looks
 * like — so a donor is given no reason to wait and no reason to stop.
 *
 * thirty seconds, matching every other outward call this form makes, and the two mistakes are not
 * symmetric in the same way: the read ordinarily answers in well under a second, and a deadline
 * tight enough to feel quick is one that refuses a donor on a slow connection whose form was about
 * to arrive.
 */
export const CONFIG_DEADLINE_MS = 30_000;

/** what a read that answered nothing at all says, in the words the reader of this card can act on. */
function unansweredFix(formId: string): string {
	return (
		`The configuration for form ${formId} did not arrive within ${CONFIG_DEADLINE_MS / 1000} ` +
		'seconds. Check that the deployment serving this form is reachable from this page.'
	);
}

/**
 * what a configuration must carry, said in the words an integrator can act on.
 *
 * CLAUDE.md keeps 4xx bodies readable by an agent rather than by a person at a console, and the
 * same reader is the one looking at this card. so the message names the response and the fix names
 * the fields.
 */
const UNREADABLE_CONFIG_FIX =
	'The config response must carry formId, at least one providers entry with a name and a ' +
	'publishableKey, currency, minAmountMinor, maxAmountMinor, at least one known frequency and ' +
	'payment method, and the orgLegalName, ein and deductibilityStatement the gift is solicited ' +
	'under.';

/**
 * the element class, closed over one runtime.
 *
 * a class per registration rather than one class reading a module variable, so two registrations
 * in one document cannot reach each other's runtime.
 */
export function donateFormClass(runtime: FormRuntime): CustomElementConstructor {
	return class BgDonateForm extends HTMLElement {
		static readonly observedAttributes: readonly string[] = OBSERVED_ATTRIBUTES;

		#actor: Actor<typeof checkoutMachine> | null = null;
		#subscription: { unsubscribe(): void } | null = null;
		#reading: AbortController | null = null;
		/** the light-DOM node a payment provider paints into, and the slot it is projected through. */
		#payment: { readonly mount: HTMLElement; readonly slot: HTMLSlotElement } | null = null;
		/** the anti-abuse challenge on the page, or nothing while none has been drawn. */
		#challenge: FormChallenge | null = null;
		/** the payment surface a runtime built for the live boot, or nothing while none is live. */
		#checkout: FormCheckout | null = null;
		/**
		 * what the live card holds outside its own subtree, or nothing while none is live.
		 *
		 * the card's own nodes go with the card when `#show` replaces it; this is for what does not —
		 * `CardView.stop` in ./views.ts is where the list is. held as the function rather than the
		 * view, because that is the whole of what this class ever asks a card for after it is built.
		 */
		#letGoOfCard: (() => void) | null = null;
		/**
		 * the live region every card in this element speaks through, built with the shadow root.
		 *
		 * one per element rather than one per card, which is what makes it heard: assistive
		 * technology announces what arrives in a region already on the page, and a region built with
		 * the card carrying its first sentence arrives in the same breath as the sentence.
		 */
		#announcer: HTMLElement | null = null;
		/**
		 * whether nothing has been said through the region since it reached the tree.
		 *
		 * the one sentence that has to wait a task — see `#announce` below, which is where the whole
		 * reason is written.
		 */
		#regionIsNew = true;
		/** drops a sentence that was scheduled and has stopped being the one to say. */
		#unsay: (() => void) | null = null;
		/**
		 * the sentence a scheduled write will land, or nothing while none is scheduled.
		 *
		 * what keeps a repeat from being undone by an ordinary patch: the region is emptied a task
		 * before the words go back into it, and the same words written into it in between would put
		 * the clear and the sentence in one task, which is a region nothing announces from.
		 */
		#pending: string | null = null;
		/** the card on screen, held rather than looked up: the live region is in front of it. */
		#card: HTMLElement | null = null;
		/**
		 * whether the boot in progress is one the element is taking the caret for.
		 *
		 * decided once per boot, in `#reboot`, and read by every card that boot puts up — the wait,
		 * the card that cannot render and the form itself. one boot shows two of those in sequence,
		 * so the answer has to outlive the read it is taken before.
		 */
		#taking = false;
		/** the cancel for the deadline over the read in flight, or nothing while none is armed. */
		#deadline: (() => void) | null = null;
		/**
		 * the form id a live boot is for, or nothing while none is live.
		 *
		 * this is what makes a boot a decision about the form the attributes name rather than a
		 * reaction to being told something. an upgrade — markup parsed and connected, the defining
		 * script arriving after it, which is the pasted snippet's normal path — hands this element an
		 * attribute reaction and a connect reaction for the same untouched markup, both with
		 * `isConnected` already true. reacting to each of them separately is two configuration reads
		 * and two payment surfaces mounted into one slot, which is what
		 * "boots exactly once through an upgrade" in ./element.dom.spec.ts holds the line on. the
		 * order the two arrive in is not relied on.
		 */
		#live: string | null = null;
		/**
		 * whether this element has already run a checkout, which is what makes the next one a re-boot.
		 *
		 * latched where the checkout is built rather than where a boot starts, so a read that failed
		 * before there was one leaves the element still owed its first: a donor back from their bank
		 * whose configuration read timed out presses Try again, and that press is the first boot this
		 * element ever completed. `FormBoot` above is what the answer is for.
		 */
		#booted = false;
		/**
		 * the cancel for a teardown that has been deferred by a task, or nothing while none is.
		 *
		 * a move arrives as a disconnect and a connect, in that order. that pair is the default the
		 * html spec states at
		 * https://html.spec.whatwg.org/multipage/custom-elements.html#preserving-custom-element-state-when-moved,
		 * where `connectedMoveCallback` below is the declaration it says supersedes it. so at
		 * `disconnectedCallback` there is nothing that tells a donor walking away from a framework
		 * reordering the list this element is in.
		 *
		 * deferring the teardown by a task and cancelling it on the connect is what tells the two
		 * apart, and a task is the shortest wait that does: both reactions of a move are delivered
		 * inside one task, so a microtask would drain before the connect one.
		 *
		 * what it costs is that a departure tears down a task later than the departure, which nothing
		 * on a page can see — the element is off the document either way. `#reboot` below is
		 * unaffected: it stops synchronously, because the element it is stopping is still connected.
		 */
		#leaving: (() => void) | null = null;

		connectedCallback(): void {
			this.#stay();
			this.#bootIfNeeded();
		}

		disconnectedCallback(): void {
			this.#stay();
			// a document with no browsing context has no timer to defer against, and nothing there can
			// be moved either — `#leaving` above is only there to tell a move from a departure, and a
			// document nothing renders in has neither. so this is a departure, taken now: deferred
			// against a view that does not exist, the teardown never runs at all and the payment
			// surface, the challenge widget and the mount node outlive the element.
			if (this.ownerDocument.defaultView === null) {
				this.#stop();
				return;
			}
			this.#leaving = this.#delay(() => {
				this.#leaving = null;
				this.#stop();
			}, 0);
		}

		/**
		 * the element being moved rather than removed, which browsers that have this say outright.
		 *
		 * nothing depends on it. `Element.moveBefore()` fires this in place of the disconnect/connect
		 * pair where an element declares it and falls back to that pair where it does not, which
		 * `#leaving` above absorbs on every engine — and has to, because the feature is Baseline
		 * limited (Chrome and Edge 133, Firefox 144, no Safari;
		 * https://api.webstatus.dev/v1/features/move-before) and every other kind of move arrives as
		 * the pair everywhere. what declaring it buys is the move said outright, in place of the
		 * deferred round trip, on the engines that have it.
		 *
		 * empty because a move changes nothing this element holds. the shadow root, the flow, the
		 * payment mount and the challenge all travel with it.
		 */
		connectedMoveCallback(): void {}

		/** a deferred teardown dropped, because the element is not leaving after all. */
		#stay(): void {
			this.#leaving?.();
			this.#leaving = null;
		}

		/**
		 * the element in a different document, restyled from that document.
		 *
		 * a constructed stylesheet may only be adopted by the document it was constructed in — a
		 * sheet from another one is a `NotAllowedError`
		 * (https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets) — so the four
		 * this root is holding are not the new document's to keep. all four are rebuilt rather than
		 * re-assigned: the token sheet also has to reach the new document's own list, because
		 * `@property` registrations are collected from the document tree and a card with none is a
		 * blank card.
		 *
		 * without this there is no second chance at it. `#mount` above returns early on a shadow root
		 * that already exists, so nothing else would ever ask this document for anything.
		 */
		adoptedCallback(): void {
			const root = this.shadowRoot;
			if (root === null) return;
			root.adoptedStyleSheets = [...sheetsFor(this.ownerDocument)];
		}

		/**
		 * an attribute reaction, including the ones that carry the value the element already has.
		 *
		 * a set of the same value is not filtered out here, and that is what the host's only lever
		 * over a failed boot is: `#live` below is put back to nothing when a read fails, so setting
		 * `form` to the id it already carries is a second read rather than a no-op. filtered here it
		 * would never reach the decision. a boot that succeeded is unaffected — `#bootIfNeeded` is
		 * where "this element is already showing that form" is answered, and it is the only place.
		 */
		attributeChangedCallback(name: string, _previous: string | null, _next: string | null): void {
			if (!this.isConnected) return;
			if (name === 'variant') {
				this.#applyVariant();
				return;
			}
			this.#bootIfNeeded();
		}

		/** boots for the form the attributes name, unless the live boot is already for that form. */
		#bootIfNeeded(): void {
			const formId = this.getAttribute('form')?.trim() ?? '';
			if (this.#live === formId) return;
			this.#reboot(formId);
		}

		/**
		 * everything the last boot started, stopped, and a boot for `formId` in its place.
		 *
		 * a form id that changed is a new configuration, a new flow and a new set of decisions, so
		 * everything the last one started is stopped first: the read in flight is abandoned rather
		 * than allowed to land on the new one, and the payment mount node it put in the host's page
		 * goes with it.
		 *
		 * a second gift on the same form is that same rebuild for a different reason, and it is the
		 * only re-initialization there is. the payment provider's own fields still hold the card the
		 * donor entered and an anti-abuse challenge token is spent once, and `#start` below is the
		 * only thing that builds either — a flow sent back to its first step would leave both, and
		 * take the money again off details nobody re-entered. ./views.ts holds the control that asks
		 * for this and says what it offers.
		 *
		 * the element takes the caret back if and only if it already had it, and that is decided here
		 * rather than by each caller. a press of ours is what took the node holding focus off the
		 * page, and that node was inside this shadow root — Try again, Give again and the deadline
		 * firing over a loading card that took the caret when it went up are all the one condition. a
		 * boot a changed attribute or a first connection asked for moved nobody's caret and must not
		 * move one on a page this element does not own. it is read before `#show` replaces the tree,
		 * because that is what takes the node being read off the document.
		 */
		#reboot(formId: string): void {
			const root = this.#root();
			this.#taking = root !== null && root.activeElement !== null;
			this.#stop();
			this.#mount();
			this.#live = formId;
			void this.#boot(formId);
		}

		/**
		 * the shadow root, its styles and its live region, built once and kept across a disconnect.
		 *
		 * the region is built here rather than with the card for the reason `createAnnouncer` in
		 * ./views.ts gives: it has to be on the page before anything is written into it, and every
		 * card this element shows is younger than the first thing it has to say.
		 */
		#mount(): void {
			// asked for on every boot rather than on the one that builds the root, because the second
			// half of what it does — the token sheet in the document — is an assertion about a list the
			// host page owns and may have assigned since (`adoptTokens` above).
			const sheets = sheetsFor(this.ownerDocument);
			if (this.shadowRoot !== null) return;
			const root = this.attachShadow({ mode: 'open' });
			root.adoptedStyleSheets = [...sheets];
			put(this.ownerDocument, root, [this.#region()]);
		}

		#root(): ShadowRoot | null {
			return this.shadowRoot;
		}

		/** the live region, built the first time it is asked for and kept from then on. */
		#region(): HTMLElement {
			this.#announcer ??= createAnnouncer(this.ownerDocument);
			return this.#announcer;
		}

		/**
		 * what the element says out loud, on the one region that outlives every card.
		 *
		 * the first sentence after the region reaches the tree is deferred by a task, and only that
		 * one: assistive technology that diffs the tree per task sees an insertion carrying its own
		 * text as one mutation and announces nothing at all. every sentence after it lands in a
		 * region that has been on the page since the task before, which is the state a live region
		 * has to be in to be live.
		 *
		 * the deferred write is dropped where a card replaces the one it was written for (`#show`
		 * below), because the sentence belongs to that card: a card patched after it says its own
		 * words through here, and a deferred write landing after that would put a screen the donor has
		 * left back on the one channel they hear.
		 *
		 * `again` is the same wait, asked for by a sentence that has already been said. a `role="status"`
		 * node handed the words it is already holding is not a change and is announced by nobody, so
		 * saying something twice is a clear and a write a task apart — the review step's refusal, which
		 * a donor may be refused for as many times as they press (./views.ts).
		 */
		#announce(words: string, again = false): void {
			const announcer = this.#region();
			// a sentence already on its way is the saying of it. writing it now instead would land the
			// clear and the words inside one task.
			if (this.#pending === words) return;
			// whatever was scheduled has stopped being the sentence to say.
			this.#drop();
			// a clear is not a sentence: it says nothing, so it neither waits a task nor spends the
			// wait the first sentence takes. written only where there is something to clear, because
			// the card patches this region on every reading and most of them have nothing to say.
			if (words === '') {
				if (announcer.textContent !== '') announcer.textContent = '';
				return;
			}
			const write = (): void => {
				this.#unsay = null;
				this.#pending = null;
				if (announcer.textContent !== words) announcer.textContent = words;
			};
			if (!this.#regionIsNew && !again) {
				write();
				return;
			}
			this.#regionIsNew = false;
			announcer.textContent = '';
			this.#pending = words;
			this.#unsay = this.#delay(write, 0);
		}

		/** a sentence that was scheduled and has stopped being the one to say, dropped. */
		#drop(): void {
			this.#unsay?.();
			this.#unsay = null;
			this.#pending = null;
		}

		/** the variant this element renders in, whatever the attribute says. */
		#variant(): Variant {
			const requested = this.getAttribute('variant');
			const known: readonly string[] = VARIANTS;
			return requested !== null && known.includes(requested)
				? (requested as Variant)
				: DEFAULT_VARIANT;
		}

		#applyVariant(): void {
			this.#card?.setAttribute('data-variant', this.#variant());
		}

		/**
		 * the card on screen, with the live region beside it rather than inside it.
		 *
		 * the outgoing card is what goes, and nothing else. replacing the root's children takes the
		 * region out and puts it back in the same task it is then written in, on every card swap —
		 * which is the one mutation a live region cannot survive. so the region is put in once, ahead
		 * of the first card, and stays there for the life of the shadow root: it is the one node here
		 * older than the card, and a boot that replaced it would leave this element announcing into a
		 * region as new as the sentence.
		 */
		#show(card: HTMLElement): void {
			const root = this.#root();
			if (root === null) return;
			const region = this.#region();
			if (region.parentNode !== root) put(this.ownerDocument, root, [region]);
			// the sentence written for the card being replaced, dropped — see `#announce` above.
			this.#drop();
			this.#card?.remove();
			put(this.ownerDocument, root, [card]);
			this.#card = card;
			this.#applyVariant();
		}

		/**
		 * the three phases of loading, in order.
		 *
		 * before this element upgrades there is no shadow root at all, so a host's
		 * `slot="loading"` content is simply what their page renders — nothing here is involved.
		 * from upgrade until the configuration lands, that same content is kept: it matches the
		 * host's page better than anything written here does. only a host who supplied none gets
		 * this component's own skeleton.
		 */
		#showLoading(): void {
			const doc = this.ownerDocument;
			const card = doc.createElement('div');
			card.setAttribute('part', 'card');
			// the one card that reserves a box rather than standing at its own height, and the class
			// is the whole of how the sheet tells it from the two that follow it (`.loading` in
			// ./styles/layout.css). it carries no `::part()` name for the reason the heading below
			// does not: a host who could restyle the reserve could take the anti-CLS floor out from
			// under their own page.
			card.className = 'loading';
			// the language its own words are in, for the reason every card ./views.ts builds carries
			// one.
			card.setAttribute('lang', 'en');
			card.setAttribute('aria-busy', 'true');
			// the wait, as a heading the caret can land on. the skeleton is hidden from the
			// accessibility tree because it is a shape (./views.ts) and a host's own placeholder is
			// theirs to word, so without this a card replacing one that held focus drops the caret on
			// the host page's body with nothing said. visually hidden — the shimmer is what a donor
			// looking at the card reads — and carrying no `::part()` name, for the reason ./parts.ts
			// gives about a surface a host could restyle into something it is not: `position: static`
			// from their sheet would put a node meant only to be heard on the screen.
			const heading = doc.createElement('h2');
			heading.className = 'vh';
			heading.setAttribute('tabindex', '-1');
			heading.textContent = LOADING_WORDS;
			const slot = doc.createElement('slot');
			slot.setAttribute('name', LOADING_SLOT);
			put(doc, card, [heading, slot]);

			const hostSupplied = Array.from(this.children).some(
				(child) => child.getAttribute('slot') === LOADING_SLOT
			);
			if (!hostSupplied) put(doc, card, [createSkeleton(doc)]);
			this.#show(card);
			// one channel. the caret landing on the heading announces the heading, so the region is
			// written only where the caret is not being taken — otherwise the same sentence twice.
			if (this.#taking) heading.focus();
			else this.#announce(LOADING_WORDS);
		}

		/**
		 * the card that says a form cannot be rendered, and the ask that gets past it.
		 *
		 * `retry` is passed by the paths a second read could answer differently and by no other: a
		 * connection that dropped comes back, and nothing else on the page would ever ask again. a
		 * form nobody named is not one of those — the fix is in the host's markup, and a control that
		 * rendered the same card a second time would be a button that does nothing.
		 */
		#showUnavailable(message: string, fix?: string, retry?: () => void): void {
			const view = createUnavailable(this.ownerDocument, message, fix, retry);
			this.#show(view.root);
			// one channel. the card's heading is the sentence, so a caret landing on it is the
			// announcement and the region stays out of it; where no caret is being taken the region is
			// all there is.
			//
			// the sentence and never the `fix` beside it. `role="status"` is atomic, so the region
			// re-reads whatever it holds whole, and the fix names a publishable key, an env var or a
			// screen in /admin — `UNREADABLE_CONFIG_FIX` above is forty words of field names. it is
			// addressed to whoever administers the deployment (./views.ts) and stays on the card,
			// which is where that reader, person or agent, finds it.
			if (this.#taking) view.focus();
			else this.#announce(message);
		}

		/**
		 * a boot for the form the attributes name, asked for by a donor's press.
		 *
		 * two presses ask: Try again on a card whose configuration read failed, and the control that
		 * starts a second gift after one that landed (./views.ts). they are the same act — everything
		 * the last boot started is stopped and a boot for the form the attributes name now takes its
		 * place — so they are one door rather than two.
		 *
		 * the attribute is read rather than an id closed over, so the form a press boots for is named
		 * the way `#bootIfNeeded` above names it.
		 *
		 * the caret is not decided here. the press that reaches this is a control in the shadow root
		 * and is therefore holding focus, which is the condition `#reboot` reads for itself.
		 */
		#bootAgain(): void {
			this.#reboot(this.getAttribute('form')?.trim() ?? '');
		}

		/**
		 * a read that did not become a configuration, on the card and off the live boot.
		 *
		 * both halves are the fix for the same thing. this element renders no form, so it is not live
		 * for one: left live for a form it never rendered, every later reaction naming that same id is
		 * dropped by `#bootIfNeeded` and the card is terminal for the life of the page — a donor whose
		 * phone lost signal for the length of the read never sees the form again, and the host cannot
		 * ask for it either.
		 */
		#unreadable(message: string, fix?: string): void {
			this.#live = null;
			this.#showUnavailable(message, fix, () => this.#bootAgain());
		}

		/**
		 * a wait, off the window this element is actually in. two things take one: the deadline over
		 * the configuration read, and the teardown `#leaving` above defers by a task.
		 *
		 * `ownerDocument.defaultView` rather than the ambient `setTimeout`, for the reason `sheetsFor`
		 * above reads its `CSSStyleSheet` off a document and `defaultDelay` in ./embed/stripe.ts reads
		 * its timer off one: this runs on a page this project does not own, and the element may be in
		 * an iframe's document rather than the top one. a document with no view renders nothing, so
		 * there is nothing to wait for and the deadline is a no-op.
		 */
		#delay(run: () => void, ms: number): () => void {
			const view = this.ownerDocument.defaultView;
			if (view === null) return () => {};
			const timer = view.setTimeout(run, ms);
			return () => view.clearTimeout(timer);
		}

		/** the deadline over the read that has stopped mattering, taken down. */
		#disarm(): void {
			this.#deadline?.();
			this.#deadline = null;
		}

		async #boot(formId: string): Promise<void> {
			if (formId.length === 0) {
				this.#showUnavailable(
					'This donation form was not told which form to render.',
					`Set the form attribute on <${DONATE_FORM_TAG}> to the id of the form to render.`
				);
				return;
			}

			const reading = new AbortController();
			this.#reading = reading;
			this.#showLoading();
			// the card the deadline paints is put up from inside the timer rather than after the call
			// returns, because the failure it is for is a call that returns nothing ever: a promise
			// nobody settles reaches no line below this one. the read is dropped with it, so a body
			// that lands later is abandoned by the `aborted` guards rather than painted over the card
			// the donor has already been asked to act on.
			this.#deadline = this.#delay(() => {
				reading.abort();
				this.#unreadable(UNLOADABLE, unansweredFix(formId));
			}, CONFIG_DEADLINE_MS);

			let body: unknown;
			try {
				body = await runtime.loadConfig(formId, reading.signal);
			} catch (error) {
				this.#disarm();
				if (reading.signal.aborted) return;
				const { message, fix } = describe(error);
				this.#unreadable(message, fix);
				return;
			}
			this.#disarm();
			if (reading.signal.aborted) return;

			const config = readFormConfig(body);
			if (config === null) {
				this.#unreadable(
					`The configuration for form ${formId} could not be read.`,
					UNREADABLE_CONFIG_FIX
				);
				return;
			}
			this.#start(config);
		}

		/**
		 * the node a payment provider paints into, which is deliberately outside the shadow root.
		 *
		 * Stripe's Payment Element cannot complete a mount inside a shadow root. It builds its
		 * container there and fires `loaderstart`, then never reaches `ready`: the frame stays two
		 * pixels high and the fields never appear, which is a donation form no donation can be
		 * completed on. Mounted into an ordinary light-DOM node in the same page it reaches `ready`
		 * and paints. That comparison — three mounts of byte-identical options, light DOM visible,
		 * light DOM hidden, and inside the shadow root — is the whole evidence; the provider
		 * documents neither way.
		 *
		 * so the node is a child of the host and is projected back into the card through a slot in
		 * the `payment` box. `::part(payment)` therefore still resolves to the same visible box an
		 * integrator has always styled, and the provider's fields still appear inside it.
		 *
		 * that is this provider's constraint rather than every provider's, and the same node serves
		 * both. the button surface `@paypal/paypal-js`'s `sdk-v6` entry loads is a custom element its
		 * core script registers — `<paypal-button>`, an ordinary `<button>` and an inline svg in a
		 * shadow root of its own, with no frame anywhere — so it has no container to lose track of
		 * across a boundary. the same three mounts from byte-identical markup — an ordinary light-DOM
		 * node, this slotted node, and directly inside this element's shadow root — paint the same
		 * button at the same size in all three, and a click on it inside a shadow root is `composed`
		 * and reaches a listener on the host element. so a second provider is handed this node as it
		 * stands; a node or a slot of its own would widen a published surface (CLAUDE.md, "Permanent
		 * contracts") for nothing.
		 *
		 * what it costs is stated rather than hidden: this node is outside the encapsulation, so the
		 * host page's own selectors reach it — a `div { margin: 2rem }` in their stylesheet lands on
		 * it, where every other node this element renders is untouchable. The declarations below are
		 * the answer and they are geometry only: an inline declaration outranks any of the host's
		 * normal ones, so the box the provider measures itself against is the one the card gave it.
		 * They are zeroes and keywords rather than values from ./styles/tokens.css because they are
		 * not a look — the look is on the `payment` box, one level up in the shadow tree. Two things
		 * they cannot answer, and nothing can: a host declaration marked `!important`, and anything
		 * inherited, which reaches this node through the slot from the shadow tree rather than from
		 * the host's DOM ancestors and is therefore already the card's.
		 *
		 * the box is drawn `hidden` (./views.ts) and un-hidden here, before the node is handed over.
		 * both halves matter. a provider's frame is projected into that box, so a box out of the
		 * layout is a mount into a subtree with no layout box — and a provider that defers drawing
		 * until it has one would never draw, on the one step of a donation that cannot be skipped.
		 * the hidden window is therefore the one before a provider is being prepared at all, and
		 * `payment.focus()` in ./views.ts is the other reason it has to be that narrow: the review
		 * step's refusal announces itself by putting the caret on this box, and `focus()` on a box
		 * with no layout box is a no-op the platform reports to nobody.
		 *
		 * it is state this code sets rather than a selector, and it cannot be a selector: the box
		 * holds this `<slot>` from here until `#stop`, so `:empty` is false the whole time — it tests
		 * the box's own child nodes, and what arrives arrives in the light DOM one flattening away.
		 * `hidden` rather than a state token because the published vocabulary is `selected`,
		 * `invalid` and `busy`, and a fourth would be a contract nobody asked for.
		 */
		#openPaymentBox(box: HTMLElement): HTMLElement {
			const doc = this.ownerDocument;
			const slot = doc.createElement('slot');
			slot.setAttribute('name', PAYMENT_SLOT);
			put(doc, box, [slot]);

			const node = doc.createElement('div');
			node.setAttribute('slot', PAYMENT_SLOT);
			node.style.cssText =
				'display:block;box-sizing:border-box;margin:0;padding:0;border:0;' +
				'inline-size:100%;min-inline-size:0;max-inline-size:none;' +
				'block-size:auto;min-block-size:0;max-block-size:none;' +
				'position:static;float:none;clear:none;overflow:visible;' +
				'transform:none;filter:none;opacity:1;visibility:visible';
			this.appendChild(node);

			// last, and before the node is returned: from here on a provider is being prepared for
			// this card, which is the whole of what the box's own state says.
			box.hidden = false;

			this.#payment = { mount: node, slot };
			return node;
		}

		#start(config: FormConfig): void {
			// a second gift is the same door a Try again presses, and the region it speaks through is
			// the element's rather than this card's — a card built with one announces its first screen
			// into a region as new as the sentence, which is a screen nobody is told about. the card is
			// handed the saying rather than the node for the same reason it is handed `restart`: what a
			// sentence has to wait for to be heard outlives every card (`#announce` above).
			const view = createCard(
				this.ownerDocument,
				config,
				() => this.#bootAgain(),
				(words, again) => this.#announce(words, again)
			);
			// what this card holds on the host page's own `window`, so `#stop` can let go of it. it is
			// latched before the card is shown because from here on every path out of this method ends
			// at a stop.
			this.#letGoOfCard = () => view.stop();
			// the card goes into the shadow root before the runtime is asked for anything: a payment
			// provider's own fields are painted from this component's ramp, and a detached subtree has
			// no computed style to read one off. it is all one task, so nothing is painted between
			// showing the card and patching it.
			this.#show(view.root);
			// after the card is on screen and before the runtime is asked for anything, for the
			// reason above: the node has to be slotted for the ramp to reach it through the
			// flattened tree, which is where a provider's appearance is read from.
			const mount = this.#openPaymentBox(view.payment);

			// through a holder rather than straight at the actor: the runtime is handed this
			// callback while the actor is still being constructed, so there is nothing to send to
			// yet. every real report arrives with the provider's script, which is later than both
			// this assignment and `start` below.
			let report: (method: PaymentMethod | null) => void = () => {};
			let stop: (failure: Failure) => void = () => {};
			let minted: (token: string) => void = () => {};
			let unchallengeable: (failure: Failure) => void = () => {};
			// the boot this element is on, said once and latched here: from this call on, every boot
			// this element runs is a second one, whatever asked for it.
			const boot: FormBoot = this.#booted ? 'again' : 'first';
			this.#booted = true;
			const checkout = runtime.checkout(
				config,
				mount,
				(method) => report(method),
				(failure) => stop(failure),
				boot
			);
			this.#checkout = checkout;
			const actor = createActor(checkoutMachine, { input: checkout.input });
			report = (method) => actor.send({ type: 'SET_METHOD', method });
			stop = (failure) => actor.send({ type: 'PAYMENT_UNAVAILABLE', failure });
			// through the same door a host writing their own layout has, rather than at the actor: a
			// projection is what publishes `setTurnstileToken` (./connect.ts), so the token this
			// element collects and the token a headless integrator hands in travel one path. built per
			// token rather than held, because a projection is a pure reading of a snapshot and a held
			// one would be a reading of the state the widget answered from rather than the one it
			// answered into.
			minted = (token) =>
				connect(actor.getSnapshot(), actor.send, domPropTypes).setTurnstileToken(token);
			unchallengeable = (failure) => actor.send({ type: 'CHALLENGE_UNAVAILABLE', failure });

			/** the step the last reading was on, which is what makes a reading a transition. */
			let previous: State['step'] | null = null;
			// the cadence goes out before the card is patched, so the provider's own fields and the
			// figures beside them are never a frame apart on what gift is being made. it is told on
			// every reading rather than on a change: this element holds no memory of what it last
			// said, and the surface is where a reading that changes nothing stops.
			const render = () => {
				const api = connect(actor.getSnapshot(), actor.send, domPropTypes);
				checkout.cadence(committedFrequency(api.state));
				view.update(api);
				const { step } = api.state;

				// drawn on arrival at the details step, and after the card has been patched for it so
				// the box the widget is handed is one the donor can see. every other step is `hidden`,
				// and a challenge a visitor is being asked to solve inside a subtree with no box is one
				// they cannot be asked to solve at all — so the box lives in that step's own subtree
				// (./views.ts).
				//
				// it is the last moment it can be drawn without the donor waiting on it: everything
				// between here and the press that spends its token is fields they have to fill in and
				// a review screen they have to read, which is two screens of time the widget has to
				// finish in rather than one.
				if (step === 'details' && this.#challenge === null) {
					this.#challenge = runtime.challenge(
						config,
						view.challenge,
						(token) => minted(token),
						(failure) => unchallengeable(failure)
					);
				}

				// the token is spent by the press that leaves `working`, and spent is spent: it is
				// valid once, whether the server honoured it or refused it. so the widget is reset on
				// the way out of that step rather than on the donor's Try again — a reset started when
				// the refusal lands has the whole of the failure screen to finish in, where one started
				// on the press that leaves it races the press after it. a reset works with the step
				// hidden, which is what a takeover screen leaves it.
				if (previous === 'working' && step !== 'working') this.#challenge?.reset();
				previous = step;
			};

			this.#actor = actor;
			this.#subscription = actor.subscribe(render);
			actor.start();
			render();
			// last, and after the first patch: the heading the caret lands on is inside the step that
			// patch un-hid, and a heading inside a `hidden` subtree is not focusable.
			if (this.#taking) view.focus();
		}

		/**
		 * everything this element started, stopped.
		 *
		 * the shadow root, its styles and its live region stay: a re-insertion boots again — which is
		 * `#live` above going back to nothing — and re-adopting the same sheets is work with no
		 * result. what the region last said stays with it, on an element rendering nothing. a
		 * sentence still waiting to be said is not that, and goes with the deadline below: it was
		 * written for a card this element has finished with.
		 *
		 * the deadline over the read goes, and it is the one thing here that would otherwise fire at
		 * an element nobody is looking at — thirty seconds after a donor closed the panel this form is
		 * in, over a read that was abandoned with it.
		 *
		 * the payment mount does not stay, and it is the one thing here that would otherwise leak
		 * into somebody else's page: it is a light-DOM child, so nothing collects it when the shadow
		 * tree is replaced, and a re-boot would leave the last one behind holding a dead frame. its
		 * slot goes with it. the box those two were in goes with the card, and the next boot draws a
		 * hidden one of its own that `#openPaymentBox` above un-hides when a provider is prepared.
		 *
		 * the challenge is stopped for a reason of its own: its widget is registered inside the
		 * provider's script under an id this element never sees, and replacing the shadow tree the
		 * widget was drawn in collects the nodes without telling the script anything.
		 *
		 * the payment surface is stopped for exactly that reason. it is let go of before it is asked,
		 * so that a surface this element has finished with is never asked a second time — the next
		 * stop has nothing left to reach for. `PaymentSurface.stop` in ./embed/stripe.ts is safe in
		 * whatever order it is reached in, so nothing here is arranged on its behalf.
		 */
		#stop(): void {
			this.#live = null;
			this.#unsay?.();
			this.#unsay = null;
			const letGo = this.#letGoOfCard;
			this.#letGoOfCard = null;
			letGo?.();
			this.#disarm();
			this.#reading?.abort();
			this.#reading = null;
			this.#subscription?.unsubscribe();
			this.#subscription = null;
			this.#actor?.stop();
			this.#actor = null;
			this.#payment?.mount.remove();
			this.#payment?.slot.remove();
			this.#payment = null;
			this.#challenge?.stop();
			this.#challenge = null;
			const checkout = this.#checkout;
			this.#checkout = null;
			checkout?.stop();
		}
	};
}

/**
 * registers the element under its permanent tag.
 *
 * registration is where the runtime arrives, which is what lets the element be constructed by the
 * HTML parser — an upgrade calls a constructor with no arguments, so anything the element needs
 * has to be closed over before the tag exists.
 *
 * the tag is a parameter so that one document can hold two registrations, which is what a spec
 * needs to drive two runtimes. every page gets the default; nothing else is a supported tag.
 */
export function defineDonateForm(runtime: FormRuntime, tag: string = DONATE_FORM_TAG): void {
	if (customElements.get(tag) !== undefined) return;
	customElements.define(tag, donateFormClass(runtime));
}
