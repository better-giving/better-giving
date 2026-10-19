import { beforeAll, describe, expect, it } from 'vitest';
import { run, first, all, stmt } from '../db/database.testing';
import { rejectionCode } from './rejection.testing';

// the constraints on `payment.provider_reference`, off the committed migrations. the column arrived
// by `ADD COLUMN` with its checks written by hand into the migration rather than rendered from
// schema.ts, so the shared `optionalNotBlank` body pinned on `provider_txn_id` in
// ./donation-schema.db.spec.ts says nothing about the copy here.
//
// every query below is scoped to its own rows — the pool gives per-file storage, not per-test.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';

const CONTACT_ID = '019fb500-0000-7000-8000-000000000001';
const DONATION_ID = '019fb500-0000-7000-8000-000000000002';

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
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
		 values (?, ?, 10000, 'USD', 0, 0)`,
			DONATION_ID,
			CONTACT_ID
		)
	);
});

const insertPayment = (
	id: string,
	provider: string | null,
	txnId: string | null,
	reference: string | null
) =>
	run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      provider, provider_txn_id, occurred_at, created_at, provider_reference)
		 values (?, ?, 10000, 'USD', 'inbound', 'daf', 'pending', ?, ?, 0, 0, ?)`,
			id,
			DONATION_ID,
			provider,
			txnId,
			reference
		)
	);

describe('a payment carries the reference its processor matches it by', () => {
	it('arrives as a nullable text column', async () => {
		const column = await first(
			stmt(`select type, "notnull" as n, dflt_value as d
			 from pragma_table_info('payment') where name = 'provider_reference'`)
		);
		expect(column).toEqual({ type: 'TEXT', n: 0, d: null });
	});

	it('stores a grant tracking ID on a chariot row, as written', async () => {
		await insertPayment('p-ref-chariot', 'chariot', 'grant_ref', 'TRK-4821');
		const row = await first(
			stmt('select provider_reference as r from payment where id = ?', 'p-ref-chariot')
		);
		expect(row).toEqual({ r: 'TRK-4821' });
	});

	it('admits a row with no reference, whatever its provider', async () => {
		await insertPayment('p-ref-none-stripe', 'stripe', 'pi_ref', null);
		await insertPayment('p-ref-none-unknown', null, null, null);
		const results = await all(
			stmt(`select id, provider_reference as r from payment
			 where id in ('p-ref-none-stripe', 'p-ref-none-unknown') order by id`)
		);
		expect(results).toEqual([
			{ id: 'p-ref-none-stripe', r: null },
			{ id: 'p-ref-none-unknown', r: null }
		]);
	});

	// a blank reference reads as one given and matches nothing on the processor's side, which is
	// worse than null for staff looking for the grant a gift came from.
	it.each(['', ' \t\n'])('refuses a blank reference %j', async (reference) => {
		const message = await rejectionCode(() =>
			insertPayment(
				`p-ref-blank-${reference.length}`,
				'chariot',
				`grant_${reference.length}`,
				reference
			)
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_provider_reference_not_blank_check');
	});

	it('refuses a reference on a row naming no provider', async () => {
		const message = await rejectionCode(() =>
			insertPayment('p-ref-orphan', null, null, 'TRK-0001')
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_provider_reference_needs_provider_check');
	});
});
