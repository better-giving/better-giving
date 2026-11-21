import type { ApiError, PledgeToldAnswer } from '@better-giving/form/v1';
import { LOGS_SAY_WHY } from '$lib/deployment-logs';
import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { sendPledgeTold } from '$lib/server/donations/pledge-told';
import { markPledgeTold } from '$lib/server/donations/pledges';
import { createEmailProvider } from '$lib/server/email/factory';
import { readFormOrigins } from '$lib/server/forms/queries';
import { database, platform } from '../context';
import type { Route } from './+types/api.v1.forms.$id.donations.$pledgeId.told';

// the donor's "I've contacted my broker" or "I've asked my custodian" on a stock or IRA (QCD)
// pledge's pending screen: no body in, `PledgeToldAnswer` in packages/form/src/v1.ts out. the first
// press stamps the pledge's `told_at` and the organisation is mailed after the answer
// ($lib/server/donations/pledge-told.ts); every press after it answers the same and mails nobody
// (`markPledgeTold` in $lib/server/donations/pledges.ts).
//
// a resource route: `POST` reaches the `action`, and `GET`, `HEAD` and `OPTIONS` the `loader`.
//
// the pledge id is the capability. it is `Pledge.id`, which only the challenge-gated
// `POST /api/v1/forms/:id/donations` saves a pledge under, and it names a pledge only on the form
// that pledge was made on: an unknown id and one for another form's pledge are the same 404.
//
// the controls AGENTS.md → Routes names for `/api/v1`, and where each one is:
//
//   rate limiting — the surface bucket, charged by the `middleware` on ./api.v1.ts before this file
//                   runs. no bucket of its own: the write is one guarded update, and the most it can
//                   send is one message per pledge, ever.
//   CORS          — from the form's own `allowed_origins` and this deployment's own donation page,
//                   on every answer including the refusals, so the pending screen can read them.
//   spam check    — not owed. the donor spent their challenge saving the pledge, and no press here
//                   can mail anyone but the organisation, once per pledge.
//   amount bounds — not owed. no amount is submitted.
//
// the mail goes to the process's deferred-work tracker, never the request: a slow or failing send
// is the operator's to hear about and never changes the donor's answer.

export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);
	const db = context.get(database);
	const { env, deferred } = context.get(platform);
	const headers = corsHeaders(request, await readFormOrigins(db, params.id));

	const marked = await markPledgeTold(
		db,
		{ id: params.pledgeId, formId: params.id },
		new Date()
	).catch((error: unknown) => {
		console.error('a pledge could not be marked told:', error);
		return null;
	});
	if (marked === null) return notMarked(headers);
	if (!marked.found) {
		return Response.json(
			{
				error: 'pledge_not_found',
				message: 'This gift isn’t saved here, so the organisation couldn’t be told about it.',
				fix: 'Use `pledge.id` from the quote `POST /api/v1/forms/{formId}/donations` answered, on the form that quote was made on.'
			} satisfies ApiError,
			{ status: 404, headers }
		);
	}
	if (marked.claimed) {
		const email = createEmailProvider(env);
		deferred.waitUntil(sendPledgeTold({ db, email }, marked.pledge));
	}
	return Response.json({ ok: true } satisfies PledgeToldAnswer, { headers });
}

/**
 * a press the database failed, already logged: a 500 with no `error`, as the submission answers its
 * own `internal_error` (./api.v1.forms.$id.donations.ts), and with the form's CORS so the pending
 * screen can read it.
 */
function notMarked(headers: HeadersInit): Response {
	return Response.json(
		{
			message: 'We couldn’t tell the organisation about this gift. Try again in a moment.',
			fix: `This is a fault in this deployment rather than anything about the request. ${LOGS_SAY_WHY}`
		},
		{ status: 500, headers }
	);
}

/** the preflight, from the form's own list as its siblings answer one; every other method a 405. */
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	if (request.method !== 'OPTIONS') return methodNotAllowed(request.method);
	return preflightResponse(request, await readFormOrigins(context.get(database), params.id), GRANT);
}

/** the siblings' grant: a press sent with a JSON `content-type` is preflighted like theirs. */
const GRANT = { methods: 'POST, OPTIONS', headers: 'content-type', maxAge: '600' } as const;

function methodNotAllowed(method: string): Response {
	return Response.json(
		{
			message: `This endpoint records that the donor asked their broker or custodian, by POST. ${method} is not a method it answers.`,
			fix: 'POST to this address with no body.'
		},
		{ status: 405, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } }
	);
}
