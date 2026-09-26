import { CHARIOT_RAILS } from '@better-giving/form/embed/rails';
import type { PaymentStatus } from '../db/schema';
import type {
	AccountChargeability,
	Intent,
	IntentRequest,
	PaymentEvent,
	PaymentFailure,
	PaymentProvider,
	PaymentResult,
	RailSwitchboard,
	ReversalEvent,
	ReversalRead,
	Settlement,
	WebhookDelivery
} from './provider';

// the Chariot adapter: a gift from a donor-advised fund, taken as a grant through Chariot's DAFpay.
//
// every call is `fetch` against Chariot's REST API and the webhook signature is WebCrypto's HMAC, so
// ./sole-importer.spec.ts has nothing to guard here, and the wire this module speaks is the whole of
// its contract with Chariot.
//
// **a grant is a pledge, and the order is the other way round from a card.** the donor authorizes
// the grant in Chariot's own window first; the server's Create Grant, from the workflow session that
// window handed the browser, is what creates it (`IntentRequest.authorizedSessionId` in
// ./provider.ts); the fund pays the organisation directly weeks later, and a person marks it received
// in Chariot's dashboard, which reaches this deployment as a `grant.updated` delivery. a grant's
// money never passes through Chariot, and Chariot reports no payout of it.
//
// **a DAFpay grant is all of Chariot this deployment reads.** Chariot's Gift Processing can also
// take money into a Chariot account, and a deposit there can come back (a `Deposit` reads `failed`,
// a `CheckDeposit` `returned`, in `specs/2026-04-01.yaml` of the openapi repository below). the
// organisation a deployment serves takes its grants from the fund directly, so no deposit category
// is subscribed to and none is read: a returned Chariot deposit, if one ever happens, is corrected
// by hand in /admin/books, which moves the books and nothing about the gift.
//
// **a grant received and then cancelled is the one reversal, read as a full refund.** a fund's money
// is no longer the donor's — "the concept of refunds after the money leaves the DAF, does not apply"
// (https://docs.givechariot.com/v2026-04-01/guides/dafpay/integrating-dafpay/transactions, "Cancellations
// & Refunds"; its source is `fern/versions/v2026-04-01/pages/integrating-dafpay/transactions.mdx` in
// the openapi repository below) — so the reference has no refund or dispute object and no event
// category for one. what it has is a grant marked received by mistake, which the same page leaves
// room for (a payout can be matched to a grant by little more than fund name and amount), and
// cancelled through Chariot's support after. every `grant.updated` is a `settlement`, and
// `readSettlement` reads a grant cancelled now with a received status in its history as the
// `succeeded` settlement of its receipt carrying the whole of it refunded (`Settlement.alsoRefunded`
// in ./provider.ts), under `<grant id>:canceled` as of its cancellation — Chariot mints no id for
// it, and the grant's own id is the gift's payment row's. the history stands in for the gift's row,
// which this module never reads, so the one answer serves a gift settled here on an earlier delivery
// and one that never was: ../donations/settle.ts settles what is not settled yet, then refunds it. a
// grant cancelled before it was ever received reads `cancelled`, with nothing to refund.
// `readReversal` reads the same grant into the same refund, under the same id; `verifyEvent` names
// no reversal, so no delivery reaches it.
//
// **it answers the one-off grant, the delivery, the reversal read and the account read, and refuses
// everything else** as `unsupported`: a gift that repeats (one-time only — `takesRepeatingGifts` in
// ./provider.ts keeps Chariot out of every repeating-gift read, cadences included), the listener
// arms (the console's binary creates the event subscription with a secret it mints), and the wallet
// arms (Chariot draws no wallet).
//
// **the API takes no version header, so nothing is pinned on the wire.** request and response shapes
// are the `2026-04-01` reference's (https://docs.givechariot.com/v2026-04-01/llms.txt, and
// `specs/2026-04-01.yaml` in https://github.com/chariot-giving/chariot-openapi). that reference
// leaves a grant's `status` an untyped string, and the API itself sends `Initiated`, `Completed` and
// `Canceled` (a sandbox read of every grant on an account, 2026-09-15) — which is the vocabulary
// `GRANT_STATUSES` below reads, case-folded so the reference's lowercase spellings of the same words
// read the same, beside the transactions guide's `Received` and `Cancelled` for the same two states.
//
// **live by default, and nothing here reads a stage.** `CHARIOT_API_URL` unset is
// `https://api.givechariot.com`; the sandbox is another address with its own keys, grants and
// subscriptions, and rehearsing is a second deployment (DEPLOY.md).

/** what the adapter needs to talk to an account. */
export type ChariotCredentials = {
	/** `CHARIOT_API_KEY`. server-only, sent as a bearer token, never logged, never echoed. */
	readonly apiKey: string;
	/** `CHARIOT_API_URL`, or the live address where it is unset (./factory.ts). */
	readonly apiUrl: string;
	/**
	 * `CHARIOT_WEBHOOK_SECRET` — the event subscription's signing secret, or `null` where the
	 * deployment holds none.
	 *
	 * nullable for `StripeCredentials.webhookSecret`'s reason in ./stripe.ts: it is sent on no call
	 * and read by `verifyEvent` alone, which is where its absence is refused.
	 */
	readonly webhookSecret: string | null;
};

/** the address a deployment with no `CHARIOT_API_URL` calls. */
export const CHARIOT_LIVE_API_URL = 'https://api.givechariot.com';

/**
 * the one event category this app acts on, and the one the console's subscription is created for.
 *
 * a status change arrives as `grant.updated`, and a grant this app created is already on its row by
 * the time any change could matter. every other category is answered `ignored`.
 */
export const SETTLEMENT_CATEGORY = 'grant.updated';

/** a donor is waiting on the answer: `TIMEOUT_MS` in ./paypal.ts argues the figure. */
const TIMEOUT_MS = 12_000;

/** how much of a sentence Chariot wrote a message of ours may repeat. */
const PROVIDER_QUOTE_MAX = 200;

/**
 * the waits between asking again while Chariot answers 409 — still processing an earlier Create
 * Grant for the same session.
 *
 * asking again is safe because Chariot creates at most one grant per session and answers a repeat
 * with the grant it holds.
 */
const CONFLICT_DELAYS_MS = [500, 1_000, 2_000] as const;

/**
 * how long Create Grant may take in all, every call and every wait between them.
 *
 * the form stops waiting at 30 seconds (`PORT_TIMEOUT_MS` in packages/form/src/checkout.machine.ts),
 * and the gift is written and answered after this returns, so the deadline stops well short of it.
 */
const GRANT_DEADLINE_MS = 20_000;

/**
 * a grant's `status`, case-folded, to the row's vocabulary.
 *
 * `completed` is the grant marked received in Chariot's dashboard, the one status money moved on.
 * `canceled` is the fund cancelling it. `received` and `cancelled` are the DAFpay transactions
 * guide's spellings of the same two (https://docs.givechariot.com/v2026-04-01/guides/dafpay/integrating-dafpay/transactions).
 * every other word — `initiated`, the reference's `awaiting_*`, a word nobody has documented yet —
 * is a grant still on its way and reads as `pending`, which is the direction safe to be wrong in:
 * nothing is posted from `pending`, and the next delivery re-reads.
 */
const GRANT_STATUSES: Readonly<Record<string, PaymentStatus>> = Object.freeze({
	completed: 'succeeded',
	received: 'succeeded',
	canceled: 'cancelled',
	cancelled: 'cancelled'
});

const SIGNATURE_HEADER = 'chariot-webhook-signature';

/**
 * the timestamp form Chariot signs with. the signed message is the header's `t` exactly as sent, so
 * it is matched here and never reparsed into a date that would serialise differently.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** an answer Chariot gave, read as far as its status and its JSON. */
type Answer = { readonly status: number; readonly body: unknown };

export function createChariotProvider(credentials: ChariotCredentials): PaymentProvider {
	const base = credentials.apiUrl.replace(/\/+$/, '');

	/** one call, answered with Chariot's status and body, or with the failure of never getting one. */
	async function call(
		method: 'GET' | 'POST',
		path: string,
		body?: unknown,
		deadline?: AbortSignal
	): Promise<Answer | PaymentFailure> {
		let response: Response;
		try {
			response = await fetch(`${base}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${credentials.apiKey}`,
					accept: 'application/json',
					...(body === undefined ? {} : { 'content-type': 'application/json' })
				},
				body: body === undefined ? null : JSON.stringify(body),
				signal:
					deadline === undefined
						? AbortSignal.timeout(TIMEOUT_MS)
						: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deadline])
			});
		} catch (error) {
			return unreachable(error);
		}
		// a body that is not JSON is read as nothing rather than thrown: every caller reads fields off
		// it, and a missing field is already a refusal with a sentence of its own.
		let parsed: unknown = null;
		try {
			parsed = await response.json();
		} catch {
			parsed = null;
		}
		return { status: response.status, body: parsed };
	}

	/** Get Grant, answered with the grant's body as Chariot sent it. */
	async function getGrant(grantId: string): Promise<PaymentResult<unknown>> {
		const answer = await call('GET', `/v1/grants/${encodeURIComponent(grantId)}`);
		if ('ok' in answer) return answer;
		if (answer.status !== 200) {
			return classifyStatus(answer.status, answer.body, `Chariot did not return grant ${grantId}`);
		}
		return { ok: true, value: answer.body };
	}

	return {
		processor: 'chariot',

		/**
		 * Create Grant, from the donor's session and the server's amount.
		 *
		 * `idempotencyKey` is not sent, and nothing is lost by it: Chariot creates at most one grant per
		 * workflow session and answers a repeat 200 with the grant it holds, so the session is the key.
		 * no metadata is sent either — Create Grant takes none — and the gift the grant belongs to is
		 * the row the caller binds the returned id to.
		 *
		 * `paymentToken` is the grant id: there is nothing left for a browser to confirm, and the id
		 * authorises nothing.
		 */
		async createIntent(request: IntentRequest): Promise<PaymentResult<Intent>> {
			const amount = request.amountMinor;
			// a fund takes whole dollars and Chariot refuses anything else; a figure short of that is
			// this app's pricing gone wrong, and is refused before it leaves.
			if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 100 !== 0) {
				return {
					ok: false,
					reason: 'invalid_request',
					detail: `A grant is a whole-dollar amount in cents, and ${amount} is not one. No grant was created.`
				};
			}
			if (request.currency !== 'USD') {
				return {
					ok: false,
					reason: 'invalid_request',
					detail: `A grant is made in USD, and this request named ${request.currency}. No grant was created.`
				};
			}
			const session = request.authorizedSessionId?.trim();
			if (session === undefined || session === '') {
				return {
					ok: false,
					reason: 'invalid_request',
					detail:
						'A grant is created from the session the donor finished in Chariot’s window, and ' +
						'this request named none. No grant was created.'
				};
			}

			const deadline = new AbortController();
			const timer = setTimeout(
				() => deadline.abort(new DOMException('the grant deadline passed', 'TimeoutError')),
				GRANT_DEADLINE_MS
			);
			const createGrant = () =>
				call('POST', '/v1/grants', { workflowSessionId: session, amount }, deadline.signal);
			let answer = await createGrant();
			for (const delay of CONFLICT_DELAYS_MS) {
				if ('ok' in answer || answer.status !== 409) break;
				await pause(delay, deadline.signal);
				if (deadline.signal.aborted) break;
				answer = await createGrant();
			}
			clearTimeout(timer);
			if ('ok' in answer) return answer;

			// `unreachable` because the grant may be about to exist, which is what that reason tells a
			// caller: whether the call took effect is unknown.
			if (answer.status === 409) {
				return {
					ok: false,
					reason: 'unreachable',
					detail:
						'Chariot is still processing the grant for this session and did not finish while ' +
						'this call waited, so whether a grant exists is unknown. The identical call made ' +
						'again answers the grant once it exists, ' +
						`and no second grant can be created for one session. Chariot said: ${quoteProblem(answer.body)}`
				};
			}
			// a 404 is a session Chariot never issued, and falls through to `classifyStatus` as
			// `not_found`: nothing about it says the donor's approval ran out.
			if (answer.status === 410) {
				return {
					ok: false,
					reason: 'authorization_expired',
					detail:
						'The donor authorized this grant in Chariot’s window more than 15 minutes ago, so ' +
						'Chariot no longer holds the authorization and no grant was created. The donor has ' +
						`to give through the fund’s window again. Chariot said: ${quoteProblem(answer.body)}`
				};
			}
			if (answer.status !== 200 && answer.status !== 201) {
				return classifyStatus(answer.status, answer.body, 'Chariot did not create the grant');
			}

			const id = stringField(answer.body, 'id');
			if (id === null) return unreadable('the grant it created');
			return { ok: true, value: { providerTxnId: id, paymentToken: id } };
		},

		/**
		 * checks a delivery's `Chariot-Webhook-Signature` and says which grant it is about.
		 *
		 * HMAC-SHA256 over `t + "." + body` with the subscription's signing secret, against every `v1`
		 * value the header carries — several is a secret mid-rotation, and any one matching is Chariot
		 * vouching for the body. schemes other than `v1` are ignored, so a downgrade verifies nothing.
		 * `crypto.subtle.verify` does the comparison, which is constant-time.
		 *
		 * **no replay window.** Chariot's reference sets none, and a genuine delivery replayed does
		 * nothing but re-read the grant's current state, which is idempotent; a window would instead
		 * refuse Chariot's own redeliveries if they carry the first attempt's signature, which the
		 * reference does not say they don't.
		 *
		 * the payload is thin — an id, a category and the object it is about — so nothing but those is
		 * read off it, and nothing is asked of Chariot: what the grant now is, a cancellation after its
		 * receipt included, is the settlement read's (the header).
		 */
		async verifyEvent(delivery: WebhookDelivery): Promise<PaymentResult<PaymentEvent>> {
			// `not_configured` rather than `bad_signature`, which holds the delivery open across the
			// redelivery window an operator sets the value inside (`verifyEvent` in ./stripe.ts).
			if (credentials.webhookSecret === null) {
				return {
					ok: false,
					reason: 'not_configured',
					detail:
						'This deployment cannot check that a payment notification came from Chariot: ' +
						'`CHARIOT_WEBHOOK_SECRET` is not set, so the delivery was refused and its body was ' +
						'not read. Open the console (`better-giving start`) and set Chariot up under Donation ' +
						'processor, which creates the subscription and stores its secret.'
				};
			}

			const header = delivery.headers[SIGNATURE_HEADER];
			const signed = header === undefined ? null : parseSignature(header);
			if (signed === null) {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						`The request carried no readable \`${SIGNATURE_HEADER}\` header — a \`t=\` time in ` +
						'ISO-8601 and at least one `v1=` signature — so its body was not read. This endpoint ' +
						'is public: an unverified delivery is anyone’s delivery.'
				};
			}

			if (!(await verifies(credentials.webhookSecret, signed, delivery.body))) {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						'The delivery did not verify against `CHARIOT_WEBHOOK_SECRET`, so its body was not ' +
						'read. If this deployment’s own subscription is failing, the secret set here is not ' +
						'the one the subscription was created with.'
				};
			}

			const event = parseJson(delivery.body);
			const id = stringField(event, 'id');
			const category = stringField(event, 'category');
			// the reference requires no field on an Event, so one with no readable time is dated by
			// its arrival.
			const occurredAt = dateOf(stringField(event, 'created_at')) ?? new Date();
			// `unsupported`, which `settleDelivery` in ../donations/settle.ts answers 200: the same
			// signed bytes read the same on every redelivery, and Chariot redelivers any non-2xx
			// toward disabling the endpoint.
			if (id === null || category === null) {
				return {
					ok: false,
					reason: 'unsupported',
					detail:
						'The delivery’s signature verified and its body names no `id` or no `category`, so ' +
						'it is not an event this app can act on and nothing was read or written. The signing ' +
						'secret is not the problem.'
				};
			}

			const grantId = stringField(event, 'associated_object_id');
			if (
				category === SETTLEMENT_CATEGORY &&
				stringField(event, 'associated_object_type') === 'grant' &&
				grantId !== null
			) {
				return {
					ok: true,
					value: { id, kind: 'settlement', type: category, occurredAt, providerTxnId: grantId }
				};
			}
			return { ok: true, value: { id, kind: 'ignored', type: category, occurredAt } };
		},

		/** Get Grant, read into the row's vocabulary. */
		async readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>> {
			const grant = await getGrant(providerTxnId);
			return grant.ok ? settlementOf(grant.value) : grant;
		},

		/**
		 * what a key that works can say, since Chariot publishes no approval to read.
		 *
		 * a key the account at the address accepts takes grants, so the answer is the `daf` rail
		 * active. the list read at one result is the cheapest call the key authorises, and it is what
		 * turns a key and an address that do not belong together — a sandbox key against the live
		 * address — into a refusal naming both.
		 */
		async readAccountChargeability(): Promise<PaymentResult<AccountChargeability>> {
			const answer = await call('GET', '/v1/grants?pageLimit=1');
			if ('ok' in answer) return answer;
			if (answer.status !== 200) {
				return classifyStatus(answer.status, answer.body, 'Chariot did not read the account');
			}
			return {
				ok: true,
				value: {
					chargesEnabled: true,
					rails: Object.fromEntries(CHARIOT_RAILS.map((rail) => [rail, 'active']))
				}
			};
		},

		/**
		 * Chariot keeps no switch for the rail, so it is reported on, and asks nothing: the two reads
		 * are issued together (./rail-chargeability.ts), and a failure here would be the one
		 * `readAccountChargeability` already reports.
		 */
		async readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>> {
			return {
				ok: true,
				value: Object.fromEntries(
					CHARIOT_RAILS.map((rail) => [rail, { offered: true, switchedOn: true }])
				)
			};
		},

		prepareRecurringGifts: async () => unsupported(NO_REPEATING_GRANTS),
		readRecurringGiftProvision: async () => unsupported(NO_REPEATING_GRANTS),
		createRecurringGift: async () => unsupported(NO_REPEATING_GRANTS),
		cancelRecurringGift: async () => unsupported(NO_REPEATING_GRANTS),
		readRecurringGift: async () => unsupported(NO_REPEATING_GRANTS),
		async readReversal(event: ReversalEvent): Promise<PaymentResult<ReversalRead>> {
			const grant = await getGrant(event.providerNoticeId);
			return grant.ok ? reversalOf(grant.value) : grant;
		},
		listWebhookEndpoints: async () => unsupported(NO_LISTENER_ARMS),
		registerWebhookEndpoint: async () => unsupported(NO_LISTENER_ARMS),
		resubscribeWebhookEndpoint: async () => unsupported(NO_LISTENER_ARMS),
		replaceWebhookEndpoint: async () => unsupported(NO_LISTENER_ARMS),
		listWalletDomains: async () => unsupported(NO_WALLETS),
		registerWalletDomain: async () => unsupported(NO_WALLETS),
		listPayableCoins: async () =>
			unsupported(
				'A grant is made in dollars, so there is no coin list to read. Nothing was asked of Chariot.'
			)
	};
}

const NO_REPEATING_GRANTS =
	'This release takes one-time grants through Chariot and no gift that repeats. Nothing was asked of Chariot.';
const NO_LISTENER_ARMS =
	'This deployment’s Chariot event subscription is created from the console (`better-giving start`), ' +
	'not from here. Nothing was asked of Chariot.';
const NO_WALLETS =
	'Chariot draws no wallet, so there is no hostname to register. Nothing was asked of Chariot.';

/** a wait that ends early when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}

/** a `t=` and every `v1=` off a signature header, or `null` where either is missing or malformed. */
type SignatureHeader = { readonly timestamp: string; readonly v1: readonly string[] };

function parseSignature(header: string): SignatureHeader | null {
	let timestamp: string | null = null;
	const v1: string[] = [];
	for (const element of header.split(',')) {
		// the first `=` only: an ISO-8601 offset carries none, and a value is never split further.
		const at = element.indexOf('=');
		if (at === -1) continue;
		const scheme = element.slice(0, at).trim();
		const value = element.slice(at + 1).trim();
		if (scheme === 't') timestamp = value;
		else if (scheme === 'v1') v1.push(value);
	}
	if (timestamp === null || !ISO_8601.test(timestamp) || v1.length === 0) return null;
	return { timestamp, v1 };
}

async function verifies(secret: string, signed: SignatureHeader, body: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	const message = encoder.encode(`${signed.timestamp}.${body}`);
	for (const signature of signed.v1) {
		if (await crypto.subtle.verify('HMAC', key, hexBytes(signature), message)) return true;
	}
	return false;
}

/** a value that is not hex, or not a digest's length, decodes to bytes no HMAC verifies against. */
function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++)
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

function settlementOf(grant: unknown): PaymentResult<Settlement> {
	const id = stringField(grant, 'id');
	const amount = field(grant, 'amount');
	if (id === null || !isPositiveCents(amount)) return unreadable('a grant');

	const refunded = isCancelledAfterReceipt(grant);
	const status = refunded ? 'succeeded' : statusOf(stringField(grant, 'status'));
	const occurredAt = occurredAtOf(grant, status);
	const cancelledAt = refunded ? occurredAtOf(grant, 'cancelled') : null;
	if (occurredAt === null || (refunded && cancelledAt === null)) {
		return unreadable('a grant carrying no time');
	}

	// the sandbox puts it on every grant from Create Grant onward, whatever its status; the reference
	// leaves it optional, so a grant without one still settles.
	const trackingId = stringField(grant, 'trackingId');

	return {
		ok: true,
		value: {
			providerTxnId: id,
			status,
			method: 'daf',
			amountMinor: amount,
			currency: 'USD',
			// the fee on a grant still on its way is an estimate and a cancelled grant carries none, so
			// only a received grant's is money the organisation does not keep — read off the grant as it
			// is now, which a grant cancelled after its receipt may no longer carry.
			feeMinor: status === 'succeeded' ? feeOf(grant) : null,
			// what a browser wrote on the grant in Chariot's window is never this app's own record:
			// the gift a grant belongs to is the row the server bound the grant id to.
			metadata: {},
			...(trackingId !== null && { reference: trackingId }),
			occurredAt,
			arrival: null,
			...(cancelledAt !== null && {
				alsoRefunded: { providerReversalId: cancellationIdOf(id), occurredAt: cancelledAt }
			})
		}
	};
}

/**
 * a received grant read cancelled, as the refund of the whole of what it settled; any other grant as
 * nothing moved.
 */
function reversalOf(grant: unknown): PaymentResult<ReversalRead> {
	const id = stringField(grant, 'id');
	if (id === null) return unreadable('a grant');
	const providerReversalId = cancellationIdOf(id);
	if (!isCancelledAfterReceipt(grant))
		return { ok: true, value: { kind: 'nothing_moved', providerReversalId } };
	const occurredAt = occurredAtOf(grant, 'cancelled');
	if (occurredAt === null) return unreadable('a grant carrying no time');
	return {
		ok: true,
		value: {
			kind: 'refund',
			reversedTxnId: id,
			providerReversalId,
			occurredAt,
			// `Settlement.metadata`'s rule, as `settlementOf` reads it: the grant's is a browser's.
			reversedMetadata: {},
			amountMinor: null,
			currency: 'USD',
			feeReturnedMinor: null
		}
	};
}

/** the refund id of a received grant's cancellation (the header). */
function cancellationIdOf(grantId: string): string {
	return `${grantId}:canceled`;
}

/** a grant read cancelled now whose status history says it was received first. */
function isCancelledAfterReceipt(grant: unknown): boolean {
	const history = field(grant, 'statuses');
	return (
		statusOf(stringField(grant, 'status')) === 'cancelled' &&
		Array.isArray(history) &&
		history.some((entry) => statusOf(stringField(entry, 'status')) === 'succeeded')
	);
}

function statusOf(word: string | null): PaymentStatus {
	return (word !== null && GRANT_STATUSES[word.toLowerCase()]) || 'pending';
}

/**
 * every itemised contribution added up — Chariot's, the fund's, an application's — because each is
 * money the organisation does not keep out of the grant.
 *
 * `feeDetail.total` is not read: the breakdown is the figure, and a total disagreeing with it is the
 * one to doubt. null where there is no breakdown or one of its amounts is not whole cents, which the
 * settlement path posts without a fee and tells an operator about.
 */
function feeOf(grant: unknown): number | null {
	const contributions = field(field(grant, 'feeDetail'), 'contributions');
	if (!Array.isArray(contributions)) return null;
	let total = 0;
	for (const contribution of contributions) {
		const amount = field(contribution, 'amount');
		if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
		total += amount;
	}
	return total;
}

/**
 * when the grant last entered a status read as `status`, off its status history; the grant's own
 * last update where the history does not say.
 */
function occurredAtOf(grant: unknown, status: PaymentStatus): Date | null {
	const history = field(grant, 'statuses');
	if (Array.isArray(history)) {
		const entered = history
			.filter((entry) => statusOf(stringField(entry, 'status')) === status)
			.at(-1);
		const at = dateOf(stringField(entered, 'createdAt'));
		if (at !== null) return at;
	}
	return dateOf(stringField(grant, 'updatedAt')) ?? dateOf(stringField(grant, 'createdAt'));
}

/**
 * a non-2xx answer, sorted into this app's vocabulary on the status, since Chariot's problem body is
 * the part free to be reworded.
 *
 * 401 and 403 name both values, because the ordinary cause is a key from one of Chariot's two
 * environments against the other's address.
 */
function classifyStatus(status: number, body: unknown, context: string): PaymentFailure {
	const said = `${context}. Chariot said: ${quoteProblem(body)}`;
	if (status === 401 || status === 403) {
		return {
			ok: false,
			reason: 'not_configured',
			detail:
				'Chariot rejected this deployment’s key: `CHARIOT_API_KEY` is not one the account at ' +
				`\`CHARIOT_API_URL\` accepts — a sandbox key against the live address is the usual cause. ${said}`
		};
	}
	if (status === 404) return { ok: false, reason: 'not_found', detail: said };
	if (status === 429) {
		return { ok: false, reason: 'rate_limited', detail: `Chariot is rate limiting. ${said}` };
	}
	if (status >= 400 && status < 500) return { ok: false, reason: 'invalid_request', detail: said };
	return { ok: false, reason: 'provider_error', detail: said };
}

/**
 * an RFC 7807 body's `title` and `detail`, bounded and on one line.
 *
 * nothing else off it: a problem about a grant can quote the grant, and a grant carries a donor's
 * name, email and address.
 */
function quoteProblem(body: unknown): string {
	const said = [stringField(body, 'title'), stringField(body, 'detail')]
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
			'No answer came back from Chariot, so whether this call took effect is unknown. The ' +
			`identical call made again is what settles it. The transport said: ${messageOf(error)}`
	};
}

function unreadable(what: string): PaymentFailure {
	return {
		ok: false,
		reason: 'provider_error',
		detail: `Chariot answered with ${what} in a shape this app cannot read.`
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

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
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

function isPositiveCents(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function dateOf(text: string | null): Date | null {
	if (text === null) return null;
	const at = new Date(text);
	return Number.isNaN(at.getTime()) ? null : at;
}
