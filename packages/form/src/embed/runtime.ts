// the runtime the loader installs: the element, registered, with the one read and the ports it
// cannot build for itself.
//
// this is the seam ../element.ts describes from the other side. the element takes a `FormRuntime`
// at registration rather than importing `fetch` or a payment SDK, and this file is the deployment's
// implementation of it. it and ./api.ts are the two places in `packages/form/src/**` that read data
// over the network. ./loader.ts causes a fetch too, by putting a `<script src>` on the page, but it
// reads nothing and parses nothing.
//
// this file owns the two halves of the world the form talks to, and only these two. the network
// half is the read — `GET /api/v1/forms/:id/config`, here, off the deployment this script was
// served from — and ./api.ts's write, which this composes: the quote port is wrapped so the
// provider's own fields learn the total the server just named. the write is in that other module
// because the deployment's own donation page spends it holding none of this one, and its header
// states the rule. the payment half is ./stripe.ts, which this composes too: the three ports a
// provider owns are taken from the surface it builds.
//
// a donor coming back from a payment provider is ./resume.ts's, both ends of it, and this file
// composes that too: what is decided here is which boot gets the one return a page can carry.
//
// the config is passed to the flow exactly as the deployment served it. narrowing it here is a
// thing this file used to do and deliberately no longer does: every rail a config may name is one
// ./stripe.ts can carry to a confirmation, wallets included, so a rail dropped on the way in would
// be this runtime overruling the account that was actually asked.

import { defineDonateForm, type FormBoot, type FormRuntime } from '../element';
import type { CheckoutPorts } from '../ports';
import { apiWords, createQuote, EmbedFailure, readJson } from './api';
import { createPaymentSurface } from './stripe';
import { takeResumeToken } from './resume';
import { createChallenge } from './turnstile';
import {
	currentScriptIfOurs,
	isRuntimePath,
	isRuntimeScript,
	lastScript,
	LOADER_PATH,
	RUNTIME_MARK,
	scriptOrigin
} from './loader';

/** the read the element boots on. `v1` is permanent, so this path is too. */
export function configUrl(origin: string, formId: string): string {
	return `${origin}/api/v1/forms/${encodeURIComponent(formId)}/config`;
}

const UNREADABLE = 'This donation form could not be loaded.';

/**
 * the deployment's own read, returning the body and nothing more.
 *
 * nothing here inspects what came back. `readFormConfig` in ../config.ts is what decides whether a
 * gift can be solicited on it, and it already treats the value as untrusted; a second, weaker check
 * here would be a second place for the two to disagree.
 *
 * every way the read can fail becomes a sentence and a fix, though, because the alternative is the
 * card rendering "Failed to fetch" at somebody trying to work out why their form is blank. the
 * three are distinct on purpose: the request never completed, it completed with a status, or it
 * completed with a body that is not json.
 *
 * an abort is re-thrown untouched. the element aborts the read when it leaves the document or its
 * `form` attribute changes, and ../element.ts answers an aborted read by rendering nothing at all —
 * turning that into an `EmbedFailure` would paint a failure card for a form nobody is looking at.
 */
function createLoadConfig(origin: string | null): FormRuntime['loadConfig'] {
	return async (formId, signal) => {
		if (origin === null) {
			throw new EmbedFailure(
				UNREADABLE,
				`The embedded runtime could not tell which deployment it was served from, so it has nowhere to read this form's configuration. Load it through ${LOADER_PATH} on the deployment that hosts the form.`
			);
		}
		const url = configUrl(origin, formId);

		let response: Response;
		try {
			response = await fetch(url, {
				signal,
				credentials: 'omit',
				headers: { accept: 'application/json' }
			});
		} catch (error) {
			if (signal.aborted) throw error;
			throw new EmbedFailure(
				UNREADABLE,
				`GET ${url} could not be reached from this page. The form is embedded on another origin, so check that this deployment serves that route and answers this page's origin with an Access-Control-Allow-Origin header — a request refused by the browser reports no status here.`
			);
		}

		if (!response.ok) {
			const parsed = await readJson(response);
			const words = parsed.ok ? apiWords(parsed.value) : null;
			throw new EmbedFailure(
				words?.message ?? UNREADABLE,
				words?.fix ??
					`GET ${url} answered ${response.status}. Check that a form with this id is published on this deployment.`
			);
		}

		const parsed = await readJson(response);
		if (!parsed.ok) {
			throw new EmbedFailure(
				UNREADABLE,
				`GET ${url} answered ${response.status} with a body that is not JSON.`
			);
		}
		return parsed.value;
	};
}

/** everything the element cannot build for itself, for one deployment. */
export function createFormRuntime(origin: string | null, doc: Document): FormRuntime {
	// built per configuration rather than once, which is what `FormRuntime.checkout` in
	// ../element.ts describes: the ports a form runs on are a function of the config it booted
	// with. `quote` needs only the deployment's origin, and the payment surface needs the config
	// itself — a payment SDK is initialised with the publishable key it carries.
	const post = createQuote(origin);

	/**
	 * the return this page came back with, per form, held from the one read that could claim it.
	 *
	 * the claim empties the URL and can therefore happen once, and a page may hold the same form
	 * twice — a hero and a footer on a donation page. the donor gave to that form, so every element
	 * showing it says so: whichever of them booted first is not the one that gets to keep the token.
	 *
	 * a form the return does not name is held as nothing, which is a page whose other form owns the
	 * return, or a return this project did not send anybody on. `takeResumeToken` in ./resume.ts
	 * leaves both of those URLs whole.
	 */
	const claimed = new Map<string, string | null>();

	/**
	 * that return, for a boot entitled to it.
	 *
	 * only a first boot is. a second `checkout` for one form id is either a second element or an
	 * element booting again, and nothing here can tell them apart — so the element says which
	 * (`FormRuntime.checkout` in ../element.ts). "Give again" carrying the old token repaints the
	 * thank-you for a gift that already settled, which is a form nobody can use a second time on
	 * that page load.
	 */
	const returned = (formId: string, boot: FormBoot): string | null => {
		if (boot !== 'first') return null;
		const held = claimed.get(formId);
		if (held !== undefined) return held;
		const token = takeResumeToken(doc, formId);
		claimed.set(formId, token);
		return token;
	};

	return {
		loadConfig: createLoadConfig(origin),
		checkout: (config, mount, onRail, onUnavailable, boot) => {
			// the return this gift is resuming, where this form is the one that sent the donor away.
			// read here rather than where `post` is built, because the answer is per form and per
			// boot, and neither is known until an element asks.
			const resumeToken = returned(config.formId, boot);
			// the two reports the provider's own surface makes, passed straight through. nothing is
			// decided here — `chosenRail` in ./stripe.ts has already turned the provider's word into
			// one of this deployment's rails or into `null`, and the sentence a donor reads when the
			// fields never came up is written there too, next to what it knows about why.
			// ../element.ts is what turns each report into an event the flow accepts.
			const surface = createPaymentSurface(config, mount, onRail, onUnavailable);
			// the quote port, wrapped so the provider's own fields learn what the server just
			// decided. nothing is decided here: the total is the server's and the payer is the one
			// the request was made for, and both are handed on exactly as they came back.
			const quote: CheckoutPorts['quote'] = async (request) => {
				const minted = await post(request);
				surface.quoted(request, minted);
				return minted;
			};
			return {
				input: {
					config,
					ports: {
						quote,
						confirm: surface.confirm,
						resume: surface.resume,
						now: () => Date.now()
					},
					...(resumeToken === null ? {} : { resume: { paymentToken: resumeToken } })
				},
				// the cadence the card reports, passed straight through. nothing is decided here: the
				// donor committed to it and ./stripe.ts is what turns it into the shape the provider's
				// own fields are drawn in.
				cadence: surface.cadence,
				// the card letting go of the surface built for this configuration, and it is this
				// surface's own: a second gift is a second call here, so a door shared between them
				// would stop the live one on the orphan's behalf.
				stop: surface.stop
			};
		},
		// the anti-abuse challenge, passed straight through. nothing is decided here for the same
		// reason nothing is decided about the payment surface: ./turnstile.ts owns which widget this
		// deployment draws, what a failure of it says to a donor, and whether a configuration naming
		// no sitekey draws anything at all. ../element.ts is what turns each token it mints into an
		// event the flow accepts.
		challenge: (config, mount, onToken, onUnavailable) =>
			createChallenge(config, mount, onToken, onUnavailable)
	};
}

/**
 * where this deployment is, per the runtime's own script tag.
 *
 * three readings, in falling order of how sure each is. `document.currentScript` is this script's
 * own element and settles it outright, where the browser still has it. then the marker the loader
 * stamped on what it installed, which is the ordinary answer once this code is running inside a
 * callback. only then a script served from under the runtime directory.
 *
 * the order matters rather than being tidiness: the marker is written by this project's own loader
 * and the path is not, so a script the org happens to serve from a directory of that name later in
 * their document must not outrank it.
 *
 * the path reading exists so the origin is still readable when the marker is absent — a tag copied
 * by hand, or written by a tag manager that strips unknown attributes. it is not a blessing of
 * pinning a hashed runtime url: that url stops being served by the next deploy, which empties the
 * directory, and the tier it is served under is `immutable`, so nothing revalidates it. the
 * supported integration point is the snippet, and it is the only one.
 */
export function runtimeOrigin(doc: Document): string | null {
	const base = doc.baseURI;
	const marked = (script: HTMLScriptElement): boolean => script.hasAttribute(RUNTIME_MARK);
	const underRuntimeDir = (script: HTMLScriptElement): boolean => isRuntimePath(script, base);
	const script =
		currentScriptIfOurs(doc, (candidate) => isRuntimeScript(candidate, base)) ??
		lastScript(doc, marked) ??
		lastScript(doc, underRuntimeDir);
	return scriptOrigin(script, base);
}

/**
 * the runtime, whole.
 *
 * registers even when the origin could not be read, because the element is what says so: it paints
 * the unavailable card carrying the sentence `loadConfig` refuses with. not registering would leave
 * an unknown tag on the page, which renders as nothing at all and reports nothing to anyone.
 */
export function startRuntime(doc: Document): void {
	defineDonateForm(createFormRuntime(runtimeOrigin(doc), doc));
}
