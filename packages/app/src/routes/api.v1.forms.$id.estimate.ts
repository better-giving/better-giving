import { corsHeaders, preflightResponse } from '$lib/server/api/cors';
import {
	estimateRateLimitKey,
	estimateRateLimitRefusal,
	isRateLimited
} from '$lib/server/api/rate-limit';
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
// other method 405 itself. the surface's rate limit is the layout's (./api.v1.ts), and a read that
// would ask NOWPayments is charged again on `QUOTE_RATE_LIMITER` under a count of its own
// (`estimateRateLimitKey` in $lib/server/api/rate-limit.ts): each one is an uncached call on the
// deployment's key, and a refusal answers 429 with the CORS echo. CORS is owed for
// the reason the config read owes it: the caller is a donor's browser on a site the form names.
// neither a spam check nor amount bounds is owed: the read starts no payment and keeps nothing a
// donor typed. the form quotes a coin gift at this figure (`estimate` in packages/form/src/ports.ts),
// and that quote is the submission (./api.v1.forms.$id.donations.ts), which owes both and re-reads
// the bounds; the gift then settles at what arrives.
//
// an id nothing matches answers the config read's 404, without a CORS echo for another site
// (./api.v1.forms.$id.config.ts), and asks NOWPayments nothing. every other miss but the limit's is
// `{ estimateMinor: null }` rather than a refusal, since the donation form meets each one alike —
// with no figure it quotes no coin gift: an amount empty or over `AMOUNT_LENGTH_MAX` characters, a
// coin the account cannot be paid in, or an estimate NOWPayments refused or did not answer in time,
// which is logged. a form taking no gifts, a draft or a retired one, is priced as a live one is: the
// submission refuses it, and the limit bounds what the pricing costs.
// the coins the account can be paid in are the cached list the config read takes its coins from
// (`cachedCoins` in $lib/server/forms/coin-cache.ts), and where it is empty or unread no coin is
// priced and the config serves no crypto (`PublishedConfigSources.coins` in
// $lib/server/forms/published-config.ts).
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

	const { env } = context.get(platform);
	const processors = createPaymentProviders(env);
	const served = await cachedCoins(processors, url.origin);
	if (!served?.some((payable) => payable.coin === coin)) return unpriced();

	if (await isRateLimited(env.QUOTE_RATE_LIMITER, estimateRateLimitKey(request))) {
		return estimateRateLimitRefusal(headers);
	}
	const valued = await processors
		.for('nowpayments')
		.estimateCoinValue({ coin, coinAmount, currency: form.currency });
	if (valued.ok) return Response.json({ estimateMinor: valued.value.amountMinor }, { headers });
	// `invalid_request` is an amount the caller typed that is no amount, refused before NOWPayments
	// is asked, and nothing an operator acts on.
	if (valued.reason !== 'invalid_request') {
		console.error('pricing a coin amount failed:', valued.reason, valued.detail);
	}
	return unpriced();
}

const GRANT = { methods: 'GET, OPTIONS', headers: null, maxAge: '600' } as const;
