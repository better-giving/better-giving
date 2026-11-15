import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { mountRoutes } from '../route-request.testing';
import * as employer from './api.v1.forms.$id.gifts.$token.employer';
import * as surface from './api.v1';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the donor naming their employer from the thank-you, driven through react router under the
// `/api/v1` layout so the surface's limit is in front of it, against a real database.

type Message = { to: string; subject: string; html: string; text: string };

const sent = vi.hoisted(() => [] as Message[]);

// the mailer is the one thing stubbed, so the pack's going is read off the message it sent.
vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: Message) {
			sent.push(message);
			return { ok: true as const };
		}
	})
}));

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
	sent.length = 0;
	await client.execute('delete from org_profile');
	await writeOrgRow(client, { tax_id: '12-3456789' });
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
	{
		formId = FORM_ID,
		token = TOKEN,
		origin = ALLOWED,
		method = 'POST',
		signal
	}: {
		formId?: string;
		token?: string;
		origin?: string;
		method?: string;
		signal?: AbortSignal;
	} = {}
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
			...(method === 'POST'
				? body instanceof ReadableStream
					? { body, duplex: 'half' }
					: { body: typeof body === 'string' ? body : JSON.stringify(body) }
				: {}),
			...(signal === undefined ? {} : { signal })
		}),
		{ deferred }
	);
	return { response, settled: () => deferred.settled() };
}

const stored = () =>
	first<{
		employer: string | null;
		pack_sent_at: number | null;
		pack_failed_at: number | null;
		reminder_due_at: number | null;
	}>(
		stmt(
			'select employer, pack_sent_at, pack_failed_at, reminder_due_at from gift_match where token = ?',
			TOKEN
		)
	);

describe('naming the employer', () => {
	// no address is pinned here, so the pack promises no reminder and arms none (`GiftOrigin` in
	// $lib/server/matching/links.ts).
	it('stores it, answers ok with the form’s CORS, and tries the pack after the answer', async () => {
		const { response, settled } = post({ employer: '  Northwind Logistics ' });
		const answer = await response;

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ ok: true });
		expect(answer.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		await settled();
		const row = await stored();
		expect(row).toMatchObject({
			employer: 'Northwind Logistics',
			pack_sent_at: expect.any(Number),
			pack_failed_at: null
		});
		expect(row?.reminder_due_at).toBeNull();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ to: 'maya@example.org' });
		expect(sent[0]?.subject).toContain('Northwind Logistics');
	});

	// the form's Skip and its timeout abort the request, which node-fetch-server turns into the
	// request's signal. here it aborts while the body is read, past the layout's middleware.
	it('stores nothing and sends no pack where the form stopped waiting before the write', async () => {
		const stopped = new AbortController();
		// no queue to fill, so nothing pulls the body until the action reads it.
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					stopped.abort();
					controller.enqueue(new TextEncoder().encode(JSON.stringify({ employer: 'Northwind' })));
					controller.close();
				}
			},
			{ highWaterMark: 0 }
		);
		const { response, settled } = post(body, { signal: stopped.signal });
		await (await response).text();
		await settled();

		expect(await stored()).toMatchObject({ employer: null, pack_sent_at: null });
		expect(sent).toHaveLength(0);
	});

	it('stores it and stamps the pack as failed, arming no reminder, where the pack cannot be written', async () => {
		await client.execute('delete from org_profile');
		const { response, settled } = post({ employer: 'Northwind' });
		expect((await response).status).toBe(200);
		await settled();

		expect(await stored()).toMatchObject({
			employer: 'Northwind',
			pack_sent_at: null,
			pack_failed_at: expect.any(Number),
			reminder_due_at: null
		});
		expect(sent).toHaveLength(0);
	});

	it('answers ok again for the same employer, changing nothing and sending no second pack', async () => {
		const first = post({ employer: 'Northwind' });
		await (await first.response).text();
		await first.settled();
		const before = await stored();

		const again = post({ employer: 'Northwind' });
		expect((await again.response).status).toBe(200);
		await again.settled();

		expect(await stored()).toEqual(before);
		expect(before).toMatchObject({ employer: 'Northwind', pack_sent_at: expect.any(Number) });
		expect(sent).toHaveLength(1);
	});

	it('stores a changed employer after the pack went, keeping its reminder and sending no second pack', async () => {
		const first = post({ employer: 'Northwind' });
		await (await first.response).text();
		await first.settled();
		const before = await stored();

		const changed = post({ employer: 'Contoso' });
		expect((await changed.response).status).toBe(200);
		await changed.settled();

		expect(await stored()).toEqual({ ...before, employer: 'Contoso' });
		expect(sent).toHaveLength(1);
	});

	it.each([
		['not JSON', 'employer=Northwind'],
		['no employer', {}],
		['a blank employer', { employer: '   ' }],
		['an employer past 200 characters', { employer: 'x'.repeat(201) }],
		['an employer holding a NUL', { employer: 'North\u0000wind' }],
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

describe('a closed match', () => {
	it.each([
		[
			'voided',
			`update gift_match set voided_at = 1, voided_by = 'staff', void_reason = 'Duplicate gift' where token = ?`
		],
		['matched', `update gift_match set matched_at = 1, matched_by = 'staff' where token = ?`]
	])('refuses a %s gift with 409, a sentence and the CORS header', async (_, close) => {
		await run(stmt(close, TOKEN));
		const answer = await post({ employer: 'Northwind' }).response;
		expect(answer.status).toBe(409);
		const refusal = (await answer.json()) as Record<string, unknown>;
		expect(Object.keys(refusal).sort()).toEqual(['fix', 'message']);
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
