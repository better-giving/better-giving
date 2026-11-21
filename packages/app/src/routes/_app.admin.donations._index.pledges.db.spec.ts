import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { readContactSummaries } from '$lib/server/contacts/queries';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { beforeNextBatch } from '$lib/server/db/batch.testing';
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
const mail = vi.hoisted(() => ({
	answer: { ok: true } as
		| { ok: true }
		| { ok: false; reason: string; detail: string; indeterminate: boolean },
	/** a slow transport: every send waits on this before it answers. */
	held: Promise.resolve()
}));

// the mail transport, captured. the receipt itself is rendered for real from the org profile.
vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: { to: string; subject: string; html: string; text: string }) {
			await mail.held;
			sent.push(message);
			return mail.answer;
		}
	})
}));

// the donor read after the commit, made to fail in the one case that needs it.
vi.mock('$lib/server/contacts/queries', async (actual) => {
	const queries = await actual<typeof import('$lib/server/contacts/queries')>();
	return { ...queries, readContactSummaries: vi.fn(queries.readContactSummaries) };
});

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
	mail.answer = { ok: true };
	mail.held = Promise.resolve();
	for (const table of [
		'ledger_entry',
		'entry_group',
		'pledge',
		'payment',
		'line_item',
		'gift_match',
		'donation',
		'contact',
		'supporter_page',
		'supporter',
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

/** one Mark received press, answered, its after-response work left to `settled`. */
function pressMarkReceived(boxes: Record<string, string>) {
	const body = new FormData();
	body.set('__form_id__', 'pledge-received');
	for (const [name, value] of Object.entries(boxes)) body.set(name, value);
	const deferred = createDeferredWork();
	const response = request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie: session, origin: ORIGIN },
			body
		}),
		{ env: bindings, deferred }
	);
	return { response, settled: () => deferred.settled() };
}

/** one Mark received press, its after-response work waited for. */
async function markReceived(boxes: Record<string, string>): Promise<Response> {
	const press = pressMarkReceived(boxes);
	const response = await press.response;
	await press.settled();
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
		expect(await response.json()).toEqual({
			received: {
				pledgeId: STOCK_PLEDGE,
				amount: '$9,512.40',
				donorName: 'Maya Okafor',
				receivedOn: '2026-11-18'
			}
		});
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

	it('sends the donor their receipt once, naming the shares and the day, and no value', async () => {
		await markReceived(STOCK_RECEIVED);

		expect(sent.map((m) => m.to)).toEqual(['maya.okafor@example.org']);
		expect(sent[0]?.subject).toBe('Your donation receipt from Cedar Fork Community Pantry Inc.');
		expect(sent[0]?.text).toContain('Shares received      50 shares of AAPL');
		expect(sent[0]?.text).toMatch(/Date received {8}November \d+, 2026/);
		expect(sent[0]?.text).toContain('In memory of Ruth Hale');
		expect(sent[0]?.text).not.toMatch(/USD|\$|9,512/);
	});

	it('tells the person the donor asked us to tell, once, and keeps who that was on the gift', async () => {
		await run(
			stmt(
				`update pledge set tribute_notify_name = 'Ellen Hale', tribute_notify_email = 'ellen.hale@example.net'
				 where id = ?`,
				STOCK_PLEDGE
			)
		);

		await markReceived(STOCK_RECEIVED);
		await markReceived({ ...STOCK_RECEIVED, value: '10000.00' });

		expect(sent.map((m) => m.to)).toEqual(['maya.okafor@example.org', 'ellen.hale@example.net']);
		expect(sent[1]?.text).toContain('Ruth Hale');
		expect(
			await first(
				stmt(
					'select tribute_notify_name, tribute_notify_email from donation where id = ?',
					STOCK_PLEDGE
				)
			)
		).toEqual({
			tribute_notify_name: 'Ellen Hale',
			tribute_notify_email: 'ellen.hale@example.net'
		});
	});

	it('counts the gift on the supporter’s fundraiser the pledge was made on', async () => {
		const page = '019fb600-0000-7000-8000-0000000000f2';
		await run(
			stmt(
				`insert into supporter (id, email, name, created_at)
				 values ('019fb600-0000-7000-8000-0000000000e1', 'ada@example.org', 'Ada Rivera', 0)`
			)
		);
		await run(
			stmt(
				`insert into supporter_page (id, supporter_id, slug, title, story, goal_minor, currency,
				                            form_id, status, published_at, created_at, updated_at)
				 values (?, '019fb600-0000-7000-8000-0000000000e1', 'run-for-the-pantry',
				         'Run for the pantry', 'I am running.', 50000, 'USD', ?, 'live', 0, 0, 0)`,
				page,
				FORM_ID
			)
		);
		await run(stmt('update pledge set supporter_page_id = ? where id = ?', page, STOCK_PLEDGE));

		await markReceived(STOCK_RECEIVED);

		expect(
			await first(stmt('select supporter_page_id from donation where id = ?', STOCK_PLEDGE))
		).toEqual({ supporter_page_id: page });
	});

	it('records one gift and sends one receipt when two presses arrive together', async () => {
		const answers = await Promise.all([
			markReceived(STOCK_RECEIVED),
			markReceived({ ...STOCK_RECEIVED, value: '10000.00' })
		]);

		expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
		expect(await count('donation')).toBe(1);
		expect(await count('payment')).toBe(1);
		expect(await booked()).toBeOneOf([951240, 1_000_000]);
		expect(sent).toHaveLength(1);
	});

	it('refuses the press whose batch meets a gift another press committed after its read', async () => {
		// the later press reads the pledge unreceived and the earlier one commits before its batch
		// runs, so only the `donation` primary key (../lib/server/donations/receive-pledge.ts) refuses it.
		let earlier: Response | undefined;
		beforeNextBatch(db, async () => {
			earlier = await markReceived({ ...STOCK_RECEIVED, value: '10000.00' });
		});

		const later = await markReceived(STOCK_RECEIVED);

		expect(earlier?.status).toBe(200);
		expect(later.status).toBe(409);
		expect(await count('donation')).toBe(1);
		expect(await booked()).toBe(1_000_000);
		expect(sent).toHaveLength(1);
	});

	it('keeps the gift and alerts the operator when the receipt cannot be sent', async () => {
		mail.answer = {
			ok: false,
			reason: 'timeout',
			detail: 'the host went quiet',
			indeterminate: true
		};
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await markReceived(STOCK_RECEIVED);

		expect(response.status).toBe(200);
		expect(await booked()).toBe(951240);
		expect(
			await first(stmt('select receipt_sent_at from donation where id = ?', STOCK_PLEDGE))
		).toEqual({ receipt_sent_at: null });
		expect(logged).toHaveBeenCalledWith('A donor’s receipt wasn’t sent:', expect.any(String));
		logged.mockRestore();
	});

	it('records nothing on a second press, and says so', async () => {
		await markReceived(STOCK_RECEIVED);
		const again = await markReceived({ ...STOCK_RECEIVED, value: '10000.00' });

		expect(again.status).toBe(409);
		expect(await count('donation')).toBe(1);
		expect(await booked()).toBe(951240);
		expect(sent).toHaveLength(1);
	});

	it('sends the receipt for the recorded gift on the press again after the first could not read the donor', async () => {
		vi.mocked(readContactSummaries).mockRejectedValueOnce(new Error('SQLITE_BUSY'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const IRA_RECEIVED = { pledge_id: IRA_PLEDGE, received_on: '2026-11-17' };

		const pressed = await markReceived({ ...IRA_RECEIVED, value: '4800.00' });
		const again = await markReceived({ ...IRA_RECEIVED, value: '5000.00' });
		const third = await markReceived({ ...IRA_RECEIVED, value: '5000.00' });
		logged.mockRestore();

		expect(pressed.status).toBe(500);
		expect(again.status).toBe(409);
		expect(third.status).toBe(409);
		expect(await count('donation')).toBe(1);
		expect(sent.map((m) => m.to)).toEqual(['j.whitfield@example.com']);
		// the gift as the first press recorded it, not the figure the retry typed.
		expect(sent[0]?.text).toContain('Amount      USD 4,800.00');
		expect(sent[0]?.text).toContain('November 17, 2026');
	});

	it('sends the receipt a failed send handed back on the press again, and none after it went', async () => {
		mail.answer = {
			ok: false,
			reason: 'timeout',
			detail: 'the host went quiet',
			indeterminate: true
		};
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		await markReceived(STOCK_RECEIVED);
		logged.mockRestore();
		mail.answer = { ok: true };
		sent.length = 0;

		expect((await markReceived(STOCK_RECEIVED)).status).toBe(409);
		expect((await markReceived(STOCK_RECEIVED)).status).toBe(409);

		expect(sent.map((m) => m.to)).toEqual(['maya.okafor@example.org']);
		expect(sent[0]?.text).toContain('Shares received      50 shares of AAPL');
	});

	it('answers a press again before a slow transport sends the receipt it still owes, and sends it once', async () => {
		mail.answer = {
			ok: false,
			reason: 'timeout',
			detail: 'the host went quiet',
			indeterminate: true
		};
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		await markReceived(STOCK_RECEIVED);
		logged.mockRestore();
		mail.answer = { ok: true };
		sent.length = 0;
		const { promise: transportAnswers, resolve: answerTransport } = Promise.withResolvers<void>();
		mail.held = transportAnswers;

		const again = pressMarkReceived(STOCK_RECEIVED);
		const twice = pressMarkReceived(STOCK_RECEIVED);
		const answers = [await again.response, await twice.response];

		expect(answers.map((a) => a.status)).toEqual([409, 409]);
		expect(sent).toEqual([]);
		answerTransport();
		await Promise.all([again.settled(), twice.settled()]);
		expect(sent.map((m) => m.to)).toEqual(['maya.okafor@example.org']);
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
		expect(sent[0]?.subject).toBe('Your donation receipt from Cedar Fork Community Pantry Inc.');
		expect(sent[0]?.text).toContain('Amount      USD 4,800.00');
		expect(sent[0]?.text).toContain('November 17, 2026');
		expect(sent[0]?.text).toContain('No goods or services were provided in return for this gift.');
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
