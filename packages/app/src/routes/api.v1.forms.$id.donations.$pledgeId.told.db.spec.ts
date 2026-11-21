import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { mountRoutes } from '../route-request.testing';
import * as told from './api.v1.forms.$id.donations.$pledgeId.told';
import * as surface from './api.v1';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import { readContactSummaries } from '$lib/server/contacts/queries';

// the donor's "I've contacted my broker" / "I've asked my custodian", driven through react router
// under the `/api/v1` layout so the surface's limit is in front of it, against a real database.

type Message = { to: string; subject: string; html: string; text: string };

const mail = vi.hoisted(() => ({
	sent: [] as Message[],
	answer: { ok: true } as
		| { ok: true }
		| { ok: false; reason: string; detail: string; indeterminate: boolean },
	/** how many sends throw before the transport answers again. */
	throws: 0
}));

// the mailer is the one thing stubbed, so what the organisation was told is read off what it sent.
vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: Message) {
			if (mail.throws > 0) {
				mail.throws -= 1;
				throw new Error('socket hang up');
			}
			mail.sent.push(message);
			return mail.answer;
		}
	})
}));

// the donor read after a press stamps the pledge: the seam where a second press is let in between
// the first one's stamp and its mail. it is the real read unless a test says otherwise.
vi.mock('$lib/server/contacts/queries', async (actual) => {
	const queries = await actual<typeof import('$lib/server/contacts/queries')>();
	return { ...queries, readContactSummaries: vi.fn(queries.readContactSummaries) };
});

const routes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/donations/:pledgeId/told', module: told }
]);

const FORM_ID = 'frm_pledgetold00001';
const OTHER_FORM_ID = 'frm_pledgetold00002';
const ALLOWED = 'https://acme.org';
const OWN = 'https://give.example.workers.dev';
const CONTACT_ID = '01900000-0000-7000-8000-00000000f001';
const STOCK_ID = '0b5f7a52-3d1e-4c8a-9f2b-6e4d1c0a7b93';
const IRA_ID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
/** the alert's headline and subject, `HEADLINE` in ../lib/server/donations/pledge-told.ts. */
const HEADLINE = 'The organisation wasn’t told about a pledge on its way';

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
			 values (?, 'individual', 'Maya Okafor', 'maya.okafor@example.org', 0, 0)`,
			CONTACT_ID
		)
	);
});

beforeEach(async () => {
	mail.sent.length = 0;
	mail.answer = { ok: true };
	mail.throws = 0;
	await client.batch([
		stmt('delete from pledge'),
		stmt('delete from org_profile'),
		stmt(`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		      values ('default', 'Cedar Fork Community Pantry Inc.', '47-3829105', 'staff@cedarfork.org', 0, 0)`),
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, ticker, shares_millionths, form_id, created_at)
			 values (?, 'stock', ?, 'USD', 'CFCP-AAPL-7Q2D', 'AAPL', 50000000, ?, 0)`,
			STOCK_ID,
			CONTACT_ID,
			FORM_ID
		),
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, custodian, amount_minor, form_id, created_at)
			 values (?, 'ira_qcd', ?, 'USD', 'CFCP-IRA-4K9M', 'Fidelity Investments', 500000, ?, 0)`,
			IRA_ID,
			CONTACT_ID,
			FORM_ID
		)
	]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function press({
	formId = FORM_ID,
	pledgeId = STOCK_ID,
	method = 'POST',
	headers = {}
}: {
	formId?: string;
	pledgeId?: string;
	method?: string;
	headers?: Record<string, string>;
} = {}) {
	const deferred = createDeferredWork();
	const response = routes(
		new Request(`${OWN}/api/v1/forms/${formId}/donations/${pledgeId}/told`, {
			method,
			headers: { [CLIENT_IP_HEADER]: `203.0.113.${nextAddress++}`, origin: ALLOWED, ...headers }
		}),
		{ deferred }
	);
	return { response, settled: () => deferred.settled() };
}

const toldAt = (id: string) =>
	first<{ told_at: number | null }>(stmt('select told_at from pledge where id = ?', id));

describe('telling the organisation', () => {
	it('stamps the pledge, answers ok with the form’s CORS, and mails the organisation after', async () => {
		const { response, settled } = press();
		const answer = await response;

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ ok: true });
		expect(answer.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect((await toldAt(STOCK_ID))?.told_at).toEqual(expect.any(Number));

		await settled();
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]).toMatchObject({
			to: 'staff@cedarfork.org',
			subject: 'Maya Okafor says 50 shares of AAPL are on the way'
		});
		expect(mail.sent[0]?.text).toContain('CFCP-AAPL-7Q2D');
	});

	it('says the amount and the custodian of an IRA (QCD) pledge', async () => {
		const { response, settled } = press({ pledgeId: IRA_ID });
		expect((await response).status).toBe(200);
		await settled();
		expect(mail.sent[0]?.subject).toBe(
			'Maya Okafor says USD 5,000.00 from Fidelity Investments is on the way'
		);
	});

	it('answers a second press the same, and mails nobody twice', async () => {
		const once = press();
		await (await once.response).json();
		await once.settled();
		const stamped = (await toldAt(STOCK_ID))?.told_at;

		const again = press();
		const answer = await again.response;
		await again.settled();

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ ok: true });
		expect((await toldAt(STOCK_ID))?.told_at).toBe(stamped);
		expect(mail.sent).toHaveLength(1);
	});

	it('stamps once and mails once when a second press lands between the first one’s stamp and its mail', async () => {
		const real = vi
			.mocked(readContactSummaries)
			.getMockImplementation() as typeof readContactSummaries;
		let secondAnswer: Response | undefined;
		let stampedBeforeSecond: number | null | undefined;
		// the first press has stamped the pledge and is reading the donor for its mail; the second
		// runs to the end here, so only the guarded update's `told_at is null` stands between them.
		vi.mocked(readContactSummaries).mockImplementationOnce(async (...args) => {
			stampedBeforeSecond = (await toldAt(STOCK_ID))?.told_at;
			const second = press();
			secondAnswer = await second.response;
			await second.settled();
			return real(...args);
		});

		const firstPress = press();
		const firstAnswer = await firstPress.response;
		await firstPress.settled();

		expect(stampedBeforeSecond).toEqual(expect.any(Number));
		expect(secondAnswer?.status).toBe(200);
		expect(await secondAnswer?.json()).toEqual({ ok: true });
		expect(firstAnswer.status).toBe(200);
		expect((await toldAt(STOCK_ID))?.told_at).toBe(stampedBeforeSecond);
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.subject).toBe('Maya Okafor says 50 shares of AAPL are on the way');
	});

	it('answers ok and mails nobody for a pledge staff already marked received', async () => {
		await client.batch([
			stmt(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values (?, ?, 951240, 'USD', 0, 0)`,
				STOCK_ID,
				CONTACT_ID
			),
			stmt('update pledge set donation_id = ? where id = ?', STOCK_ID, STOCK_ID)
		]);

		const { response, settled } = press();
		const answer = await response;
		await settled();

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ ok: true });
		expect(mail.sent).toHaveLength(0);
		expect((await toldAt(STOCK_ID))?.told_at).toBeNull();
	});

	it.each([
		[true, 'yes'],
		[false, 'no']
	])(
		'still answers ok when the mail fails, and alerts the operator (indeterminate %s)',
		async (indeterminate, delivered) => {
			mail.answer = { ok: false, reason: 'timeout', detail: 'the host went quiet', indeterminate };
			vi.spyOn(console, 'error').mockImplementation(() => {});

			const { response, settled } = press();
			expect((await response).status).toBe(200);
			await settled();

			expect((await toldAt(STOCK_ID))?.told_at).toEqual(expect.any(Number));
			expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
				['staff@cedarfork.org', 'Maya Okafor says 50 shares of AAPL are on the way'],
				['staff@cedarfork.org', HEADLINE]
			]);
			expect(mail.sent[1]?.text).toContain('CFCP-AAPL-7Q2D');
			expect(mail.sent[1]?.text).toContain('the host went quiet');
			expect(mail.sent[1]?.text).toContain(`May have been delivered anyway: ${delivered}`);
		}
	);

	it('still answers ok when the transport throws, and alerts the operator with the reason', async () => {
		mail.throws = 1;
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const { response, settled } = press();
		expect((await response).status).toBe(200);
		await settled();

		expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([['staff@cedarfork.org', HEADLINE]]);
		expect(mail.sent[0]?.text).toContain('socket hang up');
	});

	it('resolves when the alert’s own send throws too', async () => {
		mail.throws = 2;
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { response, settled } = press();
		expect((await response).status).toBe(200);
		await expect(settled()).resolves.toBeUndefined();

		expect(mail.sent).toEqual([]);
		expect(logged).toHaveBeenCalledWith(`${HEADLINE}:`, expect.stringContaining('CFCP-AAPL-7Q2D'));
	});

	it('mails nobody where no notification address is saved, and the alert reaches the log', async () => {
		await run(stmt('update org_profile set notification_email = null'));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { response, settled } = press();
		expect((await response).status).toBe(200);
		await settled();

		expect((await toldAt(STOCK_ID))?.told_at).toEqual(expect.any(Number));
		expect(mail.sent).toEqual([]);
		expect(logged).toHaveBeenCalledWith(`${HEADLINE}:`, expect.stringContaining('CFCP-AAPL-7Q2D'));
	});
});

describe('the preflight', () => {
	const preflight = (origin: string) =>
		press({
			method: 'OPTIONS',
			headers: {
				origin,
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'content-type'
			}
		});

	it('grants a page the form names a JSON POST, and stamps nothing', async () => {
		const { response, settled } = preflight(ALLOWED);
		const answer = await response;
		await settled();

		expect(answer.status).toBe(204);
		expect(answer.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(answer.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
		expect(answer.headers.get('access-control-allow-headers')).toBe('content-type');
		expect((await toldAt(STOCK_ID))?.told_at).toBeNull();
		expect(mail.sent).toEqual([]);
	});

	it('grants another site nothing', async () => {
		const answer = await preflight('https://attacker.test').response;

		expect(answer.status).toBe(204);
		expect(answer.headers.has('access-control-allow-origin')).toBe(false);
	});
});

describe('refusals', () => {
	it.each([
		['an id no pledge has', { pledgeId: '11111111-2222-4333-8444-555555555555' }],
		['another form’s pledge', { formId: OTHER_FORM_ID }],
		['an id that is no UUID', { pledgeId: 'not-a-pledge' }]
	])('answers a coded 404 for %s, and tells nobody', async (_label, over) => {
		const { response, settled } = press(over);
		const answer = await response;
		await settled();

		expect(answer.status).toBe(404);
		expect(await answer.json()).toMatchObject({ error: 'pledge_not_found' });
		expect(answer.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(mail.sent).toHaveLength(0);
		expect((await toldAt(STOCK_ID))?.told_at).toBeNull();
	});

	it.each(['GET', 'PUT', 'DELETE'])(
		'answers %s 405, naming the methods it takes, and stamps nothing',
		async (method) => {
			const { response, settled } = press({ method });
			const answer = await response;
			await settled();

			expect(answer.status).toBe(405);
			expect(answer.headers.get('allow')).toBe('POST, OPTIONS');
			expect(answer.headers.get('cache-control')).toBe('no-store');
			expect((await toldAt(STOCK_ID))?.told_at).toBeNull();
			expect(mail.sent).toEqual([]);
		}
	);
});
