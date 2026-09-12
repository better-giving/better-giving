import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { cachedCadences } from '$lib/server/forms/cadence-cache';
import {
	readPublishedConfig,
	renderableConfig,
	type PublishedConfigRefusal
} from '$lib/server/forms/published-config';
import { readFormOrigins } from '$lib/server/forms/queries';
import { cachedRails } from '$lib/server/forms/rail-cache';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.v1.forms.$id.config';

// the config the embedded donation form boots on, and the first thing anyone integrating this
// deployment ever calls: `createLoadConfig` in packages/form/src/embed/runtime.ts reads exactly this
// route, from a page on somebody else's website.
//
// a resource route: no default export, so react router answers the request with what the loader
// returns instead of rendering anything (react-router/docs/how-to/resource-routes.md). the read
// and the preflight are one loader because that is how the framework dispatches them — `GET`,
// `HEAD` and `OPTIONS` all reach the `loader`, and only `POST`, `PUT`, `PATCH` and `DELETE` reach
// an `action`. the two answers are still written apart below; `loader` is a switchboard and
// nothing else.
//
// what is decided here and what is not. the body is `readPublishedConfig`'s
// ($lib/server/forms/published-config.ts) — the config, or a refusal that already names the
// offending value and the screen that changes it, which is CLAUDE.md's rule for a 4xx read by an
// agent rather than by a person at a terminal. this file owns two things on top of it: which
// status each refusal answers with, and which callers are allowed to read the answer.
//
// the `form` row is read once, and it is the row the headers are built from.
// `readPublishedConfig` carries it out on every branch, refusals included, precisely so this
// endpoint does not go back for `allowed_origins` — a second query for the same row, on a public
// and unauthenticated path, is a second query anybody on the internet can ask for.
//
// the rate limit CLAUDE.md names alongside CORS is charged by the `middleware` on ./api.v1.ts,
// above everything here — a request that has asked too often is answered 429 before this file
// runs, so it never reads `form`. that is where it has to be: the read this endpoint cannot avoid
// is the one for an id nothing matches, and by the time a route is chosen it has already happened.
// Turnstile is not owed here and is not missing: this endpoint initiates no payment and reads
// nothing a donor typed, so there is no submission for a token to accompany — the endpoint that
// takes one is where that check belongs.
//
// 5xx is outside the readable-refusal contract below, and deliberately so. an exception in the
// reader becomes a 500 with no CORS headers, so the page that asked cannot read it — giving it one
// would mean going back for `allowed_origins` on a path where the read has just failed. a fault is
// not one of the six refusals; every one of those is a decision this code reached on purpose, and
// a browser can read all of them. the integrator's signal for the rest is the status in devtools
// and the whole body outside a browser, which is the same trade `form_not_found` takes below.
//
// the deploy-time values arrive as `context.get(platform).env` rather than as anything a loader
// returns, and the reason is that a loader's return value is serialized to the browser: an env
// handed onward puts the Stripe secret one `return { env }` from being published.
// `readPublishedConfig` narrows it.
//
// how often a gift may repeat and which rails a donor is shown are the two things in the served
// config that come off this deployment's processor account rather than out of D1, and this file is
// where the way to find them out is assembled: one provider built per request from `platform.env` —
// never a module-scope singleton (CLAUDE.md) — behind an edge cache each, because this route is the
// one every embedded form boots on and a donor should not wait on a processor for it. the reader calls
// them only once a row has been found, so an id nothing matches costs no outbound call.
//
// one provider for both, because building one costs nothing and two would be two clients against
// the same credentials. the two reads stay separate answers under separate keys: they expire
// independently, and a blip on one does not evict the other.
//
// the request's own origin is spent as a cache key and nothing else: an entry in `caches.default`
// belongs to the zone that asked for it, so the address it is kept under comes from the request
// that arrived rather than from a hostname this deployment invented.
// `$lib/server/forms/cadence-cache.ts` and `$lib/server/forms/rail-cache.ts` hold the rest of that.

/**
 * both answers, in one function because the two branches are the two halves of one export.
 *
 * ../routes.spec.ts refuses any route module whose *client-side* half can reach `$lib/server`, and
 * it reads a non-exported top-level declaration as client-side — a bundler does not drop a
 * module-scope binding merely because the export that used it was stripped. it passes over a
 * module with no client-side export at all, which this one is, so a helper lifted out of here
 * would be no less server-only than what is in here.
 */
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);
	// read above the preflight branch as well as below it: the echo names this deployment's own
	// donation page and the page asks this question one step earlier than it asks for the config
	// ($lib/server/api/cors.ts).
	const { env } = context.get(platform);

	if (request.method === 'OPTIONS') {
		// the preflight, answered from the form's own list and this deployment's own donation page.
		//
		// a browser sends this before a request it may not send outright, and it is the same
		// question the read below turns on one step earlier: may this page talk to this form. so it
		// reads the row for `allowed_origins` and stops — running the refusal ladder here would
		// answer "this form is a draft" to a browser that has not been allowed to ask anything yet,
		// in headers that carry no status and that no page can read.
		//
		// an id nothing matches and a site nothing names get the same 204 with nothing granted, for
		// the reason the not-found answer carries no CORS: a preflight that 404'd would tell any
		// page on the internet which form ids this deployment holds. `readFormOrigins` in
		// $lib/server/forms/queries.ts answers both with the same empty list, so there is nothing
		// here to tell them apart with.
		//
		// it is charged against the same bucket as the read, on the same middleware: a preflight is
		// the cheapest request an attacker can issue and it still costs a read.
		return preflightResponse(request, await readFormOrigins(db, params.id), GRANT);
	}

	const processors = createPaymentProviders(env);
	const origin = new URL(request.url).origin;
	// `renderableConfig` is this route's own judgement and not the ladder's, which is why it is
	// composed here rather than folded into the reader: a config offering no rail is one
	// `readFormConfig` in `packages/form/src/config.ts` drops, and only a caller that is about to hand a body
	// to that reader has a reason to refuse over it. the donation path shares the reader and must go
	// on charging a gift already in flight — its own header states the rule and CLAUDE.md is where it
	// comes from.
	const result = renderableConfig(
		await readPublishedConfig(
			db,
			params.id,
			env,
			() => cachedCadences(processors, origin),
			() => cachedRails(processors, origin)
		)
	);
	const headers = corsHeaders(request, result.form?.allowedOrigins ?? []);

	if (!result.ok) {
		return Response.json(result.error, { status: REFUSAL_STATUS[result.reason], headers });
	}
	return Response.json(result.config, { headers });
}

/**
 * what a preflight is granted here, and the whole of it.
 *
 * no `headers`: this endpoint takes nothing a browser has to ask permission for. `Accept` is
 * CORS-safelisted, so the read the donation form makes is a simple request that is never
 * preflighted at all — a caller that got here sent a header this route has no use for.
 *
 * `maxAge` is 600 seconds. a grant is only ever cached after it was given, and the request it
 * covers is still answered against the form's own list at the time it arrives — so an origin
 * removed in /admin stops being able to read the config immediately, whatever a cached preflight
 * says it may send.
 */
const GRANT = { methods: 'GET, OPTIONS', headers: null, maxAge: '600' } as const;

/**
 * the status each refusal answers with.
 *
 * the vocabulary is `PUBLISHED_CONFIG_REFUSALS` and it is a permanent wire contract; the statuses
 * are this file's, and they are grouped rather than one-per-member on purpose. a caller that reads
 * the `error` string learns which screen fixes it; a caller that only sees the status — a proxy,
 * a log line, an uptime check — learns whose problem it is, and there are four answers to that:
 *
 * - 404, the id is not one this deployment has ever had. the snippet in the page's HTML names
 *   nothing here.
 * - 410, the id was real and is permanently gone. a retired form is never published again —
 *   the `updateForm*` group writes in $lib/server/forms/queries.ts refuse a row with
 *   `archived_at` set and nothing
 *   clears it — so this is the single refusal where the integrator has work to do: the snippet on
 *   the site has to be replaced. 410 says that where 409 would say "wait".
 * - 409, the named form's own stored state stops it — still a draft, or a row that cannot serve.
 *   both are undone on the one /admin screen that edits that form, and the same request succeeds
 *   afterwards with nothing on the integrator's page changing. two members, one status, because
 *   the status answers "whose" and the code answers "which box".
 * - 503, nothing about the request or the form is wrong and this deployment is not finished. the
 *   organisation's details are unsaved, or neither processor's keys are set. 4xx would
 *   blame the caller for a value they cannot see and very likely cannot reach, and monitoring
 *   that treats 5xx as an outage is right to: a donation form no one can give through is one.
 *   no `Retry-After` — nothing here comes true with time, only when a person sets a value.
 *
 * both 503s sit behind the 404 in `publishedConfig`'s own order, so reaching either takes a form
 * id that exists, which comes off a snippet the organisation published itself.
 */
const REFUSAL_STATUS = {
	form_not_found: 404,
	form_not_published: 409,
	form_retired: 410,
	form_unservable: 409,
	org_profile_incomplete: 503,
	payments_not_configured: 503
} as const satisfies Record<PublishedConfigRefusal, number>;
