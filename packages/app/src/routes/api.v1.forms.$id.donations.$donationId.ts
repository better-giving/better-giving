import type { DonationStatus } from '@better-giving/form/v1';
import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { readCryptoGiftState } from '$lib/server/donations/standing';
import { readFormOrigins } from '$lib/server/forms/queries';
import { database } from '../context';
import type { Route } from './+types/api.v1.forms.$id.donations.$donationId';

// the read the donation form's waiting screen polls on a crypto gift: whether the coin arrived, is
// still awaited, or the address stopped being watched with nothing on it. `DonationStatus` in
// packages/form/src/v1.ts is the body, and the state is all of it — no amount, no coin, no donor
// detail, because the id in the path is the only thing a caller holds.
//
// a resource route: no component, so react router answers with what the loader returns. `GET`,
// `HEAD` and `OPTIONS` reach the `loader`; any other method finds no `action` and the framework
// answers it 405.
//
// this endpoint is an exception to the four controls CLAUDE.md names for `/api/v1`, approved by the
// user on 2026-09-17, and the exception is Turnstile alone:
//
//   rate limiting — the surface bucket, charged by the `middleware` on ./api.v1.ts before this file
//                   runs. no bucket of its own: a poll costs one D1 read, which is what the surface
//                   bucket is sized against, and ../routes.spec.ts fails a route that charges it
//                   again.
//   CORS          — from the form's own `allowed_origins` and this deployment's own donation page,
//                   on every answer including the refusals, so the page that polls can read them.
//   Turnstile     — not owed. a token is single-use and the screen polls every few seconds, so a
//                   token per poll cannot exist. what stands in for it: the id is a uuid the
//                   Turnstile-gated `POST /api/v1/forms/:id/donations` minted, never enumerable,
//                   and this read initiates nothing — it answers from this deployment's rows and
//                   calls no processor.
//   amount bounds — not owed. nothing is submitted and no amount is in the answer.
//
// the exception is as narrow as the rail that needs it: a gift with no crypto attempt, or one made
// on another form than the path names, is the same 404 as an id nothing carries. a card gift's
// standing is never readable here.

export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);
	const origins = await readFormOrigins(db, params.id);
	if (request.method === 'OPTIONS') return preflightResponse(request, origins, GRANT);

	const headers = corsHeaders(request, origins);
	if (!GIFT_ID.test(params.donationId)) {
		return Response.json(
			{
				message: `${params.donationId} is not a gift id. A gift id is a lowercase UUID.`,
				fix: 'Use the paymentToken from the crypto quote POST /api/v1/forms/{formId}/donations answered, unchanged.'
			},
			{ status: 400, headers }
		);
	}

	const state = await readCryptoGiftState(db, params.id, params.donationId);
	if (state === null) {
		// no `error` code: `API_ERROR_CODES` in packages/form/src/v1.ts names screens that fix a
		// refusal, and no screen fixes a token the caller holds wrong.
		return Response.json(
			{
				message: `No crypto gift ${params.donationId} was made on form ${params.id}.`,
				fix: 'Use the paymentToken from the crypto quote POST /api/v1/forms/{formId}/donations answered, on the form that quote was made on.'
			},
			{ status: 404, headers }
		);
	}
	return Response.json({ state } satisfies DonationStatus, { headers });
}

/** a simple `GET` is never preflighted, so no request headers are granted. */
const GRANT = { methods: 'GET, OPTIONS', headers: null, maxAge: '600' } as const;

/** the canonical uuid form, which is what `uuidv7()` writes for `donation.id`. */
const GIFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
