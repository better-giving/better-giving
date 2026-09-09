// the file an org pastes a `<script>` tag for, and the only one they ever paste a tag for.
//
// what it does is small and what it must never do is the reason it exists. it finds the deployment
// it was itself served from, and puts one more script tag on the page pointing at the runtime under
// that same origin. it renders nothing, imports nothing from the element and knows no form ids.
//
// small because it is cached briefly. `packages/app/_headers` serves this file with a five
// minute `max-age` and the runtime beside it with a year and `immutable`, and that split is the
// whole upgrade path: the snippet is pasted into sites this project cannot reach and is never
// edited again, so the only thing that can carry a new runtime to them is a short-lived file they
// already ask for. the path it carries is written in at build time by vite.embed.config.ts, so
// there is no manifest to fetch and nothing between the page load and the form.
//
// it reads its own script tag and never `location`. `location` is the org's page; the runtime and
// the `/api/v1` endpoints are on the deployment, and the two are different origins by design. every
// path this file can take either identifies that origin or says out loud that it could not — there
// is no branch that falls back to the page's own origin, because the page's own origin is the one
// answer that is wrong in a way nobody sees.

/** the path the loader is served under. the snippet names it, so it is permanent. */
export const LOADER_PATH = '/embed.js';

/**
 * the directory the content-hashed runtime is served from.
 *
 * shared rather than spelled out at each use, because it is read behaviourally: `isRuntimePath`
 * below decides what counts as a runtime script on somebody else's page, and `runtimeAssetPath` in
 * ./stamp.ts writes the path the loader ships with. those two disagreeing is a loader pointing at a
 * url nothing serves.
 */
export const RUNTIME_PATH_PREFIX = '/embed/';

/**
 * the token the built loader carries where the runtime's path belongs.
 *
 * hyphenated so it can never be mistaken for an identifier a minifier might rename. it lives here
 * beside the two paths rather than in ./stamp.ts, where it is read, so that ./loader.entry.ts can
 * reach it without importing a build-time module — a `new RegExp` at that module's top level is a
 * side effect rollup will not tree-shake, so importing one lands it in the loader as dead code.
 */
export const RUNTIME_PATH_PLACEHOLDER = '__bg-donate-runtime-path__';

/**
 * the query the loader carries when it is a second attempt.
 *
 * two jobs in one parameter. it defeats the cached copy of this file, since a query string is part
 * of the cache key — which is the whole point, because the cached copy is what named a runtime the
 * deploy has stopped serving. and its presence is how the fresh loader knows an attempt has already
 * been spent, so a second failure stops instead of fetching the loader forever.
 *
 * its value is the file name that failed, which keeps the set of distinct urls bounded by the
 * number of deploys rather than growing without limit the way a timestamp would.
 */
export const STALE_PARAM = 'stale';

/** what the loader marks the script it installs with, valued with the deployment it came from. */
export const RUNTIME_MARK = 'data-bg-donate-runtime';

/** an absolute url from a script's `src`, or nothing if there is no reading of it. */
export function scriptUrl(script: Element | null, baseURI: string): URL | null {
	const src = script?.getAttribute('src') ?? null;
	if (src === null || src.trim().length === 0) return null;
	try {
		return new URL(src, baseURI);
	} catch {
		return null;
	}
}

/**
 * a url's origin, or nothing where it has none.
 *
 * `data:` and `blob:` serialise their origin to the string "null", and building a runtime url out
 * of that would ask a host called null for it.
 */
function originOf(url: URL | null): string | null {
	if (url === null || url.origin === 'null') return null;
	return url.origin;
}

/** the origin a script element was served from. */
export function scriptOrigin(script: Element | null, baseURI: string): string | null {
	return originOf(scriptUrl(script, baseURI));
}

/** the origin a url string names, resolved against the page it was written on. */
export function urlOrigin(url: string, baseURI: string): string | null {
	try {
		return originOf(new URL(url, baseURI));
	} catch {
		return null;
	}
}

/**
 * the nonce a script carries, for the scripts this project injects beside it.
 *
 * a host page whose Content-Security-Policy is `script-src 'nonce-…'` without `'strict-dynamic'`
 * blocks every tag injected by a script it did allow, unless that tag carries the same nonce. the
 * snippet the org pasted carries one wherever such a policy is in force, so this is how a form
 * renders there at all.
 *
 * the IDL property and never `getAttribute`: a browser empties the content attribute once the
 * element is in a document, so that a css attribute selector cannot exfiltrate the value
 * (https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/nonce). structural rather than
 * `HTMLElement`, because `document.currentScript` may be an svg script element as well as an html
 * one and both carry it.
 */
export function scriptNonce(script: { nonce?: string } | null): string {
	return script?.nonce ?? '';
}

/**
 * a url string as the browser resolves it, so two spellings of one file compare equal.
 *
 * a url that does not parse is handed back untouched, which is a value no `src` on the page can
 * resolve to and so matches nothing — the answer this comparison wants for a url naming no file.
 */
function resolved(url: string, baseURI: string): string {
	try {
		return new URL(url, baseURI).href;
	} catch {
		return url;
	}
}

/**
 * `document.currentScript`, but only when it is one of ours.
 *
 * `currentScript` is the answer for a classic script, which is what the snippet loads — it holds
 * the element for as long as the script's own top-level statements are running, `async` or not. it
 * is null for a module script and null inside any callback.
 *
 * the predicate is applied to it rather than trusted, and that is the whole point of this function.
 * an integrator who inlines this file into their own bundle makes `currentScript` their bundle,
 * served from the org's own domain — and a loader that took that would install a runtime at
 * `https://the-org-site/embed/<hash>.js`, get a 404, render nothing and warn about nothing. a
 * script that is not ours is not an answer, so it falls through to `lastScript` and, failing that,
 * to the warning in `bootLoader`.
 */
export function currentScriptIfOurs(
	doc: Document,
	isOurs: (script: HTMLScriptElement) => boolean
): HTMLScriptElement | null {
	const current = doc.currentScript;
	if (current === null || current.tagName !== 'SCRIPT') return null;
	const script = current as HTMLScriptElement;
	return isOurs(script) ? script : null;
}

/** the last matching script on the page: where a page holds two, the later one is the one that ran. */
export function lastScript(
	doc: Document,
	isOurs: (script: HTMLScriptElement) => boolean
): HTMLScriptElement | null {
	const scripts = doc.getElementsByTagName('script');
	for (let index = scripts.length - 1; index >= 0; index -= 1) {
		const script = scripts[index];
		if (script !== undefined && isOurs(script)) return script;
	}
	return null;
}

/**
 * whether a script's src is this project's loader.
 *
 * the whole path, not its ending. the snippet pins `{origin}/embed.js` at the root, so an ending
 * match would also accept a stranger's `https://vendor.example/widget/embed.js` — and since the
 * fallback takes the last match, a vendor script further down the page would win and hand back the
 * vendor's origin.
 */
export function isLoaderPath(script: Element, baseURI: string): boolean {
	return scriptUrl(script, baseURI)?.pathname === LOADER_PATH;
}

/** whether a script's src is served from where this project's runtimes are served from. */
export function isRuntimePath(script: Element, baseURI: string): boolean {
	return scriptUrl(script, baseURI)?.pathname.startsWith(RUNTIME_PATH_PREFIX) ?? false;
}

/** whether a script is one of our runtimes, however it reached the page. */
export function isRuntimeScript(script: Element, baseURI: string): boolean {
	return script.hasAttribute(RUNTIME_MARK) || isRuntimePath(script, baseURI);
}

/**
 * the loader's own script tag.
 *
 * the element rather than the origin, because two things are read off it: where the deployment is,
 * and whether this copy of the loader is itself a retry. a query string does not change a pathname,
 * so a retry is found by exactly the same test as a first attempt.
 */
export function loaderScript(doc: Document): HTMLScriptElement | null {
	const base = doc.baseURI;
	const isOurs = (script: HTMLScriptElement): boolean => isLoaderPath(script, base);
	return currentScriptIfOurs(doc, isOurs) ?? lastScript(doc, isOurs);
}

/** where this deployment is, per the loader's own script tag. */
export function loaderOrigin(doc: Document): string | null {
	return scriptOrigin(loaderScript(doc), doc.baseURI);
}

/**
 * the tag the runtime registers, which is how this file can tell that it ran.
 *
 * spelled here rather than imported: the loader is its own bundle and imports nothing from the
 * element, so `DONATE_FORM_TAG` in ../element.ts cannot be reached without pulling the whole form
 * into a file that is re-fetched every five minutes. `watches for the tag the runtime actually
 * registers` in ./loader.dom.spec.ts holds the two spellings to each other.
 */
export const RUNTIME_ELEMENT_TAG = 'bg-donate-form';

/**
 * how long an adopted runtime is given to register that tag.
 *
 * exported so a spec asserts the boundary rather than a number copied out of this file, for the
 * reason `SCRIPT_DEADLINE_MS` is exported from ./turnstile.ts.
 *
 * ten seconds because the two mistakes cost differently. the tag this waits on is one already on
 * the page when the loader ran, so in the failure it exists for — a page cached whole, naming a
 * runtime the deploy has stopped serving — the element is undefined immediately and stays that
 * way, and every second of the wait is a donor looking at nothing. the other way is worse: fire
 * while a runtime is legitimately still in flight on a slow connection, and the retry re-fetches
 * the loader and installs a second copy of one that was about to arrive. a year-immutable asset of
 * this size is on screen in well under a second on a connection that has one, so ten is far past
 * honest slowness and still inside what a donor will sit through.
 */
export const ADOPTION_DEADLINE_MS = 10_000;

/**
 * the timer the adoption deadline is armed on.
 *
 * nothing comes back, because nothing cancels it: there is no event for an element being defined
 * to cancel it on, and a timer left to lapse costs one registry lookup on a page whose runtime
 * arrived — `elementRegistered` is read when it fires rather than when it is armed, so a runtime
 * that registered at 200ms makes the lapse a no-op rather than a retry.
 */
type Delay = (run: () => void, ms: number) => void;

/**
 * the ambient timer, off the document the page is in.
 *
 * off that view rather than the module's own globals for the reason `defaultDelay` in
 * ./turnstile.ts is: this code runs on a page this project does not own and the form may be inside
 * an iframe's document. a document with no view registers no elements and renders nothing, so
 * there is nothing to wait for and the deadline is a no-op.
 */
function defaultDelay(doc: Document): Delay {
	return (run, ms) => {
		doc.defaultView?.setTimeout(run, ms);
	};
}

/** whether the runtime has run, which is the only thing an adopted tag reports by. */
function elementRegistered(doc: Document): boolean {
	return doc.defaultView?.customElements.get(RUNTIME_ELEMENT_TAG) !== undefined;
}

/** an element this file has already put a handler on, which no attribute could record. */
type Armed = { __bgDonateArmed?: true };

/**
 * the failure this whole retry path exists for, armed once per element.
 *
 * a deploy stops serving the previous hashed runtime the moment it lands, while browser and edge
 * copies of this loader keep naming it for up to the five minutes `_headers` allows — and in that
 * window the element never upgrades and renders as an empty tag: no card, no message, nothing in
 * the console. what to do about it is the caller's, because only the caller knows whether an
 * attempt has already been spent.
 *
 * once per element because two pasted snippets are two executions of this file with no memory of
 * each other, and the second adopts what the first installed: armed twice, one failure spends both
 * of their retries. the flag is a property rather than an attribute on purpose — an attribute is
 * written into the host's html, and a page restored from a cache of that html carries the flag with
 * no handler behind it, which is exactly the page this path exists for.
 *
 * what comes back is the one spend this element gets, latched, for a caller with a second way of
 * finding out — or nothing, where an earlier call already holds it.
 */
function armRuntimeError(
	script: HTMLScriptElement,
	onError: (failed: HTMLScriptElement) => void
): (() => void) | null {
	const armed = script as HTMLScriptElement & Armed;
	if (armed.__bgDonateArmed === true) return null;
	armed.__bgDonateArmed = true;
	let spent = false;
	const spend = (): void => {
		if (spent) return;
		spent = true;
		onError(script);
	};
	script.addEventListener('error', spend);
	return spend;
}

/**
 * the runtime on the page, once per url.
 *
 * a page may hold two pasted snippets — two forms from the same deployment is the ordinary case —
 * and the second install would be a second download of the whole runtime whose registration is a
 * no-op, since a custom element name may be defined once per document. so a runtime already on the
 * page stops this, and it is adopted rather than merely counted: the same error handler goes onto
 * it, because a tag this file did not create fails every way one it did create can.
 *
 * what counts as "already on the page" is the whole url and never the origin. a host page cached
 * whole — a page cache, an html snapshot, a prerender service — keeps the tag this file installed,
 * hash and all, and the next deploy stops serving that hash. read by origin, that dead tag is a
 * runtime already present: nothing is installed, nothing is armed, and the form is an empty tag
 * with a silent console for as long as the cache lasts. read by url it is what it is — some other
 * runtime — and this installs beside it.
 *
 * a tag is one of ours by where it is served from, never by the marker it carries. every script on
 * a page this project does not own is read here and an attribute is a string anybody may write, so
 * a stranger's script naming this attribute would otherwise suppress the install outright. that is
 * robustness rather than a control — nothing is being kept out, and the marker is still what
 * `runtimeOrigin` in ./runtime.ts prefers when it reads its own origin off the page.
 *
 * two deployments on one page is a different thing and is not supportable here: whichever runtime
 * lands first defines the tag, and every form on the page then reads its configuration from that
 * one deployment. this installs anyway — refusing would guarantee the second deployment loses —
 * and says out loud which two origins are in play, because the alternative is a form that quietly
 * asks the wrong deployment about a form id it has never heard of.
 */
export function installRuntime(
	doc: Document,
	runtimeUrl: string,
	onError: (failed: HTMLScriptElement) => void = () => warnRuntimeLost(runtimeUrl, false),
	nonce = '',
	delay: Delay = defaultDelay(doc)
): HTMLScriptElement | null {
	const base = doc.baseURI;
	const origin = urlOrigin(runtimeUrl, base);
	const wanted = resolved(runtimeUrl, base);
	const foreign = new Set<string>();
	let adopted: HTMLScriptElement | null = null;
	for (const script of Array.from(doc.getElementsByTagName('script'))) {
		if (!isRuntimePath(script, base)) continue;
		const url = scriptUrl(script, base);
		// the whole page is read before anything is adopted: a rival deployment further down it is
		// the one thing this function has to say out loud, and having nothing to install is not a
		// reason to stop looking for one.
		if (url?.href === wanted) {
			adopted ??= script;
			continue;
		}
		const present = originOf(url);
		if (present !== origin) foreign.add(present ?? 'an unreadable origin');
	}
	for (const present of foreign) {
		const beside =
			adopted === null
				? `${origin ?? 'this one'} is being added beside it`
				: `${origin ?? 'this one'} is already on it too`;
		console.warn(
			`a donation form runtime from ${present} is already on this page and ${beside}. One page serves one deployment's forms — whichever runtime loads first answers for all of them — so put the forms for these two deployments on separate pages.`
		);
	}
	if (adopted !== null) {
		const spend = armRuntimeError(adopted, onError);
		// the handler above hears a tag that fails from here on. an adopted tag may have failed
		// before any of this ran — the page was restored from a cache and the browser answered it
		// while the html was still parsing — and no handler hears that one. so the element is a
		// second reporter beside it, and the first of the two to speak is the one that is heard.
		if (spend !== null) {
			delay(() => {
				if (!elementRegistered(doc)) spend();
			}, ADOPTION_DEADLINE_MS);
		}
		return null;
	}

	const script = doc.createElement('script');
	script.setAttribute(RUNTIME_MARK, origin ?? '');
	script.async = true;
	script.setAttribute('src', runtimeUrl);
	// assigned rather than set as an attribute, and only where there is one: an empty nonce on a
	// page whose policy has none is still a value the next reader has to account for.
	if (nonce !== '') script.nonce = nonce;
	armRuntimeError(script, onError);
	const parent = doc.head ?? doc.documentElement;
	parent.appendChild(script);
	return script;
}

/**
 * where a runtime that would not load leaves the page, and it is the terminal state.
 *
 * `retried` is the difference between advice and a diagnosis. before a retry, a stale cached loader
 * is by far the likeliest cause and the reader can do nothing but wait it out. after one, that
 * cause has been ruled out by the attempt itself, so repeating the advice would send somebody to
 * reload a page that has already re-fetched this file.
 */
function warnRuntimeLost(runtimeUrl: string, retried: boolean): void {
	const cause = retried
		? `${LOADER_PATH} was already re-fetched from the deployment once and this is the runtime it named, so a stale cached loader is not the cause. Check that the deployment is reachable and still serving that file.`
		: `If this deployment was updated in the last few minutes, a cached copy of ${LOADER_PATH} is still naming the previous runtime.`;
	console.warn(
		`the donation form runtime at ${runtimeUrl} could not be loaded, so no donation form on this page will render. ${cause}`
	);
}

/**
 * the loader again, past the cache, once.
 *
 * this is what closes the window rather than reporting it. the runtime that failed is almost always
 * one a deploy has stopped serving, named by a copy of this file that a browser or an edge cached
 * before that deploy — and the current name is sitting in the deployment's own copy of this file,
 * behind nothing but that cache. so the answer is to ask for this file again with a query on it,
 * which is a different cache key, and let the fresh copy boot normally.
 *
 * the failed tag is removed first. a fresh loader that names the same runtime — the failure was a
 * connection that dropped rather than a hash the deploy stopped serving — would otherwise adopt the
 * dead tag and install nothing, and adopting is the one outcome that cannot recover here.
 *
 * fetched from the deployment's own origin and never relative to the page, for the reason
 * `loaderOrigin` exists at all: relative would ask the org's site for this project's file.
 */
function retryThroughLoader(
	doc: Document,
	origin: string,
	runtimeUrl: string,
	failed: HTMLScriptElement,
	nonce: string
): void {
	failed.remove();
	const staleName = runtimeUrl.slice(runtimeUrl.lastIndexOf('/') + 1);
	const retry = doc.createElement('script');
	retry.async = true;
	// the same policy that would refuse the runtime refuses this, and a retry the host page blocks
	// is the one failure this path cannot report on its own — see `scriptNonce`.
	if (nonce !== '') retry.nonce = nonce;
	retry.setAttribute(
		'src',
		`${origin}${LOADER_PATH}?${STALE_PARAM}=${encodeURIComponent(staleName)}`
	);
	// the loader itself failing to arrive leaves nothing running and nothing said, which is the
	// silence this whole path is here to end.
	retry.addEventListener('error', () => warnRuntimeLost(runtimeUrl, true));
	const parent = doc.head ?? doc.documentElement;
	parent.appendChild(retry);
}

/**
 * the loader, whole.
 *
 * `runtimePath` is absolute and rooted — `/embed/<hash>.js` — and is joined to the deployment's
 * origin rather than left to resolve against the page, which would ask the org's own site for a
 * file only this deployment has.
 *
 * a deployment it cannot identify is said out loud rather than guessed at. the guess available here
 * is the org's own domain, and a form that loads its configuration from there is one that fails at
 * the moment a donor presses give.
 *
 * one retry, and the count is carried in this file's own url rather than in a variable, because the
 * retry is a different execution of this file with no memory of the one before it. a loader that
 * could retry without a bound would answer a deployment that is simply down by fetching it forever.
 */
export function bootLoader(doc: Document, runtimePath: string): void {
	const script = loaderScript(doc);
	const origin = scriptOrigin(script, doc.baseURI);
	if (origin === null) {
		console.warn(
			`the donation form loader could not tell which deployment it was served from, so nothing was loaded. It must be loaded by a <script> element whose src is ${LOADER_PATH} on the deployment that hosts the form, and not inlined into another bundle.`
		);
		return;
	}
	const runtimeUrl = `${origin}${runtimePath}`;
	const spent = scriptUrl(script, doc.baseURI)?.searchParams.has(STALE_PARAM) ?? false;
	const nonce = scriptNonce(script);
	installRuntime(
		doc,
		runtimeUrl,
		(failed) => {
			if (spent) {
				warnRuntimeLost(runtimeUrl, true);
				return;
			}
			retryThroughLoader(doc, origin, runtimeUrl, failed, nonce);
		},
		nonce
	);
}
