import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { searchTickers } from '$lib/server/donations/tickers';
import { formNotFound } from '$lib/server/forms/published-config';
import { readForm, readFormOrigins } from '$lib/server/forms/queries';
import { readPledgeRails } from '$lib/server/payments/pledge-rails';
import { database } from '../context';
import type { Route } from './+types/api.v1.forms.$id.tickers';

// the stock step's ticker search: what a donor types as `?q=`, answered from the list
// $lib/server/donations/ticker-refresh.ts keeps from the SEC's files, so a donor never reaches
// sec.gov. each row is `{ symbol, name }`, `name` null on a mutual fund, best match first.
//
// a resource route: `GET`, `HEAD` and `OPTIONS` reach the loader, and react router answers every
// other method 405 itself. the surface's rate limit is the layout's (./api.v1.ts). CORS is owed for
// the reason the config read owes it: the caller is a donor's browser on a site the form names.
// neither a spam check nor amount bounds is owed: the read starts no payment, names no amount and
// keeps nothing a donor typed.
//
// an id nothing matches answers the config read's 404, without a CORS echo for another site
// (./api.v1.forms.$id.config.ts). a form whose stock rail is off, and a query outside 1 to
// `QUERY_LENGTH_MAX` characters, answer an empty list rather than a refusal: the donation form
// draws no results either way.
//
// `Cache-Control: no-store` from `corsHeaders`: the answer turns over when the stock rail is
// switched off on /admin/payments, and a browser's copy of it is out of reach once kept.

/** the most tickers one answer lists. */
const RESULTS_MAX = 8;

/** the longest query searched; a longer one is no ticker or company name a donor would type. */
const QUERY_LENGTH_MAX = 40;

export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);

	if (request.method === 'OPTIONS') {
		return preflightResponse(request, await readFormOrigins(db, params.id), GRANT);
	}

	const form = await readForm(db, params.id);
	const headers = corsHeaders(request, form?.allowedOrigins ?? []);
	if (form === null) return Response.json(formNotFound(params.id), { status: 404, headers });

	const query = new URL(request.url).searchParams.get('q') ?? '';
	if (query.length < 1 || query.length > QUERY_LENGTH_MAX) return Response.json([], { headers });
	const rails = await readPledgeRails(db);
	if (!rails.stock.enabled) return Response.json([], { headers });

	const found = await searchTickers(db, query, RESULTS_MAX);
	return Response.json(
		found.map(({ symbol, name }) => ({ symbol, name })),
		{ headers }
	);
}

const GRANT = { methods: 'GET, OPTIONS', headers: null, maxAge: '600' } as const;
