import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { mountRoutes } from '../route-request.testing';
import * as employer from './api.v1.forms.$id.gifts.$token.employer';
import * as surface from './api.v1';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the donor naming their employer from the thank-you, driven through react router under the
// `/api/v1` layout so the surface's limit is in front of it, against a real database.

const routes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/gifts/:token/employer', module: employer }
]);

const FORM_ID = 'frm_employerwrite01';
const OTHER_FORM_ID = 'frm_employerwrite02';
const ALLOWED = 'https://acme.org';
const OWN = 'https://give.example.workers.dev';
const CONTACT_ID = '01900000-0000-7000-8000-00000000e001';
const DONATION_ID = '01900000-0000-7000-8000-00000000e002';
const TOKEN = '0123456789abcdefghjkmnpqrstvwxyz';

let nextAddress = 1;

beforeAll(async () => {
	const account = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	for (const id of [FORM_ID, OTHER_FORM_ID]) {
		await run(
			stmt(
				`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
				                   suggested_amounts, allowed_origins, created_at, updated_at)
				 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500]', ?, 0, 0)`,
				id,
				account?.id ?? '',
				JSON.stringify([ALLOWED])
			)
		);
	}
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Reyes', 'maya@example.org', 0, 0)`,
			CONTACT_ID
		)
	);
});

beforeEach(async () => {
	await client.batch([
		stmt('delete from payment'),
		stmt('delete from gift_match'),
		stmt('delete from donation')
	]);
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, form_id, created_at)
			 values (?, ?, 15000, 'USD', 0, ?, 0)`,
			DONATION_ID,
			CONTACT_ID,
			FORM_ID
		)
	);
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values ('01900000-0000-7000-8000-00000000e003', ?, 15000, 'USD', 'inbound', 'card', 'succeeded', 0, 0)`,
			DONATION_ID
		)
	);
	await run(
		stmt(
			'insert into gift_match (id, donation_id, token, created_at) values (?, ?, ?, 0)',
			'01900000-0000-7000-8000-00000000e004',
			DONATION_ID,
			TOKEN
		)
	);
});

function post(
	body: unknown,
	{ formId = FORM_ID, token = TOKEN, origin = ALLOWED, method = 'POST' } = {}
) {
	const deferred = createDeferredWork();
	const response = routes(
		new Request(`${OWN}/api/v1/forms/${formId}/gifts/${token}/employer`, {
			method,
			headers: {
				[CLIENT_IP_HEADER]: `203.0.113.${nextAddress++}`,
				origin,
				'content-type': 'application/json'
			},
			...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
		}),
		{ deferred }
	);
	return { response, settled: () => deferred.settled() };
}

const stored = () =>
	first<{ employer: string | null; pack_failed_at: number | null; reminder_due_at: number | null }>(
		stmt('select employer, pack_failed_at, reminder_due_at from gift_match where token = ?', TOKEN)
	);

describe('naming the employer', () => {
	it('stores it, answers ok with the form’s CORS, and tries the pack after the answer', async () => {
		const { response, settled } = post({ employer: '  Northwind Logistics ' });
		const answer = await response;

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ ok: true });
		expect(answer.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		await settled();
		// this spec's env delivers no mail, so the pack the write owed is stamped as failed.
		expect(await stored()).toMatchObject({
			employer: 'Northwind Logistics',
			reminder_due_at: expect.any(Number),
			pack_failed_at: expect.any(Number)
		});
	});

	it('answers ok again for the same employer, changing nothing', async () => {
		await (await post({ employer: 'Northwind' }).response).text();
		const again = await post({ employer: 'Northwind' }).response;
		expect(again.status).toBe(200);
	});

	it.each([
		['not JSON', 'employer=Northwind'],
		['no employer', {}],
		['a blank employer', { employer: '   ' }],
		['an employer past 200 characters', { employer: 'x'.repeat(201) }],
		['an employer that is not text', { employer: 42 }]
	])('refuses %s with 400, a sentence and the CORS header', async (_, body) => {
		const answer = await post(body).response;
		expect(answer.status).toBe(400);
		const refusal = (await answer.json()) as { message?: string; fix?: string };
		expect(refusal.message).toEqual(expect.any(String));
		expect(refusal.fix).toEqual(expect.any(String));
		expect(answer.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect((await stored())?.employer).toBeNull();
	});
});

describe('a token this write does not answer for', () => {
	it.each([
		['unknown', { token: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }],
		['malformed', { token: 'not-a-token' }],
		['for a gift on another form', { formId: OTHER_FORM_ID }]
	])('is the same 404 when it is %s, and writes nothing', async (_, where) => {
		const answer = await post({ employer: 'Northwind' }, where).response;
		expect(answer.status).toBe(404);
		const body = (await answer.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(['fix', 'message']);
		expect((await stored())?.employer).toBeNull();
	});
});

describe('the other methods', () => {
	it('grants the preflight a JSON POST from the form’s origin', async () => {
		const answer = await post(undefined, { method: 'OPTIONS' }).response;
		expect(answer.headers.get('access-control-allow-methods')).toContain('POST');
		expect(answer.headers.get('access-control-allow-headers')).toBe('content-type');
	});

	it('answers a GET 405', async () => {
		expect((await post(undefined, { method: 'GET' }).response).status).toBe(405);
	});
});
