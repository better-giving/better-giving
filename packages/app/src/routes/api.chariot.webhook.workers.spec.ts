import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact } from '$lib/server/contacts/contact-input';
import { createDb } from '$lib/server/db/client';
import type { PostableAccountId } from '$lib/server/db/postable';
import { recordDonation } from '$lib/server/donations/record';
import { mountRoutes } from '../route-request.testing';
import * as webhook from './api.chariot.webhook';

// the endpoint's own decision: which status Chariot is told. what a delivery does is
// `$lib/server/donations/settle.workers.spec.ts`, and how a signature verifies is
// `$lib/server/payments/chariot.spec.ts`.
//
// driven through react router rather than by calling the `action`, so the bytes the signature is
// computed over are the bytes the pipeline handed the handler (../route-request.testing.ts).
//
// the one call leaving the isolate is Get Grant, answered by a stubbed `fetch`. every other case is
// refused before it.

const ADDRESS = 'https://give.example.workers.dev/api/chariot/webhook';

const callback = mountRoutes([{ path: 'api/chariot/webhook', module: webhook }]);

const SECRET = 'notarealsigningsecret';

const CONFIGURED = {
	CHARIOT_API_KEY: 'notarealchariotkey',
	CHARIOT_API_URL: 'https://sandboxapi.givechariot.com',
	CHARIOT_WEBHOOK_SECRET: SECRET
};

const FORM_ID = 'frm_chariothook0001';
const GRANT_ID = '1e60800e-849b-43d1-870e-57afc8d75473';
const T = '2026-09-15T12:00:00Z';

/** a delivery about one grant, as Chariot's thin payload carries it. */
const grantUpdated = () =>
	JSON.stringify({
		id: 'event_123abc',
		created_at: '2026-09-15T12:00:00.12Z',
		category: 'grant.updated',
		associated_object_type: 'grant',
		associated_object_id: GRANT_ID
	});

/** the grant as Get Grant answers it once the organisation has marked it received. */
const RECEIVED_GRANT = {
	id: GRANT_ID,
	workflowSessionId: 'cfe09e64-6a74-4dab-a565-361185a6f248',
	fundId: 'daf-id',
	amount: 10_000,
	trackingId: 'L9E182VBGP',
	createdAt: '2026-09-14T12:00:00.000Z',
	updatedAt: '2026-09-15T12:00:00.000Z',
	status: 'Completed',
	feeDetail: { total: 290, contributions: [{ name: 'Chariot', amount: 290, feeType: 'chariot' }] }
};

/**
 * the pool's env with a case's deploy-time values. a proxy, for the reason `envWith` in
 * ./api.paypal.webhook.workers.spec.ts gives.
 */
function envWith(values: Record<string, string>): Env {
	return new Proxy(env, {
		get(target, property) {
			if (typeof property === 'string' && property in values) return values[property];
			return Reflect.get(target, property);
		}
	}) as Env;
}

/** `t=…,v1=…` over `t + "." + body`, computed here by WebCrypto the way Chariot documents it. */
async function signature(body: string, secret = SECRET): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${T}.${body}`));
	const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `t=${T},v1=${hex}`;
}

/** Get Grant, answered from `grants` by id; a grant not there is Chariot's 404. */
function chariotHolds(grants: readonly (typeof RECEIVED_GRANT)[]): { readonly reads: string[] } {
	const reads: string[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		reads.push(`${request.method} ${new URL(request.url).pathname}`);
		const grant = grants.find((g) => request.url.endsWith(`/v1/grants/${g.id}`));
		return grant === undefined
			? Response.json({ title: 'Not Found' }, { status: 404 })
			: Response.json(grant);
	});
	return { reads };
}

/** a pending DAF gift bound to the grant, written the way the donation endpoint records one. */
async function recordedGift(): Promise<void> {
	const account = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!account) throw new Error('no 4110 account in the migrated chart of accounts');
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, account.id)
		.run();
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!donor.ok) throw new Error('the fixture donor did not parse');
	const revenueAccountId = account.id as PostableAccountId;
	const result = await recordDonation(createDb(env.DB), {
		donationId: crypto.randomUUID(),
		donor: donor.value,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'chariot',
		totalMinor: 10_000,
		feeMinor: 290,
		lines: [{ label: 'Donation', revenueAccountId, amountMinor: 10_000 }],
		method: 'daf',
		providerTxnId: GRANT_ID,
		occurredAt: new Date('2026-09-14T12:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!result.ok) throw new Error(`the fixture gift was not recorded: ${result.detail}`);
}

async function postingGroups(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from entry_group').first<{ n: number }>();
	return row?.n ?? 0;
}

async function paymentStatus(): Promise<string | undefined> {
	const row = await env.DB.prepare('select status from payment where provider_txn_id = ?')
		.bind(GRANT_ID)
		.first<{ status: string }>();
	return row?.status;
}

/** one delivery, exactly as it arrives on the wire. */
async function deliver(
	body: string,
	signing: Readonly<Record<string, string>>,
	configEnv: Env = envWith(CONFIGURED)
): Promise<Response> {
	const headers = new Headers({ 'content-type': 'application/json', ...signing });
	return callback(new Request(ADDRESS, { method: 'POST', headers, body }), { env: configEnv });
}

beforeEach(async () => {
	for (const table of [
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'contact',
		'form'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

describe('POST /api/chariot/webhook', () => {
	it('settles the gift a signed grant update is about, and answers 200', async () => {
		await recordedGift();
		chariotHolds([RECEIVED_GRANT]);
		const body = grantUpdated();

		const response = await deliver(body, { 'chariot-webhook-signature': await signature(body) });

		expect(response.status).toBe(200);
		expect(await paymentStatus()).toBe('succeeded');
		expect(await postingGroups()).toBeGreaterThan(0);
	});

	it('answers a redelivery 200 and posts it once', async () => {
		await recordedGift();
		chariotHolds([RECEIVED_GRANT]);
		const body = grantUpdated();
		const signing = { 'chariot-webhook-signature': await signature(body) };
		await deliver(body, signing);
		const posted = await postingGroups();

		const again = await deliver(body, signing);

		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ outcome: 'already_posted' });
		expect(await postingGroups()).toBe(posted);
	});

	/**
	 * a grant on the organisation's Chariot account that no gift here is bound to. 200, because no
	 * redelivery makes a row appear and a non-2xx would buy retries that end the same way.
	 */
	it('answers a grant no gift is bound to 200, writing nothing', async () => {
		chariotHolds([RECEIVED_GRANT]);
		const body = grantUpdated();

		const response = await deliver(body, { 'chariot-webhook-signature': await signature(body) });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'unmatched' });
		expect(await postingGroups()).toBe(0);
	});

	it('refuses a delivery signed with another secret, reading and writing nothing', async () => {
		await recordedGift();
		const chariot = chariotHolds([RECEIVED_GRANT]);
		const body = grantUpdated();

		const response = await deliver(body, {
			'chariot-webhook-signature': await signature(body, 'someone-elses-secret')
		});

		expect(response.status).toBe(400);
		// a 4xx body is read by agents, so it names the value to fix (CLAUDE.md).
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining('CHARIOT_WEBHOOK_SECRET')
		});
		expect(chariot.reads).toEqual([]);
		expect(await paymentStatus()).toBe('pending');
		expect(await postingGroups()).toBe(0);
	});

	it('refuses a delivery carrying no signature header, and names the header', async () => {
		await recordedGift();
		const chariot = chariotHolds([RECEIVED_GRANT]);

		const response = await deliver(grantUpdated(), {});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining('chariot-webhook-signature')
		});
		expect(chariot.reads).toEqual([]);
		expect(await postingGroups()).toBe(0);
	});

	/**
	 * a body Chariot vouched for that names no event to act on. the same bytes read the same on
	 * every redelivery, and Chariot redelivers any non-2xx toward disabling the endpoint, so it is
	 * answered 200 with nothing read or written.
	 */
	it.each(['id', 'category'])(
		'answers a signed delivery with no %s 200, reading and writing nothing',
		async (field) => {
			await recordedGift();
			const chariot = chariotHolds([RECEIVED_GRANT]);
			const { [field]: _, ...unnamed } = JSON.parse(grantUpdated());
			const body = JSON.stringify(unnamed);

			const response = await deliver(body, {
				'chariot-webhook-signature': await signature(body)
			});

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ outcome: 'unactionable' });
			expect(chariot.reads).toEqual([]);
			expect(await paymentStatus()).toBe('pending');
			expect(await postingGroups()).toBe(0);
		}
	);

	/** the key is set and the secret is not: a half-finished set-up, held open for redelivery. */
	it('asks for the delivery again when this deployment holds no signing secret', async () => {
		const { CHARIOT_WEBHOOK_SECRET: _unset, ...noSecret } = CONFIGURED;
		const body = grantUpdated();

		const response = await deliver(
			body,
			{ 'chariot-webhook-signature': await signature(body) },
			envWith(noSecret)
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining('CHARIOT_WEBHOOK_SECRET')
		});
	});

	it('tells a browser what the address takes, and reads nothing off it', async () => {
		const chariot = chariotHolds([RECEIVED_GRANT]);

		const response = await callback(new Request(ADDRESS), { env: envWith(CONFIGURED) });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		expect(chariot.reads).toEqual([]);
	});

	it('refuses a mutating method other than POST before verifying anything', async () => {
		const request = new Request(ADDRESS, { method: 'PUT', body: grantUpdated() });

		const response = await callback(request, { env: envWith(CONFIGURED) });

		expect(response.status).toBe(405);
		expect(request.bodyUsed).toBe(false);
	});
});
