import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from './accounts';
import { first, run, stmt } from './database.testing';
import { rejectionCode } from './rejection.testing';

// what 0044 lets the schema hold for a hosted site, whose fiscal sponsor is its only payment
// provider: `sponsor` on `payment.provider` and `recurring_plan.provider`, a `payout` source type on
// `entry_group`, and the 4130 Grant income account it books a settled payout to.
//
// every probe runs against the committed `migrations/` applied to a real database
// (./database.testing.ts), and is scoped to its own rows: storage is per file, not per test.

const CONTACT_ID = '019fb700-0000-7000-8000-000000000001';
const FORM_ID = 'frm_sponsorprobe';
const DONATION_ID = '019fb700-0000-7000-8000-000000000002';

beforeAll(async () => {
	await run(
		stmt(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Probe Donor', 0, 0)`,
			CONTACT_ID
		)
	);
	await run(
		stmt(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values (?, 'probe', ?, 'USD', 0, 0)`,
			FORM_ID,
			POSTING_ACCOUNTS.donationsDeductible.id
		)
	);
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 10000, 'USD', 0, 0)`,
			DONATION_ID,
			CONTACT_ID
		)
	);
});

const insertPayment = (id: string, provider: string, txnId: string | null) =>
	run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method,
			                      status, provider, provider_txn_id, occurred_at, created_at)
			 values (?, ?, 10000, 'USD', 'inbound', 'card', 'succeeded', ?, ?, 0, 0)`,
			id,
			DONATION_ID,
			provider,
			txnId
		)
	);

describe('a payment the sponsor took', () => {
	it('is recorded under provider sponsor, with the id the sponsor gave it', async () => {
		await insertPayment('p-sponsor', 'sponsor', 'sp_gift_1');
		const row = await first(
			stmt('select provider as p, provider_txn_id as t from payment where id = ?', 'p-sponsor')
		);
		expect(row).toEqual({ p: 'sponsor', t: 'sp_gift_1' });
	});

	it('is refused without that id, since only manual entry goes without one', async () => {
		const chain = await rejectionCode(() => insertPayment('p-sponsor-noid', 'sponsor', null));
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('payment_processor_needs_txn_id_check');
	});

	it('leaves a provider the schema does not name refused', async () => {
		const chain = await rejectionCode(() => insertPayment('p-bogus', 'braintree', 'bt_1'));
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('payment_provider_check');
	});
});

const insertPlan = (id: string, provider: string) =>
	run(
		stmt(
			`insert into recurring_plan
			   (id, contact_id, form_id, amount_minor, currency, "interval", status, provider,
			    provider_subscription_id, provider_customer_id, started_at, created_at, updated_at)
			 values (?, ?, ?, 2500, 'USD', 'monthly', 'active', ?, ?, 'cus_probe', 0, 0, 0)`,
			id,
			CONTACT_ID,
			FORM_ID,
			provider,
			`sub_${id}`
		)
	);

describe('a repeating gift the sponsor runs', () => {
	it('is a commitment under provider sponsor', async () => {
		await insertPlan('plan-sponsor', 'sponsor');
		const row = await first(
			stmt('select provider as p from recurring_plan where id = ?', 'plan-sponsor')
		);
		expect(row).toEqual({ p: 'sponsor' });
	});

	it('leaves a provider the schema does not name refused', async () => {
		const chain = await rejectionCode(() => insertPlan('plan-bogus', 'braintree'));
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('recurring_plan_provider_check');
	});
});

const insertGroup = (id: string, sourceType: string, sourceId: string) =>
	run(
		stmt(
			`insert into entry_group (id, source_type, source_id, currency, occurred_at, created_at)
			 values (?, ?, ?, 'USD', 0, 0)`,
			id,
			sourceType,
			sourceId
		)
	);

describe('a journal entry a sponsor payout caused', () => {
	it('is posted under source type payout, a settlement and its return each on its own key', async () => {
		await insertGroup('eg-settled', 'payout', 'settled:po_1');
		await insertGroup('eg-returned', 'payout', 'returned:pr_1');
		const row = await first(
			stmt(
				`select group_concat(source_id, ' ') as ids from
				   (select source_id from entry_group where source_type = 'payout' order by source_id)`
			)
		);
		expect(row).toEqual({ ids: 'returned:pr_1 settled:po_1' });
	});

	it('is refused a second time on the same key, so a redelivered payout posts once', async () => {
		await insertGroup('eg-once', 'payout', 'settled:po_once');
		const chain = await rejectionCode(() => insertGroup('eg-twice', 'payout', 'settled:po_once'));
		expect(chain).toContain('SQLITE_CONSTRAINT_UNIQUE');
		expect(chain).toContain('entry_group.source_type, entry_group.source_id');
	});

	it('leaves a source type the schema does not name refused', async () => {
		const chain = await rejectionCode(() => insertGroup('eg-bogus', 'grant', 'g_1'));
		expect(chain).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(chain).toContain('entry_group_source_type_check');
	});
});

describe('the account a settled payout is booked to', () => {
	it('is 4130 Grant income, postable revenue under the 4100 Donations rollup', async () => {
		const row = await first(
			stmt(
				`select a.code, a.name, a.type, a.is_postable, p.code as parent
				   from account a left join account p on p.id = a.parent_id
				  where a.id = ?`,
				POSTING_ACCOUNTS.grantIncome.id
			)
		);
		expect(row).toEqual({
			code: '4130',
			name: 'Grant income',
			type: 'revenue',
			is_postable: 1,
			parent: '4100'
		});
	});
});
