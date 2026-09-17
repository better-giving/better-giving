import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChariotProvider } from './chariot';
import { isRetryable, type IntentRequest, type PaymentProvider } from './provider';

afterEach(() => {
	vi.useRealTimers();
});

// the adapter, exercised through a recording `fetch`.
//
// `fetch` is where this adapter's transport bottoms out — no SDK sits between it and Chariot — so
// the request under assertion is the request Chariot would receive: an amount in the wrong unit, a
// session id that never left, a key sent under the wrong header all type-check and all show here.
//
// ./vitest.config.ts sets `unstubGlobals` and `restoreMocks`, so a stub installed here is taken back
// before the next test runs.

/** one request the adapter made, as the assertions need to read it. */
type Recorded = {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: string;
};

/**
 * a `fetch` that answers from a script and remembers what it was asked.
 *
 * running out is an error rather than a default: a case that made one more call than it scripted is
 * a case whose subject did something it was not asked to.
 */
function recording(responses: readonly { status: number; json?: unknown }[]) {
	const remaining = [...responses];
	const calls: Recorded[] = [];

	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		calls.push({
			url: request.url,
			method: request.method,
			headers: Object.fromEntries(request.headers),
			body: await request.clone().text()
		});
		const next = remaining.shift();
		if (next === undefined) throw new Error(`unscripted request: ${request.method} ${request.url}`);
		return next.json === undefined
			? new Response(null, { status: next.status })
			: Response.json(next.json, {
					status: next.status,
					headers: next.status >= 400 ? { 'content-type': 'application/problem+json' } : {}
				});
	});

	return calls;
}

const CREDENTIALS = {
	apiKey: 'notarealchariotkey',
	apiUrl: 'https://sandboxapi.givechariot.com',
	webhookSecret: 'notarealsigningsecret'
};

const SESSION = 'cfe09e64-6a74-4dab-a565-361185a6f248';
const GRANT_ID = '1e60800e-849b-43d1-870e-57afc8d75473';

const GRANT = {
	id: GRANT_ID,
	workflowSessionId: SESSION,
	fundId: 'daf-id',
	amount: 5000,
	trackingId: 'L9E182VBGP',
	createdAt: '2024-10-17T12:38:06.999787Z',
	updatedAt: '2024-10-17T12:38:06.999787Z',
	status: 'Initiated',
	feeDetail: {
		total: 145,
		contributions: [{ name: 'Chariot', amount: 145, feeType: 'chariot' }]
	},
	metadata: { don_id: 'set-by-a-browser' }
};

const GRANT_REQUEST: IntentRequest = {
	amountMinor: 5000,
	currency: 'USD',
	method: 'daf',
	idempotencyKey: 'attempt-1',
	deploymentOrigin: 'https://donate.example.org',
	authorizedSessionId: SESSION
};

describe('createIntent — Create Grant', () => {
	// Chariot answers a repeat for a session it already holds a grant for with 200 and that grant,
	// so the same answer either way is what makes a retried call safe.
	it.each([201, 200])('answers the grant Chariot holds for the session on %i', async (status) => {
		const calls = recording([{ status, json: GRANT }]);

		const result = await createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);

		expect(result).toEqual({
			ok: true,
			value: { providerTxnId: GRANT_ID, paymentToken: GRANT_ID }
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe('POST');
		expect(calls[0]?.url).toBe('https://sandboxapi.givechariot.com/v1/grants');
		expect(calls[0]?.headers.authorization).toBe('Bearer notarealchariotkey');
		expect(JSON.parse(calls[0]?.body ?? '')).toStrictEqual({
			workflowSessionId: SESSION,
			amount: 5000
		});
	});

	// funds take whole dollars only; a cent off one is this app's pricing gone wrong, and Chariot is
	// not the place to find that out.
	it('sends no amount that is not whole dollars', async () => {
		const calls = recording([]);

		const result = await createChariotProvider(CREDENTIALS).createIntent({
			...GRANT_REQUEST,
			amountMinor: 5050
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(result.ok === false ? result.detail : '').toContain('5050');
		expect(calls).toHaveLength(0);
	});

	// a form priced in another currency cannot be granted in it: funds grant USD.
	it('sends no grant in a currency other than USD', async () => {
		const calls = recording([]);

		const result = await createChariotProvider(CREDENTIALS).createIntent({
			...GRANT_REQUEST,
			currency: 'GBP'
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(calls).toHaveLength(0);
	});

	// whether a call nobody answered created the grant is unknown, and the same call settles it.
	it('answers a call that got no answer as unreachable', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('network connection lost');
		});

		const result = await createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);

		expect(result.ok === false && result.reason).toBe('unreachable');
	});

	// the session is the grant's whole authority, so a request without one has nothing to create a
	// grant from.
	it('creates nothing without the donor’s session', async () => {
		const calls = recording([]);
		const { authorizedSessionId: _, ...withoutSession } = GRANT_REQUEST;

		const result = await createChariotProvider(CREDENTIALS).createIntent(withoutSession);

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(calls).toHaveLength(0);
	});

	// past fifteen minutes the donor's authorization is gone and no retry brings it back: the donor
	// has to go through the fund's window again, which is a terminal reason with its own sentence.
	it('answers a session past its window as an expired authorization, and terminal', async () => {
		recording([
			{
				status: 410,
				json: {
					type: 'about:blank',
					title: 'Gone',
					status: 410,
					detail: 'grant intent expired'
				}
			}
		]);

		const result = await createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);

		expect(result.ok === false && result.reason).toBe('authorization_expired');
		expect(result.ok === false && isRetryable(result.reason)).toBe(false);
		expect(result.ok === false ? result.detail : '').toContain('15 minutes');
	});

	// a session Chariot never issued — forged, or from the other environment — is not an approval
	// that ran out, and nothing about it says the donor took too long.
	it('answers a session Chariot does not hold as not found rather than expired', async () => {
		recording([
			{ status: 404, json: { title: 'Not Found', status: 404, detail: 'no such session' } }
		]);

		const result = await createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);

		expect(result.ok === false && result.reason).toBe('not_found');
		expect(result.ok === false ? result.detail : '').not.toContain('15 minutes');
	});

	// the fund's own rules — its minimum, the donor's balance — come back as a 400, and Chariot's
	// sentence is the only place that says which.
	it('refuses an amount Chariot refused, carrying Chariot’s reason', async () => {
		recording([
			{
				status: 400,
				json: {
					type: 'about:blank',
					title: 'Bad Request',
					status: 400,
					detail: 'amount exceeds the fund balance'
				}
			}
		]);

		const result = await createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(result.ok === false ? result.detail : '').toContain('amount exceeds the fund balance');
	});

	// a 409 is Chariot still working through the first request for the session. the donor is waiting
	// on the answer, so it is asked again inside the call rather than handed back to them.
	it('asks again while Chariot is still processing the session, then answers the grant', async () => {
		vi.useFakeTimers();
		const conflict = {
			status: 409,
			json: { title: 'Conflict', status: 409, detail: 'processing' }
		};
		const calls = recording([conflict, conflict, { status: 201, json: GRANT }]);

		const pending = createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);
		await vi.runAllTimersAsync();
		const result = await pending;

		expect(result.ok && result.value.providerTxnId).toBe(GRANT_ID);
		expect(calls).toHaveLength(3);
	});

	// asked a bounded number of times, then handed back as a call whose outcome is unknown — the grant
	// may be about to exist — and worth making again: Chariot's own idempotency on the session is what
	// makes that later call safe.
	it('gives up on a session still processing after a bounded wait, as an unknown outcome', async () => {
		vi.useFakeTimers();
		const conflict = {
			status: 409,
			json: { title: 'Conflict', status: 409, detail: 'processing' }
		};
		const calls = recording(Array.from({ length: 10 }, () => conflict));

		const pending = createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);
		await vi.runAllTimersAsync();
		const result = await pending;

		expect(result.ok === false && result.reason).toBe('unreachable');
		expect(result.ok === false && isRetryable(result.reason)).toBe(true);
		expect(calls.length).toBeLessThan(10);
	});

	// the form stops waiting on the donor's behalf at 30 seconds (`PORT_TIMEOUT_MS` in
	// packages/form/src/checkout.machine.ts), so slow answers and the waits between them share one
	// deadline short of that, and a gift written after it still reaches the donor.
	it('answers inside the form’s wait however slowly Chariot says it is still processing', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => {
			return new Promise<Response>((resolve, reject) => {
				const timer = setTimeout(
					() => resolve(Response.json({ title: 'Conflict', status: 409 }, { status: 409 })),
					8_000
				);
				init?.signal?.addEventListener('abort', () => {
					clearTimeout(timer);
					reject(init.signal?.reason);
				});
			});
		});
		const started = Date.now();

		const pending = createChariotProvider(CREDENTIALS).createIntent(GRANT_REQUEST);
		await vi.runAllTimersAsync();
		const result = await pending;

		expect(Date.now() - started).toBeLessThanOrEqual(20_000);
		expect(result.ok === false && result.reason).toBe('unreachable');
	});
});

describe('readSettlement — Get Grant', () => {
	/**
	 * the vocabulary the API sends is `Initiated`, `Completed`, `Canceled` (a sandbox read,
	 * 2026-09-15); the lowercase spellings are the `2026-04-01` reference's, which the same words
	 * read the same under. `Received` is the word Chariot's DAFpay guide gives the organisation
	 * marking a grant received, and reads as `Completed` does. every other word —
	 * `awaiting_daf_submission`, a status nobody has documented — is a grant still on its way, and
	 * nothing may be acted on from that.
	 */
	it.each([
		['Initiated', 'pending'],
		['Completed', 'succeeded'],
		['Canceled', 'cancelled'],
		['completed', 'succeeded'],
		['canceled', 'cancelled'],
		['Received', 'succeeded'],
		['received', 'succeeded'],
		['initiated', 'pending'],
		['awaiting_daf_submission', 'pending'],
		['Paid', 'pending']
	])('reads a grant whose status is %s as %s', async (status, expected) => {
		const calls = recording([{ status: 200, json: { ...GRANT, status } }]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result.ok && result.value.status).toBe(expected);
		expect(calls[0]?.method).toBe('GET');
		expect(calls[0]?.url).toBe(`https://sandboxapi.givechariot.com/v1/grants/${GRANT_ID}`);
	});

	it('reads a grant with no status at all as still on its way', async () => {
		const { status: _, ...statusless } = GRANT;
		recording([{ status: 200, json: statusless }]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result.ok && result.value.status).toBe('pending');
	});

	/**
	 * the fee is every itemised contribution added up — Chariot's, the fund's and an application's —
	 * because each is money the organisation does not keep out of the grant. `total` is not read:
	 * the breakdown is the figure, and a total that disagreed with it would be the one to doubt.
	 */
	it('reads a received grant’s fee off its itemised contributions', async () => {
		recording([
			{
				status: 200,
				json: {
					...GRANT,
					status: 'Completed',
					feeDetail: {
						total: 1,
						contributions: [
							{ name: 'Chariot', amount: 145, feeType: 'chariot' },
							{ name: 'Fund', amount: 50, feeType: 'daf' }
						]
					},
					statuses: [
						{ id: 's1', status: 'Initiated', createdAt: '2024-10-17T12:38:06.999787Z' },
						{ id: 's2', status: 'Completed', createdAt: '2024-10-21T03:05:45.833Z' }
					]
				}
			}
		]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result).toStrictEqual({
			ok: true,
			value: {
				providerTxnId: GRANT_ID,
				status: 'succeeded',
				method: 'daf',
				amountMinor: 5000,
				currency: 'USD',
				feeMinor: 195,
				metadata: {},
				reference: 'L9E182VBGP',
				occurredAt: new Date('2024-10-21T03:05:45.833Z'),
				arrival: null
			}
		});
	});

	// what a browser wrote on the grant in Chariot's window is never read back as this app's own:
	// the gift a grant belongs to is the row the server bound it to.
	it('carries none of the grant’s browser-set metadata', async () => {
		recording([{ status: 200, json: { ...GRANT, status: 'Completed' } }]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result.ok && result.value.metadata).toStrictEqual({});
	});

	// a cancelled grant carries no fee detail at all (sandbox), and a grant on its way has only an
	// estimate — neither is money that moved.
	it.each(['Canceled', 'Initiated'])('reads no fee on a grant that is %s', async (status) => {
		recording([{ status: 200, json: { ...GRANT, status } }]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result.ok && result.value.feeMinor).toBeNull();
	});

	// the tracking id is on a grant from the moment it is created (sandbox), so a gift still on its
	// way already has the id the organisation will match the fund's payment by.
	it.each(['Initiated', 'Completed'])(
		'reads a %s grant’s tracking id as its reference',
		async (status) => {
			recording([{ status: 200, json: { ...GRANT, status } }]);

			const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

			expect(result.ok && result.value.reference).toBe('L9E182VBGP');
		}
	);

	// the reference leaves `trackingId` optional: a grant without one still settles, and says nothing.
	it('carries no reference on a grant with no tracking id', async () => {
		const { trackingId: _, ...untracked } = GRANT;
		recording([{ status: 200, json: { ...untracked, status: 'Completed' } }]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result.ok && result.value.status).toBe('succeeded');
		expect(result.ok && 'reference' in result.value).toBe(false);
	});

	it('answers a grant the account does not hold as not found', async () => {
		recording([{ status: 404, json: { title: 'Not Found', status: 404, detail: 'no grant' } }]);

		const result = await createChariotProvider(CREDENTIALS).readSettlement(GRANT_ID);

		expect(result.ok === false && result.reason).toBe('not_found');
	});
});

describe('verifyEvent — the signed delivery', () => {
	const T = '2024-01-19T18:48:56Z';
	const BODY = JSON.stringify({
		id: 'event_123abc',
		created_at: '2024-01-19T18:48:56.37Z',
		category: 'grant.updated',
		associated_object_type: 'grant',
		associated_object_id: GRANT_ID
	});

	/** the signature Chariot computes, by node's own HMAC rather than the adapter's WebCrypto. */
	function sign(timestamp: string, body: string, secret = CREDENTIALS.webhookSecret): string {
		return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
	}

	function delivery(header: string | undefined, body = BODY) {
		return {
			body,
			headers: header === undefined ? {} : { 'chariot-webhook-signature': header }
		};
	}

	it('answers a grant update as a settlement naming the grant', async () => {
		const result = await createChariotProvider(CREDENTIALS).verifyEvent(
			delivery(`t=${T},v1=${sign(T, BODY)}`)
		);

		expect(result).toStrictEqual({
			ok: true,
			value: {
				id: 'event_123abc',
				kind: 'settlement',
				type: 'grant.updated',
				occurredAt: new Date('2024-01-19T18:48:56.37Z'),
				providerTxnId: GRANT_ID
			}
		});
	});

	it('refuses a delivery signed with another secret', async () => {
		const result = await createChariotProvider(CREDENTIALS).verifyEvent(
			delivery(`t=${T},v1=${sign(T, BODY, 'someone-elses-secret')}`)
		);

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	it('refuses a body that is not the one signed', async () => {
		const result = await createChariotProvider(CREDENTIALS).verifyEvent(
			delivery(`t=${T},v1=${sign(T, BODY)}`, BODY.replace('grant.updated', 'grant.created'))
		);

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	it('refuses a delivery carrying no signature header', async () => {
		const result = await createChariotProvider(CREDENTIALS).verifyEvent(delivery(undefined));

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	// several `v1` values is what a secret mid-rotation looks like, and any one of them matching is
	// Chariot vouching for the body.
	it('accepts a delivery where any one of several v1 signatures matches', async () => {
		const header = `t=${T},v1=${sign(T, BODY, 'an-old-secret')},v1=${sign(T, BODY)}`;

		const result = await createChariotProvider(CREDENTIALS).verifyEvent(delivery(header));

		expect(result.ok).toBe(true);
	});

	it('passes over a v1 value that is not a signature at all', async () => {
		const header = `t=${T},v1=abc,v1=${sign(T, BODY)}`;

		const result = await createChariotProvider(CREDENTIALS).verifyEvent(delivery(header));

		expect(result.ok).toBe(true);
	});

	// a scheme other than v1 is ignored, so a correct signature under it verifies nothing — which is
	// what keeps a downgrade from being a way in.
	it('verifies nothing against a signature under a scheme other than v1', async () => {
		const result = await createChariotProvider(CREDENTIALS).verifyEvent(
			delivery(`t=${T},v0=${sign(T, BODY)}`)
		);

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	// the timestamp is ISO-8601; a unix-seconds one is not a header Chariot sends, however it was
	// signed.
	it('refuses a timestamp that is not an ISO-8601 time', async () => {
		const unix = '1705690136';

		const result = await createChariotProvider(CREDENTIALS).verifyEvent(
			delivery(`t=${unix},v1=${sign(unix, BODY)}`)
		);

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	// held open rather than lost: the deployment is short a value, and Chariot's redelivery window is
	// where an operator sets it.
	it('refuses retryably where the deployment holds no signing secret', async () => {
		const result = await createChariotProvider({ ...CREDENTIALS, webhookSecret: null }).verifyEvent(
			delivery(`t=${T},v1=${sign(T, BODY)}`)
		);

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('CHARIOT_WEBHOOK_SECRET');
	});

	it('answers a verified delivery about anything but a grant as ignored', async () => {
		const body = JSON.stringify({
			id: 'event_456',
			created_at: '2024-01-19T18:48:56Z',
			category: 'unintegrated_grant.updated',
			associated_object_type: 'unintegrated_grant',
			associated_object_id: 'ug_1'
		});

		const result = await createChariotProvider(CREDENTIALS).verifyEvent(
			delivery(`t=${T},v1=${sign(T, body)}`, body)
		);

		expect(result.ok && result.value.kind).toBe('ignored');
	});
});

describe('what the account is approved for', () => {
	/**
	 * Chariot publishes no approval to read, so the answer is the one a key that works can give: the
	 * account takes grants. the call is the cheapest read the key authorises, which is what turns a
	 * key the account at the address does not accept into a refusal naming both values.
	 */
	it('reports the daf rail active where the key reads the account', async () => {
		const calls = recording([{ status: 200, json: { results: [] } }]);

		const result = await createChariotProvider(CREDENTIALS).readAccountChargeability();

		expect(result).toStrictEqual({
			ok: true,
			value: { chargesEnabled: true, rails: { daf: 'active' } }
		});
		expect(calls[0]?.url).toBe('https://sandboxapi.givechariot.com/v1/grants?pageLimit=1');
	});

	it('refuses as unconfigured where the address does not accept the key', async () => {
		recording([{ status: 401, json: { title: 'Unauthorized', status: 401, detail: 'bad key' } }]);

		const result = await createChariotProvider(CREDENTIALS).readAccountChargeability();

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('CHARIOT_API_KEY');
		expect(result.ok === false ? result.detail : '').toContain('CHARIOT_API_URL');
	});

	it('reports the daf rail switched on, asking nothing', async () => {
		const calls = recording([]);

		const result = await createChariotProvider(CREDENTIALS).readRailSwitchboard();

		expect(result).toStrictEqual({ ok: true, value: { daf: { offered: true, switchedOn: true } } });
		expect(calls).toHaveLength(0);
	});
});

describe('the arms a one-time grant has nothing behind', () => {
	it.each([
		['readRecurringGiftProvision', (p: PaymentProvider) => p.readRecurringGiftProvision()],
		['prepareRecurringGifts', (p: PaymentProvider) => p.prepareRecurringGifts()],
		['listWebhookEndpoints', (p: PaymentProvider) => p.listWebhookEndpoints()],
		['listWalletDomains', (p: PaymentProvider) => p.listWalletDomains()]
	])('refuses %s as unsupported, asking Chariot nothing', async (_name, arm) => {
		const calls = recording([]);

		const result = await arm(createChariotProvider(CREDENTIALS));

		expect(result.ok === false && result.reason).toBe('unsupported');
		expect(calls).toHaveLength(0);
	});
});
