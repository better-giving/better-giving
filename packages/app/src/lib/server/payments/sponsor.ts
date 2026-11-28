import {
	PAYMENT_METHODS as SETTLED_RAILS,
	PAYMENT_STATUSES,
	type PaymentStatus
} from '../db/schema';
import type { PayoutReturned, PayoutSettled } from '../ledger/payouts';
import {
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	type Intent,
	type IntentRequest,
	type PaymentEvent,
	type PaymentFailure,
	type PaymentFailureReason,
	type PaymentProvider,
	type PaymentResult,
	type ReversalEvent,
	type ReversalRead,
	type SettledRail,
	type Settlement,
	type SponsorFeed,
	type SponsoredGift,
	type WebhookDelivery
} from './provider';

// the sponsor adapter: a hosted charity site whose gifts the fiscal sponsor takes as donee and
// merchant, through the sponsor's partner API at `SPONSOR_API_URL`.
//
// every call is `fetch` — the one this module is handed, so ./sponsor.spec.ts drives it with no
// network — and the events signature is WebCrypto's HMAC, so ./sole-importer.spec.ts has nothing to
// guard here.
//
// **it answers the one-off payment, the payment and reversal reads and the events, and refuses
// everything else** as `unsupported`: a gift that repeats, the account and rail reads (the
// sponsor's readiness is not asked per request), the webhook endpoint arms (provisioning sets
// `SPONSOR_EVENTS_SECRET`, so there is no endpoint to register), the wallet arms, and the coin
// list and estimate (crypto does not route to the sponsor).

/** the sponsor's partner API. */
export const SPONSOR_API_URL = 'https://better.giving/api/partner/v1';

/** a donor is waiting on the answer: `TIMEOUT_MS` in ./paypal.ts argues the figure. */
const TIMEOUT_MS = 12_000;

/** what the adapter needs to talk to the sponsor. */
export type SponsorCredentials = {
	/** `SPONSOR_API_KEY`, sent as a bearer token, never logged, never echoed. */
	readonly apiKey: string;
	/** `SPONSOR_EVENTS_SECRET`, the `whsec_` secret the sponsor signs this site's events with. */
	readonly eventsSecret: string;
	readonly fetch: typeof globalThis.fetch;
};

type Answer = { readonly status: number; readonly body: unknown };

export function createSponsorProvider(credentials: SponsorCredentials): PaymentProvider {
	async function call(
		method: 'GET' | 'POST',
		path: string,
		options: { readonly body?: unknown; readonly idempotencyKey?: string } = {}
	): Promise<Answer | PaymentFailure> {
		let response: Response;
		try {
			response = await credentials.fetch(`${SPONSOR_API_URL}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${credentials.apiKey}`,
					accept: 'application/json',
					...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
					...(options.idempotencyKey === undefined
						? {}
						: { 'idempotency-key': options.idempotencyKey })
				},
				body: options.body === undefined ? null : JSON.stringify(options.body),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (error) {
			return unreachable(error);
		}
		let body: unknown = null;
		try {
			body = await response.json();
		} catch {
			body = null;
		}
		return { status: response.status, body };
	}

	return {
		processor: 'sponsor',

		async createIntent(request: IntentRequest): Promise<PaymentResult<Intent>> {
			const sponsored = request.sponsored;
			if (sponsored === undefined) {
				return {
					ok: false,
					reason: 'invalid_request',
					detail: 'A payment through the sponsor was asked for with no gift to tell it of.'
				};
			}
			const answer = await call('POST', '/payments', {
				body: paymentBody(request, sponsored),
				// the gift id, so a retried press resolves to the payment the first one made.
				idempotencyKey: sponsored.giftId
			});
			if ('ok' in answer) return answer;
			if (answer.status !== 200 && answer.status !== 201) return refusal(answer);
			const id = stringField(answer.body, 'id');
			const token = stringField(field(answer.body, 'client'), 'token');
			if (id === null || token === null) return unreadable('the payment it created');
			const reference = stringField(answer.body, 'reference');
			return {
				ok: true,
				value: {
					providerTxnId: id,
					paymentToken: token,
					...(reference === null ? {} : { reference })
				}
			};
		},

		async verifyEvent(delivery: WebhookDelivery): Promise<PaymentResult<PaymentEvent>> {
			const verified = await verifies(credentials.eventsSecret, delivery, Date.now());
			if (verified !== null) return { ok: false, reason: 'bad_signature', detail: verified };
			return sponsorEvent(parseJson(delivery.body));
		},

		/** `GET /payments/{id}`, a pure read: the sponsor completes its own captures. */
		async readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>> {
			const answer = await call('GET', `/payments/${encodeURIComponent(providerTxnId)}`);
			if ('ok' in answer) return answer;
			if (answer.status !== 200) return refusal(answer);
			const settlement = settlementOf(answer.body);
			return settlement === null
				? unreadable(`payment ${providerTxnId}`)
				: { ok: true, value: settlement };
		},

		prepareRecurringGifts: async () => unsupported(NO_REPEATING_GIFTS),
		readRecurringGiftProvision: async () => unsupported(NO_REPEATING_GIFTS),
		createRecurringGift: async () => unsupported(NO_REPEATING_GIFTS),
		cancelRecurringGift: async () => unsupported(NO_REPEATING_GIFTS),
		readRecurringGift: async () => unsupported(NO_REPEATING_GIFTS),
		/** `GET /reversals/{id}`, for the reversal a refund or dispute event names. */
		async readReversal(event: ReversalEvent): Promise<PaymentResult<ReversalRead>> {
			const answer = await call('GET', `/reversals/${encodeURIComponent(event.providerNoticeId)}`);
			if ('ok' in answer) return answer;
			if (answer.status !== 200) return refusal(answer);
			const reversal = reversalOf(answer.body);
			return reversal === null
				? unreadable(`reversal ${event.providerNoticeId}`)
				: { ok: true, value: reversal };
		},
		readAccountChargeability: async () => unsupported(NO_ACCOUNT_READ),
		readRailSwitchboard: async () => unsupported(NO_ACCOUNT_READ),
		listWebhookEndpoints: async () => unsupported(NO_ENDPOINT),
		registerWebhookEndpoint: async () => unsupported(NO_ENDPOINT),
		resubscribeWebhookEndpoint: async () => unsupported(NO_ENDPOINT),
		replaceWebhookEndpoint: async () => unsupported(NO_ENDPOINT),
		listWalletDomains: async () => unsupported(NO_WALLETS),
		registerWalletDomain: async () => unsupported(NO_WALLETS),
		listPayableCoins: async () => unsupported(NO_COINS),
		estimateCoinValue: async () => unsupported(NO_COINS)
	};
}

const NO_REPEATING_GIFTS = 'This release takes no gift that repeats through the sponsor.';
const NO_ACCOUNT_READ =
	'The sponsor’s readiness is not read per request by this release, so it has no account read.';
const NO_ENDPOINT =
	'The sponsor posts this site’s events to an address provisioning set, so there is no endpoint to register or read.';
const NO_WALLETS = 'This release asks the sponsor nothing about wallet hosts.';
const NO_COINS = 'Crypto gifts do not go through the sponsor.';

/**
 * `GET /events?after=<seq>`, this site's events in commit order — the hourly pull's read, where a
 * delivery was missed (`SPONSOR_EVENTS_SECRET` signs what arrives, and this read is what its key
 * authenticates instead). the envelopes are handed over unread: the caller reads each through
 * `sponsorEvent`. a page with no envelope in it is `unreadable`, since a feed that answers that is
 * one this app cannot page through.
 */
export async function readSponsorFeed(
	credentials: Pick<SponsorCredentials, 'apiKey' | 'fetch'>,
	after: number
): Promise<PaymentResult<SponsorFeed>> {
	let response: Response;
	try {
		response = await credentials.fetch(`${SPONSOR_API_URL}/events?after=${after}`, {
			method: 'GET',
			headers: { authorization: `Bearer ${credentials.apiKey}`, accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		return unreachable(error);
	}
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	if (response.status !== 200) return refusal({ status: response.status, body });
	const events = field(body, 'events');
	const more = field(body, 'has_more');
	if (!Array.isArray(events) || typeof more !== 'boolean') {
		return unreadable(`the events after ${after}`);
	}
	if (events.length === 0) {
		return more
			? unreadable(`an empty page of events after ${after} that says more follow`)
			: { ok: true, value: { events, next: after, more: false } };
	}
	const sequences = events.map((envelope) => field(envelope, 'seq'));
	const last = sequences[events.length - 1];
	if (!sequences.every((seq) => isSeq(seq)) || !isSeq(last) || last < after) {
		return unreadable(`a page of events after ${after} whose sequence numbers do not follow it`);
	}
	return { ok: true, value: { events, next: last, more } };
}

function isSeq(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** how far a delivery's `webhook-timestamp` may be from this server's clock, either way. */
const TOLERANCE_MS = 5 * 60_000;

/**
 * whether a delivery is signed with this site's events secret, under Standard Webhooks
 * (https://www.standardwebhooks.com): `webhook-signature` holds space-separated `v1,<base64>`
 * entries, any of which may match — the sponsor sends two while it rotates the secret — each an
 * HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>` keyed with the base64 after `whsec_`.
 *
 * `null` where it verifies, and otherwise the sentence why not. `crypto.subtle.verify` makes the
 * comparison, which is constant-time.
 */
async function verifies(
	secret: string,
	delivery: WebhookDelivery,
	now: number
): Promise<string | null> {
	const id = delivery.headers['webhook-id'];
	const timestamp = delivery.headers['webhook-timestamp'];
	const signatures = delivery.headers['webhook-signature'];
	if (id === undefined || timestamp === undefined || signatures === undefined) {
		return 'The delivery carried no `webhook-id`, `webhook-timestamp` or `webhook-signature` header.';
	}
	if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > TOLERANCE_MS) {
		return 'The delivery’s `webhook-timestamp` is more than five minutes from this server’s clock.';
	}
	const keyBytes = base64Bytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
	if (keyBytes === null) {
		return '`SPONSOR_EVENTS_SECRET` is not a `whsec_` secret; ask the sponsor for this site’s.';
	}
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	const signed = new TextEncoder().encode(`${id}.${timestamp}.${delivery.body}`);
	for (const entry of signatures.split(' ')) {
		const [version, encoded] = entry.split(',');
		if (version !== 'v1' || encoded === undefined) continue;
		const signature = base64Bytes(encoded);
		if (signature === null) continue;
		if (await crypto.subtle.verify('HMAC', key, signature, signed)) return null;
	}
	return 'No signature on the delivery was made with `SPONSOR_EVENTS_SECRET`.';
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
	try {
		return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

/**
 * a sponsor event envelope `{ id, seq, type, created_at, data }` read into the port's event, for a
 * body this app already trusts: a delivery `verifyEvent` verified, or a page of the sponsor's
 * `GET /events`, which the key authenticates.
 */
export function sponsorEvent(envelope: unknown): PaymentResult<PaymentEvent> {
	const id = stringField(envelope, 'id');
	const type = stringField(envelope, 'type');
	const occurredAt = dateOf(stringField(envelope, 'created_at'));
	if (id === null || type === null || occurredAt === null) return notAnEvent('its envelope');
	const data = field(envelope, 'data');
	const delivered = { id, type, occurredAt };

	if (type === 'payment.settled') {
		const providerTxnId = stringField(data, 'id');
		if (providerTxnId === null) return notAnEvent('a payment with no id');
		return { ok: true, value: { ...delivered, kind: 'settlement', providerTxnId } };
	}
	if (REVERSAL_TYPES.has(type)) {
		const providerNoticeId = stringField(data, 'id');
		if (providerNoticeId === null) return notAnEvent('a reversal with no id');
		return { ok: true, value: { ...delivered, kind: 'reversal', providerNoticeId } };
	}
	if (type === 'payout.settled') {
		const body = payoutSettledOf(data);
		if (body === null) return notAnEvent('a payout');
		return { ok: true, value: { ...delivered, kind: 'payout', payout: { kind: 'settled', body } } };
	}
	if (type === 'payout.returned') {
		const body = payoutReturnedOf(data);
		if (body === null) return notAnEvent('a payout return');
		return {
			ok: true,
			value: { ...delivered, kind: 'payout', payout: { kind: 'returned', body } }
		};
	}
	// a failed or expired payment moved no money, a repeating gift is not taken through the sponsor,
	// and readiness is not stored by this release: nothing here acts on them, nor on a type the
	// contract adds later.
	return { ok: true, value: { ...delivered, kind: 'ignored' } };
}

/**
 * a sponsor *Payment* as the settlement path reads one.
 *
 * the amount is `gift + gift_fee_cover`: the contribution and its cover are the sponsor's and never
 * enter this site's figures. the metadata is rebuilt from `gift_id` and the parts, under the keys
 * ../donations/settle.ts reads, because the sponsor stores none of this app's. `fee` is left null:
 * the sponsor reports it for information, and the site posts none.
 */
function settlementOf(payment: unknown): Settlement | null {
	const id = stringField(payment, 'id');
	const giftId = stringField(payment, 'gift_id');
	const status = stringField(payment, 'status');
	const currency = stringField(payment, 'currency');
	const occurredAt = dateOf(stringField(payment, 'occurred_at'));
	const amount = field(payment, 'amount');
	const gift = field(amount, 'gift');
	const giftFeeCover = field(amount, 'gift_fee_cover');
	if (
		id === null ||
		giftId === null ||
		status === null ||
		!isStatus(status) ||
		currency === null ||
		occurredAt === null ||
		!isMinor(gift) ||
		!isMinor(giftFeeCover)
	) {
		return null;
	}
	const reference = stringField(payment, 'reference');
	const refunded = field(payment, 'also_refunded');
	const reversalId = stringField(refunded, 'reversal_id');
	const refundedAt = dateOf(stringField(refunded, 'occurred_at'));
	return {
		providerTxnId: id,
		status,
		method: settledRail(stringField(payment, 'method')),
		amountMinor: gift + giftFeeCover,
		currency: currency.toUpperCase(),
		feeMinor: null,
		metadata: {
			[DONATION_METADATA_KEY]: giftId,
			[GIFT_MINOR_METADATA_KEY]: String(gift),
			[FEE_COVERED_METADATA_KEY]: giftFeeCover > 0 ? 'true' : 'false'
		},
		...(reference === null ? {} : { reference }),
		occurredAt,
		// crypto does not route to the sponsor, so no payment it settles here arrived as a coin.
		arrival: null,
		...(status === 'succeeded' && reversalId !== null && refundedAt !== null
			? { alsoRefunded: { providerReversalId: reversalId, occurredAt: refundedAt } }
			: {})
	};
}

/**
 * a sponsor *Reversal* as ../donations/reverse.ts reads one.
 *
 * the money is `gift + gift_fee_cover`, as `settlementOf` reads a payment's, so a reversal of the
 * contribution and its cover alone moves nothing here. the sponsor states no dispute fee and links no
 * dashboard: it bears the one and answers the other itself.
 */
function reversalOf(body: unknown): ReversalRead | null {
	const providerReversalId = stringField(body, 'id');
	const reversedTxnId = stringField(body, 'payment_id');
	const giftId = stringField(body, 'gift_id');
	const kind = stringField(body, 'kind');
	const currency = stringField(body, 'currency');
	const occurredAt = dateOf(stringField(body, 'occurred_at'));
	const amount = field(body, 'amount');
	const gift = field(amount, 'gift');
	const giftFeeCover = field(amount, 'gift_fee_cover');
	if (providerReversalId === null) return null;
	if (kind === 'nothing_moved') return { kind, providerReversalId };
	if (
		reversedTxnId === null ||
		giftId === null ||
		currency === null ||
		occurredAt === null ||
		!isMinor(gift) ||
		!isMinor(giftFeeCover)
	) {
		return null;
	}
	const facts = {
		reversedTxnId,
		providerReversalId,
		occurredAt,
		reversedMetadata: { [DONATION_METADATA_KEY]: giftId }
	};
	const amountMinor = gift + giftFeeCover;
	if (
		amountMinor === 0 &&
		(kind === 'refund' || kind === 'dispute_opened' || kind === 'dispute_lost')
	) {
		return { kind: 'nothing_moved', providerReversalId };
	}
	const money = { amountMinor, currency: currency.toUpperCase() };
	const dispute = { feeMinor: null, reason: stringField(body, 'reason'), dashboardUrl: null };
	switch (kind) {
		case 'refund':
			return { ...facts, ...money, kind, feeReturnedMinor: null };
		case 'refund_failed':
			return { ...facts, kind };
		case 'dispute_opened':
			return {
				...facts,
				...money,
				...dispute,
				kind,
				respondBy: dateOf(stringField(body, 'respond_by'))
			};
		case 'dispute_won':
			return { ...facts, kind, feeReturnedMinor: null, feeKeptMinor: null };
		case 'dispute_lost':
			return { ...facts, ...money, ...dispute, kind };
		default:
			return null;
	}
}

function isStatus(word: string): word is PaymentStatus {
	return (PAYMENT_STATUSES as readonly string[]).includes(word);
}

/** the sponsor's method in the `payment.method` column's vocabulary; a wallet settles as a card. */
function settledRail(method: string | null): SettledRail | null {
	if (method === 'apple_pay' || method === 'google_pay') return 'card';
	return SETTLED_RAILS.find((rail) => rail === method) ?? null;
}

/** the event types whose `data` is a reversal, read by its id. */
const REVERSAL_TYPES: ReadonlySet<string> = new Set([
	'payment.refunded',
	'payment.refund_failed',
	'payment.disputed',
	'payment.dispute_closed'
]);

function payoutSettledOf(data: unknown): PayoutSettled | null {
	const payoutId = stringField(data, 'payout_id');
	const amount = field(data, 'amount');
	const currency = stringField(data, 'currency');
	const settledAt = stringField(data, 'settled_at');
	const paymentIds = field(data, 'payment_ids') ?? [];
	if (payoutId === null || !isMinor(amount) || currency === null || dateOf(settledAt) === null) {
		return null;
	}
	if (!Array.isArray(paymentIds) || !paymentIds.every((one) => typeof one === 'string'))
		return null;
	return {
		payout_id: payoutId,
		amount,
		currency,
		settled_at: settledAt as string,
		payment_ids: paymentIds
	};
}

function payoutReturnedOf(data: unknown): PayoutReturned | null {
	const returnId = stringField(data, 'return_id');
	const payoutId = stringField(data, 'payout_id');
	const amount = field(data, 'amount');
	const currency = stringField(data, 'currency');
	const returnedAt = stringField(data, 'returned_at');
	if (
		returnId === null ||
		payoutId === null ||
		!isMinor(amount) ||
		currency === null ||
		dateOf(returnedAt) === null
	) {
		return null;
	}
	return {
		return_id: returnId,
		payout_id: payoutId,
		amount,
		currency,
		returned_at: returnedAt as string
	};
}

function isMinor(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function notAnEvent(what: string): PaymentFailure {
	return {
		ok: false,
		reason: 'invalid_request',
		detail: `The sponsor’s event carried ${what} in a shape this app cannot read.`
	};
}

/** `POST /payments`'s body: the request's figures in the sponsor's spelling. */
function paymentBody(request: IntentRequest, sponsored: SponsoredGift): Record<string, unknown> {
	const { amount, donor, tribute } = sponsored;
	return {
		gift_id: sponsored.giftId,
		amount: {
			gift: amount.gift,
			gift_fee_cover: amount.giftFeeCover,
			contribution: amount.contribution,
			contribution_fee_cover: amount.contributionFeeCover
		},
		currency: request.currency,
		method: request.method,
		...(request.coin === undefined ? {} : { coin: request.coin }),
		contribution_offered: sponsored.contributionOffered,
		deployment_origin: request.deploymentOrigin,
		...(sponsored.pageOrigin === undefined ? {} : { page_origin: sponsored.pageOrigin }),
		...(sponsored.donorIp === undefined ? {} : { donor_ip: sponsored.donorIp }),
		donor: {
			email: donor.email,
			...(donor.firstName === undefined ? {} : { first_name: donor.firstName }),
			...(donor.lastName === undefined ? {} : { last_name: donor.lastName })
		},
		...(tribute === undefined
			? {}
			: {
					tribute: {
						kind: tribute.kind,
						honoree: tribute.honoree,
						...(tribute.notify === undefined ? {} : { notify: tribute.notify })
					}
				}),
		form: sponsored.form,
		...(sponsored.campaign === undefined ? {} : { campaign: sponsored.campaign }),
		...(sponsored.program === undefined ? {} : { program: sponsored.program }),
		...(request.authorizedSessionId === undefined
			? {}
			: { authorized_session_id: request.authorizedSessionId })
	};
}

/**
 * the sponsor's problem `code` to the port's reason, one row per row of the contract's Errors table.
 * `idempotency_conflict` is a key reused against another body, which is this app's own bug.
 */
const REASON_OF_CODE: Readonly<Record<string, PaymentFailureReason>> = Object.freeze({
	key_invalid: 'not_configured',
	invalid_request: 'invalid_request',
	not_found: 'not_found',
	idempotency_conflict: 'internal_error',
	fee_not_ready: 'fee_not_ready',
	authorization_expired: 'authorization_expired',
	unsupported: 'unsupported',
	coin_not_accepted: 'coin_not_accepted',
	below_minimum: 'below_minimum',
	above_maximum: 'above_maximum',
	rate_limited: 'rate_limited',
	provider_error: 'provider_error'
});

/** a non-2xx answer, by its `code`, and by its status where the code is none this app knows. */
function refusal(answer: Answer): PaymentFailure {
	const code = stringField(answer.body, 'code');
	const title = stringField(answer.body, 'title');
	const detail =
		`The sponsor refused the call with ${answer.status}` +
		`${code === null ? '' : ` \`${code}\``}${title === null ? '' : `: ${title.slice(0, 200)}`}.`;
	const reason =
		(code === null ? undefined : REASON_OF_CODE[code]) ?? reasonOfStatus(answer.status);
	if (reason === 'not_configured') {
		return {
			ok: false,
			reason,
			detail: `${detail} \`SPONSOR_API_KEY\` is not a key the sponsor accepts; ask the sponsor for this site’s key.`
		};
	}
	const minimum = field(answer.body, 'minimum_minor');
	if (reason === 'below_minimum' && Number.isSafeInteger(minimum) && (minimum as number) > 0) {
		return { ok: false, reason, detail, minimumMinor: minimum as number };
	}
	return { ok: false, reason, detail };
}

function reasonOfStatus(status: number): PaymentFailureReason {
	if (status === 401 || status === 403) return 'not_configured';
	if (status === 404) return 'not_found';
	if (status === 429) return 'rate_limited';
	if (status >= 400 && status < 500) return 'invalid_request';
	return 'provider_error';
}

function unreachable(error: unknown): PaymentFailure {
	return {
		ok: false,
		reason: 'unreachable',
		detail:
			'No answer came back from the sponsor, so whether this call took effect is unknown. The ' +
			`identical call made again is what settles it. The transport said: ${messageOf(error)}`
	};
}

function unreadable(what: string): PaymentFailure {
	return {
		ok: false,
		reason: 'provider_error',
		detail: `The sponsor answered with ${what} in a shape this app cannot read.`
	};
}

function unsupported(detail: string): PaymentFailure {
	return { ok: false, reason: 'unsupported', detail };
}

/** a thrown value, described without becoming a second throw site (`messageOf` in ./paypal.ts). */
function messageOf(error: unknown): string {
	try {
		const said = error instanceof Error ? error.message : String(error);
		return said.replace(/\s+/g, ' ').trim().slice(0, 200);
	} catch {
		return 'an error that could not be described';
	}
}

function field(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

function stringField(value: unknown, key: string): string | null {
	const found = field(value, key);
	return typeof found === 'string' && found !== '' ? found : null;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function dateOf(text: string | null): Date | null {
	if (text === null) return null;
	const at = new Date(text);
	return Number.isNaN(at.getTime()) ? null : at;
}
