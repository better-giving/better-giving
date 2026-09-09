import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DONATE_FORM_TAG } from '../element';
import {
	ADOPTION_DEADLINE_MS,
	bootLoader,
	installRuntime,
	LOADER_PATH,
	loaderOrigin,
	RUNTIME_ELEMENT_TAG,
	RUNTIME_MARK,
	scriptNonce,
	STALE_PARAM
} from './loader';

// the loader, in the only situation it ever runs in: a page this project does not own.
//
// the one thing worth proving here is that the loader never reads `location`. `location` is the
// org's site — acme.org — and the runtime, and the config endpoint under it, are on the
// deployment. every assertion below therefore plants the loader's own script tag on an origin the
// document is not served from, and checks which of the two came back.

const HOST_PAGE = 'https://acme.org';
const DEPLOYMENT = 'https://donate.example';
const RUNTIME_PATH = '/embed/9f2a1c4e.js';

/** the loader's own script tag, as the parser would have left it. */
function plantLoader(src: string): HTMLScriptElement {
	const script = document.createElement('script');
	script.setAttribute('src', src);
	document.head.appendChild(script);
	return script;
}

/**
 * `document.currentScript` while a classic script is being processed.
 *
 * a classic script — which is what the snippet loads — sees its own element there even under
 * `async`; only a module script and a deferred callback see `null`. no DOM implementation lets a
 * test set it, so it is defined as an own property for the length of one case.
 */
function whileExecuting(script: HTMLScriptElement | null, body: () => void): void {
	Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
	try {
		body();
	} finally {
		Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
	}
}

function injected(): HTMLScriptElement | null {
	return document.querySelector(`script[${RUNTIME_MARK}]`);
}

beforeEach(() => {
	document.head.replaceChildren();
	document.body.replaceChildren();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('finding the deployment', () => {
	it('reads the origin off its own script tag while it is executing', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			expect(loaderOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// the assertion above is worth nothing unless the two origins differ, so this states that they
	// do — and states it as an identity. a bare `not.toBe(location.origin)` would also pass on
	// `null`, which is the answer this function gives when it has found nothing at all.
	it('does not answer with the page it was pasted into', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			expect(document.location.origin).not.toBe(DEPLOYMENT);
			expect(loaderOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// `document.currentScript` is null in a callback, and a host that copies the snippet into an
	// injected script can leave it null outright. the tag is still on the page, so it is found by
	// what it is: a src whose path is /embed.js.
	it('falls back to the script tag whose src is /embed.js', () => {
		plantLoader(`${HOST_PAGE}/vendor/analytics.js`);
		plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(null, () => {
			expect(loaderOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	it('answers with nothing when no script on the page is one of ours', () => {
		plantLoader(`${HOST_PAGE}/vendor/analytics.js`);
		whileExecuting(null, () => {
			expect(loaderOrigin(document)).toBeNull();
		});
	});

	// an integrator who inlines this file into their own bundle makes `currentScript` their bundle,
	// served from the org's own domain. taking it would install a runtime at the org's own origin —
	// a 404, a blank space, and nothing in the console, because the warning only fires on `null`.
	// so a script that is not ours is not an answer.
	it('refuses a currentScript that is not the loader', () => {
		const theirs = plantLoader(`${HOST_PAGE}/bundle.js`);
		whileExecuting(theirs, () => {
			expect(loaderOrigin(document)).toBeNull();
		});
	});

	// with the loader still on the page, an inlined copy falls through to it rather than to nothing.
	it('falls through a foreign currentScript to the loader tag', () => {
		plantLoader(`${DEPLOYMENT}/embed.js`);
		const theirs = plantLoader(`${HOST_PAGE}/bundle.js`);
		whileExecuting(theirs, () => {
			expect(loaderOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// the snippet pins /embed.js at the root. an ending match would also accept a stranger's
	// widget/embed.js — and since the fallback takes the last match, a vendor script further down
	// the page would win and hand back the vendor's origin.
	it('does not mistake a vendor script that merely ends in embed.js', () => {
		plantLoader(`${DEPLOYMENT}/embed.js`);
		plantLoader(`${HOST_PAGE}/widget/embed.js`);
		whileExecuting(null, () => {
			expect(loaderOrigin(document)).toBe(DEPLOYMENT);
		});
	});

	// a src that names no origin is not one: `data:` serialises its origin to the string "null",
	// and a url built on that asks a host called null for the runtime.
	it('answers with nothing for a src that names no origin', () => {
		const inline = plantLoader('data:text/javascript,void 0');
		whileExecuting(inline, () => {
			expect(loaderOrigin(document)).toBeNull();
		});
	});
});

describe('installing the runtime', () => {
	it('loads it from the deployment, by absolute url', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});
		const runtime = injected();
		expect(runtime?.getAttribute('src')).toBe(`${DEPLOYMENT}${RUNTIME_PATH}`);
	});

	// a relative src would resolve against the org's page and ask acme.org for a file only the
	// deployment has, which is a 404 and a blank space where the form was.
	it('never installs a relative url', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});
		const src = injected()?.getAttribute('src') ?? '';
		expect(src.startsWith('https://')).toBe(true);
		expect(new URL(src).origin).not.toBe(document.location.origin);
	});

	// the loader is a classic script and so is what it installs: the snippet loads a bare script
	// tag, and the runtime must not block the org's page while it arrives.
	it('installs it async', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});
		expect(injected()?.async).toBe(true);
	});

	// two forms on one page is two pasted snippets, and the element handles as many as the page
	// holds. a second copy of the runtime would be a second download of the whole runtime whose
	// registration is a no-op, since a custom element name may be defined once per document.
	it('installs it once however many loaders run', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
			bootLoader(document, RUNTIME_PATH);
		});
		expect(document.querySelectorAll(`script[${RUNTIME_MARK}]`).length).toBe(1);
	});

	it('reports the second call as having installed nothing', () => {
		installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`);
		expect(installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`)).toBeNull();
	});

	// a runtime written by hand carries no marker, so a dedupe that looked only for the marker
	// would download the whole runtime a second time. what counts as a runtime already on the page
	// is the same question ./runtime.ts asks when it reads its own origin.
	it('sees a runtime that reached the page without the marker', () => {
		plantLoader(`${DEPLOYMENT}${RUNTIME_PATH}`);
		expect(installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`)).toBeNull();
	});

	// a host page cached whole — a wordpress page cache, an html snapshot, a prerender service —
	// keeps the tag the loader installed, hash and all, for as long as that cache lasts. the next
	// deploy stops serving that hash, so the tag the restored page carries is dead. a dedupe that
	// asked only which origin it came from would read it as a runtime already present, install
	// nothing and arm nothing, leaving an empty tag and a silent console for the life of the cache.
	it('installs beside a runtime whose hash the deploy has stopped serving', () => {
		const stale = plantLoader(`${DEPLOYMENT}/embed/0ldhash1.js`);
		stale.setAttribute(RUNTIME_MARK, DEPLOYMENT);

		const installed = installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`);

		expect(installed?.getAttribute('src')).toBe(`${DEPLOYMENT}${RUNTIME_PATH}`);
	});

	// every script on a page this project does not own is read here, and an attribute is a string
	// anybody may write. what makes a tag one of ours is where it is served from — under the runtime
	// directory, on the deployment — and the marker adds nothing a stranger could not have typed.
	// robustness rather than a control: nothing is being kept out, and a page whose own scripts
	// collide with this name still gets its form.
	it('installs beside a foreign script that merely carries the marker, saying nothing about it', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const theirs = plantLoader(`${HOST_PAGE}/vendor/analytics.js`);
		theirs.setAttribute(RUNTIME_MARK, DEPLOYMENT);

		const installed = installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`);

		expect(installed?.getAttribute('src')).toBe(`${DEPLOYMENT}${RUNTIME_PATH}`);
		// not a runtime at all, so it is neither a reason to install nothing nor a second deployment
		// to report. reporting one would put a paragraph about two orgs' snippets in the console of
		// every page whose own scripts happen to carry this attribute name.
		expect(warn).not.toHaveBeenCalled();
	});

	// a runtime already on the page is adopted rather than downloaded a second time, and an adopted
	// tag fails the same ways a self-installed one does — a request that did not complete, a page
	// restored from a cache the deploy has not invalidated. without a handler on it, adoption is
	// where the whole recovery path silently ends.
	it('arms the retry on a runtime it adopted rather than installed', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const present = plantLoader(`${DEPLOYMENT}${RUNTIME_PATH}`);

		expect(installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`)).toBeNull();

		present.dispatchEvent(new Event('error'));
		expect(warn.mock.calls[0]?.[0]).toContain(`${DEPLOYMENT}${RUNTIME_PATH}`);
	});

	// the two-deployment page again, from the side where this loader has nothing to install: its own
	// runtime is already here, and the rival's is here too. the rival is the whole reason the
	// paragraph exists, and adopting is not a reason to stop looking for one.
	it('says a second deployment is on the page even when its own runtime is already there', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		plantLoader(`${HOST_PAGE}${RUNTIME_PATH}`);
		plantLoader(`${DEPLOYMENT}${RUNTIME_PATH}`);

		expect(installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`)).toBeNull();
		expect(warn.mock.calls[0]?.[0]).toContain(HOST_PAGE);
		expect(warn.mock.calls[0]?.[0]).toContain(DEPLOYMENT);
		// nothing was added: the runtime it would have installed is the one it adopted.
		expect(warn.mock.calls[0]?.[0]).not.toContain('being added');
	});

	// one page serves one deployment's forms — whichever runtime defines the tag first answers for
	// all of them — so an agency page carrying two orgs' snippets is not a supported arrangement.
	// silently skipping the second would leave its forms reading their configuration from the first
	// deployment, which has never heard of those form ids.
	it('says so when a second deployment lands on the same page', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`);
		const second = installRuntime(document, `${HOST_PAGE}${RUNTIME_PATH}`);
		expect(second).not.toBeNull();
		expect(warn.mock.calls[0]?.[0]).toContain(DEPLOYMENT);
		expect(warn.mock.calls[0]?.[0]).toContain(HOST_PAGE);
		expect(warn.mock.calls[0]?.[0]).toContain('being added');
	});

	it('marks what it installs with the deployment it came from', () => {
		installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`);
		expect(injected()?.getAttribute(RUNTIME_MARK)).toBe(DEPLOYMENT);
	});

	// a deploy stops serving the previous hashed runtime the moment it lands, while cached copies
	// of the loader keep naming it for up to the five minutes `_headers` allows. in that window the
	// element never upgrades and renders as an empty tag: no card, no message, and — without this —
	// nothing in the console either. this is the terminal shape, used when the caller has supplied
	// no answer of its own; `bootLoader` supplies one, and the retry cases below are that.
	it('reports a runtime that fails to load', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const script = installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`);
		expect(script).not.toBeNull();
		script?.dispatchEvent(new Event('error'));
		expect(warn.mock.calls[0]?.[0]).toContain(`${DEPLOYMENT}${RUNTIME_PATH}`);
	});

	// guessing an origin is worse than saying so: the guess is the org's own domain, and asking it
	// for /api/v1 hands the donor a form that fails at the moment they press give.
	it('installs nothing, and says why, when it cannot find the deployment', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		whileExecuting(null, () => {
			bootLoader(document, RUNTIME_PATH);
		});
		expect(injected()).toBeNull();
		expect(warn.mock.calls[0]?.[0]).toMatch(/embed\.js/);
	});
});

// a host page whose policy is `script-src 'nonce-…'` without `'strict-dynamic'` blocks every script
// this project injects unless it carries that page's nonce — and the snippet the org pasted already
// carries one, because their own policy is what made them write it.
describe('the nonce a strict policy on the host page demands', () => {
	// the IDL property and never `getAttribute`. browsers empty the content attribute once the
	// element is in a document, so that a css attribute selector cannot exfiltrate the value
	// (https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/nonce) — which leaves an
	// attribute reading finding nothing on exactly the pages this matters on.
	it('reads a nonce the content attribute no longer carries', () => {
		const script = plantLoader(`${DEPLOYMENT}${LOADER_PATH}`);
		// the shape a browser leaves behind: the attribute emptied, the value only on the property.
		script.setAttribute('nonce', '');
		Object.defineProperty(script, 'nonce', { value: 'n0nce', configurable: true });

		expect(script.getAttribute('nonce')).toBe('');
		expect(scriptNonce(script)).toBe('n0nce');
	});

	it('answers with nothing where the page sets no nonce', () => {
		expect(scriptNonce(plantLoader(`${DEPLOYMENT}${LOADER_PATH}`))).toBe('');
		expect(scriptNonce(null)).toBe('');
	});

	// without this the runtime tag is refused by the host's policy and the form is an empty tag —
	// the same silence a stale hash leaves, and this one no retry can recover, since the retry is
	// another injected script the same policy refuses.
	it('gives the runtime it installs the nonce of the script that injected it', () => {
		const script = plantLoader(`${DEPLOYMENT}${LOADER_PATH}`);
		Object.defineProperty(script, 'nonce', { value: 'n0nce', configurable: true });
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});

		expect(injected()?.nonce).toBe('n0nce');
	});

	// a page with no policy of its own is the ordinary one, and a nonce invented for it would be a
	// nonce matching nothing — refused by any policy that arrives later at the edge.
	//
	// what this pins is where the nonce is read from: the tag that did the injecting, and never
	// whichever script on the page happens to have one — taking a stranger's would put their nonce
	// on our tag on every page that has both, which is what the host's own nonced script here would
	// catch.
	it('sets no nonce where the injecting script has none', () => {
		const theirs = plantLoader(`${HOST_PAGE}/vendor/analytics.js`);
		Object.defineProperty(theirs, 'nonce', { value: 'theirs', configurable: true });
		const script = plantLoader(`${DEPLOYMENT}${LOADER_PATH}`);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});

		expect(injected()?.nonce ?? '').toBe('');
	});
});

// the window a deploy opens, closed rather than reported.
//
// the runtime that fails is one this deployment has stopped serving, named by a copy of the loader
// that a browser or an edge cached before the deploy. the current name is in the deployment's own
// copy of that same file, behind nothing but the cache — so the answer is to ask for the file again
// under a url the cache does not hold, and let the fresh copy boot normally.
describe('recovering from a runtime the deploy stopped serving', () => {
	/** every loader tag on the page, oldest first. */
	function loaderTags(): HTMLScriptElement[] {
		return Array.from(document.getElementsByTagName('script')).filter((script) =>
			(script.getAttribute('src') ?? '').includes(LOADER_PATH)
		);
	}

	function bootAndFail(loaderSrc: string): void {
		const script = plantLoader(loaderSrc);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});
		injected()?.dispatchEvent(new Event('error'));
	}

	it('fetches the loader again when the runtime will not load', () => {
		bootAndFail(`${DEPLOYMENT}/embed.js`);
		const retry = loaderTags().at(-1);
		expect(retry?.getAttribute('src')).toBe(
			`${DEPLOYMENT}${LOADER_PATH}?${STALE_PARAM}=9f2a1c4e.js`
		);
	});

	// a fresh loader that names the same runtime — a connection that dropped rather than a hash the
	// deploy stopped serving — would otherwise adopt the dead tag and put nothing on the page.
	it('takes the failed runtime off the page first', () => {
		bootAndFail(`${DEPLOYMENT}/embed.js`);
		expect(injected()).toBeNull();
	});

	// the same trap `loaderOrigin` exists for. a relative retry would ask the org's own site for
	// this project's file, which it does not have.
	it('fetches it from the deployment and never from the page', () => {
		bootAndFail(`${DEPLOYMENT}/embed.js`);
		const src = loaderTags().at(-1)?.getAttribute('src') ?? '';
		expect(new URL(src).origin).toBe(DEPLOYMENT);
		expect(new URL(src).origin).not.toBe(document.location.origin);
	});

	it('says nothing yet, because the retry may still succeed', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		bootAndFail(`${DEPLOYMENT}/embed.js`);
		expect(warn).not.toHaveBeenCalled();
	});

	// the retry is a second execution of this file with no memory of the first, so the count rides
	// on the url. a loader that could retry without a bound would answer a deployment that is simply
	// down by fetching it forever.
	it('stops after one attempt', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		bootAndFail(`${DEPLOYMENT}${LOADER_PATH}?${STALE_PARAM}=9f2a1c4e.js`);

		expect(loaderTags().length).toBe(1);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain(`${DEPLOYMENT}${RUNTIME_PATH}`);
	});

	// the advice a first failure gives is to wait out a cached loader. after a retry that cause has
	// been ruled out by the attempt itself, so repeating it would send somebody to reload a page
	// that has already re-fetched the file.
	it('stops with a diagnosis rather than the advice it started with', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		bootAndFail(`${DEPLOYMENT}${LOADER_PATH}?${STALE_PARAM}=9f2a1c4e.js`);
		expect(warn.mock.calls[0]?.[0]).toMatch(/already been re-fetched|already re-fetched/);
		expect(warn.mock.calls[0]?.[0]).not.toMatch(/updated in the last few minutes/);
	});

	// the whole cycle, in the order a browser runs it: the cached loader names a runtime the deploy
	// has stopped serving, that runtime fails, the loader is re-fetched, and the fresh copy — which
	// carries the current hash, because the build stamped it — installs the runtime that exists.
	// the removal of the failed tag is what keeps the two apart: the dead tag names the stale hash
	// and the fresh loader names the current one, so both would sit on the page as runtimes.
	it('installs the current runtime when the fresh loader boots', () => {
		bootAndFail(`${DEPLOYMENT}/embed.js`);
		const current = '/embed/Djb4IG8-.js';

		const retry = loaderTags().at(-1);
		whileExecuting(retry ?? null, () => {
			bootLoader(document, current);
		});

		expect(injected()?.getAttribute('src')).toBe(`${DEPLOYMENT}${current}`);
	});

	// the retry is a third injected script, and a host policy that would have refused the runtime
	// refuses it for the same reason. blocked, it is the one failure on this path that reports
	// nothing at all: no `error` fires on a tag the policy never fetched.
	it('carries the nonce onto the loader it fetches again', () => {
		const script = plantLoader(`${DEPLOYMENT}${LOADER_PATH}`);
		Object.defineProperty(script, 'nonce', { value: 'n0nce', configurable: true });
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
		});
		injected()?.dispatchEvent(new Event('error'));

		expect(loaderTags().at(-1)?.nonce).toBe('n0nce');
	});

	// two pasted snippets are two executions of this file with no memory of each other, and the
	// second adopts the runtime the first installed. armed twice, one runtime that did not arrive
	// spends both retries — two fetches of the loader and two more executions of it.
	it('spends one retry however many loaders adopted the runtime', () => {
		const script = plantLoader(`${DEPLOYMENT}/embed.js`);
		whileExecuting(script, () => {
			bootLoader(document, RUNTIME_PATH);
			bootLoader(document, RUNTIME_PATH);
		});
		injected()?.dispatchEvent(new Event('error'));

		// the pasted tag, and one retry beside it.
		expect(loaderTags()).toHaveLength(2);
	});

	// the loader failing to arrive leaves nothing running and nothing said, which is the silence
	// this whole path is here to end.
	it('reports a retry that never arrives', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		bootAndFail(`${DEPLOYMENT}/embed.js`);
		expect(warn).not.toHaveBeenCalled();

		loaderTags().at(-1)?.dispatchEvent(new Event('error'));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain(`${DEPLOYMENT}${RUNTIME_PATH}`);
	});
});

// a runtime adopted on a page that was cached whole, which is the case this dedupe exists for.
//
// the tag it adopts there is one the browser has already answered — from its own cache, or with a
// 404 the moment the deploy landed — so the `error` a self-installed tag reports through has
// either fired before any of this code ran or is never coming. a handler hears neither. what is
// left to look at is the element itself: still not registered a while after adoption, and the
// runtime behind that tag is not arriving.
describe('a runtime adopted on a page that was cached whole', () => {
	/** a document with a window of its own, so one case's element registry is not the next case's. */
	function page(): Document {
		const frame = document.createElement('iframe');
		document.body.appendChild(frame);
		const doc = frame.contentDocument;
		if (doc === null) throw new Error('the iframe has no document');
		return doc;
	}

	/** a runtime tag already on that page, the way a cached copy of the html carries one. */
	function plant(doc: Document, src: string): HTMLScriptElement {
		const script = doc.createElement('script');
		script.setAttribute('src', src);
		doc.head.appendChild(script);
		return script;
	}

	function deadline() {
		const armed: { run: () => void; ms: number }[] = [];
		return {
			armed,
			delay: (run: () => void, ms: number): void => void armed.push({ run, ms })
		};
	}

	it('spends the retry when the element is still not registered', () => {
		const doc = page();
		const present = plant(doc, `${DEPLOYMENT}${RUNTIME_PATH}`);
		const spent: HTMLScriptElement[] = [];
		const timer = deadline();

		installRuntime(
			doc,
			`${DEPLOYMENT}${RUNTIME_PATH}`,
			(failed) => spent.push(failed),
			'',
			timer.delay
		);
		timer.armed[0]?.run();

		expect(timer.armed[0]?.ms).toBe(ADOPTION_DEADLINE_MS);
		expect(spent).toEqual([present]);
	});

	// the ordinary adoption: two pasted snippets, and the runtime the first installed arrives and
	// registers the element. spending a retry on that is a second download of a runtime that is
	// already running, and a loader fetch that answers a question nobody asked.
	it('spends nothing once the runtime has registered the element', () => {
		const doc = page();
		plant(doc, `${DEPLOYMENT}${RUNTIME_PATH}`);
		const spent: HTMLScriptElement[] = [];
		const timer = deadline();

		installRuntime(
			doc,
			`${DEPLOYMENT}${RUNTIME_PATH}`,
			(failed) => spent.push(failed),
			'',
			timer.delay
		);
		doc.defaultView?.customElements.define(RUNTIME_ELEMENT_TAG, class extends HTMLElement {});
		timer.armed[0]?.run();

		expect(timer.armed).toHaveLength(1);
		expect(spent).toEqual([]);
	});

	// one retry, whichever of the two says the runtime is gone. the retry re-fetches the loader past
	// its cache, so a second one is a second fetch and a second execution of this whole file.
	it('spends one retry when the tag errors and the deadline lapses', () => {
		const doc = page();
		const present = plant(doc, `${DEPLOYMENT}${RUNTIME_PATH}`);
		const spent: HTMLScriptElement[] = [];
		const timer = deadline();

		installRuntime(
			doc,
			`${DEPLOYMENT}${RUNTIME_PATH}`,
			(failed) => spent.push(failed),
			'',
			timer.delay
		);
		present.dispatchEvent(new Event('error'));
		timer.armed[0]?.run();

		expect(spent).toEqual([present]);
	});

	// the loader may not import the element — it is a separate bundle, five-minute cached, that
	// renders nothing and knows nothing about the form. so the tag it watches for is spelled twice,
	// and this is what keeps the two spellings the same name.
	it('watches for the tag the runtime actually registers', () => {
		expect(RUNTIME_ELEMENT_TAG).toBe(DONATE_FORM_TAG);
	});
});

// two spellings of one url, which is a question this file answers rather than assumes.
//
// what is compared is what the browser resolves, on both sides: the src on the page is read
// through a `URL` already, and the url being installed goes through the same parse. compared as
// written, a runtime already on the page under another spelling of its own address is a second
// download of a file that is already there, and a second registration of an element that may be
// defined once.
describe('the url a runtime is recognised by', () => {
	it('resolves what it was handed the way the page would', () => {
		plantLoader(RUNTIME_PATH);

		expect(installRuntime(document, RUNTIME_PATH)).toBeNull();
	});

	it('resolves a path that walks through itself', () => {
		plantLoader(`${DEPLOYMENT}${RUNTIME_PATH}`);

		expect(installRuntime(document, `${DEPLOYMENT}/embed/./9f2a1c4e.js`)).toBeNull();
	});

	// a query is part of a url and part of a cache key, so a tag carrying one names a different
	// file to fetch — even where the path is the same.
	it('does not take a runtime carrying a query for the one it was asked for', () => {
		plantLoader(`${DEPLOYMENT}${RUNTIME_PATH}?v=2`);

		expect(installRuntime(document, `${DEPLOYMENT}${RUNTIME_PATH}`)).not.toBeNull();
	});
});
