import { createStaticHandler, type LoaderFunction } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import { markFiled, markMatched, nameEmployer, voidMatch } from '$lib/server/matching/match';
import { createDeferredWork, type DeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { requestContext } from '../request-context';
import { queryDocument } from '../route-request.testing';
import type { Route } from './+types/gift.$token';
import * as giftPage from './gift.$token';

// the donor's own page for one gift, against a real database: what the loader hands the page for
// each state of the claim, and what each post writes.
//
// the loader goes through `queryDocument`, because its refusal is a `data()` whose status is the
// answer. the action is called directly, as ./forgot.db.spec.ts calls its own: no `middleware` sits
// above this route, and `queryRoute` drops the status a refusal carries.
//
// the mailer is the one thing stubbed: the pack is the write's after-response work, and the
// assertion worth having is that it went to this gift's donor.

type Message = { to: string; subject: string; html: string; text: string };

const sent = vi.hoisted(() => [] as Message[]);

vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: Message) {
			sent.push(message);
			return { ok: true as const };
		}
	})
}));

const OWN = 'https://give.example';
const CONTACT_ID = '019fba00-0000-7000-8000-000000000001';
const STAFF = '01HSTAFFMEMBER000000000001';
const REASON = 'Duplicate of an earlier claim 5521';
const T0 = new Date('2026-11-12T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

const env = {
	...readEnv({}, specRateLimiters()),
	SMTP_HOST: 'smtp.example.org',
	SMTP_USERNAME: 'apikey',
	SMTP_PASSWORD: 'mail-secret',
	MAIL_FROM: 'giving@example.org'
} as Env;

let db: Db;
let next = 0;
const fresh = () => `019fba00-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

/** a gift with a match row, in the books where `settled` says. answers its id and token. */
async function gift(settled = true): Promise<{ donationId: string; token: string }> {
	const donationId = fresh();
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, fee_minor, received_at, receipt_sent_at, created_at)
			 values (?, ?, 15000, 'USD', 0, ?, ?, 0)`,
			donationId,
			CONTACT_ID,
			T0.getTime(),
			T0.getTime()
		)
	);
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values (?, ?, 15000, 'USD', 'inbound', 'card', ?, ?, 0)`,
			fresh(),
			donationId,
			settled ? 'succeeded' : 'pending',
			T0.getTime()
		)
	);
	const token = `${String(next).padStart(4, '0')}abcdefghjkmnpqrstvwxyz012345`;
	await run(
		stmt(
			'insert into gift_match (id, donation_id, token, created_at) values (?, ?, ?, 0)',
			fresh(),
			donationId,
			token
		)
	);
	return { donationId, token };
}

beforeAll(async () => {
	db = createDb(client);
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Reyes', 'maya.reyes@example.com', 0, 0)`,
			CONTACT_ID
		)
	);
	await run(
		stmt(
			`insert into org_profile (id, legal_name, tax_id, deductibility_statement, brand_colour, created_at, updated_at)
			 values ('default', 'Greenfield Food Bank Inc.', '12-3456789', 'No goods or services.', '#2f6f4e', 0, 0)`
		)
	);
});

const ROUTE_ID = 'gift';
const handler = createStaticHandler([
	{ id: ROUTE_ID, path: 'gift/:token', loader: giftPage.loader as unknown as LoaderFunction }
]);

type LoaderData = Route.ComponentProps['loaderData'];

async function visit(token: string, on: Env = env): Promise<{ status: number; data: LoaderData }> {
	const answered = await queryDocument(
		handler,
		new Request(`${OWN}/gift/${token}`),
		requestContext({ env: on, deferred: createDeferredWork(), client })
	);
	return {
		status: answered.statusCode,
		data: answered.loaderData[ROUTE_ID] as LoaderData
	};
}

/** the page's data as the document serializes it, for searching. */
const serialized = (data: LoaderData) => JSON.stringify(data);

describe('the page', () => {
	it('is a 404 with no gift data for a token no gift holds', async () => {
		const answered = await visit('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
		expect(answered.status).toBe(404);
		expect(answered.data).toEqual({ kind: 'refused' });
	});

	it('is the same 404 for a gift not in the books yet', async () => {
		const { token } = await gift(false);
		const answered = await visit(token);
		expect(answered.status).toBe(404);
		expect(answered.data).toEqual({ kind: 'refused' });
	});

	it('hands the page the organisation by its legal name, its look and the gift', async () => {
		const { token } = await gift();
		const answered = await visit(token);
		expect(answered.status).toBe(200);
		expect(answered.data).toMatchObject({
			kind: 'gift',
			orgName: 'Greenfield Food Bank Inc.',
			logo: null,
			look: { brandColour: '#2f6f4e' },
			gift: { employer: null, filedAt: null, voidedAt: null, refundedAt: null }
		});
	});

	it('carries its own gift’s employer and no other’s', async () => {
		const mine = await gift();
		const theirs = await gift();
		await nameEmployer(db, { donationId: mine.donationId }, 'Northwind Traders');
		await nameEmployer(db, { donationId: theirs.donationId }, 'Contoso Zeppelin 8812');
		const answered = serialized((await visit(mine.token)).data);
		expect(answered).toContain('Northwind Traders');
		expect(answered).not.toContain('Contoso Zeppelin 8812');
	});

	it('shows a filed gift as filed', async () => {
		const { donationId, token } = await gift();
		await markFiled(db, { donationId }, 'donor', T0);
		expect((await visit(token)).data).toMatchObject({ gift: { filedAt: T0 } });
	});

	it('shows a voided gift as voided, with neither the reason nor who voided it', async () => {
		const { donationId, token } = await gift();
		await voidMatch(db, { donationId }, STAFF, REASON, T0);
		const answered = await visit(token);
		expect(answered.data).toMatchObject({ gift: { voidedAt: T0 } });
		expect(serialized(answered.data)).not.toContain(REASON);
		expect(serialized(answered.data)).not.toContain(STAFF);
	});

	it('shows a gift staff marked matched and filed, with neither staff id', async () => {
		const { donationId, token } = await gift();
		await markFiled(db, { donationId }, STAFF, T0);
		await markMatched(db, { donationId }, `${STAFF}-2`, T0);
		const answered = await visit(token);
		expect(answered.data).toMatchObject({ gift: { filedAt: T0, matchedAt: T0 } });
		expect(serialized(answered.data)).not.toContain(STAFF);
	});

	it('shows a refunded gift as refunded', async () => {
		const { donationId, token } = await gift();
		const at = new Date(T0.getTime() + DAY_MS);
		await run(
			stmt(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
				 values (?, ?, 15000, 'USD', 'refund', 'card', 'succeeded', ?, 0)`,
				fresh(),
				donationId,
				at.getTime()
			)
		);
		expect((await visit(token)).data).toMatchObject({ gift: { refundedAt: at } });
	});

	it('promises the armed reminder only where an address is pinned for the sweep', async () => {
		const { donationId, token } = await gift();
		await run(
			stmt(
				`update gift_match set employer = 'Northwind', pack_sent_at = ?, reminder_due_at = ?
				 where donation_id = ?`,
				T0.getTime(),
				T0.getTime() + 3 * DAY_MS,
				donationId
			)
		);

		expect((await visit(token)).data).toMatchObject({ gift: { reminderPromised: false } });
		expect((await visit(token, { ...env, BETTER_AUTH_URL: OWN })).data).toMatchObject({
			gift: { reminderPromised: true }
		});
	});
});

/** the execution context the last post was made with, so its deferred send can be waited on. */
let running: DeferredWork;

/** a post to the page, as its own forms submit one; `site` is the browser's `Sec-Fetch-Site`. */
async function post(token: string, fields: Record<string, string>, site = 'same-origin') {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	running = createDeferredWork();
	const request = new Request(`${OWN}/gift/${token}`, {
		method: 'POST',
		headers: { 'sec-fetch-site': site },
		body
	});
	const answer = await giftPage.action({
		request,
		url: new URL(request.url),
		params: { token },
		pattern: '/gift/:token',
		context: requestContext({ env, deferred: running, client })
	} as Route.ActionArgs);
	// a refusal is `invalid()`'s `data()`, with the status on it; an accepted post is the bare value.
	return 'init' in answer
		? { status: answer.init?.status ?? 200, data: answer.data }
		: { status: 200, data: answer };
}

/** what a post threw, as the response the deployment sends. */
async function thrown(call: Promise<unknown>): Promise<Response> {
	try {
		await call;
	} catch (error) {
		if (error instanceof Response) return error;
		throw error;
	}
	throw new Error('the post was answered rather than refused');
}

const stamps = (donationId: string) =>
	first<{
		employer: string | null;
		reminder_due_at: number | null;
		pack_sent_at: number | null;
		filed_at: number | null;
		filed_by: string | null;
	}>(
		stmt(
			'select employer, reminder_due_at, pack_sent_at, filed_at, filed_by from gift_match where donation_id = ?',
			donationId
		)
	);

describe('naming the employer', () => {
	// no address is pinned here, so the pack promises no reminder and arms none (`GiftOrigin` in
	// $lib/server/matching/links.ts).
	it('stores it and mails the pack after the answer, arming no reminder', async () => {
		const { donationId, token } = await gift();
		sent.length = 0;

		const answered = await post(token, { intent: 'employer', employer: '  Northwind Traders ' });

		expect(answered).toMatchObject({ status: 200, data: { done: 'employer' } });
		const row = await stamps(donationId);
		expect(row?.employer).toBe('Northwind Traders');
		await running.settled();
		expect((await stamps(donationId))?.reminder_due_at).toBeNull();
		expect(sent.map((message) => message.to)).toEqual(['maya.reyes@example.com']);
		expect((await stamps(donationId))?.pack_sent_at).not.toBeNull();
	});

	it('refuses a blank employer with a 400 at the box, writing nothing', async () => {
		const { donationId, token } = await gift();
		const answered = await post(token, { intent: 'employer', employer: '   ' });
		expect(answered.status).toBe(400);
		expect(answered.data).toMatchObject({ intent: 'employer', error: expect.any(String) });
		expect((await stamps(donationId))?.employer).toBeNull();
	});

	it('refuses an employer past 200 characters with a 400 at the box', async () => {
		const { donationId, token } = await gift();
		const answered = await post(token, { intent: 'employer', employer: 'x'.repeat(201) });
		expect(answered.status).toBe(400);
		expect(answered.data).toMatchObject({ intent: 'employer', error: expect.any(String) });
		expect((await stamps(donationId))?.employer).toBeNull();
	});

	it('takes 200 characters that are not 200 code units', async () => {
		const { donationId, token } = await gift();
		const answered = await post(token, { intent: 'employer', employer: '🌱'.repeat(200) });
		expect(answered.status).toBe(200);
		expect((await stamps(donationId))?.employer).toBe('🌱'.repeat(200));
	});

	it.each([
		['voided', (donationId: string) => voidMatch(db, { donationId }, STAFF, REASON, T0)],
		['matched', (donationId: string) => markMatched(db, { donationId }, STAFF, T0)]
	])('is refused in plain words on a %s gift, never a 404 or a 500', async (_, close) => {
		const { donationId, token } = await gift();
		await close(donationId);
		const answered = await post(token, { intent: 'employer', employer: 'Northwind Traders' });
		expect(answered.status).toBe(409);
		expect(answered.data).toMatchObject({ intent: 'employer', error: expect.any(String) });
		expect(JSON.stringify(answered.data)).not.toContain(REASON);
		expect((await stamps(donationId))?.employer).toBeNull();
	});
});

describe('marking it filed', () => {
	it('stamps the donor as the filer, with no employer named', async () => {
		const { donationId, token } = await gift();
		const answered = await post(token, { intent: 'filed' });
		expect(answered).toMatchObject({ status: 200, data: { done: 'filed' } });
		const row = await stamps(donationId);
		expect(row?.filed_by).toBe('donor');
		expect(row?.filed_at).not.toBeNull();
		expect(row?.employer).toBeNull();
	});

	it('stamps once when pressed twice, and answers both as filed', async () => {
		const { donationId, token } = await gift();
		await post(token, { intent: 'filed' });
		const once = (await stamps(donationId))?.filed_at;
		const again = await post(token, { intent: 'filed' });
		expect(again).toMatchObject({ status: 200, data: { done: 'filed' } });
		expect((await stamps(donationId))?.filed_at).toBe(once);
	});

	it('is refused in plain words on a voided gift, writing nothing', async () => {
		const { donationId, token } = await gift();
		await voidMatch(db, { donationId }, STAFF, REASON, T0);
		const answered = await post(token, { intent: 'filed' });
		expect(answered.status).toBe(409);
		expect(answered.data).toMatchObject({ intent: 'filed', error: expect.any(String) });
		expect((await stamps(donationId))?.filed_at).toBeNull();
	});

	it('answers a matched gift as filed, which counts as filed, stamping nothing', async () => {
		const { donationId, token } = await gift();
		await markMatched(db, { donationId }, STAFF, T0);
		const answered = await post(token, { intent: 'filed' });
		expect(answered).toMatchObject({ status: 200, data: { done: 'filed' } });
		expect((await stamps(donationId))?.filed_at).toBeNull();
	});
});

describe('a post', () => {
	it('is refused from another origin before anything is written', async () => {
		const { donationId, token } = await gift();
		const refusal = await thrown(post(token, { intent: 'filed' }, 'cross-site'));
		expect(refusal.status).toBe(403);
		expect((await stamps(donationId))?.filed_at).toBeNull();
	});

	it('is the page’s 404 for a token no gift holds, and for a gift not in the books', async () => {
		const unsettled = await gift(false);
		for (const token of ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', unsettled.token]) {
			expect((await post(token, { intent: 'filed' })).status).toBe(404);
		}
		expect((await stamps(unsettled.donationId))?.filed_at).toBeNull();
	});

	it('is a 400 when the body is not a form, never a 500', async () => {
		const { token } = await gift();
		const request = new Request(`${OWN}/gift/${token}`, {
			method: 'POST',
			headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
			body: '{"intent":"filed"}'
		});
		const answer = await giftPage.action({
			request,
			url: new URL(request.url),
			params: { token },
			pattern: '/gift/:token',
			context: requestContext({ env, deferred: createDeferredWork(), client })
		} as Route.ActionArgs);
		expect('init' in answer ? answer.init?.status : 200).toBe(400);
	});

	it('is a 400 when it names neither intent', async () => {
		const { token } = await gift();
		expect((await post(token, { intent: 'matched' })).status).toBe(400);
	});
});
