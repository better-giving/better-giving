import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { challengeKind } from '$lib/server/api/challenge';
import { readFormOrigins } from '$lib/server/forms/queries';
import { database, platform } from '../context';
import type { Route } from './+types/api.v1.forms.$id.challenge';

// a fresh ALTCHA challenge for the donation form to solve before it submits, on a deployment whose
// spam check is ALTCHA ($lib/server/api/challenge.ts). the served config names this address as
// `altchaChallengeUrl` exactly when it is the check.
//
// a resource route: `GET`, `HEAD` and `OPTIONS` reach the loader, and react router answers every
// other method 405 itself. the surface's rate limit is the layout's (./api.v1.ts). CORS is owed for
// the reason the config read owes it: the caller is a donor's browser on a site the form names.
//
// the challenge is not bound to the form in the path, so an id nothing matches is issued one too,
// with no CORS echo, which is the same answer that id gets for a preflight: telling the two apart
// would tell any page which form ids this deployment holds. issuing costs one HMAC and no read
// beyond `allowed_origins` ($lib/server/api/altcha.ts).

export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);
	const { env } = context.get(platform);
	const origins = await readFormOrigins(db, params.id);

	if (request.method === 'OPTIONS') return preflightResponse(request, origins, GRANT);

	const headers = corsHeaders(request, origins);
	if (challengeKind(env) === 'turnstile') {
		return Response.json(
			{
				message:
					'This deployment checks submissions with Turnstile, so it issues no ALTCHA challenge.',
				fix: 'Render the Turnstile widget from `turnstileSiteKey` in the form’s config.'
			},
			{ status: 404, headers }
		);
	}
	return Response.json(await env.ALTCHA.challenge(), { headers });
}

const GRANT = { methods: 'GET, OPTIONS', headers: null, maxAge: '600' } as const;
