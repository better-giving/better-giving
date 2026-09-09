// the echo decision every `/api/v1` answer is built on, and the one place it is made.
//
// it is here rather than beside the route because the next endpoint reads the same
// `allowed_origins` off the same row and has to reach the same answer. a second copy of this
// function is a second place somebody can write `*`, and the two copies would not have to
// disagree for long — the first one edited under a deadline is the one that ships.
//
// two things are echoed to and they arrive from different places: the sites the form names come off
// its row, which the route has already read and hands over rather than this function querying it a
// second time, and this deployment's own origin comes off the request. a route that hands over no
// row where one exists answers the form's own sites nothing, and the failure is a donation that
// reports only that the request never completed.
//
// what is not shared, and stays on each route: which methods a preflight grants, how long it may
// be cached, and which status each refusal carries. those differ per endpoint by design — a
// quote endpoint's preflight grants `POST` and a `content-type` header this one has no use for.
// the echo is the decision; the grant is not.

/**
 * the headers every answer carries, refusals included.
 *
 * `Access-Control-Allow-Origin` echoes the request's own `Origin` and only where something this
 * deployment holds already names it, compared literally. never `*`, and never the header reflected
 * back unchecked: either one would make the answer readable by script on any page anywhere. the
 * literal `null` an opaque origin sends is refused by the same compare, since neither source can
 * spell it.
 *
 * two sources, and a caller matching either is echoed to:
 *
 * - the form's own `allowed_origins`, which is the comparison the edit screen stores against
 *   (`readOriginList` in `@better-giving/operator/origins` stores what a typed row normalises to,
 *   which is the origin a browser sends, and refuses what cannot be read as one — wildcards
 *   included).
 * - this deployment's own origin, taken off the request URL, on every form and whether or not a row
 *   was found. every form served here loads on this deployment's own donation page, which is not a
 *   site anyone ticks and has no `site` row — a page an operator can untick is a page they can
 *   break. the request is the source of truth rather than anything stored: the host a request
 *   arrived on is one this worker answers on. the challenge check reads it the same way
 *   (`acceptableHostnames` in ../donations/quote.ts).
 *
 * three callers get no header at all, and they are not the same case:
 *
 * - no `Origin` at all — curl, a server-side fetch, an agent. there is nothing to echo, and CORS
 *   governs what a browser lets a page read rather than who may call.
 * - an `Origin` neither source names. the body is the same body: `Origin` is an attribution
 *   signal and never an authorization control (CLAUDE.md), so refusing on it would be an endpoint
 *   claiming to authorize on a value the caller writes.
 * - no form at all, asked from anywhere but this deployment itself. there is no row to check
 *   against, so that answer is legible to `curl` and opaque to a browser. it is the trade taken
 *   deliberately: echoing the caller's own origin there would make the endpoint a form-id oracle for
 *   every page on the internet, and a mistyped id in a snippet is a request the integrator can
 *   repeat outside a browser. the donation page is not that trade — it is on this deployment's own
 *   origin, so a donor there reads an id nothing matches as `form_not_found` rather than as a
 *   request that never completed.
 *
 * a refusal needs this at least as much as an answer does. a browser will not let a page read a
 * 4xx body without the header either, and the runtime on the far end can then only report that
 * the request never completed (`createLoadConfig` in packages/form/src/embed/runtime.ts).
 *
 * `Cache-Control: no-store`, because these bodies turn over on an /admin save — a publish, a new
 * origin, a key replaced — and there is no way to reach whatever cached one on a site nobody here
 * can see. `Vary: Origin` for a different reason and not as a second spelling of the same one:
 * the answer differs by that request header even where the body does not, so a shared cache that
 * kept one page's copy would hand it to a site the form never named.
 */
export function corsHeaders(request: Request, allowedOrigins: readonly string[]): Headers {
	const headers = new Headers({ 'cache-control': 'no-store', vary: 'Origin' });
	const origin = request.headers.get('origin');
	if (origin === null) return headers;
	if (allowedOrigins.includes(origin) || origin === new URL(request.url).origin) {
		headers.set('access-control-allow-origin', origin);
	}
	return headers;
}

/**
 * what a route grants a preflight, on top of the echo above.
 *
 * every field is the route's, because this is the half that differs per endpoint — see the header
 * of this file. a route states what it actually accepts and nothing more.
 */
export type PreflightGrant = {
	/** the `Access-Control-Allow-Methods` value, e.g. `POST, OPTIONS`. */
	readonly methods: string;
	/**
	 * the request headers a browser may send, or `null` where the route needs none granted.
	 *
	 * `null` is the honest answer for an endpoint whose request carries only CORS-safelisted
	 * headers: such a request is never preflighted at all, so a caller that got there sent
	 * something the route has no use for, and granting a vocabulary it does not need is how a list
	 * of allowed headers grows. an endpoint taking a JSON body is the other case — `content-type:
	 * application/json` is not safelisted, so the browser asks first and a route that grants
	 * nothing refuses every submission it exists to take.
	 */
	readonly headers: string | null;
	/** how long a browser may skip the preflight, in seconds, as a string. */
	readonly maxAge: string;
};

/**
 * the 204 a preflight is answered with, granted to whoever the echo above names and nobody else.
 *
 * one function rather than one per route because the shape of the answer is the same on both and
 * only the grant differs: the echo is `corsHeaders`' decision, a browser reads the grant only when
 * that header is present, and the status is 204 either way. two copies would be two places
 * somebody can write a method or a header into a list.
 *
 * a caller nothing names, and an id nothing matches, both get this same 204 with nothing granted.
 * that is not a refusal spelled differently — it is the only answer available: a preflight carries
 * no status a page can read, and one that 404'd would tell any page on the internet which form ids
 * this deployment holds.
 *
 * in `vite dev` none of this is observable: Vite's own middleware adds
 * `Access-Control-Allow-Origin` and `Access-Control-Allow-Methods` to an OPTIONS response, so a
 * preflight this app refused still reads as granted there
 * (https://vite.dev/config/server-options.html#server-cors). `pnpm preview`, which runs the built
 * worker under wrangler, is where the refusal is real.
 */
export function preflightResponse(
	request: Request,
	allowedOrigins: readonly string[],
	grant: PreflightGrant
): Response {
	const headers = corsHeaders(request, allowedOrigins);
	headers.set('access-control-allow-methods', grant.methods);
	headers.set('access-control-max-age', grant.maxAge);
	if (grant.headers !== null) headers.set('access-control-allow-headers', grant.headers);
	return new Response(null, { status: 204, headers });
}
