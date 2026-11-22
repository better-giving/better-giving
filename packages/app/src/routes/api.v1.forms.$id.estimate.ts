import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import { cachedCoins } from '$lib/server/forms/coin-cache';
import { formNotFound } from '$lib/server/forms/published-config';
import { readForm, readFormOrigins } from '$lib/server/forms/queries';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.v1.forms.$id.estimate';

// what a coin amount a donor typed is worth, for the line under it on the donation form's first step
// ("About $482.10"): `?coin=` is one `PayableCoin.coin` off the served config, `?amount=` the decimal
// as typed. the body is `{ estimateMinor }`, minor units of the form's currency at NOWPayments' rate
// (`estimateCoinValue` in $lib/server/payments/nowpayments.ts), or null where it cannot be priced.
//
// a resource route: `GET`, `HEAD` and `OPTIONS` reach the loader, and react router answers every
// other method 405 itself. the surface's rate limit is the layout's (./api.v1.ts). CORS is owed for
// the reason the config read owes it: the caller is a donor's browser on a site the form names.
// neither a spam check nor amount bounds is owed: the read starts no payment and keeps nothing a
// donor typed. the form quotes a coin gift at this figure (`estimate` in packages/form/src/ports.ts),
// and that quote is the submission (./api.v1.forms.$id.donations.ts), which owes both and re-reads
// the bounds; the gift then settles at what arrives.
//
// an id nothing matches answers the config read's 404, without a CORS echo for another site
// (./api.v1.forms.$id.config.ts), and asks NOWPayments nothing. every other miss is
// `{ estimateMinor: null }` rather than a refusal, since the donation form meets each one alike —
// with no figure it quotes no coin gift: an amount empty or over `AMOUNT_LENGTH_MAX` characters, a
// coin the served list does not name — which is every coin while crypto is off, the list being empty
// there (`cachedCoins` in $lib/server/forms/coin-cache.ts) — or an estimate NOWPayments refused or
// did not answer in time.
//
// `Cache-Control: no-store` from `corsHeaders`: the figure moves with the coin's price.

/** the longest amount priced; a longer one is no figure a donor types. */
const AMOUNT_LENGTH_MAX = 32;

export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const db = context.get(database);

	if (request.method === 'OPTIONS') {
		return preflightResponse(request, await readFormOrigins(db, params.id), GRANT);
	}

	const form = await readForm(db, params.id);
	const headers = corsHeaders(request, form?.allowedOrigins ?? []);
	if (form === null) return Response.json(formNotFound(params.id), { status: 404, headers });

	const unpriced = () => Response.json({ estimateMinor: null }, { headers });
	const url = new URL(request.url);
	const coin = url.searchParams.get('coin') ?? '';
	const coinAmount = url.searchParams.get('amount') ?? '';
	if (coinAmount.length < 1 || coinAmount.length > AMOUNT_LENGTH_MAX) return unpriced();

	const processors = createPaymentProviders(context.get(platform).env);
	const served = await cachedCoins(processors, url.origin);
	if (!served?.some((payable) => payable.coin === coin)) return unpriced();

	const valued = await processors
		.for('nowpayments')
		.estimateCoinValue({ coin, coinAmount, currency: form.currency });
	return valued.ok
		? Response.json({ estimateMinor: valued.value.amountMinor }, { headers })
		: unpriced();
}

const GRANT = { methods: 'GET, OPTIONS', headers: null, maxAge: '600' } as const;
