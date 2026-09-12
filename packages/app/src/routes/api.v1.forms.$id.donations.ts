import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import {
	isRateLimited,
	quoteRateLimitKey,
	quoteRateLimitRefusal
} from '$lib/server/api/rate-limit';
import { verifyTurnstile } from '$lib/server/api/turnstile';
import { mintQuote, refusalCode, type QuoteRefusal } from '$lib/server/donations/quote';
import { readFormOrigins } from '$lib/server/forms/queries';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.v1.forms.$id.donations';

// the endpoint that takes money: a donor's submission in, an authoritative fee and a payment token
// out. it is the second route under `/api/v1` and the only one that writes anything.
//
// a resource route: no component export, so react router answers with what the handlers return
// instead of rendering anything (react-router/docs/how-to/resource-routes.md). which handler runs
// is the framework's dispatch and not a switch here — `POST` reaches the `action`, and `GET`,
// `HEAD` and `OPTIONS` all reach the `loader`, which is why the preflight is written as a loader
// and why a `GET` on this address has to be answered rather than assumed away.
//
// what is decided here and what is not. the body and every refusal in it are `mintQuote`'s
// ($lib/server/donations/quote.ts) — that module owns the order the checks run in and what each one
// says. this file owns two things on top: which status each refusal answers with, and which callers
// are allowed to read the answer.
//
// the four controls CLAUDE.md names for this surface, and where each one is:
//
//   rate limiting — twice, and only one of them is here. the surface bucket is the `middleware` on
//                   ./api.v1.ts, above every route on `/api/v1`, so a caller who has asked too
//                   often is answered 429 before this file runs and never reads `form`. this route
//                   then charges a bucket of its own, ten times tighter, because what a submission
//                   costs is not what a read costs — see the note on the charge below. it never
//                   charges the surface's, and ../routes.spec.ts fails it if it does.
//   CORS          — below, from the row `mintQuote` carries out on every branch and from the env
//                   that names this deployment's own donation page. a browser cannot read a 4xx
//                   body without the header either, so a refusal handed back without the row is a
//                   refusal the page that asked never sees.
//   Turnstile     — inside `mintQuote`, before anything is minted at the processor.
//   amount bounds — inside `mintQuote`, re-read from the form record. the amount in the body is an
//                   input to look up, never a figure to charge.
//
// the body is read exactly once, here, by the endpoint that owns it (CLAUDE.md). a body that is not
// JSON is handed on as `undefined` rather than refused on the spot, and the reason is the CORS
// header: refusing here means answering before the form row has been read, so the page that sent it
// could not read the refusal. the sentence `parseQuoteRequest` answers with is true of both cases.
//
// no `recurring_plan` row is written on any path out of this file, and none may be. this endpoint
// authorizes a repeating gift at the processor; a commitment's row is written by the first charge
// that settles, by `$lib/server/donations/collect.ts` alone (CLAUDE.md), because an authorization
// is not a collection and a row minted here would claim income on a gift the donor's bank may
// still refuse.
//
// nothing here is a module-scope singleton. the D1 handle and the deploy-time values arrive on the
// request context, which src/request-context.ts seeds per request, and the payment provider is
// built from that env on the call — never assigned at module scope, and never handed onward to
// anything that returns a value to a browser.

/**
 * the submission.
 *
 * `POST` and nothing else. react router routes every mutating method to this one function, so a
 * `PUT` or a `DELETE` arrives here as readily as the submission does and would otherwise be minted
 * as one — the preflight below grants `POST` alone, which stops a browser and stops nothing else.
 */
export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);

	const db = context.get(database);
	const { env } = context.get(platform);

	// this endpoint's own bucket, charged before anything else runs.
	//
	// the surface bucket above it is sized against a caller costing one D1 read. a submission costs
	// a read, a Turnstile verification and a payment intent minted at the processor, so sixty a
	// minute is what this one allows where the surface allows six hundred (wrangler.jsonc). both
	// numbers are sized against the same address, which is why this one is not tighter still: a
	// carrier NAT or a campus puts many real donors behind one, and that does not change because
	// the request costs more. Turnstile is the control on card testing; this is the ceiling on a
	// minute in which the challenge is passing.
	//
	// the refusal carries CORS headers where the surface's refusal deliberately carries none, and
	// that difference is the reason the charge is here rather than only on the layout. the layout
	// cannot echo an origin without the `allowed_origins` read its refusal exists to avoid; this
	// route is answering a donor mid-checkout, on a page that cannot read a body with no
	// `Access-Control-Allow-Origin` on it — the runtime would report only that the request never
	// completed, which reads as a CORS misconfiguration to whoever embedded the form. so a refusal
	// pays for one read to say what actually happened. that read is itself bounded by the surface
	// bucket charged a moment ago, which is sized to accept exactly this much: the config endpoint
	// costs one read on every request it answers.
	//
	// a deployment with no binding takes the gift, and a caller the edge attributed no address to
	// is not counted at all. both are `isRateLimited`'s decisions and are argued in
	// $lib/server/api/rate-limit.ts; what is local here is that neither leaves this endpoint
	// unmetered, because the layout's surface bucket is still in front of it and still fails loud.
	if (await isRateLimited(env.QUOTE_RATE_LIMITER, quoteRateLimitKey(request))) {
		return quoteRateLimitRefusal(corsHeaders(request, await readFormOrigins(db, params.id)));
	}

	const result = await mintQuote(
		{
			db,
			env,
			processors: createPaymentProviders(env),
			verifyChallenge: verifyTurnstile
		},
		{ formId: params.id, body: await readJsonBody(request), request }
	);

	const headers = corsHeaders(request, result.form?.allowedOrigins ?? []);
	if (result.ok) return Response.json(result.quote, { headers });

	const code = refusalCode(result.reason);
	return Response.json(
		{
			...(code === null ? {} : { error: code }),
			message: result.message,
			fix: result.fix
		},
		{ status: REFUSAL_STATUS[result.reason], headers }
	);
}

/**
 * the preflight, and the answer to every other method the framework sends to a `loader`.
 *
 * a JSON `POST` is not a simple request, so the preflight here is real: `content-type:
 * application/json` is not CORS-safelisted, which is the whole difference from the config route —
 * a browser asks permission before sending this at all, and a route granting no headers would
 * refuse every submission it exists to take. the grant is that one header and no other; `Accept`
 * needs no grant, and a list of allowed headers only ever grows.
 *
 * the preflight is answered from the form's own list and this deployment's own donation page,
 * exactly as the config route's is: an id nothing matches and a site nothing names both get a 204
 * with nothing granted, because a preflight that 404'd would tell any page on the internet which
 * form ids this deployment holds.
 *
 * a `GET` reaches here too, and it is answered rather than left to the framework because this
 * address is one a person or an agent will open in a browser. it reads no row and carries no echo:
 * the answer names no form, and a read spent on a method this endpoint does not take is a read
 * anyone on the internet can ask for.
 */
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	if (request.method !== 'OPTIONS') return methodNotAllowed(request.method);
	const db = context.get(database);
	return preflightResponse(request, await readFormOrigins(db, params.id), GRANT);
}

const GRANT = { methods: 'POST, OPTIONS', headers: 'content-type', maxAge: '600' } as const;

/**
 * the answer to a method this endpoint does not take.
 *
 * no `error` code, for the reason the surface's own not-found answer mints none: `API_ERROR_CODES`
 * in packages/form/src/v1.ts is a permanent wire vocabulary whose members each name the screen that
 * fixes them, and no screen fixes a request made with the wrong verb. `Allow` is what a caller
 * acts on, and it is required on a 405
 * (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405).
 */
function methodNotAllowed(method: string): Response {
	return Response.json(
		{
			message: `This endpoint takes a gift by POST. ${method} is not a method it answers.`,
			fix: 'POST a JSON body to this address. `GET /api/v1/forms/{formId}/config` is the read.'
		},
		{
			status: 405,
			headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' }
		}
	);
}

/**
 * the request body, parsed once, or `undefined` where it is not JSON at all.
 *
 * `undefined` rather than a throw, because a `SyntaxError` escaping here is a 500 on a public
 * endpoint with no CORS headers and no sentence — and the request is not the deployment's fault.
 * `parseQuoteRequest` in $lib/server/donations/quote-input.ts is what names it, one step later,
 * where the form row exists to build the headers from.
 */
async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

/**
 * the status each refusal answers with.
 *
 * the six inherited from the config ladder answer exactly what that route answers, and that is a
 * requirement rather than a convenience: the same form in the same state has to look the same to a
 * caller whichever endpoint it asked. the rest are this path's, and they group the same way — a
 * caller reading `error` learns which screen fixes it, a caller reading only the status learns
 * whose problem it is.
 *
 * - 400, the body. the only refusal here caused by what the caller sent, and the only one whose fix
 *   is in the integrator's own code rather than on a screen.
 * - 403, the challenge did not clear. it is not 401 — nothing about this surface is authenticated,
 *   and there is no credential to present. the donation form's answer is a fresh token, which is
 *   what the `challenge_failed` code exists to tell it.
 * - 404 / 410 / 409, the form: an id this deployment never had, one permanently retired, or one
 *   whose own stored state stops it. as the config route argues at length.
 * - 500, a defect of ours. no code, because no screen fixes it: `API_ERROR_CODES` in
 *   `packages/form/src/v1.ts` is a permanent vocabulary whose members each name one, and a member for our
 *   own bug would ask a donation form to render a screen about it. this is also where a gift that
 *   could not be written lands — including the case where the form or the fund vanished between the
 *   read at the top of this request and the write at the bottom. nothing about the request is
 *   wrong, no caller can act on it, and retrying fails identically until a row is restored by hand.
 * - 503, this deployment is not finished or something it depends on is not answering. the
 *   organisation's details, a processor's keys, a recurring gift it cannot honour, the challenge
 *   service, the processor. 4xx would blame the caller for a value they very likely cannot see, and
 *   monitoring that treats 5xx as an outage is right to: a donation form that cannot take a gift is
 *   one.
 *
 * no `Retry-After` on any of them, including the two that do come true with time. the one refusal
 * on this surface that carries one is the 429 — answered twice, by the layout's surface bucket and
 * by the charge at the top of this file, and in both cases by a limiter that knows its own period.
 * here the wait is a processor's or an operator's and this app does not know it.
 */
const REFUSAL_STATUS = {
	form_not_found: 404,
	form_not_published: 409,
	form_retired: 410,
	form_unservable: 409,
	org_profile_incomplete: 503,
	payments_not_configured: 503,
	invalid_request: 400,
	frequency_unsupported: 503,
	challenge_failed: 403,
	challenge_unavailable: 503,
	payments_unavailable: 503,
	internal_error: 500
} as const satisfies Record<QuoteRefusal, number>;
