import { beforeAll, describe, expect, it } from 'vitest';
import { first, run, stmt } from '../db/database.testing';
import { rejectionCode } from './rejection.testing';

// the constraints on `pledge_rail` and `pledge`, the two tables stock and IRA (QCD) gifts stand on,
// and the `payment` a pledge becomes at Mark received. each is held here by the extended result
// code it raises, never its prose (CONTRIBUTING.md -> Tests).
//
// every query below is scoped to its own rows — the pool gives per-file storage, not per-test.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
const SQLITE_CONSTRAINT_NOTNULL = 'SQLITE_CONSTRAINT_NOTNULL';

const CONTACT_ID = '019fb500-0000-7000-8000-000000000001';
const DONATION_ID = '019fb500-0000-7000-8000-000000000002';
const FORM_ID = '019fb500-0000-7000-8000-000000000003';

beforeAll(async () => {
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
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Maya Okafor', 0, 0)`,
			CONTACT_ID
		)
	);
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 951240, 'USD', 0, 0)`,
			DONATION_ID,
			CONTACT_ID
		)
	);
});

const insertRail = (opts: {
	id: string;
	enabled: 0 | 1;
	brokerageName?: string | null;
	dtcNumber?: string | null;
	accountNumber?: string | null;
	accountName?: string | null;
	payeeName?: string | null;
	mailingAddress?: string | null;
}) =>
	run(
		stmt(
			`insert into pledge_rail (id, enabled, brokerage_name, dtc_number, account_number, account_name,
			                          payee_name, mailing_address, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
			opts.id,
			opts.enabled,
			opts.brokerageName ?? null,
			opts.dtcNumber ?? null,
			opts.accountNumber ?? null,
			opts.accountName ?? null,
			opts.payeeName ?? null,
			opts.mailingAddress ?? null
		)
	);

describe('pledge_rail', () => {
	it('refuses a stock rail turned on with a detail missing', async () => {
		expect(
			await rejectionCode(() =>
				insertRail({
					id: 'stock',
					enabled: 1,
					brokerageName: 'Harbor Street Securities',
					dtcNumber: null,
					accountNumber: 'Z12-345678',
					accountName: 'Cedar Fork Community Pantry Inc.'
				})
			)
		).toContain(SQLITE_CONSTRAINT_CHECK);
	});

	it('keeps details that are not complete on a rail turned off, which is what Disable leaves', async () => {
		await insertRail({ id: 'ira_qcd', enabled: 0, payeeName: 'Cedar Fork Community Pantry Inc.' });
		expect(await first(stmt(`select enabled from pledge_rail where id = 'ira_qcd'`))).toEqual({
			enabled: 0
		});
	});

	it("refuses a detail stated on the other rail's row", async () => {
		expect(
			await rejectionCode(() =>
				insertRail({ id: 'stock', enabled: 0, payeeName: 'Cedar Fork Community Pantry Inc.' })
			)
		).toContain(SQLITE_CONSTRAINT_CHECK);
	});

	it('refuses a rail the schema does not have', async () => {
		expect(await rejectionCode(() => insertRail({ id: 'bond', enabled: 0 }))).toContain(
			SQLITE_CONSTRAINT_CHECK
		);
	});
});

const insertPledge = (opts: {
	id: string;
	method: string;
	reference: string;
	ticker?: string | null;
	sharesMillionths?: number | null;
	custodian?: string | null;
	amountMinor?: number | null;
	formId?: string | null;
}) =>
	run(
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, ticker, shares_millionths,
			                     custodian, amount_minor, form_id, created_at)
			 values (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, 0)`,
			opts.id,
			opts.method,
			CONTACT_ID,
			opts.reference,
			opts.ticker ?? null,
			opts.sharesMillionths ?? null,
			opts.custodian ?? null,
			opts.amountMinor ?? null,
			opts.formId === undefined ? FORM_ID : opts.formId
		)
	);

const stockPledge = (id: string, reference: string) =>
	insertPledge({ id, method: 'stock', reference, ticker: 'AAPL', sharesMillionths: 50_000_000 });

describe('pledge', () => {
	it('refuses a second pledge under a reference already given out', async () => {
		await stockPledge('019fb500-0000-7000-8000-000000000101', 'CFCP-AAPL-7Q2D');
		expect(
			await rejectionCode(() =>
				stockPledge('019fb500-0000-7000-8000-000000000102', 'CFCP-AAPL-7Q2D')
			)
		).toContain(SQLITE_CONSTRAINT_UNIQUE);
	});

	it('refuses a pledge on no form, which the told press could never find', async () => {
		expect(
			await rejectionCode(() =>
				insertPledge({
					id: '019fb500-0000-7000-8000-000000000108',
					method: 'stock',
					reference: 'CFCP-AAPL-6U7H',
					ticker: 'AAPL',
					sharesMillionths: 50_000_000,
					formId: null
				})
			)
		).toContain(SQLITE_CONSTRAINT_NOTNULL);
	});

	it('refuses a reference in lowercase, which would read back as a second spelling', async () => {
		expect(
			await rejectionCode(() =>
				stockPledge('019fb500-0000-7000-8000-000000000103', 'cfcp-aapl-8r3e')
			)
		).toContain(SQLITE_CONSTRAINT_CHECK);
	});

	it('refuses a stock pledge carrying a dollar figure, which only Mark received may state', async () => {
		expect(
			await rejectionCode(() =>
				insertPledge({
					id: '019fb500-0000-7000-8000-000000000104',
					method: 'stock',
					reference: 'CFCP-AAPL-9S4F',
					ticker: 'AAPL',
					sharesMillionths: 50_000_000,
					amountMinor: 1
				})
			)
		).toContain(SQLITE_CONSTRAINT_CHECK);
	});

	it('refuses an IRA (QCD) pledge naming no custodian', async () => {
		expect(
			await rejectionCode(() =>
				insertPledge({
					id: '019fb500-0000-7000-8000-000000000105',
					method: 'ira_qcd',
					reference: 'CFCP-IRA-4K9M',
					amountMinor: 500_000
				})
			)
		).toContain(SQLITE_CONSTRAINT_CHECK);
	});

	it('refuses a second pledge claiming a gift one pledge already became', async () => {
		const into = (id: string) =>
			run(stmt(`update pledge set donation_id = ? where id = ?`, DONATION_ID, id));
		await stockPledge('019fb500-0000-7000-8000-000000000107', 'CFCP-AAPL-3T5G');
		await insertPledge({
			id: '019fb500-0000-7000-8000-000000000106',
			method: 'ira_qcd',
			reference: 'CFCP-IRA-5L2N',
			custodian: 'Fidelity Investments',
			amountMinor: 500_000
		});
		await into('019fb500-0000-7000-8000-000000000107');
		expect(
			await first(
				stmt('select donation_id from pledge where id = ?', '019fb500-0000-7000-8000-000000000107')
			)
		).toEqual({ donation_id: DONATION_ID });
		expect(await rejectionCode(() => into('019fb500-0000-7000-8000-000000000106'))).toContain(
			SQLITE_CONSTRAINT_UNIQUE
		);
	});
});

const insertPayment = (id: string, method: string, amountMinor: number) =>
	run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
			                      provider, occurred_at, created_at)
			 values (?, ?, ?, 'USD', 'inbound', ?, 'succeeded', 'manual', 0, 0)`,
			id,
			DONATION_ID,
			amountMinor,
			method
		)
	);

describe('the payment a pledge becomes at Mark received', () => {
	it('is written on the stock and IRA (QCD) rails, settled by staff', async () => {
		await insertPayment('019fb500-0000-7000-8000-000000000201', 'stock', 951_240);
		await insertPayment('019fb500-0000-7000-8000-000000000202', 'ira_qcd', 500_000);
		expect(
			await first(
				stmt(
					`select count(*) as n from payment where donation_id = ? and status = 'succeeded'`,
					DONATION_ID
				)
			)
		).toEqual({ n: 2 });
	});

	it('refuses a succeeded pledge with no value', async () => {
		expect(
			await rejectionCode(() => insertPayment('019fb500-0000-7000-8000-000000000203', 'stock', 0))
		).toContain(SQLITE_CONSTRAINT_CHECK);
	});
});
