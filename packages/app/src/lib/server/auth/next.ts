/**
 * where the sign-in form lives, and the destination the gate in `./gate.ts` sends an anonymous
 * request to. the screen it names is `src/routes/login.tsx`.
 *
 * a bare path, as every server redirect in this app is — see the note on the redirect in
 * `src/routes/_app._index.tsx` for why, and for what a fork that ever configured a base path would
 * have to change all at once.
 */
export const LOGIN_PATH = '/login';

/** the query parameter the gate mints and the sign-in page reads back. */
export const NEXT_PARAM = 'next';

/**
 * the origin a candidate is resolved against, and it is deliberately one no deployment can be
 * reached at: nothing built here is ever handed back, only compared. `.invalid` is reserved for
 * exactly this (https://datatracker.ietf.org/doc/html/rfc2606#section-2).
 */
const RESOLVE_ORIGIN = 'https://next.invalid';

/**
 * whether a string is a path and cannot be read as naming a host.
 *
 * the two rejected spellings are both authorities to a browser: `//host` is protocol-relative, and
 * a backslash is a slash to the url parser for every scheme this app is served over.
 */
function isPathOnly(value: string): boolean {
	return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
}

/**
 * the destination a sign-in may return to, or `null` for every other input.
 *
 * this is an open-redirect control and it is the whole of one. the parameter it validates arrives
 * on a url an attacker composes: a link to this deployment's own `/login`, carrying a destination
 * of their choosing, which the operator signs in at and is then sent to. so a candidate is honoured
 * only when it is a path inside this deployment, and anything else is replaced by `/` in silence —
 * never echoed into a message, because a message quoting the rejected value hands the attacker the
 * page they wanted the operator to read.
 *
 * a path is not decided by its first character alone. the candidate is resolved against an origin
 * that cannot be reached, and the result is honoured only if it still names that origin — which is
 * what catches the spellings a browser normalises before it resolves them: `//host`, `/\host`, and
 * a tab or newline between the slashes, which url parsing strips. the resolved path is then held to
 * the same rule as the raw one, because `/..//host` resolves inside the origin and comes back out
 * as `//host`, which is protocol-relative again by the time it reaches a `Location` header.
 *
 * `/login` and anything under it is refused as well: the gate that mints this parameter redirects
 * there, so honouring it would return the operator to the form they just cleared.
 *
 * total by construction — a parser that threw would become a 500 on the sign-in page, which is the
 * one page a deployment cannot afford to lose.
 */
export function safeNext(raw: string | null | undefined): string | null {
	if (typeof raw !== 'string' || !isPathOnly(raw)) return null;

	let resolved: URL;
	try {
		resolved = new URL(raw, RESOLVE_ORIGIN);
	} catch {
		return null;
	}

	if (resolved.origin !== RESOLVE_ORIGIN) return null;
	if (resolved.pathname === LOGIN_PATH || resolved.pathname.startsWith(`${LOGIN_PATH}/`)) {
		return null;
	}

	const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
	return isPathOnly(path) ? path : null;
}

/**
 * where a sign-in ends up: the destination the gate turned away, or `/` when there is none.
 *
 * the candidate arrives on the sign-in page's own url, because the gate redirects there with it
 * (`?next=…`) and a `<Form method="post">` with no `action` posts to the current url, query string
 * included — so `src/routes/login.tsx` reads it off `url` in its `loader` and again in its
 * `action`, and neither the page nor the browser has to carry it in a field.
 *
 * the default is `/`, which is the app's entrance rather than a screen: it forwards to the home
 * screen, so what home is stays decided in one place (`src/routes/_app._index.tsx`) rather than in
 * every module that has to send somebody there. naming a section here instead would be a second
 * answer to keep in step with that one.
 *
 * it sits beside `safeNext` rather than on the screen because both halves of one rule belong
 * together: what may be returned to, and what stands in when nothing may.
 */
export function signInDestination(url: URL): string {
	return safeNext(url.searchParams.get(NEXT_PARAM)) ?? '/';
}
