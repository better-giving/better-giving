import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import { campaignRaised } from '$lib/server/pages/goal';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { finishSetup } from '../webhook-routes.testing';
import * as layout from './_app';
import * as donations from './_app.admin.donations._index';

// the Gifts screen's stock and IRA (QCD) pledges, against a real database: the "Waiting to arrive"
// read, and Mark received, which writes the gift, its payment and its entry in one `batch()` and
// sends the donor's receipt after the commit, through the deferred-work tracker.
//
// the chain is mounted rather than the action called, for the reason ./_app.admin.books.db.spec.ts
// gives: the session gate is a middleware on ./_app.tsx.

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);

// the mail transport, captured. the receipt itself is rendered for real from the org profile.
vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: { to: string; subject: string; html: string; text: string }) {
			sent.push(message);
			return { ok: true as const };
		}
	})
}));

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-long-enough-password';
const SCREEN = '/admin/donations';

const MAYA = '019fb600-0000-7000-8000-000000000001';
const JAMES = '019fb600-0000-7000-8000-000000000002';
const FORM_ID = '019fb600-0000-7000-8000-0000000000f1';
const PROGRAM_ID = '019fb600-0000-7000-8000-0000000000a1';
const STOCK_PLEDGE = '019fb600-0000-7000-8000-000000000101';
const IRA_PLEDGE = '019fb600-0000-7000-8000-000000000102';

let db: Db;
let request: RouteRequester;
let bindings: Env;
let session: string;

beforeAll(async () => {
	db = createDb(client);
	bindings = await finishSetup(PASSWORD);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donations', module: donations }
	]);
	session = await signIn();
});

beforeEach(async () => {
	sent.length = 0;
	for (const table of [
		'ledger_entry',
		'entry_group',
		'pledge',
		'payment',
		'line_item',
		'gift_match',
		'donation',
		'contact',
		'form',
		'program',
		'org_profile'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	const account = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500]', '[]', 0, 0)`,
			FORM_ID,
			account?.id ?? ''
		)
	);
	await run(
		stmt(
			`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Food pantry', 'active', 0, 0)`,
			PROGRAM_ID
		)
	);
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Okafor', 'maya.okafor@example.org', 0, 0),
			        (?, 'individual', 'James Whitfield', 'j.whitfield@example.com', 0, 0)`,
			MAYA,
			JAMES
		)
	);
	await run(
		stmt(`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Cedar Fork Community Pantry Inc.', '47-3829105', 'No goods or services were provided.',
		         '412 Alder Lane', 'Cedar Fork', 'US', 'staff@cedarfork.org', 0, 0)`)
	);
	await run(
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, ticker, shares_millionths,
			                     told_at, form_id, program_id, note, tribute_kind, tribute_honoree, created_at)
			 values (?, 'stock', ?, 'USD', 'CFCP-AAPL-7Q2D', 'AAPL', 50000000, 1795000000000, ?, ?,
			         'For the pantry.', 'memory', 'Ruth Hale', 1794000000000)`,
			STOCK_PLEDGE,
			MAYA,
			FORM_ID,
			PROGRAM_ID
		)
	);
	await run(
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, custodian, amount_minor,
			                     form_id, created_at)
			 values (?, 'ira_qcd', ?, 'USD', 'CFCP-IRA-4K9M', 'Fidelity Investments', 500000, ?, 1793000000000)`,
			IRA_PLEDGE,
			JAMES,
			FORM_ID
		)
	);
});

async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.cause);
	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	return headers
		.getSetCookie()
		.map((value) => value.split(';', 1)[0])
		.join('; ');
}

type Drawn = Awaited<ReturnType<typeof donations.loader>>;

async function drawn(): Promise<Drawn> {
	const response = await request(
		new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie: session } }),
		{ env: bindings }
	);
	expect(response.status).toBe(200);
	return (await response.json()) as Drawn;
}

/** one Mark received press, its after-response work waited for. */
async function markReceived(boxes: Record<string, string>): Promise<Response> {
	const body = new FormData();
	body.set('__form_id__', 'pledge-received');
	for (const [name, value] of Object.entries(boxes)) body.set(name, value);
	const deferred = createDeferredWork();
	const response = await request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie: session, origin: ORIGIN },
			body
		}),
		{ env: bindings, deferred }
	);
	await deferred.settled();
	return response;
}

/** what the books hold as given: every donation-revenue credit, as a positive figure. */
async function booked(): Promise<number> {
	const row = await first<{ n: number }>(
		stmt(
			`select coalesce(-sum(e.amount_minor), 0) as n from ledger_entry e
			 join account a on a.id = e.account_id where a.code like '41%'`
		)
	);
	return row?.n ?? 0;
}

async function count(table: string): Promise<number> {
	return (await first<{ n: number }>(stmt(`select count(*) as n from ${table}`)))?.n ?? 0;
}

const STOCK_RECEIVED = { pledge_id: STOCK_PLEDGE, value: '9,512.40', received_on: '2026-11-18' };

describe('a pledge waiting to arrive', () => {
	it('is listed with its donor, what was pledged, its reference and where the donor is', async () => {
		const screen = await drawn();

		expect(screen.waiting).toEqual({
			total: 2,
			pledges: [
				{
					id: STOCK_PLEDGE,
					method: 'stock',
					donorName: 'Maya Okafor',
					donorEmail: 'maya.okafor@example.org',
					pledged: '50 shares of AAPL',
					reference: 'CFCP-AAPL-7Q2D',
					told: true
				},
				{
					id: IRA_PLEDGE,
					method: 'ira_qcd',
					donorName: 'James Whitfield',
					donorEmail: 'j.whitfield@example.com',
					pledged: '$5,000.00 from Fidelity Investments',
					reference: 'CFCP-IRA-4K9M',
					told: false
				}
			]
		});
	});

	it('moves no total and writes no gift, payment or entry', async () => {
		const screen = await drawn();

		expect(screen.donations).toEqual([]);
		expect(await campaignRaised(db, FORM_ID)).toEqual({ raisedMinor: 0 });
		expect(await booked()).toBe(0);
		for (const table of ['donation', 'payment', 'line_item', 'ledger_entry']) {
			expect(await count(table)).toBe(0);
		}
	});
});

describe('Mark received', () => {
	it('records the gift at the value and on the day entered, and it joins the table and the totals', async () => {
		const response = await markReceived(STOCK_RECEIVED);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: { pledgeId: STOCK_PLEDGE } });
		expect(await campaignRaised(db, FORM_ID)).toEqual({ raisedMinor: 951240 });
		expect(await booked()).toBe(951240);

		const screen = await drawn();
		expect(screen.waiting.pledges.map((p) => p.id)).toEqual([IRA_PLEDGE]);
		expect(screen.waiting.total).toBe(1);
		expect(screen.donations).toEqual([
			expect.objectContaining({
				donorName: 'Maya Okafor',
				amount: '$9,512.40',
				receivedOn: '2026-11-18',
				status: 'completed',
				paidWith: 'Stocks',
				program: 'Food pantry',
				note: 'For the pantry.',
				tribute: { kind: 'memory', honoree: 'Ruth Hale' }
			})
		]);
	});

	it('sends the donor their receipt once, naming the shares and the value entered', async () => {
		await markReceived(STOCK_RECEIVED);

		expect(sent.map((m) => m.to)).toEqual(['maya.okafor@example.org']);
		expect(sent[0]?.subject).toBe('Your donation receipt from Cedar Fork Community Pantry Inc.');
		expect(sent[0]?.text).toContain('50 shares of AAPL');
		expect(sent[0]?.text).toContain('Value when received  USD 9,512.40');
		expect(sent[0]?.text).toContain('In memory of Ruth Hale');
	});

	it('records nothing on a second press, and says so', async () => {
		await markReceived(STOCK_RECEIVED);
		const again = await markReceived({ ...STOCK_RECEIVED, value: '10000.00' });

		expect(again.status).toBe(409);
		expect(await count('donation')).toBe(1);
		expect(await booked()).toBe(951240);
		expect(sent).toHaveLength(1);
	});

	it.each([
		['a missing date', { received_on: '' }, 'received_on', 'required'],
		[
			'a date in the future',
			{ received_on: '2999-01-01' },
			'received_on',
			'must not be in the future'
		],
		['a zero value', { value: '0' }, 'value', 'must not be zero'],
		['a missing value', { value: '' }, 'value', 'required']
	])('refuses %s, flags its box and writes nothing', async (_, change, box, message) => {
		const response = await markReceived({ ...STOCK_RECEIVED, ...change });

		expect(response.status).toBe(400);
		const answer = (await response.json()) as {
			form: { result: { error: Record<string, string[]> } };
		};
		expect(answer.form.result.error[box]).toEqual([message]);
		expect(await count('donation')).toBe(0);
		expect(await count('pledge where donation_id is not null')).toBe(0);
		expect(sent).toEqual([]);
	});

	it('refuses a negative value, and writes nothing', async () => {
		const response = await markReceived({ ...STOCK_RECEIVED, value: '-5.00' });

		expect(response.status).toBe(400);
		const answer = (await response.json()) as {
			form: { result: { error: Record<string, string[]> } };
		};
		expect(answer.form.result.error.value).toHaveLength(1);
		expect(await count('donation')).toBe(0);
	});

	it('records an IRA (QCD) gift at the value the check is for, paid with IRA (QCD)', async () => {
		await markReceived({ pledge_id: IRA_PLEDGE, value: '4800.00', received_on: '2026-11-17' });

		const screen = await drawn();
		expect(screen.donations).toEqual([
			expect.objectContaining({
				amount: '$4,800.00',
				paidWith: 'IRA (QCD)',
				receivedOn: '2026-11-17'
			})
		]);
		expect(sent.map((m) => m.to)).toEqual(['j.whitfield@example.com']);
	});

	it('refuses a pledge id that names no pledge, and writes nothing', async () => {
		const response = await markReceived({
			...STOCK_RECEIVED,
			pledge_id: '019fb600-0000-7000-8000-00000000dead'
		});

		expect(response.status).toBe(404);
		expect(await count('donation')).toBe(0);
	});
});
