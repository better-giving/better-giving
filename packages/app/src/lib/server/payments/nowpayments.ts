import { majorText } from '../../forms/amounts';
import {
	DONATION_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	type AccountChargeability,
	type Arrival,
	type Intent,
	type IntentRequest,
	type PayableCoin,
	type PaymentEvent,
	type PaymentFailure,
	type PaymentProvider,
	type PaymentResult,
	type RailSwitchboard,
	type Settlement,
	type WebhookDelivery
} from './provider';
import { webhookAddress } from './webhook-address';
import type { PaymentStatus } from '../db/schema';

// the NOWPayments adapter: a gift in crypto, sent by the donor to an address NOWPayments minted for
// that one payment.
//
// every call is `fetch` against NOWPayments' REST API with the key in `x-api-key`.
// `@nowpaymentsio/nowpayments-sdk-nodejs` is not used and ./sole-importer.spec.ts keeps it out of the
// tree: its normalisers remap payment statuses, turn every amount into a float, leave `fee` untyped
// and read the wrong expiry, and it carries payout surfaces this app must never reach. the wire this
// module speaks is the whole of its contract with NOWPayments, read from the Postman collection
// (https://documenter.getpostman.com/view/7907941/2s93JusNJt). its `GET`s were checked against the
// live API; `POST /v1/payment` has not been called live.
//
// **there is nothing for a browser to confirm.** `createIntent` mints a floating-rate payment and
// answers with the address, the coin amount, the memo and the expiry (`DepositInstructions` in
// ./provider.ts); the donor sends from their own wallet, and NOWPayments posts an IPN to the address
// named on that payment.
//
// **it answers** `createIntent`, `verifyEvent`, `readSettlement`, `listPayableCoins` and the two
// account reads, and refuses everything else as `unsupported`: a gift that repeats (a payment is one
// deposit — `takesRepeatingGifts` in ./provider.ts keeps NOWPayments out of every repeating-gift
// read), the listener arms (no endpoint is registered on the account; each payment carries its own
// callback), and the wallet arms. no payout, conversion or sub-partner call is made here, ever: those
// move money out of the account.
//
// **an IPN names; the read settles.** a verified notification says which payment moved and to which
// status, and carries the settlement its body states as `SettlementEvent.delivered` — the fallback
// for a payment `GET /v1/payment/:id` will not answer. no callback reaches a machine without a public
// address, so the arm is proven against signed fixtures (./nowpayments.spec.ts).
//
// **a repeat deposit is a payment of its own.** money sent again to a used address arrives under a new
// `payment_id` with `parent_payment_id` set and the parent's `order_id`, marked `finished` or
// `partially_paid`, converted at the rate when it landed (the collection's repeated-deposits section).
// it is read by `parent_payment_id` alone. a wrong-asset deposit processed on the account arrives the
// same way, in the coin that was sent, which is why the coin is read off the payment and never off the
// intent.
//
// **unconfirmed until the test gift**, where the collection is silent:
// - whether an IPN carries `created_at`/`updated_at`. its example carries neither, and a status read
//   does; a notification without them is timed on arrival, so a redelivery of it is timed anew.
// - whether `GET /v1/payment/:id` answers for a repeat deposit, which no key created. the list read's
//   example carries children, and the status read says only "the same API key that you used in the
//   create payment request"; where it answers `not_found`, `delivered` is what is left.
// - which of `full-currencies`' `precision` and `network_precision` is the number of decimals a coin
//   can actually be sent in. they disagree per coin, and the smaller is taken (`decimalsCarried`).
// - whether a `partially_paid` payment is later reported `finished` with more received. the collection
//   names one way to `finished` — the merchant marking a small shortfall finished in the dashboard,
//   the amount unchanged — and routes more money to the address as a repeat deposit. either way a
//   second report of one payment is never a second posting (`entry_group_source_idx` in
//   ../db/schema.ts), and a figure differing from the one posted is an operator's to reconcile.
//
// **live only, and nothing here reads a stage.** NOWPayments' sandbox is a separate account at
// another address, with its own key, that this module never calls.

/** what the adapter needs to talk to an account. */
export type NowpaymentsCredentials = {
	/** `NOWPAYMENTS_API_KEY`. server-only, sent as `x-api-key`, never logged, never echoed. */
	readonly apiKey: string;
	/**
	 * `NOWPAYMENTS_OUTCOME_CURRENCY` — the lowercase code of the coin the account pays out in.
	 *
	 * every minimum is asked against it: without `currency_to`, `min-amount` prices the coin against no
	 * payout coin at all rather than the account's wallet, and misses the real floor both ways — an
	 * order of magnitude over it for btc and under it for eth and trx. no call reads the payout coin
	 * off the account.
	 */
	readonly outcomeCurrency: string;
	/**
	 * `NOWPAYMENTS_IPN_SECRET`, or `null` where the deployment holds none. sent on no call; the IPN arm
	 * is the one reader.
	 */
	readonly ipnSecret: string | null;
};

const API_URL = 'https://api.nowpayments.io';

/** a donor is waiting on the answer: `TIMEOUT_MS` in ./paypal.ts argues the figure. */
const TIMEOUT_MS = 12_000;

/**
 * the two coin lists, which a config load reads on every rail's behalf (../forms/rail-cache.ts,
 * ../forms/coin-cache.ts): a NOWPayments that does not answer within it withdraws crypto for that
 * load rather than holding a card donor's form open.
 *
 * it also bounds a crypto quote: the lists (asked once per request, by the config load or the create,
 * whichever is first), then the minimum and the estimate together, then the create — 4s + 12s + 12s
 * of NOWPayments at worst, under the form's 30-second wait.
 */
const LIST_TIMEOUT_MS = 4_000;

/** how much of a sentence NOWPayments wrote a message of ours may repeat. */
const PROVIDER_QUOTE_MAX = 200;

/** an answer NOWPayments gave, read as far as its status and its JSON. */
type Answer = { readonly status: number; readonly body: unknown };

export function createNowpaymentsProvider(credentials: NowpaymentsCredentials): PaymentProvider {
	const outcome = credentials.outcomeCurrency.toLowerCase();

	/** one call, answered with NOWPayments' status and body, or with the failure of never getting one. */
	async function call(
		method: 'GET' | 'POST',
		path: string,
		body?: unknown,
		timeoutMs = TIMEOUT_MS
	): Promise<Answer | PaymentFailure> {
		let response: Response;
		try {
			response = await fetch(`${API_URL}${path}`, {
				method,
				headers: {
					'x-api-key': credentials.apiKey,
					accept: 'application/json',
					...(body === undefined ? {} : { 'content-type': 'application/json' })
				},
				body: body === undefined ? null : JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (error) {
			return unreachable(error);
		}
		// a body that is not JSON is read as nothing rather than thrown: every caller reads fields off
		// it, and a missing field is already a refusal with a sentence of its own.
		let parsed: unknown = null;
		try {
			parsed = parseWithSource(await response.text());
		} catch {
			parsed = null;
		}
		return { status: response.status, body: parsed };
	}

	/**
	 * the coins the account enabled that NOWPayments takes payment in, keyed by lowercased code, and
	 * every code `full-currencies` names — which the payout coin is checked against.
	 *
	 * `merchant/coins` alone is not the payable set: a third of what an account can enable carries
	 * `available_for_payment: false`. so the enabled codes are read against `full-currencies`, which
	 * is where name, network and memo live as well.
	 */
	async function acceptedCoins(): Promise<PaymentResult<CoinLists>> {
		const [enabled, listed] = await Promise.all([accountSelection(), currencyList()]);
		for (const answer of [enabled, listed]) {
			if ('ok' in answer) return answer;
			if (answer.status !== 200) {
				return classifyStatus(
					answer.status,
					answer.body,
					'NOWPayments did not list the account’s coins'
				);
			}
		}
		const selected = field((enabled as Answer).body, 'selectedCurrencies');
		const currencies = field((listed as Answer).body, 'currencies');
		if (!Array.isArray(selected) || !Array.isArray(currencies)) return unreadable('a coin list');

		const chosen = new Set(
			selected.filter((code) => typeof code === 'string').map((code) => code.toLowerCase())
		);
		const payable = new Map<string, PayableCoin>();
		const known = new Set<string>();
		const decimals = new Map<string, number>();
		const networkName = networkNamesOf(currencies);
		for (const currency of currencies) {
			const code = stringField(currency, 'code');
			if (code !== null) {
				known.add(code.toLowerCase());
				const carried = decimalsCarried(currency);
				if (carried !== null) decimals.set(code.toLowerCase(), carried);
			}
			const coin = acceptedCoinOf(currency, networkName);
			if (coin !== null && chosen.has(coin.coin)) payable.set(coin.coin, coin);
		}
		return { ok: true, value: { payable, known, decimals, networkName } };
	}

	/**
	 * `merchant/coins` and `full-currencies`, each asked once per provider. one request's config load
	 * and its crypto quote both need them, and a provider is built per request (CLAUDE.md →
	 * *Runtime*), so an answer kept here is never older than the request that asked.
	 */
	let selection: Promise<Answer | PaymentFailure> | null = null;
	let currencies: Promise<Answer | PaymentFailure> | null = null;
	function accountSelection(): Promise<Answer | PaymentFailure> {
		selection ??= call('GET', '/v1/merchant/coins', undefined, LIST_TIMEOUT_MS);
		return selection;
	}
	function currencyList(): Promise<Answer | PaymentFailure> {
		currencies ??= call('GET', '/v1/full-currencies', undefined, LIST_TIMEOUT_MS);
		return currencies;
	}

	/** whether the account's own selection names any coin, off `merchant/coins` alone. */
	async function selectsAnyCoin(): Promise<PaymentResult<boolean>> {
		const answer = await accountSelection();
		if ('ok' in answer) return answer;
		if (answer.status !== 200) {
			return classifyStatus(answer.status, answer.body, 'NOWPayments did not read the account');
		}
		const selected = field(answer.body, 'selectedCurrencies');
		if (!Array.isArray(selected)) return unreadable('the account’s coin selection');
		return { ok: true, value: selected.some((code) => typeof code === 'string') };
	}

	return {
		processor: 'nowpayments',

		/**
		 * the account's selection read against `full-currencies`: two calls, whatever the account holds.
		 *
		 * no minimum is asked here. the list is read by a public config boot, and a floor per coin is a
		 * subrequest per enabled coin — hundreds on one cold read. a coin whose floor NOWPayments will
		 * not answer is refused when a donor picks it (`createIntent`, `coin_not_accepted`).
		 */
		async listPayableCoins(): Promise<PaymentResult<readonly PayableCoin[]>> {
			const accepted = await acceptedCoins();
			if (!accepted.ok) return accepted;
			if (!accepted.value.known.has(outcome)) return outcomeUnknown(outcome);
			return { ok: true, value: [...accepted.value.payable.values()] };
		},

		/**
		 * the coin checked against the account, the gift priced in it against the coin's floor, and only
		 * then a floating-rate payment — so no donor is handed an address for a deposit that would land
		 * failed or part-paid.
		 *
		 * `idempotencyKey` is not sent: NOWPayments takes none. a create whose answer was lost and is
		 * made again mints a second payment with a second address, and the first — never shown to
		 * anyone — expires unpaid. `order_id` is the donation id on both, which is what an IPN is joined
		 * back by.
		 *
		 * `paymentToken` is the donation id: there is nothing for a browser to confirm.
		 */
		async createIntent(request: IntentRequest): Promise<PaymentResult<Intent>> {
			const coin = request.coin?.trim().toLowerCase() ?? '';
			const donationId = request.metadata?.[DONATION_METADATA_KEY] ?? '';
			const invalid = invalidRequest(request, coin, donationId);
			if (invalid !== null) return invalid;
			const price = majorText(request.amountMinor, 'USD');

			const accepted = await acceptedCoins();
			if (!accepted.ok) return accepted;
			if (!accepted.value.known.has(outcome)) return outcomeUnknown(outcome);
			if (!accepted.value.payable.has(coin)) return coinNotAccepted(coin);

			// the floor is asked for this one coin only; NOWPayments refusing to answer it is a coin it will
			// not take a payment in today, never a gift under the floor.
			const [minimum, estimated] = await Promise.all([minimumFor(coin), estimateFor(price, coin)]);
			if (!minimum.ok) {
				return minimum.reason === 'invalid_request' || minimum.reason === 'not_found'
					? coinNotAccepted(coin)
					: minimum;
			}
			if (!estimated.ok) return estimated;
			if (compareDecimals(estimated.value, minimum.value.coinAmount) < 0) {
				const minimumMinor = centsUp(minimum.value.dollars);
				return {
					ok: false,
					reason: 'below_minimum',
					detail:
						`A gift of $${price} converts to ${estimated.value} ${coin.toUpperCase()}, under the ` +
						`${minimum.value.coinAmount} ${coin.toUpperCase()} NOWPayments accepts in that coin — ` +
						`about $${majorText(minimumMinor, 'USD')}. No address was created.`,
					minimumMinor
				};
			}

			const answer = await call('POST', '/v1/payment', {
				price_amount: Number(price),
				price_currency: 'usd',
				pay_currency: coin,
				order_id: donationId,
				ipn_callback_url: webhookAddress('nowpayments', request.deploymentOrigin),
				is_fixed_rate: false,
				is_fee_paid_by_user: false
			});
			if ('ok' in answer) return answer;
			if (answer.status !== 200 && answer.status !== 201) {
				return refusedPayment(answer, price, coin);
			}
			return intentOf(
				answer.body,
				donationId,
				coin,
				accepted.value.networkName,
				accepted.value.decimals.get(coin) ?? null,
				giftSplitOf(request)
			);
		},

		/**
		 * the IPN checked against `NOWPAYMENTS_IPN_SECRET`, then named: which payment, which status.
		 *
		 * NOWPayments sends no event id. a notification goes out per status change, again from the
		 * dashboard, and again on any non-2xx, so `payment_id:payment_status:actually_paid` is the event —
		 * the same notification redelivered is the same event, and a new status, or the same status
		 * reporting a different amount received, is a new one.
		 *
		 * `refunded` and any status NOWPayments has not documented are `ignored`. every other names a
		 * settlement, carried with what the body itself states as `delivered`; the settlement acted on
		 * is still `readSettlement`'s. a body stating no settlement this module can read — an arrival
		 * valued under a cent, a shape it cannot read — carries none; an estimate that did not answer
		 * refuses the delivery retryably instead, since the body may be the only settlement there is.
		 */
		async verifyEvent(delivery: WebhookDelivery): Promise<PaymentResult<PaymentEvent>> {
			const secret = credentials.ipnSecret?.trim() ?? '';
			// `not_configured` rather than `bad_signature`, which holds the delivery open across the
			// redelivery window an operator sets the value inside (`verifyEvent` in ./stripe.ts).
			if (secret === '') {
				return {
					ok: false,
					reason: 'not_configured',
					detail:
						'This deployment cannot check that a payment notification came from NOWPayments: ' +
						'`NOWPAYMENTS_IPN_SECRET` is not set, so the delivery was refused and its body was not ' +
						'read. Generate the IPN secret under Payment Settings in the NOWPayments dashboard and ' +
						'store it in the console (`better-giving start`).'
				};
			}
			const signature = delivery.headers[SIGNATURE_HEADER];
			if (signature === undefined || !(await verifies(secret, signature, delivery.body))) {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						`The delivery carried no \`${SIGNATURE_HEADER}\` header that verifies against ` +
						'`NOWPAYMENTS_IPN_SECRET`, so its body was not read. This endpoint is public: an ' +
						'unverified delivery is anyone’s. If every notification is refused, the secret set here ' +
						'is not the one under Payment Settings in the NOWPayments dashboard.'
				};
			}

			const payment = parseWithSource(delivery.body);
			const id = paymentIdField(payment, 'payment_id');
			const word = stringField(payment, 'payment_status');
			if (id === null || id === 'unreadable' || word === null) {
				const missing = word === null ? '`payment_status`' : '`payment_id` as digits';
				return {
					ok: false,
					reason: 'invalid_request',
					detail:
						`The delivery’s signature verified and its body names no ${missing}, so nothing was ` +
						'acted on. The IPN secret is not the problem.'
				};
			}
			// the collection's IPN example carries no time; a delivery without one is timed on arrival.
			const occurredAt = timeOf(payment) ?? new Date();
			const received = arrivedAmount(payment) ?? '0';
			const named = { id: `${id}:${word}:${received}`, type: word, occurredAt };
			if (!SETTLEMENT_STATUSES.has(word)) return { ok: true, value: { ...named, kind: 'ignored' } };

			// `readSettlement` may value the same arrival again at a later estimate; the first posting
			// stands (`entry_group_source_idx` in ../db/schema.ts).
			let unvalued = null as PaymentFailure | null;
			const stated = await settlementOf(
				payment,
				async (coinAmount, coin) => {
					const valued = await estimateInDollars(coinAmount, coin);
					if (!valued.ok) unvalued = valued;
					return valued;
				},
				occurredAt
			);
			if (unvalued !== null) return unvalued;
			return {
				ok: true,
				value: {
					...named,
					kind: 'settlement',
					providerTxnId: id,
					...(stated.ok ? { delivered: stated.value } : {})
				}
			};
		},

		/** `GET /v1/payment/:id`, read into the row's vocabulary. */
		async readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>> {
			const answer = await call('GET', `/v1/payment/${encodeURIComponent(providerTxnId)}`);
			if ('ok' in answer) return answer;
			if (answer.status === 404) {
				return {
					ok: false,
					reason: 'not_found',
					detail:
						`NOWPayments holds no payment ${providerTxnId} this deployment’s key can read. A payment ` +
						'is readable only with the API key it was created under, so one made before ' +
						`\`NOWPAYMENTS_API_KEY\` was replaced reads as missing. NOWPayments said: ${quoteProblem(answer.body)}`
				};
			}
			if (answer.status !== 200) {
				return classifyStatus(
					answer.status,
					answer.body,
					`NOWPayments did not return payment ${providerTxnId}`
				);
			}
			return settlementOf(answer.body, estimateInDollars);
		},

		/**
		 * what a key that reads the account can say, since NOWPayments publishes no approval to read:
		 * `crypto` is `active` where the account enabled a coin and `inactive` where it enabled none.
		 */
		async readAccountChargeability(): Promise<PaymentResult<AccountChargeability>> {
			const selected = await selectsAnyCoin();
			if (!selected.ok) return selected;
			return {
				ok: true,
				value: { chargesEnabled: true, rails: { crypto: selected.value ? 'active' : 'inactive' } }
			};
		},

		/**
		 * the account's coin selection is the one switch it keeps, so crypto is offered exactly where a
		 * coin is enabled. `switchedOn` stays true: no selection off reads as a refusal nobody made.
		 */
		async readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>> {
			const selected = await selectsAnyCoin();
			if (!selected.ok) return selected;
			return { ok: true, value: { crypto: { offered: selected.value, switchedOn: true } } };
		},

		prepareRecurringGifts: async () => unsupported(NO_REPEATING_GIFTS),
		readRecurringGiftProvision: async () => unsupported(NO_REPEATING_GIFTS),
		createRecurringGift: async () => unsupported(NO_REPEATING_GIFTS),
		cancelRecurringGift: async () => unsupported(NO_REPEATING_GIFTS),
		readRecurringGift: async () => unsupported(NO_REPEATING_GIFTS),
		listWebhookEndpoints: async () => unsupported(NO_LISTENER_ARMS),
		registerWebhookEndpoint: async () => unsupported(NO_LISTENER_ARMS),
		resubscribeWebhookEndpoint: async () => unsupported(NO_LISTENER_ARMS),
		replaceWebhookEndpoint: async () => unsupported(NO_LISTENER_ARMS),
		listWalletDomains: async () => unsupported(NO_WALLETS),
		registerWalletDomain: async () => unsupported(NO_WALLETS)
	};

	/** what a dollar figure converts to in a coin, at NOWPayments' current rate. */
	async function estimateFor(price: string, coin: string): Promise<PaymentResult<string>> {
		const query = new URLSearchParams({ amount: price, currency_from: 'usd', currency_to: coin });
		const answer = await call('GET', `/v1/estimate?${query}`);
		if ('ok' in answer) return answer;
		if (answer.status !== 200) {
			return classifyStatus(
				answer.status,
				answer.body,
				`NOWPayments did not price $${price} in ${coin}`
			);
		}
		const estimated = decimalField(answer.body, 'estimated_amount');
		return estimated === null
			? unreadable(`the price of $${price} in ${coin}`)
			: { ok: true, value: estimated };
	}

	/**
	 * what an amount of a coin is worth in dollars, at NOWPayments' current rate.
	 *
	 * a refusal here is retryable whatever NOWPayments answered: it values money that already moved,
	 * and the IPN that asked is sent again.
	 */
	async function estimateInDollars(
		coinAmount: string,
		coin: string
	): Promise<PaymentResult<string>> {
		const query = new URLSearchParams({
			amount: coinAmount,
			currency_from: coin,
			currency_to: 'usd'
		});
		const answer = await call('GET', `/v1/estimate?${query}`);
		if ('ok' in answer) return answer;
		const valued = answer.status === 200 ? decimalField(answer.body, 'estimated_amount') : null;
		if (valued !== null) return { ok: true, value: valued };
		return {
			ok: false,
			reason: 'provider_error',
			detail:
				`NOWPayments did not value ${coinAmount} ${coin.toUpperCase()} in dollars, so nothing was ` +
				`settled. The read made again is worth making. NOWPayments said: ${quoteProblem(answer.body)}`
		};
	}

	/** a coin's floor against the payout coin, in coin units and in dollars. */
	async function minimumFor(coin: string): Promise<PaymentResult<Minimum>> {
		const query = new URLSearchParams({
			currency_from: coin,
			currency_to: outcome,
			fiat_equivalent: 'usd',
			is_fixed_rate: 'false',
			is_fee_paid_by_user: 'false'
		});
		const answer = await call('GET', `/v1/min-amount?${query}`);
		if ('ok' in answer) return answer;
		if (answer.status !== 200) {
			return classifyStatus(
				answer.status,
				answer.body,
				`NOWPayments did not answer the minimum for ${coin}`
			);
		}
		const coinAmount = decimalField(answer.body, 'min_amount');
		const dollars = decimalField(answer.body, 'fiat_equivalent');
		if (coinAmount === null || dollars === null) return unreadable(`the minimum for ${coin}`);
		return { ok: true, value: { coinAmount, dollars } };
	}
}

const NO_REPEATING_GIFTS =
	'A crypto gift through NOWPayments is one deposit, and nothing on the account collects again. Nothing was asked of NOWPayments.';
const NO_LISTENER_ARMS =
	'NOWPayments registers no webhook endpoint on the account: each payment carries the address it notifies. Nothing was asked of NOWPayments.';
const NO_WALLETS =
	'NOWPayments draws no wallet, so there is no hostname to register. Nothing was asked of NOWPayments.';

const SIGNATURE_HEADER = 'x-nowpayments-sig';

/**
 * whether `signature` is NOWPayments' HMAC-SHA512, under the trimmed secret, of `body` parsed, its
 * object keys sorted at every depth, and serialised again.
 *
 * the sort is recursive, and arrays stay arrays (`payment_extra_ids` is one), as the SDK's
 * `sortObjectDeep` does (https://github.com/NowPaymentsIO/nowpayments-sdk-nodejs, src/ipn.js). the
 * collection's prose form — a replacer array of top-level keys — blanks `fee`, and its Node sample
 * sorts an array into an object; each verifies nothing NOWPayments signed.
 *
 * the digest is taken over what `JSON.parse` and `JSON.stringify` make of the body, not over its
 * bytes, so a number whose double prints differently from how it was sent — more than seventeen
 * significant digits, an exponent — verifies only where NOWPayments' serialiser printed it the same
 * way. the SDK carries the same residual. the converse holds too: `5745459419.0` and `5.745459419e9`
 * verify under the signature for `5745459419`. amounts are read from the body separately, as sent
 * (`parseWithSource`), and a payment id read any way but as digits is refused (`paymentIdField`).
 *
 * the compare is `crypto.subtle.verify`'s, which does not stop at the first differing byte.
 */
async function verifies(secret: string, signature: string, body: string): Promise<boolean> {
	const expected = signature.trim();
	if (!/^[0-9a-f]{128}$/i.test(expected)) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return false;
	}
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-512' },
		false,
		['verify']
	);
	let signed: string;
	try {
		signed = JSON.stringify(sortedDeep(parsed));
	} catch {
		// nesting deeper than the stack: a `RangeError`, and nothing NOWPayments sends.
		return false;
	}
	return crypto.subtle.verify('HMAC', key, hexBytes(expected), encoder.encode(signed));
}

function sortedDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortedDeep);
	if (typeof value !== 'object' || value === null) return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		sorted[key] = sortedDeep((value as Record<string, unknown>)[key]);
	}
	return sorted;
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/** a request refused before anything is asked of NOWPayments, or null for one that may be sent. */
function invalidRequest(
	request: IntentRequest,
	coin: string,
	donationId: string
): PaymentFailure | null {
	const refuse = (detail: string): PaymentFailure => ({
		ok: false,
		reason: 'invalid_request',
		detail
	});
	if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
		return refuse(
			`A payment is a positive amount in cents, and ${request.amountMinor} is not one. No address was created.`
		);
	}
	if (request.currency !== 'USD') {
		return refuse(
			`A crypto gift is priced in USD, and this request named ${request.currency}. No address was created.`
		);
	}
	if (coin === '') {
		return refuse(
			'A crypto gift names the coin the donor pays in, and this request named none. No address was created.'
		);
	}
	if (donationId === '') {
		return refuse(
			`A crypto payment carries the gift it pays for as \`order_id\`, and this request's metadata named no \`${DONATION_METADATA_KEY}\`. No address was created.`
		);
	}
	return null;
}

/**
 * a payout coin NOWPayments does not know. no gift can be checked against a minimum without it, so
 * the coin list refuses as well as the create: served, crypto would fail every quote at the last step.
 */
function outcomeUnknown(outcome: string): PaymentFailure {
	return {
		ok: false,
		reason: 'not_configured',
		detail:
			`\`NOWPAYMENTS_OUTCOME_CURRENCY\` is \`${outcome}\`, which is no coin code NOWPayments knows, so ` +
			'no crypto gift can be checked against its minimum and none is taken. Set it to the ' +
			'lowercase code of the payout wallet under Payment Settings in the NOWPayments dashboard, ' +
			'such as `usdttrc20`.'
	};
}

function coinNotAccepted(coin: string): PaymentFailure {
	return {
		ok: false,
		reason: 'coin_not_accepted',
		detail: `This organisation’s NOWPayments account takes no payment in \`${coin}\` today. No address was created.`
	};
}

/**
 * a create NOWPayments refused, with its two refusals about the amount named as such.
 *
 * `AMOUNT_MINIMAL_ERROR` is NOWPayments' code for a price under the coin's floor, reachable where the
 * rate moved between the estimate and the create. no call reports a coin's ceiling — `full-currencies`
 * carries an `is_maxlimit` flag and no figure — so a refusal naming a maximum is the only place one
 * surfaces.
 */
function refusedPayment(answer: Answer, price: string, coin: string): PaymentFailure {
	const said = quoteProblem(answer.body);
	if (answer.status === 400 && stringField(answer.body, 'code') === 'AMOUNT_MINIMAL_ERROR') {
		return {
			ok: false,
			reason: 'below_minimum',
			detail: `A gift of $${price} is under what NOWPayments accepts in ${coin.toUpperCase()}. No address was created. NOWPayments said: ${said}`
		};
	}
	// the code NOWPayments refuses a price over a coin's ceiling with is unconfirmed until the test
	// gift, so the match is on its prose and the refusal is logged as NOWPayments wrote it — status and
	// message, which carry no key — for that gift to confirm the code by.
	if (answer.status === 400 && /maxim/i.test(said)) {
		console.warn('NOWPayments refused a payment as over a maximum:', answer.status, said);
		return {
			ok: false,
			reason: 'above_maximum',
			detail: `A gift of $${price} is over what NOWPayments accepts in ${coin.toUpperCase()}. No address was created. NOWPayments said: ${said}`
		};
	}
	return classifyStatus(answer.status, answer.body, 'NOWPayments did not create the payment');
}

/**
 * a created payment, as the quote endpoint needs it.
 *
 * `payment_id` is text on this answer and a number on a status read; either is carried as its
 * digits. the expiry is `valid_until`, and where a payment carries none, `created_at` plus the seven
 * days a floating-rate address is watched for.
 */
function intentOf(
	payment: unknown,
	donationId: string,
	asked: string,
	networkName: (network: string) => string,
	decimals: number | null,
	gift: GiftSplit
): PaymentResult<Intent> {
	const id = digitsOrNull(paymentIdField(payment, 'payment_id'));
	const address = stringField(payment, 'pay_address');
	const coin = stringField(payment, 'pay_currency')?.toLowerCase() ?? null;
	const network = stringField(payment, 'network');
	const coinAmount = decimalField(payment, 'pay_amount');
	const validUntil =
		dateOf(stringField(payment, 'valid_until')) ??
		plusDays(dateOf(stringField(payment, 'created_at')), 7);
	if (
		id === null ||
		address === null ||
		coin === null ||
		network === null ||
		coinAmount === null ||
		validUntil === null
	) {
		return unreadable('the payment it created');
	}
	// an address handed to the donor for another coin or another gift is a deposit nothing settles.
	if (coin !== asked || stringField(payment, 'order_id') !== donationId) {
		return unreadable(`a payment in ${coin} for another gift or coin than the one asked for`);
	}
	const places = centPlaces(coinAmount, decimalField(payment, 'price_amount'), decimals);
	const giftCoinAmount = giftAmount(coinAmount, places, gift.giftMinor, gift.totalMinor);
	return {
		ok: true,
		value: {
			providerTxnId: id,
			paymentToken: donationId,
			deposit: {
				address,
				memo: idField(payment, 'payin_extra_id'),
				coin,
				network: networkName(network),
				coinAmount: askedAmount(coinAmount, places),
				...(giftCoinAmount === null ? {} : { giftCoinAmount }),
				validUntil
			}
		}
	};
}

/**
 * how the charge splits, in the cents the request was priced in: the donor's own figure, and the
 * whole of what they are paying.
 *
 * `giftMinor` is null where the request stated none — unknown, never "no fee", so the deposit states
 * the total alone rather than a split guessed at.
 */
type GiftSplit = { readonly giftMinor: number | null; readonly totalMinor: number };

/**
 * the split off the request that is about to be paid.
 *
 * read off the metadata the same call writes onto the payment, because that is where this app states
 * the donor's own figure — the charge is minted at the grossed-up total and the gift has no field of
 * its own (`GIFT_MINOR_METADATA_KEY` in ./provider.ts). anything but a plain count of cents is
 * unreadable rather than coerced: it is the numerator of a figure a donor reads.
 */
function giftSplitOf(request: IntentRequest): GiftSplit {
	const stated = request.metadata?.[GIFT_MINOR_METADATA_KEY] ?? '';
	const giftMinor = /^\d+$/.test(stated) ? Number(stated) : Number.NaN;
	return {
		giftMinor: Number.isSafeInteger(giftMinor) ? giftMinor : null,
		totalMinor: request.amountMinor
	};
}

/**
 * the decimal both of a deposit's figures are cut at: the last one worth about a cent, and never
 * more than the coin can be sent in. null where the price or the coin's decimals do not read.
 *
 * `pay_amount` is priced to the coin's full precision — `48.07692308 XRP` — and a donor reads the
 * figure off a screen to type or paste into a wallet. the decimals that matter are the ones a cent
 * buys: at `usd` a unit, the last digit worth about a cent is decimal `floor(log10(usd / 0.01))`,
 * which is 1 for a unit around 52¢ and 7 for one around $100,000.
 *
 * one place for the pair, computed once, because the fee a screen states is the remainder of the two
 * figures either side of it: cut at two places they are two figures whose difference is not the fee.
 *
 * the arithmetic is the digits NOWPayments sent, never a double: `floor(log10(a/b))` is the
 * difference of the two exponents, less one where `a`'s mantissa is the smaller.
 */
function centPlaces(
	coinAmount: string,
	dollars: string | null,
	decimals: number | null
): number | null {
	const price = dollars === null ? null : exactOf(dollars);
	const amount = exactOf(coinAmount);
	if (price === null || amount === null || decimals === null) return null;
	const perUnit =
		exponentOf(price) - exponentOf(amount) - (mantissaCompare(price, amount) < 0 ? 1 : 0);
	return Math.min(decimals, Math.max(perUnit + 2, 0));
}

/**
 * what the donor is asked to send: `pay_amount` at the place a cent buys, rounded up.
 *
 * **up, never down.** this figure is what has to arrive: rounded down, the donor sends short and
 * NOWPayments settles a `partially_paid` deposit against a gift they meant to give in full. rounded
 * up, they send a fraction of a cent more than the payment asked and it settles `finished` at what
 * arrived. nothing NOWPayments refuses is reachable either way — the payment already exists by the
 * time this runs, minted at its own `pay_amount` against the coin's minimum, and no call carries
 * this figure back.
 *
 * the figure NOWPayments sent, unrounded, where there is no place to cut at — the exact amount is
 * always sendable, where a figure rounded on a precision nobody could read is a guess at what a
 * wallet takes.
 */
function askedAmount(coinAmount: string, places: number | null): string {
	return places === null ? coinAmount : roundedUpAt(coinAmount, places);
}

/**
 * the donor's own figure in the coin, cut down at the place the total was cut up, or null where
 * there is no second figure to state (`DepositInstructions.giftCoinAmount` in ./provider.ts).
 *
 * **down, where the total goes up**, at the one place both are cut at: the fee a screen states is
 * the remainder of the two, so bracketing the true figures is what makes the three rows sum exactly
 * as drawn. the direction is also the safe one to be wrong in — the donor is never told they gave
 * more than they did, and the fee they covered is never understated.
 *
 * **nothing is sent from this figure and nothing is settled against it.** what the donor sends is
 * the total, minted and floored by NOWPayments against the coin's minimum before either figure is
 * cut, so cutting this one down reaches no minimum and no payment.
 *
 * null in the four cases the screen has no gift row for: a request that stated no gift; a donor who
 * declined the fee, whose one figure is the total; a gift under the last place shown, which is a
 * coin whose whole unit is most of the gift; and a total cut at no place at all, where a gift cut
 * beside it would be a guess at a precision the coin never named.
 *
 * the arithmetic is the digits NOWPayments sent against the two integer cent figures, never a
 * double: `digits × gift × 10^places / (total × 10^amountPlaces)`, truncated, which is the floor.
 */
function giftAmount(
	coinAmount: string,
	places: number | null,
	giftMinor: number | null,
	totalMinor: number
): string | null {
	const amount = exactOf(coinAmount);
	if (
		amount === null ||
		places === null ||
		giftMinor === null ||
		giftMinor <= 0 ||
		giftMinor >= totalMinor
	) {
		return null;
	}
	const units =
		(amount.digits * BigInt(giftMinor) * 10n ** BigInt(places)) /
		(BigInt(totalMinor) * 10n ** BigInt(amount.places));
	return units === 0n ? null : figureOf(units, places);
}

/** `floor(log10(x))` for a positive decimal: where its most significant digit stands. */
function exponentOf(x: Exact): number {
	return x.digits.toString().length - 1 - x.places;
}

/** which of two positive decimals has the larger mantissa, their exponents set aside. */
function mantissaCompare(a: Exact, b: Exact): number {
	const aDigits = a.digits.toString();
	const bDigits = b.digits.toString();
	const width = Math.max(aDigits.length, bDigits.length);
	const aPadded = aDigits.padEnd(width, '0');
	const bPadded = bDigits.padEnd(width, '0');
	return aPadded === bPadded ? 0 : aPadded < bPadded ? -1 : 1;
}

/** a canonical decimal at `places` decimals, any digit dropped rounding it up. */
function roundedUpAt(amount: string, places: number): string {
	const [whole = '0', fraction = ''] = amount.split('.');
	if (fraction.length <= places) return amount;
	const dropped = fraction.slice(places);
	const kept = BigInt(`${whole}${fraction.slice(0, places)}`) + (/[1-9]/.test(dropped) ? 1n : 0n);
	return figureOf(kept, places);
}

/** a positive count of `places`-decimal units as a canonical decimal (`CoinAmount` in ./provider.ts). */
function figureOf(units: bigint, places: number): string {
	const digits = units.toString().padStart(places + 1, '0');
	const integer = digits.slice(0, digits.length - places);
	const tail = digits.slice(digits.length - places).replace(/0+$/, '');
	return tail === '' ? integer : `${integer}.${tail}`;
}

/**
 * a payment's `payment_status`, to the row's vocabulary, for a payment nothing has arrived on.
 *
 * `finished` and `partially_paid` are absent because they settle what arrived, whatever was asked —
 * and so do `expired` and `failed` with anything sent (`settlementOf`). every other word — `waiting`,
 * `confirming`, `confirmed`, `sending`, `refunded`, a word nobody has documented — reads as
 * `pending`, the direction safe to be wrong in: nothing is posted from it.
 */
const UNPAID_STATUSES: Readonly<Record<string, PaymentStatus>> = Object.freeze({
	expired: 'cancelled',
	failed: 'failed'
});

const ARRIVED_STATUSES = new Set(['finished', 'partially_paid', 'expired', 'failed']);

/** what an IPN names a settlement for; `refunded` and any undocumented word are `ignored`. */
const SETTLEMENT_STATUSES = new Set([
	'waiting',
	'confirming',
	'confirmed',
	'sending',
	'partially_paid',
	'finished',
	'failed',
	'expired'
]);

/** the dollar value of an amount of a coin, where a payment carries none. */
type Estimator = (coinAmount: string, coin: string) => Promise<PaymentResult<string>>;

/**
 * a payment read back, or as an IPN states it — timed `arrivedAt` where it carries no time of its own.
 *
 * what arrived is valued at `actually_paid_at_fiat`, and where that is absent or zero — the
 * collection's own examples carry it absent on a read and zero on an IPN — at NOWPayments' estimate
 * for the amount received. never at $0: a value under a cent is refused, and the read made again.
 */
async function settlementOf(
	payment: unknown,
	estimate: Estimator,
	arrivedAt: Date | null = null
): Promise<PaymentResult<Settlement>> {
	const id = digitsOrNull(paymentIdField(payment, 'payment_id'));
	const asked = decimalField(payment, 'price_amount');
	const occurredAt = timeOf(payment) ?? arrivedAt;
	if (id === null || asked === null || occurredAt === null) return unreadable('a payment');

	const word = stringField(payment, 'payment_status') ?? '';
	const repeatOf = paymentIdField(payment, 'parent_payment_id');
	if (repeatOf === 'unreadable') return unreadable('a repeat deposit whose parent payment id');
	const orderId = stringField(payment, 'order_id');
	const settled = {
		providerTxnId: id,
		method: 'crypto',
		currency: 'USD',
		feeMinor: null,
		metadata: repeatOf === null && orderId !== null ? { [DONATION_METADATA_KEY]: orderId } : {},
		occurredAt
	} as const;
	const unpaid = (): PaymentResult<Settlement> => ({
		ok: true,
		value: {
			...settled,
			status: UNPAID_STATUSES[word] ?? 'pending',
			amountMinor: centsRounded(asked),
			arrival: null
		}
	});

	if (!ARRIVED_STATUSES.has(word)) return unpaid();
	const paid = arrivedAmount(payment);
	if (paid === 'unreadable') return unreadable(`a ${word} payment whose amount received`);
	if (paid === null) return unpaid();

	const coin = stringField(payment, 'pay_currency')?.toLowerCase() ?? null;
	if (coin === null) return unreadable('a payment naming no coin');

	const atArrival = decimalField(payment, 'actually_paid_at_fiat');
	let dollars = atArrival;
	let valuedBy: Arrival['valuedBy'] = 'arrival_rate';
	if (atArrival === null || centsRounded(atArrival) === 0) {
		const estimated = await estimate(paid, coin);
		if (!estimated.ok) return estimated;
		dollars = estimated.value;
		valuedBy = 'processor_estimate';
	}
	if (dollars === null || centsRounded(dollars) === 0) {
		return {
			ok: false,
			reason: 'provider_error',
			detail:
				`NOWPayments values the ${paid} ${coin.toUpperCase()} that arrived on payment ${id} at under a ` +
				'cent, so nothing was settled. The read made again is worth making.'
		};
	}
	return {
		ok: true,
		value: {
			...settled,
			status: 'succeeded',
			amountMinor: centsRounded(dollars),
			feeMinor: feeInCents(field(payment, 'fee'), coin, paid, dollars),
			arrival: { coin, coinAmount: paid, valuedBy, repeatOf }
		}
	};
}

/**
 * what NOWPayments took, in cents, where it names the fee in dollars or in the coin paid in — the one
 * coin this payment carries a dollar rate for, `dollars` for `paid` — or took nothing, which is $0 in
 * any currency. null for a non-zero fee in any other currency, and for one whose parts cannot all be
 * read: no outside price is reached for.
 *
 * `depositFee`, `serviceFee` and `withdrawalFee` share the one `currency`, so the sum is in a coin.
 */
function feeInCents(fee: unknown, coin: string, paid: string, dollars: string): number | null {
	const parts = ['depositFee', 'serviceFee', 'withdrawalFee'].map((key) =>
		exactOf(field(fee, key))
	);
	let total: Exact = { digits: 0n, places: 0 };
	for (const part of parts) {
		if (part === null) return null;
		total = sum(total, part);
	}
	if (total.digits === 0n) return 0;
	const currency = stringField(fee, 'currency')?.toLowerCase() ?? null;
	if (currency !== 'usd' && currency !== coin) return null;
	if (currency === 'usd') return roundedHalfUp(total.digits * 100n, 10n ** BigInt(total.places));
	const rate = exactOf(dollars);
	const received = exactOf(paid);
	if (rate === null || received === null) return null;
	return roundedHalfUp(
		total.digits * rate.digits * 100n * 10n ** BigInt(received.places),
		received.digits * 10n ** BigInt(total.places + rate.places)
	);
}

/** a non-negative decimal as whole digits over a power of ten. */
type Exact = { readonly digits: bigint; readonly places: number };

/** a JSON number or a numeric string, zero included, as an exact decimal; null for anything else. */
function exactOf(found: unknown): Exact | null {
	const text = found instanceof JsonNumber ? found.text : typeof found === 'string' ? found : null;
	if (text === null) return null;
	const canonical = canonicalDecimal(text);
	if (canonical === null) return isZero(text) ? { digits: 0n, places: 0 } : null;
	const [whole = '0', fraction = ''] = canonical.split('.');
	return { digits: BigInt(`${whole}${fraction}`), places: fraction.length };
}

function sum(a: Exact, b: Exact): Exact {
	const places = Math.max(a.places, b.places);
	return {
		digits:
			a.digits * 10n ** BigInt(places - a.places) + b.digits * 10n ** BigInt(places - b.places),
		places
	};
}

function roundedHalfUp(numerator: bigint, denominator: bigint): number {
	return Number((2n * numerator + denominator) / (2n * denominator));
}

function isZero(text: string): boolean {
	return /^\+?0*(\.0*)?([eE][+-]?\d+)?$/.test(text.trim()) && /\d/.test(text);
}

/**
 * `actually_paid` as a canonical amount, `null` where nothing arrived — absent, null or zero — and
 * `'unreadable'` where it is present and not a number: a payment is never recorded as not given over
 * a figure that could not be read.
 */
function arrivedAmount(payment: unknown): string | null | 'unreadable' {
	const found = field(payment, 'actually_paid');
	if (found === undefined || found === null) return null;
	const text = found instanceof JsonNumber ? found.text : typeof found === 'string' ? found : null;
	if (text === null) return 'unreadable';
	const amount = canonicalDecimal(text);
	if (amount !== null) return amount;
	return isZero(text) ? null : 'unreadable';
}

/**
 * what the account holds: the coins it takes payment in, every code NOWPayments knows, and what each
 * network is called.
 */
type CoinLists = {
	readonly payable: ReadonlyMap<string, PayableCoin>;
	readonly known: ReadonlySet<string>;
	/** how many decimals a coin can be sent in, keyed by lowercased code (`decimalsCarried`). */
	readonly decimals: ReadonlyMap<string, number>;
	readonly networkName: (network: string) => string;
};

/** a coin's floor: what NOWPayments will accept in it, and that figure in dollars. */
type Minimum = { readonly coinAmount: string; readonly dollars: string };

/**
 * a network's readable name, off `full-currencies` alone — the list carries no name for a network.
 *
 * `Tether USD (Tron)` names `trx`: the bracket a token on the network carries, the most frequent
 * where tokens disagree and the first listed on a tie. a network no token brackets takes the name of
 * the first unbracketed coin whose ticker is its code (`eth` → `Ethereum`), and one with neither
 * keeps its code, uppercased.
 */
function networkNamesOf(currencies: readonly unknown[]): (network: string) => string {
	const brackets = new Map<string, Map<string, number>>();
	const natives = new Map<string, string>();
	for (const currency of currencies) {
		const network = stringField(currency, 'network');
		const name = stringField(currency, 'name');
		const ticker = stringField(currency, 'ticker')?.toLowerCase();
		const bracket = /\(([^()]+)\)\s*$/.exec(name ?? '')?.[1]?.trim();
		if (name !== null && ticker !== undefined && !name.includes('(') && !natives.has(ticker)) {
			natives.set(ticker, name);
		}
		if (network === null || !bracket) continue;
		const counts = brackets.get(network) ?? new Map<string, number>();
		counts.set(bracket, (counts.get(bracket) ?? 0) + 1);
		brackets.set(network, counts);
	}
	const names = new Map<string, string>();
	for (const [network, counts] of brackets) {
		let best = '';
		for (const [bracket, count] of counts) {
			if (count > (counts.get(best) ?? 0)) best = bracket;
		}
		names.set(network, best);
	}
	return (network) => names.get(network) ?? natives.get(network) ?? network.toUpperCase();
}

/**
 * how many decimals of a coin can actually be sent, off `full-currencies`, or null where neither
 * figure reads.
 *
 * the smaller of `precision` and `network_precision`, which the list carries side by side and
 * disagree on a token — `usdttrc20` is 6 against the 8 beside it. the smaller is the safe one both
 * ways round: `askedAmount` only ever rounds a figure up, so too few decimals asks for a fraction of
 * a cent more, while too many asks for a digit the donor's wallet has nowhere to put.
 */
function decimalsCarried(currency: unknown): number | null {
	const carried = [intField(currency, 'precision'), intField(currency, 'network_precision')].filter(
		(places) => places !== null
	);
	return carried.length === 0 ? null : Math.min(...carried);
}

function acceptedCoinOf(
	currency: unknown,
	networkName: (network: string) => string
): PayableCoin | null {
	const code = stringField(currency, 'code');
	const name = stringField(currency, 'name');
	const network = stringField(currency, 'network');
	const ticker = stringField(currency, 'ticker');
	if (code === null || name === null || network === null || ticker === null) return null;
	if (field(currency, 'enable') !== true || field(currency, 'available_for_payment') !== true) {
		return null;
	}
	return {
		coin: code.toLowerCase(),
		name,
		network: networkName(network),
		ticker: ticker.toLowerCase(),
		memoRequired:
			field(currency, 'extra_id_exists') === true && field(currency, 'extra_id_optional') !== true
	};
}

/**
 * a non-2xx answer, sorted into this app's vocabulary on the status, since NOWPayments' message is
 * the part free to be reworded.
 */
function classifyStatus(status: number, body: unknown, context: string): PaymentFailure {
	const said = `${context}. NOWPayments said: ${quoteProblem(body)}`;
	if (status === 401 || status === 403) {
		return {
			ok: false,
			reason: 'not_configured',
			detail:
				'NOWPayments rejected this deployment’s key: `NOWPAYMENTS_API_KEY` is not a key the account ' +
				`accepts — a sandbox key is the usual cause, since this deployment calls the live API. ${said}`
		};
	}
	if (status === 404) return { ok: false, reason: 'not_found', detail: said };
	if (status === 429) {
		return { ok: false, reason: 'rate_limited', detail: `NOWPayments is rate limiting. ${said}` };
	}
	if (status >= 400 && status < 500) return { ok: false, reason: 'invalid_request', detail: said };
	return { ok: false, reason: 'provider_error', detail: said };
}

/**
 * an error body's `code` and `message`, bounded and on one line.
 *
 * nothing else off it: a problem about a payment can quote the payment, and a payment carries the
 * donor's address.
 */
function quoteProblem(body: unknown): string {
	const said = [stringField(body, 'code'), stringField(body, 'message')]
		.filter((part) => part !== null)
		.join(': ')
		.replace(/\s+/g, ' ')
		.trim();
	if (said === '') return 'nothing this app could read';
	return said.length <= PROVIDER_QUOTE_MAX ? said : `${said.slice(0, PROVIDER_QUOTE_MAX)}…`;
}

function unreachable(error: unknown): PaymentFailure {
	return {
		ok: false,
		reason: 'unreachable',
		detail:
			'No answer came back from NOWPayments, so whether this call took effect is unknown. The ' +
			`identical call made again is what settles it. The transport said: ${messageOf(error)}`
	};
}

function unreadable(what: string): PaymentFailure {
	return {
		ok: false,
		reason: 'provider_error',
		detail: `NOWPayments answered with ${what} in a shape this app cannot read.`
	};
}

function unsupported(detail: string): PaymentFailure {
	return { ok: false, reason: 'unsupported', detail };
}

/** a thrown value, described without becoming a second throw site (`messageOf` in ./paypal.ts). */
function messageOf(error: unknown): string {
	try {
		const said = error instanceof Error ? error.message : String(error);
		return said.replace(/\s+/g, ' ').trim().slice(0, PROVIDER_QUOTE_MAX);
	} catch {
		return 'an error that could not be described';
	}
}

/**
 * a JSON number as the digits NOWPayments sent.
 *
 * parsed into a double, `0.00000001` and a wei-scale amount lose digits before anything can read
 * them; kept as its source text, the amount a donor is shown is the amount NOWPayments asked for.
 */
class JsonNumber {
	readonly text: string;
	constructor(text: string) {
		this.text = text;
	}
}

/**
 * `JSON.parse`, with every number kept as its source text where the runtime hands the reviver one
 * (`context.source`, ES2025), and as the double's own shortest text where it does not.
 */
function parseWithSource(text: string): unknown {
	return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
		typeof value === 'number' ? new JsonNumber(context?.source ?? String(value)) : value
	);
}

function field(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/**
 * a payment id NOWPayments sends as a string on one answer and a number on another, as its digits:
 * null where absent, `'unreadable'` where spelled any other way. a signature covers the number a
 * spelling parses to, never the spelling (`verifies`), so `5.745459419e9` is refused rather than
 * read as a payment of its own.
 */
function paymentIdField(value: unknown, key: string): string | null | 'unreadable' {
	const found = field(value, key);
	if (found === undefined || found === null) return null;
	const text = found instanceof JsonNumber ? found.text : typeof found === 'string' ? found : null;
	return text !== null && /^\d+$/.test(text) ? text : 'unreadable';
}

function digitsOrNull(id: string | null | 'unreadable'): string | null {
	return id === 'unreadable' ? null : id;
}

/** a value NOWPayments sends as a string on one answer and a number on another, as sent. */
function idField(value: unknown, key: string): string | null {
	const found = field(value, key);
	if (found instanceof JsonNumber) return found.text;
	return typeof found === 'string' && found !== '' ? found : null;
}

/** when a payment last moved: `updated_at`, or `created_at` where it carries no update. */
function timeOf(payment: unknown): Date | null {
	return dateOf(stringField(payment, 'updated_at')) ?? dateOf(stringField(payment, 'created_at'));
}

function dateOf(text: string | null): Date | null {
	if (text === null) return null;
	const at = new Date(text);
	return Number.isNaN(at.getTime()) ? null : at;
}

function plusDays(at: Date | null, days: number): Date | null {
	return at === null ? null : new Date(at.getTime() + days * 86_400_000);
}

function stringField(value: unknown, key: string): string | null {
	const found = field(value, key);
	return typeof found === 'string' && found !== '' ? found : null;
}

/** a non-negative whole number off a field NOWPayments sends as a number or as a string. */
function intField(value: unknown, key: string): number | null {
	const found = field(value, key);
	const text = found instanceof JsonNumber ? found.text : typeof found === 'string' ? found : null;
	return text !== null && /^\d+$/.test(text.trim()) ? Number(text) : null;
}

/** a positive amount off a field NOWPayments sends as a number or as a string, as canonical text. */
function decimalField(value: unknown, key: string): string | null {
	const found = field(value, key);
	if (found instanceof JsonNumber) return canonicalDecimal(found.text);
	return typeof found === 'string' ? canonicalDecimal(found) : null;
}

/** which of two canonical decimals is larger: negative, zero or positive, as `sort` reads it. */
function compareDecimals(a: string, b: string): number {
	const [aWhole = '', aFraction = ''] = a.split('.');
	const [bWhole = '', bFraction = ''] = b.split('.');
	if (aWhole.length !== bWhole.length) return aWhole.length - bWhole.length;
	if (aWhole !== bWhole) return aWhole < bWhole ? -1 : 1;
	const width = Math.max(aFraction.length, bFraction.length);
	const aPadded = aFraction.padEnd(width, '0');
	const bPadded = bFraction.padEnd(width, '0');
	return aPadded === bPadded ? 0 : aPadded < bPadded ? -1 : 1;
}

/** a canonical dollar figure in cents, half a cent and over rounded up. */
function centsRounded(dollars: string): number {
	const [whole = '0', fraction = ''] = dollars.split('.');
	const cents = Number(`${whole}${fraction.slice(0, 2).padEnd(2, '0')}`);
	return (fraction[2] ?? '0') >= '5' ? cents + 1 : cents;
}

/** a canonical dollar figure in cents, any fraction of a cent rounded up. */
function centsUp(dollars: string): number {
	const [whole = '0', fraction = ''] = dollars.split('.');
	const cents = Number(`${whole}${fraction.slice(0, 2).padEnd(2, '0')}`);
	return /[1-9]/.test(fraction.slice(2)) ? cents + 1 : cents;
}

/**
 * `12.50`, `1.2e-7` and `0012.5` as the one canonical positive decimal each names (`CoinAmount` in
 * ./provider.ts), moved digit by digit and never through a double. null for anything not a positive
 * decimal.
 */
function canonicalDecimal(text: string): string | null {
	const match = /^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
	if (match === null) return null;
	const whole = match[1] ?? '';
	const fraction = match[2] ?? '';
	const exponent = Number(match[3] ?? '0');
	let digits = `${whole}${fraction}`;
	let point = whole.length + exponent;
	if (point < 0) {
		digits = `${'0'.repeat(-point)}${digits}`;
		point = 0;
	}
	if (point > digits.length) digits = digits.padEnd(point, '0');
	const integer = digits.slice(0, point).replace(/^0+/, '') || '0';
	const decimals = digits.slice(point).replace(/0+$/, '');
	if (integer === '0' && decimals === '') return null;
	return decimals === '' ? integer : `${integer}.${decimals}`;
}
