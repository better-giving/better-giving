import type { ConsoleRefusal } from './access';

// the console surface's own vocabulary: what "under `/console`" means, and what this surface owes
// that the public api does not — which is nothing, contingently.
//
// `/api/v1` is anonymous, browser-reachable and payment-initiating, and CLAUDE.md names what an
// endpoint there owes before it ships: CORS from the form's own `allowed_origins`, a rate limit,
// Turnstile, and amount bounds re-read from the row. this surface is none of those three things
// and owes none of that, and each absence is a decision rather than an omission:
//
//   - **no CORS headers at all, on any answer, refusals included.** a page in a browser must not
//     be able to read this response, and the way to make sure of that is to hand it no header that
//     would let it. that also means no `OPTIONS` handler: a preflight has nothing to grant.
//   - **no cookie is read and none is set**, so CSRF is unrepresentable here rather than defended
//     against. the credential is a bearer header, which a browser attaches to nothing by itself.
//   - **`Cache-Control: no-store` on everything.** the report names which secrets this deployment
//     has set, and a store between here and the console has no business holding that.
//   - **no rate limiter, and this one is contingent.** a wrong token costs no D1 read and no
//     binding call — `consoleAccess` in ./access.ts reads `platform.env` and one header and
//     nothing else — against a 256-bit value. that holds *only while the check precedes every
//     read*, which is why the check is the `middleware` on `src/routes/console.ts` (./gate.ts)
//     rather than a line in each route file. moving it into a route would put a database read in
//     front of an unauthenticated caller and make this surface worth metering; if that ever
//     happens, a bucket belongs here.
//
// it is deliberately not under `/api/v1`. that path is a permanent add-never-rename contract
// pasted into sites nobody here can reach (CLAUDE.md), and a route sitting next to it inherits how
// it is read whatever this file says.

/**
 * the URL prefix of the console surface.
 *
 * a route joins this surface by nesting under `src/routes/console.ts`, which is the layout the
 * credential check is mounted on (`./gate.ts`); `src/routes.spec.ts` fails on a route served
 * under this prefix that sits anywhere else.
 */
export const CONSOLE_BASE_PATH = '/console';

/**
 * an answer from this surface, with the headers every one of them carries.
 *
 * one function for the report, both writes and every refusal, so "no CORS, no store" is a property
 * of the surface rather than something each route remembers. a route that answered with
 * `Response.json()` directly would be missing the store header and nothing would report it.
 */
export function consoleJson(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: {
			// the report says which of this deployment's secrets are set. nothing between here and
			// the console may keep a copy of that.
			'cache-control': 'no-store'
		}
	});
}

/** a refusal from the check, as the wire carries it. */
export function consoleRefusalResponse(refusal: ConsoleRefusal): Response {
	const { status, ...body } = refusal;
	return consoleJson(body, status);
}

/**
 * the answer to a method a route on this surface does not take.
 *
 * it is answered rather than left to the framework: react router faults a request it has no
 * handler for with a 400 quoting a route id nobody outside this repository has heard of, and a
 * caller here is a person or an agent exploring with the credential in hand. `Allow` is what they
 * act on, and it is required on a 405
 * (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405).
 *
 * here rather than beside each write for the reason `consoleJson` above is here: the store header
 * is a property of the surface, and a route answering with `Response.json` of its own would be
 * missing it with nothing reporting that.
 */
export function consoleMethodNotAllowed(method: string, allow: string): Response {
	const response = consoleJson(
		{
			message: `${method} is not a method this endpoint answers.`,
			fix: `Send the request as ${allow}.`
		},
		405
	);
	response.headers.set('allow', allow);
	return response;
}
