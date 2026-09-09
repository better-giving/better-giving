// the resume vocabulary: how a return from a payment provider is named on the way out and claimed
// on the way in.
//
// both ends of one mechanism, in one module. the stamp is this project's own parameter rather than
// a provider's, so a second payment adapter takes it from here rather than from a sibling adapter;
// the provider's own return parameters are what a claim sweeps up beside it, and they belong with
// the claim. ./stripe.ts stamps, ./runtime.ts claims, and neither re-exports what it imports.
//
// nothing here writes a query string through `URLSearchParams`. that serializer is form-urlencoded
// — `;` becomes `%3B`, a valueless parameter grows an `=`, `%20` becomes `+` — and every url in
// this file is the host page's: their own parameters come back to them character for character,
// whether they are travelling out on a return url or being left behind by a scrub. reading a value
// off a url is safe and is what both functions below do.
//
// `../../package.json` exports this module as `./embed/resume`. the deployment's own donation page
// claims a return the same way ./runtime.ts does, and it takes `RESUME_FORM_PARAM` from here rather
// than spelling it: the stamp is permanent, and a second spelling of it is a return no form claims.

/**
 * the parameter naming which form sent a donor away, on the url a provider returns them to.
 *
 * the provider's own return parameters say nothing about whose gift they belong to, and the page
 * they land on is one this project does not own: it may carry a second form, or the org's own
 * separate integration with the same provider. so a return is claimed by the form this names and by
 * nothing else.
 *
 * the value is a literal of its own and follows no other name in this repository — the element's tag
 * is `bg-donate-form`, and neither is derived from the other. it is permanent for the reason the tag
 * is: it goes out on urls handed to a payment provider, and a donor coming back to a page stamped
 * by an older build is a donor whose gift no form on it claims.
 */
export const RESUME_FORM_PARAM = 'bg_donate_form';

/**
 * the token a provider appends to the return.
 *
 * the same opaque `Quote.paymentToken` the gift was minted with, which is what makes the return
 * readable at all: the donor comes back cross-origin into a brand-new JavaScript context that
 * remembers nothing, and this is the only thing carried across.
 */
const RESUME_TOKEN_PARAM = 'payment_intent_client_secret';

/**
 * where a claim is noted on a document that would not let its url be scrubbed.
 *
 * not a permanent contract the way `RESUME_FORM_PARAM` is, and it does not need to be: nothing
 * outside this module reads it, and a build that renamed it would re-serve one tab's claim rather
 * than strand a url in flight — which is the degraded case `takeResumeToken` already accepts.
 *
 * one note per form, holding a fingerprint of the token it claimed. something derived from the
 * token rather than a flag is what lets a donor give a second time from the same tab: their second
 * return carries a token the note does not answer to, so it is not mistaken for the first one
 * coming back around.
 */
const CLAIM_NOTE = 'bg_donate_claimed';

/**
 * a token reduced to the identity of one claim.
 *
 * the note has one question to answer — whether this return is the one already served — and the
 * token answers it while also being the secret the gift is confirmed with. written whole it would
 * be a second copy of that secret, on a page this project does not own, outliving the url that
 * carried it for as long as the tab stays open. what is kept instead is FNV-1a over the string,
 * run twice from different offsets and joined, which distinguishes two returns and reconstructs
 * neither.
 *
 * a fold rather than anything the platform hashes for us, because the claim is recorded
 * synchronously with the read — see `takeResumeToken` below on why that ordering is load-bearing.
 */
function fingerprint(token: string): string {
	const fold = (offset: number): string => {
		let hash = offset;
		for (let at = 0; at < token.length; at += 1) {
			hash ^= token.charCodeAt(at);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	};
	return `${fold(2166136261)}.${fold(16777619)}`;
}

/** the query parameters a payment provider adds to the page it sends a donor back to. */
const RETURN_PARAMS: readonly string[] = [RESUME_TOKEN_PARAM, 'payment_intent', 'redirect_status'];

/** an href taken apart at the two boundaries a query has, every character on either side kept. */
type Parts = { readonly head: string; readonly query: string; readonly fragment: string };

function parts(href: string): Parts {
	const hash = href.indexOf('#');
	const fragment = hash === -1 ? '' : href.slice(hash);
	// after the fragment is off, because a `?` inside one is part of the fragment.
	const rest = hash === -1 ? href : href.slice(0, hash);
	const mark = rest.indexOf('?');
	return mark === -1
		? { head: rest, query: '', fragment }
		: { head: rest.slice(0, mark), query: rest.slice(mark + 1), fragment };
}

/** an href put back together, carrying no `?` where there is nothing left to put after one. */
function rejoin(at: Parts, query: string): string {
	return `${at.head}${query === '' ? '' : `?${query}`}${at.fragment}`;
}

/**
 * the query with the named parameters dropped and every other character as the host wrote it.
 *
 * a pair is matched on the name it opens with, so a valueless parameter is matched by its own name
 * and an empty segment is nobody's and stays.
 */
function without(query: string, names: readonly string[]): string {
	if (query === '') return '';
	return query
		.split('&')
		.filter((pair) => !names.includes(pair.split('=')[0] ?? pair))
		.join('&');
}

/**
 * the page the donor is on, which is the page they come back to, stamped with the form sending them.
 *
 * the stamp the page already carries goes: the href is read at confirm time, so a page this project
 * has already sent a donor away from carries one, and two stamps means the reader takes the first —
 * a form that could never claim its own return.
 *
 * the new one goes at the end of the query and ahead of any fragment, which is where a query ends.
 */
export function stampReturnUrl(here: string, formId: string): string {
	const at = parts(here);
	const kept = without(at.query, [RESUME_FORM_PARAM]);
	const stamp = `${RESUME_FORM_PARAM}=${encodeURIComponent(formId)}`;
	return rejoin(at, kept === '' ? stamp : `${kept}&${stamp}`);
}

/**
 * the payment token a redirect came back with, claimed by the form that sent the donor away.
 *
 * claimed, and that word carries three rules.
 *
 * only the form the stamp names takes anything. a url carrying no stamp is a return this project
 * did not send anybody on — the org's own separate integration with the same provider — and a stamp
 * naming a different form belongs to that form, which may not have booted yet. both are left whole.
 *
 * a stamp that does match is swept off whether or not there was a token behind it. a host router or
 * a parameter-stripping script may have taken the token and left the rest, and a stamp nothing ever
 * claims sits on a donor's address bar for good.
 *
 * taken rather than copied, and taken at the moment it is claimed. left in place the token outlives
 * the gift it names: a reload weeks later would boot straight into a resume. scrubbed ahead of a
 * claim it is worse, because nothing can get it back — a page whose form never mounted has had its
 * url rewritten with nobody to consume what it held, and neither a reload nor Back recovers it. so
 * the scrub is synchronous with the read.
 *
 * one-shot has two bounds, because the scrub is only the first of them. a document that refuses to
 * let its own url be rewritten — sandboxed, or opaque-origin — refuses every time, so the stamp and
 * the token stay in the address bar; `createFormRuntime` in ./runtime.ts holds one claim per page
 * load and serves it to every element asking, but that memory is the JavaScript context's, and a
 * reload or a Back is a new one arriving at the same url. so where the scrub is refused, the claim
 * is noted in `sessionStorage` instead, which lasts as long as the tab the donor came back into.
 *
 * a document that refuses both — an opaque origin has no storage to reach either — is served the
 * token every time it is asked. that is this function degraded rather than broken: the gift resumes,
 * and it resumes again on a reload of that url. the alternative is refusing a donor the return they
 * are holding, and on that host there is nothing left to tell the two cases apart with.
 */
export function takeResumeToken(doc: Document, formId: string): string | null {
	const view = doc.defaultView;
	if (view === null) return null;
	const here = view.location.href;
	const carried = new URL(here).searchParams;
	if (carried.get(RESUME_FORM_PARAM) !== formId) return null;

	const carrying = carried.get(RESUME_TOKEN_PARAM);
	const token = carrying === null || carrying.length === 0 ? null : carrying;

	const at = parts(here);
	try {
		view.history.replaceState(
			view.history.state,
			'',
			rejoin(at, without(at.query, [RESUME_FORM_PARAM, ...RETURN_PARAMS]))
		);
		// the url no longer carries any of it, so there is nothing a later load could claim twice
		// and nothing to write onto a host page's own storage.
		return token;
	} catch {
		// a document that will not let its own url be rewritten. the token has still been read, so
		// the gift is still resumed; what is lost is the tidying and, with it, the bound the scrub
		// was carrying.
	}

	if (token === null) return null;
	try {
		const note = `${CLAIM_NOTE}:${formId}`;
		const claimed = fingerprint(token);
		const kept = view.sessionStorage;
		if (kept.getItem(note) === claimed) return null;
		kept.setItem(note, claimed);
	} catch {
		// storage refused as well, which is the same opaque origin refusing the rewrite. the gift
		// resumes, and it resumes again on the next load of this url.
	}
	return token;
}
