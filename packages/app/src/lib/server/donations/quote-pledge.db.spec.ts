import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import type { TurnstileCheck, TurnstileResult } from '../api/turnstile';
import type { EmailProvider } from '../email/provider';
import { campaignRaised } from '../pages/goal';
import { enablePledgeRail } from '../payments/pledge-rails';
import { soleProcessor } from '../payments/processors.testing';
import { type PaymentProvider, refusing } from '../payments/provider';
import { parseContact } from '../contacts/contact-input';
import { type PledgeToSave, REFERENCE_DRAWS, savePledge } from './pledges';
import { mintQuote, type QuoteDeps } from './quote';
import { receivePledge } from './receive-pledge';
import { replaceTickers } from './tickers';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// a stock or IRA (QCD) pledge through `POST /api/v1/forms/:id/donations`, against a real database.
//
// the processor port refuses every call: a pledge is no processor's, so a case that reached one
// would fail here rather than pass on a stub's good answer.

const FORM_ID = 'frm_quotepledge0001';
const OTHER_FORM_ID = 'frm_quotepledge0002';
const FUNDRAISER_FORM_ID = 'frm_quotepledge0003';
const FUNDRAISER_PAGE_ID = '019fb600-0000-7000-8000-0000000000f2';
const ALLOWED = 'https://acme.org';
const PLEDGE_ID = '0b5f7a52-3d1e-4c8a-9f2b-6e4d1c0a7b93';

/** a deployment that cannot send mail: no `SMTP_*` and no `MAIL_FROM`. */
const NO_MAIL = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc',
	TURNSTILE_SECRET_KEY: '0xSECRET'
};

const ENV = {
	...NO_MAIL,
	SMTP_HOST: 'mail.cedarfork.org',
	SMTP_USERNAME: 'apikey',
	SMTP_PASSWORD: 'pw',
	MAIL_FROM: 'giving@cedarfork.org'
};

const STOCK_DETAILS = {
	brokerageName: 'Harbor Street Securities',
	dtcNumber: '0164',
	accountNumber: 'Z12-345678',
	accountName: 'Cedar Fork Community Pantry Inc.'
};

const IRA_DETAILS = {
	payeeName: 'Cedar Fork Community Pantry Inc.',
	mailingAddress: '412 Alder Lane, Suite 3\nCedar Fork, OR 97330'
};

let db: Db;

beforeAll(async () => {
	db = createDb(client);
	const account = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	for (const id of [FORM_ID, OTHER_FORM_ID, FUNDRAISER_FORM_ID]) {
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
			`insert into supporter (id, email, name, created_at)
			 values ('019fb600-0000-7000-8000-0000000000f1', 'ada@example.org', 'Ada Rivera', 0)`
		)
	);
	await run(
		stmt(
			`insert into supporter_page (id, supporter_id, slug, title, story, goal_minor, currency,
			                            form_id, status, published_at, created_at, updated_at)
			 values (?, '019fb600-0000-7000-8000-0000000000f1', 'run-for-the-pantry',
			         'Run for the pantry', 'I am running.', 50000, 'USD', ?, 'live', 0, 0, 0)`,
			FUNDRAISER_PAGE_ID,
			FUNDRAISER_FORM_ID
		)
	);
	await replaceTickers(db, [
		{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq', kind: 'company' },
		{ symbol: 'MSFT', name: 'Microsoft Corp', exchange: 'Nasdaq', kind: 'company' }
	]);
});

beforeEach(async () => {
	await client.batch([
		// a received pledge's gift and its books, written by one case below.
		stmt('delete from ledger_entry'),
		stmt('delete from entry_group'),
		stmt('delete from pledge'),
		stmt('delete from payment'),
		stmt('delete from line_item'),
		stmt('delete from gift_match'),
		stmt('delete from donation'),
		stmt('delete from pledge_rail'),
		stmt('delete from contact'),
		stmt('delete from org_profile'),
		stmt(`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		      values ('default', 'Cedar Fork Community Pantry Inc.', '47-3829105', 'staff@cedarfork.org', 0, 0)`)
	]);
	await enablePledgeRail(db, { rail: 'stock', details: STOCK_DETAILS });
	await enablePledgeRail(db, { rail: 'ira_qcd', details: IRA_DETAILS });
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** the refusing port, recording the name of every method a case calls on it. */
function recordingRefusal(reached: string[]): PaymentProvider {
	const port = refusing('stripe', 'unreachable', 'a pledge reached a processor');
	return new Proxy(port, {
		get(target, key, receiver) {
			const value: unknown = Reflect.get(target, key, receiver);
			if (typeof value !== 'function') return value;
			return (...args: unknown[]) => {
				reached.push(String(key));
				return value.apply(target, args);
			};
		}
	});
}

function deps(
	result: TurnstileResult = { ok: true }
): QuoteDeps & { checks: TurnstileCheck[]; reached: string[] } {
	const checks: TurnstileCheck[] = [];
	const reached: string[] = [];
	const email: EmailProvider = {
		async send() {
			throw new Error('saving a pledge sends no mail');
		}
	};
	return {
		db,
		env: ENV,
		processors: soleProcessor(recordingRefusal(reached)),
		verifyChallenge: async (check) => {
			checks.push(check);
			return result;
		},
		email,
		defer: () => {
			throw new Error('saving a pledge defers nothing');
		},
		checks,
		reached
	};
}

const donor = {
	email: 'maya.okafor@example.org',
	firstName: 'Maya',
	lastName: 'Okafor',
	consentedToContact: false,
	turnstileToken: 'tok'
};

const stock = (over: Record<string, unknown> = {}) => ({
	formId: FORM_ID,
	method: 'stock',
	frequency: 'one_time',
	pledgeId: PLEDGE_ID,
	ticker: 'AAPL',
	shares: '50',
	...donor,
	...over
});

const ira = (over: Record<string, unknown> = {}) => ({
	formId: FORM_ID,
	method: 'ira_qcd',
	frequency: 'one_time',
	amountMinor: 10_000,
	coversFee: false,
	pledgeId: PLEDGE_ID,
	custodian: 'Fidelity Investments',
	...donor,
	...over
});

const save = (body: unknown, d: QuoteDeps = deps(), formId = FORM_ID) =>
	mintQuote(d, {
		formId,
		body,
		request: new Request(`https://give.example.workers.dev/api/v1/forms/${formId}/donations`, {
			method: 'POST',
			headers: { origin: ALLOWED }
		})
	});

const pledges = () => client.execute('select * from pledge').then((r) => r.rows);
const contacts = () => client.execute('select id from contact').then((r) => r.rows);

describe('mintQuote() — a pledge and the processors', () => {
	it.each([
		['stock', stock],
		['ira_qcd', ira]
	] as const)(
		'saves a %s pledge asking no processor anything, its cadences and rails included',
		async (_, body) => {
			const d = deps();
			const result = await save(body(), d);

			expect(result.ok).toBe(true);
			expect(d.reached).toEqual([]);
		}
	);
});

describe('mintQuote() — a stock pledge', () => {
	it('saves it with its donor and answers the pending screen’s whole shape', async () => {
		const result = await save(stock({ note: 'For the pantry', programId: undefined }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.quote).toEqual({
			paymentToken: PLEDGE_ID,
			feeMinor: 0,
			totalMinor: 0,
			pledge: {
				id: PLEDGE_ID,
				method: 'stock',
				reference: expect.stringMatching(/^CFCP-AAPL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/),
				receiptTo: 'maya.okafor@example.org',
				ticker: 'AAPL',
				shares: '50',
				deliverTo: 'Harbor Street Securities',
				dtcNumber: '0164',
				accountNumber: 'Z12-345678',
				accountName: 'Cedar Fork Community Pantry Inc.'
			}
		});

		const [row] = await pledges();
		expect(row).toMatchObject({
			id: PLEDGE_ID,
			method: 'stock',
			ticker: 'AAPL',
			shares_millionths: 50_000_000,
			amount_minor: null,
			reference: result.quote.pledge?.reference,
			form_id: FORM_ID,
			origin: ALLOWED,
			note: 'For the pantry',
			told_at: null,
			donation_id: null,
			supporter_page_id: null
		});
		expect(await contacts()).toHaveLength(1);
	});

	it('names the supporter’s fundraiser whose form it was made on', async () => {
		const result = await save(stock({ formId: FUNDRAISER_FORM_ID }), deps(), FUNDRAISER_FORM_ID);

		expect(result.ok).toBe(true);
		expect((await pledges())[0]).toMatchObject({
			form_id: FUNDRAISER_FORM_ID,
			supporter_page_id: FUNDRAISER_PAGE_ID
		});
	});

	it('takes a fractional share to six places', async () => {
		const result = await save(stock({ shares: '12.000001' }));
		expect(result.ok && result.quote.pledge).toMatchObject({ shares: '12.000001' });
		expect((await pledges())[0]?.shares_millionths).toBe(12_000_001);
	});

	it.each([
		['ticker', { ticker: undefined }],
		['shares', { shares: undefined }],
		['shares', { shares: '1.0000001' }],
		['shares', { shares: '0' }],
		['shares', { shares: '-5' }]
	] as const)('saves nothing and names `%s` when it is missing or wrong', async (field, over) => {
		const result = await save(stock(over));

		expect(result).toMatchObject({ ok: false, reason: 'pledge_detail_invalid', field });
		expect(await pledges()).toHaveLength(0);
		expect(await contacts()).toHaveLength(0);
	});

	it('refuses a ticker the list does not hold, before the challenge is spent', async () => {
		const d = deps();
		const result = await save(stock({ ticker: 'ZZQ' }), d);

		expect(result).toMatchObject({ ok: false, reason: 'ticker_not_listed', field: 'ticker' });
		expect(d.checks).toHaveLength(0);
		expect(await pledges()).toHaveLength(0);
	});

	it('refuses a gift that repeats', async () => {
		const result = await save(stock({ frequency: 'monthly' }));
		expect(result).toMatchObject({ ok: false, reason: 'invalid_request' });
		expect(await pledges()).toHaveLength(0);
	});
});

describe('mintQuote() — an IRA (QCD) pledge', () => {
	it('saves it and answers the payee details, the EIN and the amount', async () => {
		const result = await save(ira());

		expect(result.ok && result.quote).toEqual({
			paymentToken: PLEDGE_ID,
			feeMinor: 0,
			totalMinor: 10_000,
			pledge: {
				id: PLEDGE_ID,
				method: 'ira_qcd',
				reference: expect.stringMatching(/^CFCP-IRA-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/),
				receiptTo: 'maya.okafor@example.org',
				amountMinor: 10_000,
				custodian: 'Fidelity Investments',
				payeeName: 'Cedar Fork Community Pantry Inc.',
				ein: '47-3829105',
				mailingAddress: '412 Alder Lane, Suite 3\nCedar Fork, OR 97330'
			}
		});
		expect((await pledges())[0]).toMatchObject({
			method: 'ira_qcd',
			amount_minor: 10_000,
			currency: 'USD',
			custodian: 'Fidelity Investments',
			ticker: null
		});
	});

	it('saves nothing and names `custodian` when it is missing', async () => {
		const result = await save(ira({ custodian: undefined }));
		expect(result).toMatchObject({
			ok: false,
			reason: 'pledge_detail_invalid',
			field: 'custodian'
		});
		expect(await pledges()).toHaveLength(0);
	});

	it('holds the amount to the form’s bounds', async () => {
		const result = await save(ira({ amountMinor: 2_000_000 }));
		expect(result).toMatchObject({ ok: false, reason: 'invalid_request' });
		expect(await pledges()).toHaveLength(0);
	});
});

describe('mintQuote() — a pledge where no receipt can be sent', () => {
	it.each([
		['stock', stock],
		['ira_qcd', ira]
	] as const)(
		'answers a %s pledge with no receipt address where the deployment cannot send mail',
		async (_, body) => {
			const result = await save(body(), { ...deps(), env: NO_MAIL });

			expect(result.ok && result.quote.pledge?.receiptTo).toBe('');
			expect(await contacts()).toHaveLength(1);
		}
	);
});

describe('mintQuote() — what every pledge is refused over', () => {
	it.each([
		['stock', stock],
		['ira_qcd', ira]
	] as const)('refuses %s while its rail is off, as a rail it cannot take', async (rail, make) => {
		await run(stmt('update pledge_rail set enabled = 0 where id = ?', rail));

		const result = await save(make());
		expect(result).toMatchObject({ ok: false, reason: 'payments_not_configured' });
		expect(await pledges()).toHaveLength(0);
	});

	it('refuses a pledge on a rail never turned on', async () => {
		await run(stmt('delete from pledge_rail'));
		expect(await save(stock())).toMatchObject({ ok: false, reason: 'payments_not_configured' });
	});

	it('runs the challenge, and saves nothing when it does not clear', async () => {
		const d = deps({ ok: false, reason: 'rejected', detail: 'token spent', operatorFix: null });
		const result = await save(stock(), d);

		expect(d.checks).toHaveLength(1);
		expect(result).toMatchObject({ ok: false, reason: 'challenge_failed' });
		expect(await pledges()).toHaveLength(0);
	});
});

describe('mintQuote() — a pledge the database fails', () => {
	it('answers `internal_error` rather than throwing, so the route still sends its CORS', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		// `ticker.symbol` is the one column of the real file only `tickerListed` (./tickers.ts) reads:
		// the config read before it reads one row's `replaced_at` (`tickersReplacedAt`), and so still
		// succeeds.
		await run(stmt('alter table ticker rename column symbol to symbol_gone'));
		let result: Awaited<ReturnType<typeof save>>;
		try {
			result = await save(stock());
		} finally {
			await run(stmt('alter table ticker rename column symbol_gone to symbol'));
		}

		expect(result).toMatchObject({ ok: false, reason: 'internal_error' });
		expect(await pledges()).toHaveLength(0);
		const [message, error] =
			logged.mock.calls.find(([m]) => m === 'a pledge could not be saved:') ?? [];
		expect(message).toBe('a pledge could not be saved:');
		expect(sqliteResultCode(error)).toBe('SQLITE_ERROR');
	});
});

describe('mintQuote() — a pledge moves no total', () => {
	it('writes no gift, payment, line or books entry, and leaves the goal where it was', async () => {
		const before = await campaignRaised(db, FORM_ID);

		expect((await save(stock())).ok).toBe(true);
		expect((await save(ira({ pledgeId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }))).ok).toBe(true);

		for (const table of ['donation', 'payment', 'line_item', 'entry_group', 'ledger_entry']) {
			const counted = await first<{ n: number }>(stmt(`select count(*) as n from ${table}`));
			expect(counted?.n, table).toBe(0);
		}
		expect(await campaignRaised(db, FORM_ID)).toEqual(before);
	});
});

describe('mintQuote() — the same press twice', () => {
	it.each([
		['stock', stock],
		['ira_qcd', ira]
	] as const)('saves one %s pledge and answers it again, reference and all', async (_, make) => {
		const first = await save(make());
		const second = await save(make({ note: 'sent again' }));

		expect(second).toEqual(first);
		expect(await pledges()).toHaveLength(1);
		expect(await contacts()).toHaveLength(1);
	});

	it('answers it again after Mark received wrote its gift under the same id', async () => {
		const first = await save(stock());
		const received = await receivePledge(db, {
			pledgeId: PLEDGE_ID,
			amountMinor: 951_240,
			dated: new Date('2026-11-18')
		});
		expect(received.ok).toBe(true);

		expect(await save(stock())).toEqual(first);
		expect(await pledges()).toHaveLength(1);
	});

	it('answers the same donor again whatever case their email is typed in', async () => {
		const first = await save(stock());
		const second = await save(stock({ email: 'Maya.Okafor@example.org' }));

		expect(second).toEqual(first);
	});

	it.each([
		['other shares', stock({ shares: '75' })],
		['another ticker', stock({ ticker: 'MSFT' })],
		['another donor', stock({ email: 'j.whitfield@example.com' })],
		['the other rail', ira()]
	] as const)('refuses the id where it is sent again with %s, saving nothing', async (_, body) => {
		expect((await save(stock())).ok).toBe(true);

		const result = await save(body);

		expect(result).toMatchObject({ ok: false, reason: 'pledge_id_taken' });
		expect(result).not.toHaveProperty('field');
		expect(JSON.stringify(result)).not.toContain('maya.okafor');
		expect(await pledges()).toMatchObject([{ ticker: 'AAPL', shares_millionths: 50_000_000 }]);
		expect(await contacts()).toHaveLength(1);
	});

	it('refuses a resend once its rail is off, on that rail or the other, saving nothing', async () => {
		expect((await save(stock())).ok).toBe(true);
		await run(stmt(`update pledge_rail set enabled = 0 where id = 'stock'`));

		expect(await save(stock())).toMatchObject({ ok: false, reason: 'payments_not_configured' });
		expect(await save(ira())).toMatchObject({ ok: false, reason: 'pledge_id_taken' });
		expect(await pledges()).toMatchObject([{ method: 'stock', ticker: 'AAPL' }]);
	});

	it.each([
		['amount', { amountMinor: 20_000 }],
		['custodian', { custodian: 'Vanguard' }]
	] as const)(
		'refuses the id where an IRA (QCD) pledge is sent again with another %s',
		async (_, over) => {
			expect((await save(ira())).ok).toBe(true);

			expect(await save(ira(over))).toMatchObject({ ok: false, reason: 'pledge_id_taken' });
			expect(await pledges()).toMatchObject([{ amount_minor: 10_000 }]);
		}
	);

	it('refuses an id another form’s pledge holds, and answers nothing of it', async () => {
		expect((await save(stock())).ok).toBe(true);
		const result = await save(stock({ formId: OTHER_FORM_ID }), deps(), OTHER_FORM_ID);

		expect(result).toMatchObject({ ok: false, reason: 'pledge_id_taken' });
		expect(JSON.stringify(result)).not.toContain('maya.okafor');
	});

	it('refuses an id a gift holds, writing nothing, so Mark received never meets it', async () => {
		await run(
			stmt(
				`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
				 values ('019fb600-0000-7000-8000-000000000002', 'individual', 'James Whitfield',
				         'j.whitfield@example.com', 0, 0)`
			)
		);
		await run(
			stmt(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values (?, '019fb600-0000-7000-8000-000000000002', 10000, 'USD', 0, 0)`,
				PLEDGE_ID
			)
		);

		const result = await save(stock());

		expect(result).toMatchObject({ ok: false, reason: 'pledge_id_taken' });
		expect(await pledges()).toHaveLength(0);
		expect(await contacts()).toHaveLength(1);
		expect(
			await receivePledge(db, { pledgeId: PLEDGE_ID, amountMinor: 951_240, dated: new Date() })
		).toEqual({ ok: false, reason: 'not_found' });
	});
});

describe('savePledge() — a reference already taken', () => {
	const TAKEN = 'CFCP-AAPL-7Q2D';

	/** a second pledge to save, and a draw that answers `references` in turn, counting each. */
	function secondPledge(references: readonly string[]) {
		const parsed = parseContact({
			kind: 'individual',
			first_name: 'Ada',
			last_name: 'Okafor',
			primary_email: 'ada@example.org'
		});
		if (!parsed.ok) throw new Error('the fixture donor did not parse');
		const input: PledgeToSave = {
			id: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
			formId: FORM_ID,
			origin: null,
			currency: 'USD',
			pledged: { method: 'stock', ticker: 'AAPL', sharesMillionths: 1_000_000 },
			donor: parsed.value,
			consentedToContact: null,
			note: undefined,
			noteOnPage: undefined,
			tribute: null,
			programId: null
		};
		const drawn: string[] = [];
		const draw = () => {
			const reference = references[Math.min(drawn.length, references.length - 1)] ?? TAKEN;
			drawn.push(reference);
			return reference;
		};
		return { input, draw, drawn };
	}

	beforeEach(async () => {
		expect((await save(stock())).ok).toBe(true);
		await run(stmt('update pledge set reference = ?', TAKEN));
	});

	it('draws another and saves', async () => {
		const { input, draw, drawn } = secondPledge([TAKEN, 'CFCP-AAPL-9W4E']);

		const result = await savePledge(db, input, draw);

		expect(drawn).toEqual([TAKEN, 'CFCP-AAPL-9W4E']);
		expect(result).toMatchObject({ ok: true, value: { reference: 'CFCP-AAPL-9W4E' } });
		expect(await pledges()).toHaveLength(2);
	});

	it('gives up after its last draw, saving neither the pledge nor its donor', async () => {
		const { input, draw, drawn } = secondPledge([TAKEN]);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await savePledge(db, input, draw);

		expect(drawn).toHaveLength(REFERENCE_DRAWS);
		expect(result).toMatchObject({ ok: false, reason: 'failed' });
		expect(await pledges()).toHaveLength(1);
		expect(await contacts()).toHaveLength(1);
		expect(logged).not.toHaveBeenCalled();
	});
});
