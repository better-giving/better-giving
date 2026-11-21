import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, first, run, stmt } from '../db/database.testing';
import { listWaitingPledges, WAITING_PLEDGE_LIMIT } from './pledges';

// the Gifts screen's "Waiting to arrive" read, against a real database.

let db: Db;

const MAYA = '019fb600-0000-7000-8000-000000000001';
const JAMES = '019fb600-0000-7000-8000-000000000002';
const RECEIVED_GIFT = '019fb600-0000-7000-8000-000000000003';
const FORM_ID = '019fb600-0000-7000-8000-000000000004';

beforeAll(async () => {
	db = createDb(client);
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
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Okafor', 'maya.okafor@example.org', 0, 0),
			        (?, 'individual', 'James Whitfield', 'j.whitfield@example.com', 0, 0)`,
			MAYA,
			JAMES
		)
	);
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 951240, 'USD', 0, 0)`,
			RECEIVED_GIFT,
			MAYA
		)
	);
});

beforeEach(async () => {
	await run(stmt('delete from pledge'));
});

const stockPledge = (opts: {
	id: string;
	reference: string;
	toldAt?: number | null;
	donationId?: string | null;
	createdAt: number;
}) =>
	run(
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, ticker, shares_millionths,
			                     told_at, donation_id, form_id, created_at)
			 values (?, 'stock', ?, 'USD', ?, 'AAPL', 50000000, ?, ?, ?, ?)`,
			opts.id,
			MAYA,
			opts.reference,
			opts.toldAt ?? null,
			opts.donationId ?? null,
			FORM_ID,
			opts.createdAt
		)
	);

const iraPledge = (opts: { id: string; reference: string; createdAt: number }) =>
	run(
		stmt(
			`insert into pledge (id, method, contact_id, currency, reference, custodian, amount_minor,
			                     form_id, created_at)
			 values (?, 'ira_qcd', ?, 'USD', ?, 'Fidelity Investments', 500000, ?, ?)`,
			opts.id,
			JAMES,
			opts.reference,
			FORM_ID,
			opts.createdAt
		)
	);

describe('listWaitingPledges', () => {
	it('lists each pledge not yet received, newest first, with its donor and what was pledged', async () => {
		await stockPledge({
			id: '019fb600-0000-7000-8000-000000000101',
			reference: 'CFCP-AAPL-7Q2D',
			toldAt: 1_795_000_000_000,
			createdAt: 1_794_000_000_000
		});
		await iraPledge({
			id: '019fb600-0000-7000-8000-000000000102',
			reference: 'CFCP-IRA-4K9M',
			createdAt: 1_794_500_000_000
		});

		expect(await listWaitingPledges(db)).toEqual({
			total: 2,
			pledges: [
				{
					id: '019fb600-0000-7000-8000-000000000102',
					reference: 'CFCP-IRA-4K9M',
					donorName: 'James Whitfield',
					donorEmail: 'j.whitfield@example.com',
					pledged: {
						method: 'ira_qcd',
						amountMinor: 500_000,
						currency: 'USD',
						custodian: 'Fidelity Investments'
					},
					toldAt: null,
					createdAt: new Date(1_794_500_000_000)
				},
				{
					id: '019fb600-0000-7000-8000-000000000101',
					reference: 'CFCP-AAPL-7Q2D',
					donorName: 'Maya Okafor',
					donorEmail: 'maya.okafor@example.org',
					pledged: { method: 'stock', ticker: 'AAPL', sharesMillionths: 50_000_000 },
					toldAt: new Date(1_795_000_000_000),
					createdAt: new Date(1_794_000_000_000)
				}
			]
		});
	});

	it('leaves out a pledge staff have marked received, which is a gift on the table now', async () => {
		await stockPledge({
			id: '019fb600-0000-7000-8000-000000000103',
			reference: 'CFCP-AAPL-8R3E',
			donationId: RECEIVED_GIFT,
			createdAt: 1_794_000_000_000
		});
		expect(await listWaitingPledges(db)).toEqual({ total: 0, pledges: [] });
	});

	it('lists the newest WAITING_PLEDGE_LIMIT and counts every one waiting', async () => {
		const held = WAITING_PLEDGE_LIMIT + 1;
		const ids = Array.from(
			{ length: held },
			(_, n) => `019fb600-0000-7000-8000-${String(n).padStart(12, '0')}`
		);
		await client.batch(
			ids.map((id, n) =>
				stmt(
					`insert into pledge (id, method, contact_id, currency, reference, ticker, shares_millionths,
					                     form_id, created_at)
					 values (?, 'stock', ?, 'USD', ?, 'AAPL', 50000000, ?, ?)`,
					id,
					MAYA,
					`CFCP-AAPL-${String(n).padStart(4, '0')}`,
					FORM_ID,
					1_794_000_000_000 + n
				)
			)
		);

		const { total, pledges } = await listWaitingPledges(db);

		expect(total).toBe(held);
		expect(pledges).toHaveLength(WAITING_PLEDGE_LIMIT);
		expect(pledges[0]?.id).toBe(ids[held - 1]);
		expect(pledges.map((p) => p.id)).not.toContain(ids[0]);
	});

	it('orders two pledges made in the same millisecond by id, the later id first', async () => {
		await stockPledge({
			id: '019fb600-0000-7000-8000-000000000201',
			reference: 'CFCP-AAPL-2A2A',
			createdAt: 1_794_000_000_000
		});
		await stockPledge({
			id: '019fb600-0000-7000-8000-000000000202',
			reference: 'CFCP-AAPL-2B2B',
			createdAt: 1_794_000_000_000
		});

		expect((await listWaitingPledges(db)).pledges.map((p) => p.id)).toEqual([
			'019fb600-0000-7000-8000-000000000202',
			'019fb600-0000-7000-8000-000000000201'
		]);
	});
});
