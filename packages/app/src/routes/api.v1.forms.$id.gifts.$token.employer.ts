import { type EmployerAnswer, MAX_EMPLOYER } from '@better-giving/form/v1';
import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { createEmailProvider } from '$lib/server/email/factory';
import { readFormOrigins } from '$lib/server/forms/queries';
import { giftLinkOrigin } from '$lib/server/matching/links';
import { employerNamed } from '$lib/server/matching/pack';
import { database, platform } from '../context';
import type { Route } from './+types/api.v1.forms.$id.gifts.$token.employer';

// the donor naming the employer that may match their gift, from the donation form's thank-you:
// `EmployerRequest` in packages/form/src/v1.ts in, `EmployerAnswer` out. it does what naming the
// employer on the gift page does (`employerNamed` in $lib/server/matching/pack.ts): the employer
// stored, and the pack mailed after the answer where none has gone, which arms the one reminder
// where `BETTER_AUTH_URL` pins the address. a voided or matched gift's is refused with the gift
// page's 409.
//
// a resource route: `POST` reaches the `action`, and `GET`, `HEAD` and `OPTIONS` the `loader`.
//
// the token is the capability. it is the last segment of `Quote.giftUrl`, 160 bits minted with the
// gift (`mintGiftMatchToken` in $lib/server/db/schema.ts), and it names a gift only on the form that
// gift was made on: an unknown token, a malformed one and one for another form's gift are the same
// 404, so the answer tells a caller nothing about tokens it does not hold.
//
// the controls AGENTS.md → Routes names for `/api/v1`, and where each one is:
//
//   rate limiting — the surface bucket, charged by the `middleware` on ./api.v1.ts before this file
//                   runs. no bucket of its own: the write is one statement and a read, and the most
//                   it can send is one pack per gift, ever — the pack's claim (`sendOwedPack`) sends
//                   none once one has gone. ../routes.spec.ts fails a route that charges the surface
//                   bucket again.
//   CORS          — from the form's own `allowed_origins` and this deployment's own donation page,
//                   on every answer including the refusals, so the thank-you can read them.
//   spam check    — not owed. a challenge token is single-use and the donor already spent theirs on
//                   the gift; the capability is the token above, which only the challenge-gated
//                   `POST /api/v1/forms/:id/donations` hands out, and no call here can mail anyone but
//                   the donor of that gift, once.
//   amount bounds — not owed. no amount is submitted or charged.
//
// the body is read exactly once, here. the employer is the donor's own words: no answer and no log
// line here carries it.
//
// the form's Skip and its timeout abort the request, and node-fetch-server aborts `request.signal`
// when the connection closes. the signal is read after the body, where an aborted request writes
// nothing. a write already in flight when the form stops waiting still lands and still owes its
// pack, which goes to the deferred-work tracker rather than the request (`employerNamed` in
// $lib/server/matching/pack.ts), so neither side may promise a skipped write did not happen.

export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);
	const db = context.get(database);
	const { env, deferred } = context.get(platform);
	const headers = corsHeaders(request, await readFormOrigins(db, params.id));

	const typed = employerIn(await readJsonBody(request));
	// react router throws an aborted request's reason after the action anyway; this throws it first.
	if (request.signal.aborted) throw request.signal.reason;
	if (typed === null) {
		return Response.json(
			{
				message: `The body names no employer. It is JSON with an \`employer\` of 1 to ${MAX_EMPLOYER} characters once trimmed.`,
				fix: 'Send { "employer": "…" } with the name the donor typed, trimmed.'
			},
			{ status: 400, headers }
		);
	}

	const written = await employerNamed(
		{
			db,
			email: createEmailProvider(env),
			giftOrigin: giftLinkOrigin(env, new URL(request.url)),
			defer: (work) => deferred.waitUntil(work)
		},
		{ token: params.token, formId: params.id },
		typed,
		new Date()
	);
	if (written.ok) {
		const closed = written.state.voidedAt !== null || written.state.matchedAt !== null;
		if (!closed) return Response.json({ ok: true } satisfies EmployerAnswer, { headers });
		// the 409 the gift page's action answers (./gift.$token.tsx); `createEmployerWrite` in
		// packages/form/src/embed/api.ts counts any non-OK status as the write failing.
		return Response.json(
			{
				message: 'This gift’s match request is closed, so the employer can no longer be changed.',
				fix: 'Nothing to resend: the organisation closed the match, or the employer’s gift arrived.'
			},
			{ status: 409, headers }
		);
	}
	if (written.reason === 'not_found') {
		// no `error` code: `API_ERROR_CODES` in packages/form/src/v1.ts names screens that fix a
		// refusal, and no screen fixes a token the caller holds wrong.
		return Response.json(
			{
				message: `No gift on form ${params.id} has the gift page ${params.token}.`,
				fix: 'Use the last segment of the giftUrl the quote POST /api/v1/forms/{formId}/donations answered, on the form that quote was made on.'
			},
			{ status: 404, headers }
		);
	}
	return Response.json(
		{
			message: `The employer is blank, longer than ${MAX_EMPLOYER} characters once trimmed, or holds a control character.`,
			fix: `Send the name the donor typed, trimmed, between 1 and ${MAX_EMPLOYER} characters and on one line.`
		},
		{ status: 400, headers }
	);
}

/** the preflight, from the form's own list as its siblings answer one; every other method a 405. */
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	if (request.method !== 'OPTIONS') return methodNotAllowed(request.method);
	return preflightResponse(request, await readFormOrigins(context.get(database), params.id), GRANT);
}

/** a JSON `POST` is preflighted, so `content-type` is granted and nothing else. */
const GRANT = { methods: 'POST, OPTIONS', headers: 'content-type', maxAge: '600' } as const;

function methodNotAllowed(method: string): Response {
	return Response.json(
		{
			message: `This endpoint takes the donor's employer by POST. ${method} is not a method it answers.`,
			fix: 'POST a JSON body { "employer": "…" } to this address.'
		},
		{ status: 405, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } }
	);
}

/** the body parsed once, or `undefined` where it is not JSON, which the refusal above names. */
async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

/** the `employer` the body carries, or `null` where it carries no text. the length is the write's. */
function employerIn(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const { employer } = body as { employer?: unknown };
	return typeof employer === 'string' ? employer : null;
}
