import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IntentRequest } from './provider';
import { createSponsorProvider, readSponsorFeed, sponsorEvent } from './sponsor';

// the sponsor adapter, driven through the `fetch` it is handed: what it sends is what the sponsor
// would receive, and what it answers is read off a scripted reply.

type Recorded = {
	readonly url: string;
	readonly method: string;
	readonly headers: Headers;
	readonly body: string;
};

function scripted(replies: readonly { status: number; json?: unknown }[]) {
	const remaining = [...replies];
	const calls: Recorded[] = [];
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		calls.push({
			url: request.url,
			method: request.method,
			headers: request.headers,
			body: await request.text()
		});
		const reply = remaining.shift();
		if (reply === undefined) throw new Error('the adapter made a call this case did not script');
		return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
			status: reply.status,
			headers: { 'content-type': 'application/json' }
		});
	};
	return { fetch, calls };
}

const SECRET_BYTES = new Uint8Array(32).map((_, index) => index + 1);
const EVENTS_SECRET = `whsec_${Buffer.from(SECRET_BYTES).toString('base64')}`;

function provider(fetch: typeof globalThis.fetch) {
	return createSponsorProvider({ apiKey: 'spk_test', eventsSecret: EVENTS_SECRET, fetch });
}

const GIFT_ID = '0192f0c4-0000-7000-8000-000000000001';

const INTENT: IntentRequest = {
	amountMinor: 10_330,
	currency: 'USD',
	method: 'card',
	idempotencyKey: GIFT_ID,
	deploymentOrigin: 'https://give.example.org',
	sponsored: {
		giftId: GIFT_ID,
		amount: { gift: 10_000, giftFeeCover: 330, contribution: 0, contributionFeeCover: 0 },
		contributionOffered: false,
		donor: { email: 'ada@example.org', firstName: 'Ada', lastName: 'Lovelace' },
		form: { id: 'form-1', name: 'Spring appeal' },
		program: { id: 'program-1', name: 'Meals' },
		tribute: {
			kind: 'memory',
			honoree: 'Charles',
			notify: { name: 'Byron', email: 'b@example.org' }
		},
		pageOrigin: 'https://www.example.org',
		donorIp: '203.0.113.7'
	}
};

describe('createIntent', () => {
	it('posts the contract body under the gift id as its idempotency key', async () => {
		const { fetch, calls } = scripted([
			{
				status: 201,
				json: { id: 'pay_1', reference: 'R-1', client: { provider: 'stripe', token: 'pi_secret' } }
			}
		]);
		const result = await provider(fetch).createIntent(INTENT);

		expect(result).toEqual({
			ok: true,
			value: { providerTxnId: 'pay_1', paymentToken: 'pi_secret', reference: 'R-1' }
		});
		const [call] = calls;
		expect(call?.method).toBe('POST');
		expect(call?.url).toBe('https://better.giving/api/partner/v1/payments');
		expect(call?.headers.get('authorization')).toBe('Bearer spk_test');
		expect(call?.headers.get('idempotency-key')).toBe(GIFT_ID);
		expect(JSON.parse(call?.body ?? '')).toEqual({
			gift_id: GIFT_ID,
			amount: { gift: 10_000, gift_fee_cover: 330, contribution: 0, contribution_fee_cover: 0 },
			currency: 'USD',
			method: 'card',
			contribution_offered: false,
			deployment_origin: 'https://give.example.org',
			page_origin: 'https://www.example.org',
			donor_ip: '203.0.113.7',
			donor: { email: 'ada@example.org', first_name: 'Ada', last_name: 'Lovelace' },
			tribute: {
				kind: 'memory',
				honoree: 'Charles',
				notify: { name: 'Byron', email: 'b@example.org' }
			},
			form: { id: 'form-1', name: 'Spring appeal' },
			program: { id: 'program-1', name: 'Meals' }
		});
	});

	it.each([
		[401, 'key_invalid', 'not_configured'],
		[400, 'invalid_request', 'invalid_request'],
		[404, 'not_found', 'not_found'],
		[409, 'idempotency_conflict', 'internal_error'],
		[409, 'fee_not_ready', 'fee_not_ready'],
		[410, 'authorization_expired', 'authorization_expired'],
		[422, 'unsupported', 'unsupported'],
		[422, 'coin_not_accepted', 'coin_not_accepted'],
		[422, 'above_maximum', 'above_maximum'],
		[429, 'rate_limited', 'rate_limited'],
		[502, 'provider_error', 'provider_error']
	] as const)('answers %i %s as %s', async (status, code, reason) => {
		const { fetch } = scripted([{ status, json: { code, title: 'Refused' } }]);
		const result = await provider(fetch).createIntent(INTENT);
		expect(result.ok ? null : result.reason).toBe(reason);
	});

	it('answers below_minimum with the smallest charge it names', async () => {
		const { fetch } = scripted([
			{ status: 422, json: { code: 'below_minimum', minimum_minor: 500 } }
		]);
		const result = await provider(fetch).createIntent(INTENT);
		expect(result).toMatchObject({ ok: false, reason: 'below_minimum', minimumMinor: 500 });
	});

	it('answers a 5xx with no readable code as provider_error', async () => {
		const { fetch } = scripted([{ status: 503 }]);
		const result = await provider(fetch).createIntent(INTENT);
		expect(result.ok ? null : result.reason).toBe('provider_error');
	});

	it('answers no answer at all as unreachable', async () => {
		const fetch: typeof globalThis.fetch = async () => {
			throw new TypeError('fetch failed');
		};
		const result = await provider(fetch).createIntent(INTENT);
		expect(result.ok ? null : result.reason).toBe('unreachable');
	});
});

/** a Standard Webhooks signature over `id.timestamp.body`, as the sponsor makes one. */
function sign(id: string, timestamp: number, body: string, key: Uint8Array = SECRET_BYTES): string {
	return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function delivery(
	envelope: unknown,
	options: { readonly at?: number; readonly signature?: (signed: string) => string } = {}
) {
	const body = JSON.stringify(envelope);
	const timestamp = Math.floor((options.at ?? Date.now()) / 1000);
	const id = 'msg_1';
	const signed = sign(id, timestamp, body);
	return {
		body,
		headers: {
			'webhook-id': id,
			'webhook-timestamp': String(timestamp),
			'webhook-signature': options.signature?.(signed) ?? signed
		}
	};
}

const SETTLED = {
	id: 'evt_1',
	seq: 7,
	type: 'payment.settled',
	created_at: '2026-11-27T10:00:00Z',
	data: { id: 'pay_1', gift_id: GIFT_ID }
};

const NO_FETCH: typeof globalThis.fetch = async () => {
	throw new Error('verifying an event calls nobody');
};

describe('verifyEvent', () => {
	it('accepts a delivery signed with the site’s secret', async () => {
		const result = await provider(NO_FETCH).verifyEvent(delivery(SETTLED));
		expect(result.ok).toBe(true);
	});

	it('accepts a delivery where one of two signatures matches', async () => {
		const other = sign('msg_1', 0, 'x', new Uint8Array(32));
		const result = await provider(NO_FETCH).verifyEvent(
			delivery(SETTLED, { signature: (signed) => `${other} ${signed}` })
		);
		expect(result.ok).toBe(true);
	});

	it('refuses a delivery whose signature does not match', async () => {
		const wrong = sign('msg_1', 0, 'x', new Uint8Array(32));
		const result = await provider(NO_FETCH).verifyEvent(
			delivery(SETTLED, { signature: () => wrong })
		);
		expect(result.ok ? null : result.reason).toBe('bad_signature');
	});

	it('refuses a delivery with no signature headers', async () => {
		const result = await provider(NO_FETCH).verifyEvent({
			body: JSON.stringify(SETTLED),
			headers: {}
		});
		expect(result.ok ? null : result.reason).toBe('bad_signature');
	});

	it.each([
		['six minutes old', -6 * 60_000],
		['six minutes ahead', 6 * 60_000]
	])('refuses a delivery stamped %s', async (_, offset) => {
		const result = await provider(NO_FETCH).verifyEvent(
			delivery(SETTLED, { at: Date.now() + offset })
		);
		expect(result.ok ? null : result.reason).toBe('bad_signature');
	});
});

describe('readSettlement', () => {
	const PAYMENT = {
		id: 'pay_1',
		gift_id: GIFT_ID,
		status: 'succeeded',
		method: 'apple_pay',
		amount: { gift: 10_000, gift_fee_cover: 330, contribution: 1_500, contribution_fee_cover: 50 },
		currency: 'usd',
		fee: 412,
		reference: 'R-1',
		occurred_at: '2026-11-27T10:00:00Z'
	};

	it('reads the payment, as the site’s gift and its cover, with the gift named back', async () => {
		const { fetch, calls } = scripted([{ status: 200, json: PAYMENT }]);
		const result = await provider(fetch).readSettlement('pay_1');

		expect(calls[0]?.method).toBe('GET');
		expect(calls[0]?.url).toBe('https://better.giving/api/partner/v1/payments/pay_1');
		expect(result).toEqual({
			ok: true,
			value: {
				providerTxnId: 'pay_1',
				status: 'succeeded',
				method: 'card',
				amountMinor: 10_330,
				currency: 'USD',
				feeMinor: null,
				metadata: { donation_id: GIFT_ID, gift_minor: '10000', fee_covered: 'true' },
				reference: 'R-1',
				occurredAt: new Date('2026-11-27T10:00:00Z'),
				arrival: null
			}
		});
	});

	it('carries a refund the read already reports', async () => {
		const { fetch } = scripted([
			{
				status: 200,
				json: {
					...PAYMENT,
					also_refunded: { reversal_id: 'rev_1', occurred_at: '2026-11-27T11:00:00Z' }
				}
			}
		]);
		const result = await provider(fetch).readSettlement('pay_1');
		expect(result).toMatchObject({
			ok: true,
			value: {
				alsoRefunded: { providerReversalId: 'rev_1', occurredAt: new Date('2026-11-27T11:00:00Z') }
			}
		});
	});

	it('answers a payment the sponsor does not hold as not_found', async () => {
		const { fetch } = scripted([{ status: 404, json: { code: 'not_found' } }]);
		const result = await provider(fetch).readSettlement('pay_x');
		expect(result.ok ? null : result.reason).toBe('not_found');
	});
});

describe('readReversal', () => {
	const REVERSAL = {
		id: 'rev_1',
		payment_id: 'pay_1',
		gift_id: GIFT_ID,
		amount: { gift: 10_000, gift_fee_cover: 330, contribution: 1_500, contribution_fee_cover: 50 },
		currency: 'usd',
		occurred_at: '2026-11-28T10:00:00Z'
	};
	const event = {
		kind: 'reversal',
		id: 'evt_2',
		type: 'payment.refunded',
		occurredAt: new Date('2026-11-28T10:00:00Z'),
		providerNoticeId: 'rev_1'
	} as const;
	const facts = {
		reversedTxnId: 'pay_1',
		providerReversalId: 'rev_1',
		occurredAt: new Date('2026-11-28T10:00:00Z'),
		reversedMetadata: { donation_id: GIFT_ID }
	};

	it('reads the reversal the event names, as the site’s gift and its cover', async () => {
		const { fetch, calls } = scripted([{ status: 200, json: { ...REVERSAL, kind: 'refund' } }]);
		const result = await provider(fetch).readReversal(event);

		expect(calls[0]?.method).toBe('GET');
		expect(calls[0]?.url).toBe('https://better.giving/api/partner/v1/reversals/rev_1');
		expect(result).toEqual({
			ok: true,
			value: {
				...facts,
				kind: 'refund',
				amountMinor: 10_330,
				currency: 'USD',
				feeReturnedMinor: null
			}
		});
	});

	it.each([
		['refund_failed', { kind: 'refund_failed' }],
		[
			'dispute_opened',
			{
				kind: 'dispute_opened',
				amountMinor: 10_330,
				currency: 'USD',
				feeMinor: null,
				reason: 'fraudulent',
				dashboardUrl: null,
				respondBy: new Date('2026-12-10T00:00:00Z')
			}
		],
		['dispute_won', { kind: 'dispute_won', feeReturnedMinor: null, feeKeptMinor: null }],
		[
			'dispute_lost',
			{
				kind: 'dispute_lost',
				amountMinor: 10_330,
				currency: 'USD',
				feeMinor: null,
				reason: 'fraudulent',
				dashboardUrl: null
			}
		]
	])('reads %s', async (kind, read) => {
		const { fetch } = scripted([
			{
				status: 200,
				json: { ...REVERSAL, kind, reason: 'fraudulent', respond_by: '2026-12-10T00:00:00Z' }
			}
		]);
		const result = await provider(fetch).readReversal(event);
		expect(result).toEqual({ ok: true, value: { ...facts, ...read } });
	});

	it('reads nothing_moved as money that has not moved', async () => {
		const { fetch } = scripted([{ status: 200, json: { ...REVERSAL, kind: 'nothing_moved' } }]);
		const result = await provider(fetch).readReversal(event);
		expect(result).toEqual({
			ok: true,
			value: { kind: 'nothing_moved', providerReversalId: 'rev_1' }
		});
	});

	it('reads a refund of the contribution alone as nothing moved on the site', async () => {
		const { fetch } = scripted([
			{
				status: 200,
				json: {
					...REVERSAL,
					kind: 'refund',
					amount: { gift: 0, gift_fee_cover: 0, contribution: 1_500, contribution_fee_cover: 50 }
				}
			}
		]);
		const result = await provider(fetch).readReversal(event);
		expect(result).toEqual({
			ok: true,
			value: { kind: 'nothing_moved', providerReversalId: 'rev_1' }
		});
	});

	it('answers a reversal the sponsor does not hold as not_found', async () => {
		const { fetch } = scripted([{ status: 404, json: { code: 'not_found' } }]);
		const result = await provider(fetch).readReversal(event);
		expect(result.ok ? null : result.reason).toBe('not_found');
	});

	it('answers a reversal it cannot read as provider_error', async () => {
		const { fetch } = scripted([{ status: 200, json: { ...REVERSAL, kind: 'chargeback' } }]);
		const result = await provider(fetch).readReversal(event);
		expect(result.ok ? null : result.reason).toBe('provider_error');
	});
});

describe('what an event is about', () => {
	const envelope = (type: string, data: unknown) => ({ ...SETTLED, type, data });

	it('reads payment.settled as a settlement of the payment it carries', async () => {
		const result = await provider(NO_FETCH).verifyEvent(delivery(SETTLED));
		expect(result).toEqual({
			ok: true,
			value: {
				kind: 'settlement',
				id: 'evt_1',
				type: 'payment.settled',
				occurredAt: new Date('2026-11-27T10:00:00Z'),
				providerTxnId: 'pay_1'
			}
		});
	});

	it.each([
		'payment.refunded',
		'payment.refund_failed',
		'payment.disputed',
		'payment.dispute_closed'
	])('reads %s as a reversal naming the reversal it carries', async (type) => {
		const result = await provider(NO_FETCH).verifyEvent(
			delivery(envelope(type, { id: 'rev_1', payment_id: 'pay_1' }))
		);
		expect(result).toMatchObject({
			ok: true,
			value: { kind: 'reversal', providerNoticeId: 'rev_1', type }
		});
	});

	it('reads payout.settled as a payout carrying its body', async () => {
		const body = {
			payout_id: 'po_1',
			amount: 52_000,
			currency: 'usd',
			settled_at: '2026-11-26T00:00:00Z',
			payment_ids: ['pay_1']
		};
		const result = await provider(NO_FETCH).verifyEvent(delivery(envelope('payout.settled', body)));
		expect(result).toMatchObject({
			ok: true,
			value: { kind: 'payout', payout: { kind: 'settled', body } }
		});
	});

	it('reads payout.returned as a payout return carrying its body', async () => {
		const body = {
			return_id: 'ret_1',
			payout_id: 'po_1',
			amount: 2_000,
			currency: 'usd',
			returned_at: '2026-11-26T00:00:00Z'
		};
		const result = await provider(NO_FETCH).verifyEvent(
			delivery(envelope('payout.returned', body))
		);
		expect(result).toMatchObject({
			ok: true,
			value: { kind: 'payout', payout: { kind: 'returned', body } }
		});
	});

	it('refuses a payout whose body it cannot read', async () => {
		const result = await provider(NO_FETCH).verifyEvent(
			delivery(envelope('payout.settled', { payout_id: 'po_1', amount: '52000' }))
		);
		expect(result.ok ? null : result.reason).toBe('invalid_request');
	});

	it.each([
		'payment.failed',
		'payment.expired',
		'recurring.charged',
		'recurring.failed',
		'recurring.ended',
		'availability.changed',
		'something.new'
	])('ignores %s', async (type) => {
		const result = await provider(NO_FETCH).verifyEvent(delivery(envelope(type, {})));
		expect(result).toMatchObject({ ok: true, value: { kind: 'ignored', type } });
	});

	it('reads a pulled envelope with no signature the same way', () => {
		expect(sponsorEvent(SETTLED)).toMatchObject({
			ok: true,
			value: { kind: 'settlement', providerTxnId: 'pay_1' }
		});
	});
});

describe('readSponsorFeed', () => {
	const after = (seq: number) => ({ id: `evt_${seq}`, seq, type: 'payment.settled', data: {} });

	it('asks after the cursor it is given and answers the last sequence on the page', async () => {
		const { fetch, calls } = scripted([
			{ status: 200, json: { events: [after(7), after(8)], has_more: true } }
		]);

		const result = await readSponsorFeed({ apiKey: 'spk_test', fetch }, 6);

		expect(calls[0]?.url).toBe('https://better.giving/api/partner/v1/events?after=6');
		expect(calls[0]?.headers.get('authorization')).toBe('Bearer spk_test');
		expect(result).toMatchObject({ ok: true, value: { next: 8, more: true } });
	});

	it('answers the same cursor and no more for an empty page', async () => {
		const { fetch } = scripted([{ status: 200, json: { events: [], has_more: false } }]);

		const result = await readSponsorFeed({ apiKey: 'spk_test', fetch }, 6);

		expect(result).toMatchObject({ ok: true, value: { events: [], next: 6, more: false } });
	});

	it.each([
		[{ events: [after(3)], has_more: false }, 'a page whose last sequence is behind the cursor'],
		[{ events: [{ id: 'evt_x' }], has_more: false }, 'an event with no sequence'],
		[{ events: [], has_more: true }, 'an empty page that says more follow'],
		[{ events: [] }, 'a page with no has_more']
	])('refuses %s', async (body, _what) => {
		const { fetch } = scripted([{ status: 200, json: body }]);
		const result = await readSponsorFeed({ apiKey: 'spk_test', fetch }, 6);
		expect(result.ok ? null : result.reason).toBe('provider_error');
	});

	it('answers a refused key as not_configured, naming the variable', async () => {
		const { fetch } = scripted([{ status: 401, json: { code: 'key_invalid' } }]);
		const result = await readSponsorFeed({ apiKey: 'spk_bad', fetch }, 0);
		expect(result).toMatchObject({
			ok: false,
			reason: 'not_configured',
			detail: expect.stringContaining('SPONSOR_API_KEY')
		});
	});

	it('answers a call that never came back as unreachable', async () => {
		const fetch = (async () => {
			throw new TypeError('fetch failed');
		}) as typeof globalThis.fetch;
		const result = await readSponsorFeed({ apiKey: 'spk_test', fetch }, 0);
		expect(result.ok ? null : result.reason).toBe('unreachable');
	});
});
