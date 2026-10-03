import { env } from 'cloudflare:test';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mountRoutes, type RouteRequester } from '../../../route-request.testing';
import * as surface from '../../../routes/integrations.v1';
import * as donorsList from '../../../routes/integrations.v1.donors';
import * as giftsList from '../../../routes/integrations.v1.gifts';
import * as recurringList from '../../../routes/integrations.v1.recurring-gifts';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_TEST_TYPE, type WebhookEvent } from '../../webhooks/catalog';
import { parseContact } from '../contacts/contact-input';
import { createDb, type Db } from '../db/client';
import { contact, dispute, donation, payment } from '../db/schema';
import { commitDonor } from '../donations/donor';
import { sendDueWebhooks, sendTestWebhook } from '../webhooks/deliver';
import { createDestination } from '../webhooks/destinations';
import {
	disputeOpenedWebhookStatements,
	giftRefundedWebhookStatements,
	recurringChargeFailedWebhookStatements,
	recurringGiftChangeWebhookStatements,
	recurringGiftStartedWebhookStatements,
	webhookStatements
} from '../webhooks/events';
import { mintApiKey, revokeApiKey } from './keys';
import { openApiDocument, REFUSAL_STATUS, WEBHOOK_EVENT_DATA } from './openapi';
import { schemaErrors } from './openapi.testing';
import type { IntegrationsRefusalCode } from './surface';

// the published schemas held to what this deployment really answers, against a real D1: each
// list's page as its route serves it, each event's body as the delivery run posts it, and each
// refusal code at the status the document gives it. ./openapi.spec.ts holds the document's shape
// and its drift from the constants; this is where a key rendered and never described, or a type
// described and never rendered, fails.

const OWN = 'https://give.example.workers.dev';
const document = openApiDocument(OWN);

const surfaceRoute = mountRoutes([{ path: 'integrations/v1', module: surface }]);
const listRoutes: Record<string, RouteRequester> = {
	'/gifts': mountRoutes([
		{ path: 'integrations/v1', module: surface },
		{ path: 'gifts', module: giftsList }
	]),
	'/donors': mountRoutes([
		{ path: 'integrations/v1', module: surface },
		{ path: 'donors', module: donorsList }
	]),
	'/recurring-gifts': mountRoutes([
		{ path: 'integrations/v1', module: surface },
		{ path: 'recurring-gifts', module: recurringList }
	])
};

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

/** a fresh address per case: the layout charges every request to its address. */
let caller = 0;
const address = () => `198.51.100.${caller}`;

beforeEach(async () => {
	for (const table of [
		'api_key',
		'webhook_delivery',
		'webhook_destination_event',
		'webhook_destination',
		'dispute',
		'payment',
		'donation',
		'recurring_plan',
		'contact',
		'form'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	caller += 1;
});

const PLAN_ID = '019fb900-0000-7000-8000-00000000a002';

/** the id of the record on each list that everything seeded is about. */
type Seeded = Readonly<Record<'/gifts' | '/donors' | '/recurring-gifts', string>>;

/**
 * a $50 gift from Ada Okafor, settled with the rows it owes; $20 of it refunded and a dispute
 * opened on another $20; Ada's consent changed; and a $25 monthly commitment from her, started,
 * updated, its charge failed and ended. every one of the nine events, queued the way its writer
 * queues it.
 */
async function seedEverything(): Promise<Seeded> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const giftId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({
			id: contactId,
			kind: 'individual',
			displayName: 'Ada Okafor',
			primaryEmail: 'ada@example.org'
		}),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: at }),
		db.insert(payment).values({
			id: giftId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		}),
		...webhookStatements(db, { paymentId: giftId, contactId })
	]);

	const withdraw = (id: string) =>
		db.insert(payment).values({
			id,
			donationId,
			amountMinor: 2_000,
			currency: 'USD',
			direction: 'refund',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: new Date('2026-09-15T08:00:00.000Z'),
			parentPaymentId: giftId
		});
	const refundId = uuidv7();
	const disputedId = uuidv7();
	await db.batch([withdraw(refundId), giftRefundedWebhookStatements(db, refundId)]);
	await db.batch([
		withdraw(disputedId),
		db.insert(dispute).values({
			paymentId: disputedId,
			respondBy: new Date('2026-10-01T23:59:59.000Z'),
			reason: 'fraudulent'
		}),
		disputeOpenedWebhookStatements(db, disputedId)
	]);

	const returning = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!returning.ok) throw new Error('the fixture donor does not parse');
	await commitDonor(db, returning.value, true);

	const account = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values ('frm_openapiplan1', 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(account?.id)
		.run();
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, 'frm_openapiplan1', 2500, 'USD', 'monthly', 'active', 'stripe',
		         'sub_openapi1', 'cus_openapi1', ?, ?, null, ?, ?)`
	)
		.bind(
			PLAN_ID,
			contactId,
			Date.parse('2026-09-03T12:00:00.000Z'),
			Date.parse('2026-10-03T12:00:00.000Z'),
			Date.now(),
			Date.now()
		)
		.run();
	await db.batch([
		...recurringGiftStartedWebhookStatements(db, { id: PLAN_ID, status: 'active' }),
		recurringGiftChangeWebhookStatements(db, 'recurring_gift.updated', PLAN_ID, sql`1 = 1`),
		recurringChargeFailedWebhookStatements(db, PLAN_ID, {
			attemptKey: 'evt_openapi_failed',
			attemptCount: 1,
			nextRetryAt: new Date('2026-10-08T12:00:00.000Z'),
			failedAt: new Date('2026-10-05T12:00:00.000Z'),
			amountMinor: 2500,
			currency: 'USD'
		}),
		recurringGiftChangeWebhookStatements(db, 'recurring_gift.ended', PLAN_ID, sql`1 = 1`)
	]);
	return { '/gifts': giftId, '/donors': contactId, '/recurring-gifts': PLAN_ID };
}

/** every body the delivery run posts to one destination subscribed to every event. */
async function postedBodies(): Promise<{ bodies: Posted[]; seeded: Seeded }> {
	const created = await createDestination(db, {
		url: 'https://crm.example.org/hooks/openapi',
		events: WEBHOOK_EVENT_TYPES
	});
	if (!created.ok) throw new Error(created.box);
	const seeded = await seedEverything();
	const { bodies, receiver } = receiving();

	// the feed's pace posts every event seeded in one run.
	await sendDueWebhooks(
		{ db, fetch: receiver, onPaused: async () => undefined },
		new Date(Date.now() + 60_000)
	);
	return { bodies, seeded };
}

type Posted = { type: string; data: Record<string, unknown> };

/** a `fetch` standing in for a receiver, keeping every body posted to it. */
function receiving() {
	const bodies: Posted[] = [];
	const receiver = (async (_: RequestInfo | URL, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)) as Posted);
		return new Response('ok');
	}) as typeof fetch;
	return { bodies, receiver };
}

/** the operation the document gives a post of `type`. */
function postOf(type: string) {
	return (document.webhooks as Record<string, { post: unknown }>)[type]?.post as {
		'x-record'?: string;
		requestBody: { content: { 'application/json': { schema: { $ref: string } } } };
	};
}

/** the component schema the document gives a post of `type` as its body. */
function envelopeOf(type: string): string {
	return postOf(type).requestBody.content['application/json'].schema.$ref.split('/').at(-1) ?? '';
}

describe('the published schemas, against what this deployment renders', () => {
	it.each(Object.entries(document.paths))(
		'describes the page GET %s really answers',
		async (path, operation) => {
			await seedEverything();
			const { key } = await mintApiKey(db, { name: 'Schema check', kind: 'api' });
			const route = listRoutes[path];
			if (route === undefined) throw new Error(`no route mounted for ${path}`);

			const response = await route(
				new Request(`${OWN}/integrations/v1${path}`, {
					headers: { authorization: `Bearer ${key}`, 'cf-connecting-ip': address() }
				})
			);
			const page = (await response.json()) as { data: unknown[] };
			const { $ref } = operation.get.responses['200'].content['application/json'].schema as {
				$ref: string;
			};

			expect(response.status).toBe(200);
			expect(page.data.length).toBeGreaterThan(0);
			expect(schemaErrors(document, $ref.split('/').at(-1) ?? '', page)).toEqual([]);
		}
	);

	it('describes the body of every event the delivery run posts', async () => {
		const { bodies } = await postedBodies();

		expect(bodies.map((body) => body.type).sort()).toEqual([...WEBHOOK_EVENT_TYPES].sort());
		for (const body of bodies)
			expect({
				type: body.type,
				errors: schemaErrors(document, envelopeOf(body.type), body)
			}).toEqual({ type: body.type, errors: [] });
	});

	it('names, for every event, where its record sits and which list it is an entry of', async () => {
		const { bodies, seeded } = await postedBodies();

		expect(bodies).toHaveLength(WEBHOOK_EVENT_TYPES.length);
		for (const body of bodies) {
			const at = postOf(body.type)['x-record'] ?? '';
			const record = at
				.split('.')
				.slice(1)
				.reduce<Record<string, unknown>>(
					(inside, key) => inside[key] as Record<string, unknown>,
					body.data
				);
			const { list } = WEBHOOK_EVENT_DATA[body.type as WebhookEvent].record;
			expect({ type: body.type, id: record.id, stamped: typeof record.updated_at }).toEqual({
				type: body.type,
				id: seeded[list],
				stamped: 'string'
			});
		}
	});

	it('describes the body of the test post a destination’s page sends', async () => {
		const created = await createDestination(db, {
			url: 'https://crm.example.org/hooks/test',
			events: ['gift.made']
		});
		if (!created.ok) throw new Error(created.box);
		const { bodies, receiver } = receiving();

		await sendTestWebhook(receiver, created.destination, new Date());

		expect(bodies.map((body) => body.type)).toEqual([WEBHOOK_TEST_TYPE]);
		expect(schemaErrors(document, envelopeOf(WEBHOOK_TEST_TYPE), bodies[0])).toEqual([]);
	});

	it('refuses an object carrying a key its schema does not describe', () => {
		const donor = {
			id: 'd',
			name: 'Ada Okafor',
			email: null,
			consent: 'unasked',
			created_at: '2026-09-10T12:00:00.000Z',
			updated_at: '2026-09-10T12:00:00.000Z'
		};

		expect(schemaErrors(document, 'Donor', donor)).toEqual([]);
		expect(schemaErrors(document, 'Donor', { ...donor, lifetime_minor: 5_000 })).not.toEqual([]);
	});

	it('refuses a value a set’s known values do not name, though the document takes one', () => {
		const donor = {
			id: 'd',
			name: 'Ada Okafor',
			email: null,
			consent: 'unasked',
			created_at: '2026-09-10T12:00:00.000Z',
			updated_at: '2026-09-10T12:00:00.000Z'
		};

		expect(schemaErrors(document, 'Donor', donor)).toEqual([]);
		expect(schemaErrors(document, 'Donor', { ...donor, consent: 'maybe' })).not.toEqual([]);
	});
});

/** a well-formed key this deployment never made. */
const NEVER_MADE = `bgk_${'A'.repeat(43)}`;

async function live(): Promise<string> {
	return (await mintApiKey(db, { name: 'Refusal check', kind: 'api' })).key;
}

const REFUSALS: readonly {
	readonly code: IntegrationsRefusalCode;
	readonly request: () => Promise<Response>;
}[] = [
	{ code: 'missing_key', request: () => gifts('') },
	{ code: 'malformed_key', request: () => gifts('', 'Basic YWRhOnNlY3JldA==') },
	{ code: 'unknown_key', request: () => gifts('', `Bearer ${NEVER_MADE}`) },
	{
		code: 'revoked_key',
		request: async () => {
			const minted = await mintApiKey(db, { name: 'Gone', kind: 'api' });
			await revokeApiKey(db, minted.id);
			return gifts('', `Bearer ${minted.key}`);
		}
	},
	{
		code: 'not_found',
		request: async () =>
			surfaceRoute(
				new Request(`${OWN}/integrations/v1`, {
					headers: { authorization: `Bearer ${await live()}`, 'cf-connecting-ip': address() }
				})
			)
	},
	{
		code: 'method_not_allowed',
		request: async () => gifts('', `Bearer ${await live()}`, 'POST')
	},
	{
		code: 'rate_limited',
		request: async () => {
			const authorization = `Bearer ${await live()}`;
			for (;;) {
				const response = await gifts('', authorization);
				if (response.status !== 200) return response;
			}
		}
	},
	{ code: 'invalid_limit', request: async () => gifts('?limit=0', `Bearer ${await live()}`) },
	{ code: 'invalid_cursor', request: async () => gifts('?cursor=zz', `Bearer ${await live()}`) },
	{
		code: 'invalid_updated_since',
		request: async () => gifts('?updated_since=yesterday', `Bearer ${await live()}`)
	},
	{ code: 'unknown_parameter', request: async () => gifts('?since=1', `Bearer ${await live()}`) }
];

function gifts(query: string, authorization?: string, method = 'GET'): Promise<Response> {
	const route = listRoutes['/gifts'];
	if (route === undefined) throw new Error('no gifts route mounted');
	return route(
		new Request(`${OWN}/integrations/v1/gifts${query}`, {
			method,
			headers: {
				'cf-connecting-ip': address(),
				...(authorization === undefined ? {} : { authorization })
			}
		})
	);
}

describe('every refusal code, at the status the document gives it', () => {
	it('provokes each code once', () => {
		expect(REFUSALS.map(({ code }) => code).sort()).toEqual(Object.keys(REFUSAL_STATUS).sort());
	});

	it.each(REFUSALS)('answers $code as documented', async ({ code, request }) => {
		const response = await request();

		expect({
			status: response.status,
			error: ((await response.json()) as { error: string }).error
		}).toEqual({
			status: REFUSAL_STATUS[code],
			error: code
		});
	});
});
